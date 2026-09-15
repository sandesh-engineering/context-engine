import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import * as crypto from 'crypto';
import {
  IObjectStorageService,
  UploadPartResult,
  CompleteMultipartUploadResult,
} from '../interfaces/object-storage.interface';
import { RetryPolicy } from '../../resilience/retry-policy';

export interface S3StorageAdapterOptions {
  bucketName: string;
  client?: S3Client;
  retryPolicy?: RetryPolicy;
  minPartSizeBytes?: number; // S3 minimum is 5MB for multipart
}

export interface StreamUploadResult extends CompleteMultipartUploadResult {
  sha256Digest: string;
  byteSize: number;
}

@Injectable()
export class S3StorageAdapter implements IObjectStorageService {
  private readonly logger = new Logger(S3StorageAdapter.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly retryPolicy: RetryPolicy;
  private readonly minPartSizeBytes: number;

  constructor(options: S3StorageAdapterOptions) {
    this.bucketName = options.bucketName;
    this.s3Client = options.client || new S3Client({});
    this.retryPolicy = options.retryPolicy || new RetryPolicy();
    this.minPartSizeBytes = options.minPartSizeBytes || 5 * 1024 * 1024; // 5 MB
  }

  async createMultipartUpload(
    key: string,
    metadata?: Record<string, string>,
  ): Promise<string> {
    return this.retryPolicy.execute(async () => {
      const command = new CreateMultipartUploadCommand({
        Bucket: this.bucketName,
        Key: key,
        Metadata: metadata,
      });

      const response = await this.s3Client.send(command);
      if (!response.UploadId) {
        throw new Error(`Failed to initiate multipart upload for key ${key}: Missing UploadId`);
      }
      return response.UploadId;
    });
  }

  async uploadPart(
    uploadId: string,
    key: string,
    partNumber: number,
    buffer: Buffer,
  ): Promise<UploadPartResult> {
    return this.retryPolicy.execute(async () => {
      const command = new UploadPartCommand({
        Bucket: this.bucketName,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: buffer,
      });

      const response = await this.s3Client.send(command);
      if (!response.ETag) {
        throw new Error(`UploadPart ${partNumber} for key ${key} returned no ETag`);
      }

      return {
        partNumber,
        eTag: response.ETag.replace(/"/g, ''),
      };
    });
  }

  async completeMultipartUpload(
    uploadId: string,
    key: string,
    parts: UploadPartResult[],
  ): Promise<CompleteMultipartUploadResult> {
    return this.retryPolicy.execute(async () => {
      const sortedParts = [...parts]
        .sort((a, b) => a.partNumber - b.partNumber)
        .map((p) => ({
          PartNumber: p.partNumber,
          ETag: p.eTag.startsWith('"') ? p.eTag : `"${p.eTag}"`,
        }));

      const command = new CompleteMultipartUploadCommand({
        Bucket: this.bucketName,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: sortedParts,
        },
      });

      const response = await this.s3Client.send(command);
      return {
        key: response.Key || key,
        eTag: (response.ETag || '').replace(/"/g, ''),
        location: response.Location,
      };
    });
  }

  async abortMultipartUpload(uploadId: string, key: string): Promise<void> {
    try {
      const command = new AbortMultipartUploadCommand({
        Bucket: this.bucketName,
        Key: key,
        UploadId: uploadId,
      });
      await this.s3Client.send(command);
      this.logger.log(`Successfully aborted multipart upload ${uploadId} for key ${key}`);
    } catch (error) {
      this.logger.warn(
        `Failed to abort multipart upload ${uploadId} for key ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      await this.s3Client.send(command);
      this.logger.log(`Compensating deletion: deleted object ${key} from bucket ${this.bucketName}`);
    } catch (error) {
      this.logger.error(
        `Failed compensating deletion for key ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType?: string,
    metadata?: Record<string, string>,
  ): Promise<{ key: string; eTag: string }> {
    return this.retryPolicy.execute(async () => {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
        Metadata: metadata,
      });

      const response = await this.s3Client.send(command);
      return {
        key,
        eTag: (response.ETag || '').replace(/"/g, ''),
      };
    });
  }

  /**
   * High-level streaming uploader with bounded memory buffering,
   * incremental SHA-256 calculation, and deterministic cleanup on abort/error.
   */
  async streamToStorage(
    key: string,
    stream: Readable,
    options?: { metadata?: Record<string, string>; partSize?: number },
  ): Promise<StreamUploadResult> {
    const partSize = options?.partSize || this.minPartSizeBytes;
    const sha256Hash = crypto.createHash('sha256');
    let uploadId: string | null = null;
    let totalBytes = 0;
    let partNumber = 1;
    const parts: UploadPartResult[] = [];
    let currentBufferChunks: Buffer[] = [];
    let currentBufferLength = 0;

    try {
      uploadId = await this.createMultipartUpload(key, options?.metadata);

      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        sha256Hash.update(buffer);
        totalBytes += buffer.length;

        currentBufferChunks.push(buffer);
        currentBufferLength += buffer.length;

        if (currentBufferLength >= partSize) {
          const partBuffer = Buffer.concat(currentBufferChunks);
          const uploadPartResult = await this.uploadPart(
            uploadId,
            key,
            partNumber++,
            partBuffer,
          );
          parts.push(uploadPartResult);

          currentBufferChunks = [];
          currentBufferLength = 0;
        }
      }

      // Upload remaining final part if any
      if (currentBufferLength > 0 || parts.length === 0) {
        const finalBuffer = Buffer.concat(currentBufferChunks);
        const uploadPartResult = await this.uploadPart(
          uploadId,
          key,
          partNumber,
          finalBuffer,
        );
        parts.push(uploadPartResult);
      }

      const completeResult = await this.completeMultipartUpload(
        uploadId,
        key,
        parts,
      );

      const finalSha256 = sha256Hash.digest('hex');

      return {
        ...completeResult,
        sha256Digest: finalSha256,
        byteSize: totalBytes,
      };
    } catch (error) {
      if (uploadId) {
        await this.abortMultipartUpload(uploadId, key);
      }
      throw error;
    }
  }
}

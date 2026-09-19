import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import * as crypto from 'crypto';
import {
  IObjectStorageService,
  UploadPartResult,
  CompleteMultipartUploadResult,
  StreamUploadResult,
} from '../interfaces/object-storage.interface';
import { RetryPolicy } from '../../resilience/retry-policy';

export type { StreamUploadResult };

export interface S3StorageAdapterOptions {
  bucketName: string;
  client?: S3Client;
  retryPolicy?: RetryPolicy;
  minPartSizeBytes?: number; // S3 minimum is 5MB for multipart
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
        `Failed to abort multipart upload ${uploadId} for key ${key}: ${error instanceof Error ? error.message : String(error)
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
        `Failed compensating deletion for key ${key}: ${error instanceof Error ? error.message : String(error)
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

  async streamToStorage(
    key: string,
    stream: Readable,
    options?: {
      metadata?: Record<string, string>;
      partSize?: number;
    },
  ): Promise<StreamUploadResult> {

    /* Size of each multipart part. */
    const partSize = options?.partSize || this.minPartSizeBytes;

    /* Incrementally calculate the file's content hash. */
    const sha256Hash = crypto.createHash('sha256');

    /* Multipart upload identifier. */
    let uploadId: string | null = null;

    /* Total uploaded bytes. */
    let totalBytes = 0;

    /* Current multipart part number. */
    let partNumber = 1;

    /* Uploaded part metadata required for completion. */
    const parts: UploadPartResult[] = [];

    /* Buffer only the current part. */
    let currentBufferChunks: Buffer[] = [];
    let currentBufferLength = 0;

    try {
      /* Start multipart upload. */
      uploadId = await this.createMultipartUpload(
        key,
        options?.metadata,
      );

      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk);

        /* Update content hash. */
        sha256Hash.update(buffer);

        /* Track total file size. */
        totalBytes += buffer.length;

        /* Add data to the current part. */
        currentBufferChunks.push(buffer);
        currentBufferLength += buffer.length;

        if (currentBufferLength >= partSize) {
          /* Build the current part. */
          const partBuffer = Buffer.concat(currentBufferChunks);

          /* Upload the part. */
          const uploadPartResult = await this.uploadPart(
            uploadId,
            key,
            partNumber++,
            partBuffer,
          );

          /* Remember the uploaded part. */
          parts.push(uploadPartResult);

          /* Start the next part. */
          currentBufferChunks = [];
          currentBufferLength = 0;
        }
      }

      /* Upload the final part. */
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

      /* Assemble all parts into the final object. */
      const completeResult = await this.completeMultipartUpload(
        uploadId,
        key,
        parts,
      );

      /* Get the final content fingerprint. */
      const sha256Digest = sha256Hash.digest('hex');

      return {
        ...completeResult,
        sha256Digest,
        byteSize: totalBytes,
      };
    } catch (error) {
      /* Remove incomplete multipart upload. */
      if (uploadId) {
        await this.abortMultipartUpload(uploadId, key);
      }

      throw error;
    }
  }

  /**
   * Retrieves a readable stream for an object stored in S3.
   *
   * @param {string} key - S3 object storage key
   * @returns {Promise<Readable>} Readable stream of object binary payload
   */
  async getObjectStream(key: string): Promise<Readable> {
    return this.retryPolicy.execute(async () => {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      const response = await this.s3Client.send(command);
      if (!response.Body) {
        throw new Error(`Failed to retrieve object stream for key ${key}: Empty body`);
      }
      return response.Body as Readable;
    });
  }
}

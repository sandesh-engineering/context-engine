import { Injectable } from '@nestjs/common';
import { Readable } from 'stream';
import * as crypto from 'crypto';
import {
  IObjectStorageService,
  UploadPartResult,
  CompleteMultipartUploadResult,
  StreamUploadResult,
} from '../interfaces/object-storage.interface';

@Injectable()
export class MemoryStorageAdapter implements IObjectStorageService {
  public objects = new Map<string, { buffer: Buffer; metadata?: Record<string, string>; eTag: string }>();
  public activeMultipartUploads = new Map<string, { key: string; parts: Map<number, Buffer>; metadata?: Record<string, string> }>();
  public deletedKeys: string[] = [];
  public abortedUploadIds: string[] = [];

  async createMultipartUpload(key: string, metadata?: Record<string, string>): Promise<string> {
    const uploadId = `mem_upload_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    this.activeMultipartUploads.set(uploadId, {
      key,
      parts: new Map<number, Buffer>(),
      metadata,
    });
    return uploadId;
  }

  async uploadPart(
    uploadId: string,
    key: string,
    partNumber: number,
    buffer: Buffer,
  ): Promise<UploadPartResult> {
    const session = this.activeMultipartUploads.get(uploadId);
    if (!session) {
      throw new Error(`UploadId ${uploadId} not found`);
    }
    session.parts.set(partNumber, buffer);
    const eTag = crypto.createHash('md5').update(buffer).digest('hex');
    return { partNumber, eTag };
  }

  async completeMultipartUpload(
    uploadId: string,
    key: string,
    parts: UploadPartResult[],
  ): Promise<CompleteMultipartUploadResult> {
    const session = this.activeMultipartUploads.get(uploadId);
    if (!session) {
      throw new Error(`UploadId ${uploadId} not found`);
    }

    const sortedBuffers = [...session.parts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, buf]) => buf);

    const fullBuffer = Buffer.concat(sortedBuffers);
    const eTag = `${crypto.createHash('md5').update(fullBuffer).digest('hex')}-${parts.length}`;

    this.objects.set(key, {
      buffer: fullBuffer,
      metadata: session.metadata,
      eTag,
    });

    this.activeMultipartUploads.delete(uploadId);

    return {
      key,
      eTag,
      location: `memory://${key}`,
    };
  }

  async abortMultipartUpload(uploadId: string, key: string): Promise<void> {
    this.abortedUploadIds.push(uploadId);
    this.activeMultipartUploads.delete(uploadId);
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType?: string,
    metadata?: Record<string, string>,
  ): Promise<{ key: string; eTag: string }> {
    const eTag = crypto.createHash('md5').update(body).digest('hex');
    this.objects.set(key, {
      buffer: body,
      metadata: { ...metadata, contentType: contentType || 'application/octet-stream' },
      eTag,
    });
    return { key, eTag };
  }

  async deleteObject(key: string): Promise<void> {
    this.deletedKeys.push(key);
    this.objects.delete(key);
  }

  async streamToStorage(
    key: string,
    stream: Readable,
    options?: { metadata?: Record<string, string>; partSize?: number },
  ): Promise<StreamUploadResult> {
    const uploadId = await this.createMultipartUpload(key, options?.metadata);
    const sha256Hash = crypto.createHash('sha256');
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    try {
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        sha256Hash.update(buffer);
        chunks.push(buffer);
        totalBytes += buffer.length;
      }

      const fullBuffer = Buffer.concat(chunks);
      const partResult = await this.uploadPart(uploadId, key, 1, fullBuffer);
      const completeResult = await this.completeMultipartUpload(uploadId, key, [partResult]);

      return {
        ...completeResult,
        sha256Digest: sha256Hash.digest('hex'),
        byteSize: totalBytes,
      };
    } catch (err) {
      await this.abortMultipartUpload(uploadId, key);
      throw err;
    }
  }
}

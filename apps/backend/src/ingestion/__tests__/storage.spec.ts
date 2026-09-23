import { Readable } from 'stream';
import { S3StorageAdapter } from '../storage/adapters/s3-storage.adapter';
import { MemoryStorageAdapter } from '../storage/adapters/memory-storage.adapter';
import { RetryPolicy } from '../resilience/retry-policy';

describe('Storage Adapters Tests', () => {
  describe('MemoryStorageAdapter', () => {
    let adapter: MemoryStorageAdapter;

    beforeEach(() => {
      adapter = new MemoryStorageAdapter();
    });

    it('should stream to storage and compute sha256 correctly', async () => {
      const content = 'Test Document Content for Streaming';
      const stream = Readable.from([Buffer.from(content)]);
      const key = 'tenants/t1/documents/d1/v1/raw.bin';

      const result = await adapter.streamToStorage(key, stream);

      expect(result.key).toBe(key);
      expect(result.byteSize).toBe(Buffer.byteLength(content));
      expect(result.sha256Digest).toBeDefined();
      expect(adapter.objects.has(key)).toBe(true);
    });

    it('should abort multipart upload if stream fails midway', async () => {
      const failingStream = new Readable({
        read() {
          this.emit('error', new Error('Network stream interrupted'));
        },
      });
      const key = 'tenants/t1/documents/d1/v1/failed.bin';

      await expect(adapter.streamToStorage(key, failingStream)).rejects.toThrow(
        'Network stream interrupted',
      );
      expect(adapter.abortedUploadIds.length).toBe(1);
      expect(adapter.objects.has(key)).toBe(false);
    });

    it('should perform compensating deletion', async () => {
      const key = 'tenants/t1/documents/d1/v1/temp.bin';
      await adapter.putObject?.(key, Buffer.from('temp'), 'application/pdf');
      await adapter.deleteObject(key);

      expect(adapter.deletedKeys).toContain(key);
      expect(adapter.objects.has(key)).toBe(false);
    });
  });

  describe('S3StorageAdapter with Mocks & Retries', () => {
    it('should retry transient errors with backoff policy', async () => {
      let sendAttempts = 0;
      const mockS3Client = {
        send: jest.fn().mockImplementation(async (command: any) => {
          sendAttempts++;
          if (sendAttempts < 3) {
            const err: any = new Error('SlowDown');
            err.name = 'SlowDown';
            err.$metadata = { httpStatusCode: 503 };
            throw err;
          }
          if (command.constructor.name === 'CreateMultipartUploadCommand') {
            return { UploadId: 'test-upload-id-123' };
          }
          if (command.constructor.name === 'UploadPartCommand') {
            return { ETag: '"etag-part-1"' };
          }
          if (command.constructor.name === 'CompleteMultipartUploadCommand') {
            return { Key: 'test-key', ETag: '"final-etag"' };
          }
          return {};
        }),
      } as any;

      const retryPolicy = new RetryPolicy({
        maxAttempts: 3,
        initialDelayMs: 1,
        maxDelayMs: 5,
        sleepFn: () => Promise.resolve(),
      });

      const adapter = new S3StorageAdapter({
        bucketName: 'test-bucket',
        client: mockS3Client,
        retryPolicy,
        minPartSizeBytes: 10,
      });

      const stream = Readable.from([Buffer.from('Test small chunk')]);
      const result = await adapter.streamToStorage('test-key', stream);

      expect(result.key).toBe('test-key');
      expect(sendAttempts).toBeGreaterThanOrEqual(3);
    });

    it('should fail immediately on permanent non-retryable 403 error', async () => {
      let sendAttempts = 0;
      const mockS3Client = {
        send: jest.fn().mockImplementation(async () => {
          sendAttempts++;
          const err: any = new Error('AccessDenied');
          err.name = 'AccessDenied';
          err.$metadata = { httpStatusCode: 403 };
          throw err;
        }),
      } as any;

      const retryPolicy = new RetryPolicy({
        maxAttempts: 3,
        initialDelayMs: 1,
        maxDelayMs: 5,
        sleepFn: () => Promise.resolve(),
      });

      const adapter = new S3StorageAdapter({
        bucketName: 'test-bucket',
        client: mockS3Client,
        retryPolicy,
      });

      const stream = Readable.from([Buffer.from('Test')]);
      await expect(adapter.streamToStorage('forbidden-key', stream)).rejects.toThrow('AccessDenied');
      expect(sendAttempts).toBe(1);
    });
  });
});

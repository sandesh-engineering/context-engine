import { Readable } from 'stream';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { IngestionService } from '../ingestion.service';
import { MemoryStorageAdapter } from '../storage/adapters/memory-storage.adapter';
import { StoragePathBuilder } from '../services/storage-path-builder.service';

describe('Validation Pipeline Tests', () => {
  let service: IngestionService;
  let memoryStorage: MemoryStorageAdapter;

  beforeEach(() => {
    memoryStorage = new MemoryStorageAdapter();
    const mockPersistence = {
      persistUploadedDocument: jest.fn().mockResolvedValue({
        document: { id: 'doc-1', createdAt: new Date() },
        version: { id: 'ver-1' },
        job: { id: 'job-1', status: 'PENDING', stage: 'AVAILABLE' },
      }),
    } as any;
    const mockConfig = {
      get: jest.fn().mockReturnValue(500 * 1024 * 1024),
    } as any;
    service = new IngestionService(
      memoryStorage,
      mockPersistence,
      new StoragePathBuilder(),
      mockConfig,
    );
  });

  it('should accept valid PDF stream and preserve original bytes exactly once downstream', async () => {
    const pdfContent = '%PDF-1.7\nSample Knowledge Document Content Part 1 Part 2';
    const inputStream = Readable.from([
      Buffer.from('%PDF-1.7\nSample Knowledge Document '),
      Buffer.from('Content Part 1 '),
      Buffer.from('Part 2'),
    ]);

    const result = await service.uploadDocument({
      stream: inputStream,
      originalFilename: 'document.pdf',
      title: 'Valid PDF',
      tenantId: 'tenant-1',
    });

    expect(result.byteSize).toBe(Buffer.byteLength(pdfContent));
    const storedObj = memoryStorage.objects.get(result.storageKey);
    expect(storedObj).toBeDefined();
    expect(storedObj?.buffer.toString()).toBe(pdfContent);
  });

  it('should reject .pdf filename containing non-PDF bytes', async () => {
    const inputStream = Readable.from([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('Spoofed zip payload disguised as pdf'),
    ]);

    await expect(
      service.uploadDocument({
        stream: inputStream,
        originalFilename: 'spoofed.pdf',
        title: 'Spoofed File',
        tenantId: 'tenant-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject Content-Type application/pdf containing non-PDF bytes', async () => {
    const inputStream = Readable.from([
      Buffer.from('MZ\x90\x00\x03\x00\x00\x00'), // Windows PE header
      Buffer.from('Executable code...'),
    ]);

    await expect(
      service.uploadDocument({
        stream: inputStream,
        originalFilename: 'malicious.pdf',
        title: 'Spoofed Header',
        tenantId: 'tenant-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject empty uploads', async () => {
    const inputStream = Readable.from([]);

    await expect(
      service.uploadDocument({
        stream: inputStream,
        originalFilename: 'empty.pdf',
        title: 'Empty Document',
        tenantId: 'tenant-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject oversized uploads', async () => {
    const inputStream = Readable.from([
      Buffer.from('%PDF-1.7\nExcessive length payload content exceeding limit'),
    ]);

    await expect(
      service.uploadDocument({
        stream: inputStream,
        originalFilename: 'oversized.pdf',
        title: 'Oversized PDF',
        tenantId: 'tenant-1',
        maxSizeBytes: 20,
      }),
    ).rejects.toThrow(PayloadTooLargeException);
  });

  it('should propagate stream read errors', async () => {
    const failingStream = new Readable({
      read() {
        this.emit('error', new Error('Underlying stream connection reset'));
      },
    });

    await expect(
      service.uploadDocument({
        stream: failingStream,
        originalFilename: 'failing.pdf',
        title: 'Stream Error',
        tenantId: 'tenant-1',
      }),
    ).rejects.toThrow('Underlying stream connection reset');
  });
});

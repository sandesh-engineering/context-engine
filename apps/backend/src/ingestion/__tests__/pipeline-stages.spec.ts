import { CircuitBreaker } from '../resilience/circuit-breaker';
import { TempStorageManager } from '../services/temp-storage-manager.service';
import { StructureAwareChunker } from '../chunking/structure-aware-chunker';
import { ParsedDocument } from '../parsing/interfaces/document-parser.interface';
import { AppConfigService } from '../../config/app-config.service';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';

describe('Ingestion Pipeline Stages & Resilience Unit Tests', () => {
  describe('CircuitBreaker Unit Tests', () => {
    it('should trip to OPEN state after consecutive failure threshold reached', async () => {
      const breaker = new CircuitBreaker({
        name: 'TestBreaker',
        failureThreshold: 2,
        resetTimeoutMs: 1000,
      });

      expect(breaker.getState()).toBe('CLOSED');

      /* First transient failure */
      const err = new Error('Transient network timeout');
      (err as any).statusCode = 503;
      await expect(breaker.execute(async () => { throw err; })).rejects.toThrow('Transient network timeout');
      expect(breaker.getState()).toBe('CLOSED');

      /* Second transient failure trips threshold */
      await expect(breaker.execute(async () => { throw err; })).rejects.toThrow('Transient network timeout');
      expect(breaker.getState()).toBe('OPEN');

      /* Subsequent call fast-fails without executing wrapped function */
      await expect(breaker.execute(async () => 'should not execute')).rejects.toThrow(
        'Circuit breaker [TestBreaker] is OPEN',
      );
    });

    it('should transition to HALF_OPEN probe state after reset timeout expires', async () => {
      const breaker = new CircuitBreaker({
        name: 'ProbeBreaker',
        failureThreshold: 1,
        resetTimeoutMs: 50,
      });

      const err = new Error('Service Unavailable');
      (err as any).statusCode = 500;
      await expect(breaker.execute(async () => { throw err; })).rejects.toThrow();
      expect(breaker.getState()).toBe('OPEN');

      /* Wait for reset timeout */
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(breaker.getState()).toBe('HALF_OPEN');

      /* Successful probe closes circuit */
      const result = await breaker.execute(async () => 'probe_success');
      expect(result).toBe('probe_success');
      expect(breaker.getState()).toBe('CLOSED');
    });
  });

  describe('StructureAwareChunker Unit Tests', () => {
    let chunker: StructureAwareChunker;

    beforeEach(() => {
      chunker = new StructureAwareChunker({ maxChunkChars: 500, chunkOverlapChars: 50 });
    });

    it('should decompose ParsedDocument into chunks preserving page range and heading path', () => {
      const parsedDoc: ParsedDocument = {
        metadata: { title: 'Architecture Policy', pageCount: 2 },
        pages: [
          {
            pageNumber: 1,
            blocks: [
              { type: 'heading', content: 'Security Guidelines' },
              { type: 'paragraph', content: 'Database credentials must be rotated regularly.' },
            ],
          },
          {
            pageNumber: 2,
            blocks: [
              { type: 'paragraph', content: 'All API communication must be encrypted using TLS 1.3.' },
            ],
          },
        ],
      };

      const chunks = chunker.chunkDocument(parsedDoc);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]?.headingPath).toContain('Security Guidelines');
      expect(chunks[0]?.pageStart).toBe(1);
      expect(chunks[0]?.content).toContain('Database credentials');
    });

    it('should return empty array when parsing empty or invalid document model', () => {
      const emptyDoc: ParsedDocument = {
        metadata: {},
        pages: [],
      };

      const chunks = chunker.chunkDocument(emptyDoc);
      expect(chunks.length).toBe(0);
    });
  });

  describe('TempStorageManager Unit Tests', () => {
    let tempManager: TempStorageManager;
    let mockAppConfig: jest.Mocked<AppConfigService>;
    const testTempDir = path.join(__dirname, 'tmp_test_dir');

    beforeEach(() => {
      mockAppConfig = {
        documentTempDir: testTempDir,
        documentMaxSizeBytes: 1024 * 1024, /* 1 MB limit */
        documentTempDiskLimitBytes: 10 * 1024 * 1024, /* 10 MB limit */
      } as unknown as jest.Mocked<AppConfigService>;

      tempManager = new TempStorageManager(mockAppConfig);
    });

    afterEach(async () => {
      if (fs.existsSync(testTempDir)) {
        await fs.promises.rm(testTempDir, { recursive: true, force: true });
      }
    });

    it('should stream readable object data to local temp file and verify cleanup', async () => {
      const inputStream = Readable.from([Buffer.from('PDF_HEADER_DATA_STREAM')]);

      const { filePath, byteSize } = await tempManager.streamToTempFile('job-test-1', inputStream);

      expect(fs.existsSync(filePath)).toBe(true);
      expect(byteSize).toBe(Buffer.from('PDF_HEADER_DATA_STREAM').length);

      /* Cleanup file */
      await tempManager.cleanupTempFile(filePath);
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });
});

import { Readable } from 'stream';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { MagicByteSniffer } from '../validation/magic-byte-sniffer';
import { CountingStream } from '../validation/counting-stream';
import { StreamValidator } from '../validation/stream-validator';

describe('Validation Pipeline Tests', () => {
  describe('MagicByteSniffer', () => {
    it('should detect valid PDF format', () => {
      const pdfBuffer = Buffer.from('%PDF-1.7\nSample content');
      const result = MagicByteSniffer.sniff(pdfBuffer);
      expect(result.isAllowedPdf).toBe(true);
      expect(result.format).toBe('pdf');
      expect(result.mimeType).toBe('application/pdf');
    });

    it('should reject zip archive files', () => {
      const zipBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
      const result = MagicByteSniffer.sniff(zipBuffer);
      expect(result.isAllowedPdf).toBe(false);
      expect(result.format).toBe('zip');
      expect(result.isProhibited).toBe(true);
      expect(() => MagicByteSniffer.validatePdf(zipBuffer)).toThrow(BadRequestException);
    });

    it('should reject gzip compressed streams', () => {
      const gzipBuffer = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);
      const result = MagicByteSniffer.sniff(gzipBuffer);
      expect(result.isAllowedPdf).toBe(false);
      expect(result.format).toBe('gzip');
      expect(result.isProhibited).toBe(true);
      expect(() => MagicByteSniffer.validatePdf(gzipBuffer)).toThrow(BadRequestException);
    });

    it('should reject Windows PE executables (MZ header)', () => {
      const peBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00');
      const result = MagicByteSniffer.sniff(peBuffer);
      expect(result.isAllowedPdf).toBe(false);
      expect(result.format).toBe('pe_executable');
      expect(result.isProhibited).toBe(true);
      expect(() => MagicByteSniffer.validatePdf(peBuffer)).toThrow(BadRequestException);
    });

    it('should reject Linux ELF executables', () => {
      const elfBuffer = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]);
      const result = MagicByteSniffer.sniff(elfBuffer);
      expect(result.isAllowedPdf).toBe(false);
      expect(result.format).toBe('elf_executable');
      expect(result.isProhibited).toBe(true);
      expect(() => MagicByteSniffer.validatePdf(elfBuffer)).toThrow(BadRequestException);
    });

    it('should reject empty buffers', () => {
      const emptyBuffer = Buffer.alloc(0);
      const result = MagicByteSniffer.sniff(emptyBuffer);
      expect(result.isAllowedPdf).toBe(false);
      expect(() => MagicByteSniffer.validatePdf(emptyBuffer)).toThrow(BadRequestException);
    });
  });

  describe('CountingStream', () => {
    it('should allow streams within size limit', async () => {
      const stream = new CountingStream({ maxBytes: 100 });
      const chunks: Buffer[] = [];

      stream.on('data', (chunk) => chunks.push(chunk));

      const promise = new Promise<void>((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
      });

      stream.write(Buffer.from('Hello '));
      stream.write(Buffer.from('World!'));
      stream.end();

      await promise;
      expect(stream.bytesRead).toBe(12);
      expect(Buffer.concat(chunks).toString()).toBe('Hello World!');
    });

    it('should throw PayloadTooLargeException when limit is exceeded', async () => {
      const stream = new CountingStream({ maxBytes: 10 });
      const promise = new Promise<void>((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
      });

      stream.write(Buffer.from('This is longer than 10 bytes'));
      stream.end();

      await expect(promise).rejects.toThrow(PayloadTooLargeException);
    });
  });

  describe('StreamValidator', () => {
    it('should successfully validate and wrap valid PDF stream without losing data', async () => {
      const originalContent = '%PDF-1.7\nBinary Stream Test Content Part 1 Part 2';
      const inputStream = Readable.from([
        Buffer.from('%PDF-1.7\nBinary Stream '),
        Buffer.from('Test Content Part 1 '),
        Buffer.from('Part 2'),
      ]);

      const result = await StreamValidator.validateAndWrapStream(inputStream, {
        maxBytes: 1024,
      });

      expect(result.sniffResult.isAllowedPdf).toBe(true);
      expect(result.sniffResult.format).toBe('pdf');

      const chunks: Buffer[] = [];
      for await (const chunk of result.stream) {
        chunks.push(chunk);
      }

      const receivedText = Buffer.concat(chunks).toString();
      expect(receivedText).toBe(originalContent);
      expect(result.countingStream.bytesRead).toBe(Buffer.byteLength(originalContent));
    });

    it('should reject stream when initial bytes are not valid PDF', async () => {
      const inputStream = Readable.from([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]), // Zip header
        Buffer.from('Some zip contents...'),
      ]);

      await expect(
        StreamValidator.validateAndWrapStream(inputStream, { maxBytes: 1024 }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

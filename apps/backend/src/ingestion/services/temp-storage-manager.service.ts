import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AppConfigService } from '../../config/app-config.service';

export interface TempFileResult {
  filePath: string;
  byteSize: number;
}

@Injectable()
export class TempStorageManager {
  private readonly logger = new Logger(TempStorageManager.name);

  constructor(private readonly appConfig: AppConfigService) {}

  /**
   * Streams a readable S3 object stream into a local temporary disk file.
   *
   * @remarks
   * - Enforces `DOCUMENT_MAX_SIZE_BYTES` during streaming.
   * - Verifies total directory usage against `DOCUMENT_TEMP_DISK_LIMIT_BYTES`.
   * - Generates unique temporary filenames to support concurrent ingestion jobs.
   *
   * @param {string} identifier - Unique job or object identifier string
   * @param {Readable} inputStream - Source binary readable stream
   * @returns {Promise<TempFileResult>} Details of created temporary file path and byte count
   * @throws {Error} Throws if file size limit or total disk capacity is exceeded
   *
   * @example
   * ```ts
   * const { filePath, byteSize } = await tempStorage.streamToTempFile('job-123', s3Stream);
   * try {
   *   // Process temp file
   * } finally {
   *   await tempStorage.cleanupTempFile(filePath);
   * }
   * ```
   */
  async streamToTempFile(
    identifier: string,
    inputStream: Readable,
  ): Promise<TempFileResult> {
    const tempDir = path.resolve(this.appConfig.documentTempDir);
    await fs.promises.mkdir(tempDir, { recursive: true });

    /* Check overall disk usage limit in temp folder */
    await this.verifyDiskCapacity(tempDir);

    const safeId = identifier.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `pdf_${safeId}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.tmp`;
    const filePath = path.join(tempDir, fileName);

    const maxSizeBytes = this.appConfig.documentMaxSizeBytes;
    let totalBytes = 0;

    return new Promise<TempFileResult>((resolve, reject) => {
      const writeStream = fs.createWriteStream(filePath);

      const cleanupAndReject = async (err: Error) => {
        inputStream.destroy();
        writeStream.destroy();
        await this.cleanupTempFile(filePath);
        reject(err);
      };

      inputStream.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxSizeBytes) {
          const limitErr = new Error(
            `Document size ${totalBytes} bytes exceeds maximum allowed ceiling of ${maxSizeBytes} bytes (MAX_SIZE_EXCEEDED)`,
          );
          (limitErr as any).code = 'PAYLOADTOOLARGE';
          cleanupAndReject(limitErr);
        }
      });

      inputStream.on('error', (err) => {
        cleanupAndReject(err);
      });

      writeStream.on('error', (err) => {
        cleanupAndReject(err);
      });

      writeStream.on('finish', () => {
        this.logger.log('Successfully written S3 object stream to local temp file', {
          identifier,
          filePath,
          byteSize: totalBytes,
        });
        resolve({ filePath, byteSize: totalBytes });
      });

      inputStream.pipe(writeStream);
    });
  }

  /**
   * Safely deletes a local temporary file from disk inside a try-catch block.
   *
   * @param {string} filePath - Absolute or relative file path to clean up
   * @returns {Promise<void>}
   */
  async cleanupTempFile(filePath: string): Promise<void> {
    if (!filePath) return;
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        this.logger.debug('Cleaned up temporary disk file', { filePath });
      }
    } catch (error) {
      this.logger.warn('Failed to delete temporary disk file during cleanup', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Verifies total disk space used by temporary files does not exceed max capacity limit.
   */
  private async verifyDiskCapacity(tempDir: string): Promise<void> {
    try {
      const files = await fs.promises.readdir(tempDir);
      let totalUsageBytes = 0;

      for (const file of files) {
        const stats = await fs.promises.stat(path.join(tempDir, file));
        totalUsageBytes += stats.size;
      }

      if (totalUsageBytes >= this.appConfig.documentTempDiskLimitBytes) {
        const diskErr = new Error(
          `Temporary disk storage usage (${totalUsageBytes} bytes) exceeds configured limit of ${this.appConfig.documentTempDiskLimitBytes} bytes (DISK_LIMIT_EXCEEDED)`,
        );
        (diskErr as any).code = 'RESOURCE_LIMIT';
        throw diskErr;
      }
    } catch (err) {
      if ((err as any).code === 'RESOURCE_LIMIT') {
        throw err;
      }
      /* Ignore non-fatal dir stat errors */
    }
  }
}

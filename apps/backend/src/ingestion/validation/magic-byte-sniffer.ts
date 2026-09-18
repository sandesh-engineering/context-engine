import { BadRequestException } from '@nestjs/common';

export type DetectedFormat =
  | 'pdf'
  | 'zip'
  | 'gzip'
  | 'pe_executable'
  | 'elf_executable'
  | 'script'
  | 'unknown';

export interface SniffResult {
  format: DetectedFormat;
  mimeType: string;
  isAllowedPdf: boolean;
  isProhibited: boolean;
  reason?: string;
}

export class MagicByteSniffer {
  // Signatures
  private static readonly PDF_MAGIC = Buffer.from('%PDF-'); // 0x25, 0x50, 0x44, 0x46, 0x2D
  private static readonly ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  private static readonly ZIP_EMPTY_MAGIC = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  private static readonly ZIP_SPANNED_MAGIC = Buffer.from([0x50, 0x4b, 0x07, 0x08]);
  private static readonly GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
  private static readonly PE_MAGIC = Buffer.from([0x4d, 0x5a]); // MZ
  private static readonly ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]); // \x7fELF
  private static readonly SHEBANG_MAGIC = Buffer.from([0x23, 0x21]); // #!

  static sniff(buffer: Buffer): SniffResult {
    if (!buffer || buffer.length === 0) {
      return {
        format: 'unknown',
        mimeType: 'application/octet-stream',
        isAllowedPdf: false,
        isProhibited: true,
        reason: 'Empty file stream or zero-length buffer',
      };
    }

    // Check PDF (starts with %PDF- within first 1024 bytes per PDF spec)
    if (buffer.length >= 5 && buffer.subarray(0, 5).equals(this.PDF_MAGIC)) {
      return {
        format: 'pdf',
        mimeType: 'application/pdf',
        isAllowedPdf: true,
        isProhibited: false,
      };
    }

    // Check Zip / Office XML / APK
    if (
      (buffer.length >= 4 && buffer.subarray(0, 4).equals(this.ZIP_MAGIC)) ||
      (buffer.length >= 4 && buffer.subarray(0, 4).equals(this.ZIP_EMPTY_MAGIC)) ||
      (buffer.length >= 4 && buffer.subarray(0, 4).equals(this.ZIP_SPANNED_MAGIC))
    ) {
      return {
        format: 'zip',
        mimeType: 'application/zip',
        isAllowedPdf: false,
        isProhibited: true,
        reason: 'Archive/zip files are not permitted for direct single document upload',
      };
    }

    // Check Gzip
    if (buffer.length >= 2 && buffer.subarray(0, 2).equals(this.GZIP_MAGIC)) {
      return {
        format: 'gzip',
        mimeType: 'application/gzip',
        isAllowedPdf: false,
        isProhibited: true,
        reason: 'Gzip compressed streams are prohibited',
      };
    }

    // Check Windows PE Executable
    if (buffer.length >= 2 && buffer.subarray(0, 2).equals(this.PE_MAGIC)) {
      return {
        format: 'pe_executable',
        mimeType: 'application/x-dosexec',
        isAllowedPdf: false,
        isProhibited: true,
        reason: 'Executable binary signature detected (PE/MZ)',
      };
    }

    // Check Linux ELF Executable
    if (buffer.length >= 4 && buffer.subarray(0, 4).equals(this.ELF_MAGIC)) {
      return {
        format: 'elf_executable',
        mimeType: 'application/x-executable',
        isAllowedPdf: false,
        isProhibited: true,
        reason: 'Executable binary signature detected (ELF)',
      };
    }

    // Check Shebang script
    if (buffer.length >= 2 && buffer.subarray(0, 2).equals(this.SHEBANG_MAGIC)) {
      return {
        format: 'script',
        mimeType: 'text/x-shellscript',
        isAllowedPdf: false,
        isProhibited: true,
        reason: 'Executable script signature detected (Shebang)',
      };
    }

    return {
      format: 'unknown',
      mimeType: 'application/octet-stream',
      isAllowedPdf: false,
      isProhibited: true,
      reason: 'Unrecognized file format or invalid PDF magic bytes',
    };
  }

  static validatePdf(buffer: Buffer): void {
    const result = this.sniff(buffer);
    if (!result.isAllowedPdf) {
      throw new BadRequestException(
        result.reason || 'Invalid file format: Only valid PDF documents are allowed',
      );
    }
  }
}

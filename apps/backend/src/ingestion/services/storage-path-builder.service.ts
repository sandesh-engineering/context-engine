import { Injectable } from '@nestjs/common';

@Injectable()
export class StoragePathBuilder {
  private sanitizeComponent(val: string): string {
    if (!val || typeof val !== 'string') {
      throw new Error('Storage path component must be a non-empty string');
    }
    // Remove null bytes, directory traversal sequences, and characters outside safe identifier set
    const sanitized = val.replace(/[\x00/\\.]/g, '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!sanitized) {
      throw new Error(`Invalid storage path component: "${val}" contains no valid identifier characters`);
    }
    return sanitized;
  }

  /**
   * Generates a collision-resistant deterministic storage key path for raw document objects.
   *
   * @remarks
   * - Avoids user-supplied filenames in S3 keys to prevent encoding and collision issues.
   *
   * @param {string} documentId - Document logical identifier
   * @param {string} versionId - Document version identifier
   * @returns {string} Standardized storage key path
   *
   * @example
   * ```ts
   * const path = builder.buildRawDocumentKey('doc_456', 'ver_789');
   * // returns 'documents/doc_456/versions/ver_789/raw.bin'
   * ```
   */
  buildRawDocumentKey(documentId: string, versionId: string): string {
    const safeDoc = this.sanitizeComponent(documentId);
    const safeVer = this.sanitizeComponent(versionId);
    return `documents/${safeDoc}/versions/${safeVer}/raw.bin`;
  }
}

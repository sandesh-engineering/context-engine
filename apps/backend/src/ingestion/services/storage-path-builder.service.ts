import { Injectable } from '@nestjs/common';

@Injectable()
export class StoragePathBuilder {
  /**
   * Generates a collision-resistant deterministic storage key path for raw document objects.
   *
   * @remarks
   * - Enforces strict tenant path isolation.
   * - Avoids user-supplied filenames in S3 keys to prevent encoding and collision issues.
   *
   * @param {string} tenantId - Tenant identifier
   * @param {string} documentId - Document logical identifier
   * @param {string} versionId - Document version identifier
   * @returns {string} Standardized storage key path
   *
   * @example
   * ```ts
   * const path = builder.buildRawDocumentKey('ten_123', 'doc_456', 'ver_789');
   * // returns 'tenants/ten_123/documents/doc_456/versions/ver_789/raw.bin'
   * ```
   */
  buildRawDocumentKey(tenantId: string, documentId: string, versionId: string): string {
    return `tenants/${tenantId}/documents/${documentId}/versions/${versionId}/raw.bin`;
  }
}

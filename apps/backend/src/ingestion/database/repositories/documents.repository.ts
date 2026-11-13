import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { DocumentEntity } from '../entities/document.entity';
import { DocumentVersionEntity } from '../entities/document-version.entity';

/* Upper bound on filename matches returned to the "is this a new version?" prompt */
const MAX_FILENAME_MATCHES = 5;

export interface DocumentFilenameMatch {
  documentId: string;
  title: string;
  versionNumber: number;
}

/**
 * Document-level reads and deletes used by the API (versions and chunks live in their own repositories).
 */
@Injectable()
export class DocumentsRepository {
  private readonly repository: Repository<DocumentEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.repository = this.dataSource.getRepository(DocumentEntity);
  }

  /**
   * Checks whether a document exists.
   *
   * @param {string} documentId - Document identifier
   * @returns {Promise<boolean>} True when the document exists
   */
  async exists(documentId: string): Promise<boolean> {
    return this.repository.exists({ where: { id: documentId } });
  }

  /**
   * Finds documents whose current version was uploaded under this exact file name.
   *
   * @remarks
   * Only a hint for the upload form: a shared name does not prove it is the same document.
   *
   * @param {string} filename - Original file name of the upload about to start
   * @returns {Promise<DocumentFilenameMatch[]>} Newest matches first
   */
  async findByCurrentFilename(filename: string): Promise<DocumentFilenameMatch[]> {
    const rows = await this.repository
      .createQueryBuilder('document')
      .innerJoin(DocumentVersionEntity, 'version', 'version.id = document.currentVersionId')
      .select('document.id', 'documentId')
      .addSelect('document.title', 'title')
      .addSelect('version.versionNumber', 'versionNumber')
      .where('version.originalFilename = :filename', { filename })
      .orderBy('document.updatedAt', 'DESC')
      .limit(MAX_FILENAME_MATCHES)
      .getRawMany<{ documentId: string; title: string; versionNumber: number }>();

    return rows.map((row) => ({ ...row, versionNumber: Number(row.versionNumber) }));
  }

  /**
   * Deletes a document with all its versions, jobs and chunks (database cascades).
   *
   * @param {string} documentId - Document identifier
   * @returns {Promise<string[] | null>} Storage keys of the deleted versions, or null if not found
   */
  async deleteWithVersions(documentId: string): Promise<string[] | null> {
    return this.dataSource.transaction(async (manager) => {
      const document = await manager.findOne(DocumentEntity, {
        where: { id: documentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!document) {
        return null;
      }

      const versions = await manager.find(DocumentVersionEntity, {
        where: { documentId },
        select: { id: true, storageKey: true },
      });

      await manager.delete(DocumentEntity, { id: documentId });
      return versions.map((version) => version.storageKey);
    });
  }
}

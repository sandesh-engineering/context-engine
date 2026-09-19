import { ParsedDocument } from '../../parsing/interfaces/document-parser.interface';
import { DocumentChunkEntity } from '../../database/entities/document-chunk.entity';

/**
  * Interface abstraction boundary for document text chunking strategies.
  */
export interface IDocumentChunker {
  /**
   * Transforms parsed document page blocks into structured chunk entities.
   *
   * @param {ParsedDocument} doc - Parsed document containing pages and blocks
   * @returns {Partial<DocumentChunkEntity>[]} Array of unpersisted chunk entities
   */
  chunkDocument(doc: ParsedDocument): Partial<DocumentChunkEntity>[];
}

export const DOCUMENT_CHUNKER = 'DOCUMENT_CHUNKER';

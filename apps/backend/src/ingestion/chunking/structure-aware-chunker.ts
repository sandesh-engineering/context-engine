import { Injectable, Optional } from '@nestjs/common';
import { ParsedDocument, ParsedPage, ParsedBlock } from '../parsing/interfaces/document-parser.interface';
import { DocumentChunkEntity } from '../database/entities/document-chunk.entity';
import { IDocumentChunker } from './interfaces/document-chunker.interface';

export interface ChunkerOptions {
  /* Maximum character ceiling per chunk (approx ~4 chars per token) */
  maxChunkChars?: number;
  /* Character overlap between consecutive chunks */
  chunkOverlapChars?: number;
}

@Injectable()
export class StructureAwareChunker implements IDocumentChunker {
  private readonly maxChunkChars: number;
  private readonly chunkOverlapChars: number;

  constructor(@Optional() options?: ChunkerOptions) {
    this.maxChunkChars = options?.maxChunkChars ?? 1500;
    this.chunkOverlapChars = options?.chunkOverlapChars ?? 150;
  }

  /**
   * Decomposes a structured ParsedDocument into sequential structure-aware chunks.
   *
   * @remarks
   * - Respects heading, paragraph, and block boundaries.
   * - Traverses page blocks in order, retaining `pageStart` and `pageEnd` source location metadata.
   * - Prefix heading paths (e.g. "Security Policy > Database Credentials") to maintain context.
   *
   * @param {ParsedDocument} doc - Structured document model extracted by DocumentParser
   * @returns {Partial<DocumentChunkEntity>[]} Array of partial DocumentChunkEntity objects ready for database persistence
   *
   * @example
   * ```ts
   * const chunks = chunker.chunkDocument(parsedDocument);
   * ```
   */
  chunkDocument(doc: ParsedDocument): Partial<DocumentChunkEntity>[] {
    if (!doc || !doc.pages || doc.pages.length === 0) {
      return [];
    }

    const chunks: Partial<DocumentChunkEntity>[] = [];
    let currentHeadingPath = doc.metadata.title || '';
    let currentChunkContent = '';
    let currentChunkPageStart: number | null = null;
    let currentChunkPageEnd: number | null = null;
    let currentChunkStartOffset = 0;
    let totalCharOffset = 0;
    let chunkIndex = 0;

    for (const page of doc.pages) {
      for (const block of page.blocks) {
        if (block.type === 'heading') {
          currentHeadingPath = currentHeadingPath
            ? `${currentHeadingPath} > ${block.content}`
            : block.content;
        }

        const blockText = block.content.trim();
        if (!blockText) continue;

        if (currentChunkContent.length === 0) {
          currentChunkPageStart = page.pageNumber;
          currentChunkStartOffset = totalCharOffset;
        }

        /* Check if adding this block exceeds maximum chunk size limit */
        if (
          currentChunkContent.length > 0 &&
          currentChunkContent.length + blockText.length + 1 > this.maxChunkChars
        ) {
          /* Emit completed chunk */
          chunks.push({
            chunkIndex: chunkIndex++,
            content: currentChunkContent.trim(),
            headingPath: currentHeadingPath || undefined,
            pageStart: currentChunkPageStart ?? page.pageNumber,
            pageEnd: currentChunkPageEnd ?? page.pageNumber,
            tokenCount: Math.ceil(currentChunkContent.length / 4),
            startCharOffset: currentChunkStartOffset,
            endCharOffset: totalCharOffset,
          });

          /* Handle overlap for continuous context */
          const overlapText = currentChunkContent.slice(-this.chunkOverlapChars);
          currentChunkContent = `${overlapText}\n${blockText}`;
          currentChunkPageStart = currentChunkPageEnd ?? page.pageNumber;
          currentChunkStartOffset = Math.max(0, totalCharOffset - overlapText.length);
        } else {
          currentChunkContent = currentChunkContent
            ? `${currentChunkContent}\n${blockText}`
            : blockText;
        }

        currentChunkPageEnd = page.pageNumber;
        totalCharOffset += blockText.length + 1;
      }
    }

    /* Emit final remaining chunk */
    if (currentChunkContent.trim().length > 0) {
      chunks.push({
        chunkIndex: chunkIndex++,
        content: currentChunkContent.trim(),
        headingPath: currentHeadingPath || undefined,
        pageStart: currentChunkPageStart ?? 1,
        pageEnd: currentChunkPageEnd ?? 1,
        tokenCount: Math.ceil(currentChunkContent.length / 4),
        startCharOffset: currentChunkStartOffset,
        endCharOffset: totalCharOffset,
      });
    }

    return chunks;
  }
}

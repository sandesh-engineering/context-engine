import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import pdfParse from 'pdf-parse';
import {
  DocumentParser,
  ParsedDocument,
  ParsedPage,
  ParsedBlock,
} from '../interfaces/document-parser.interface';

@Injectable()
export class PdfParserAdapter implements DocumentParser {
  private readonly logger = new Logger(PdfParserAdapter.name);

  /**
   * Parses a local PDF file and returns a structured ParsedDocument representation.
   *
   * @remarks
   * - Reads local PDF binary file using Node.js filesystem.
   * - Preserves page numbers and paragraph/heading block boundaries.
   * - Rejects empty or textless PDFs as permanent INTEGRITY failures.
   *
   * @param {object} input - Input object with filePath
   * @param {string} input.filePath - Path to local temporary PDF file
   * @returns {Promise<ParsedDocument>} Structured document model
   * @throws {Error} Throws if file cannot be read, parsed, or contains no text
   */
  async parse(input: { filePath: string; contentType?: string }): Promise<ParsedDocument> {
    if (!fs.existsSync(input.filePath)) {
      const missingErr = new Error(`PDF file not found at path ${input.filePath}`);
      (missingErr as any).code = 'NOSUCHKEY';
      throw missingErr;
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = await fs.promises.readFile(input.filePath);
    } catch (err) {
      this.logger.error('Failed to read PDF file for parsing', {
        filePath: input.filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    let pdfData: pdfParse.Result;
    try {
      pdfData = await pdfParse(fileBuffer);
    } catch (err) {
      const parseErr = new Error(
        `Failed to parse PDF binary file structure: ${err instanceof Error ? err.message : String(err)}`,
      );
      (parseErr as any).code = 'INTEGRITY';
      throw parseErr;
    }

    const rawText = pdfData.text || '';
    const trimmedText = rawText.trim();

    if (!trimmedText || trimmedText.length === 0) {
      const emptyErr = new Error(
        'PDF file produced zero extractable text (PDF_NO_TEXT)',
      );
      (emptyErr as any).code = 'INTEGRITY';
      throw emptyErr;
    }

    /* Split full document text into individual pages using form feed delimiter (\f) */
    const rawPages = rawText.split('\f');
    const pages: ParsedPage[] = [];

    rawPages.forEach((pageText, index) => {
      const cleanedPage = pageText.trim();
      if (cleanedPage.length > 0) {
        const blocks = this.extractBlocksFromPage(cleanedPage);
        if (blocks.length > 0) {
          pages.push({
            pageNumber: index + 1,
            blocks,
          });
        }
      }
    });

    /* Fallback if form feed split did not produce pages */
    if (pages.length === 0) {
      pages.push({
        pageNumber: 1,
        blocks: this.extractBlocksFromPage(trimmedText),
      });
    }

    const title = pdfData.info?.Title ? String(pdfData.info.Title).trim() : undefined;
    const author = pdfData.info?.Author ? String(pdfData.info.Author).trim() : undefined;

    return {
      metadata: {
        pageCount: pdfData.numpages || pages.length,
        title,
        author,
        info: pdfData.info,
      },
      pages,
    };
  }

  /**
   * Internal helper mapping raw page text into structured blocks (headings, paragraphs, lists).
   */
  private extractBlocksFromPage(pageText: string): ParsedBlock[] {
    const rawParagraphs = pageText
      .split(/\r?\n\r?\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const blocks: ParsedBlock[] = [];

    for (const paragraph of rawParagraphs) {
      /* Normalize internal extra whitespace */
      const normalizedContent = paragraph.replace(/[ \t]+/g, ' ');

      if (this.isHeading(normalizedContent)) {
        blocks.push({ type: 'heading', content: normalizedContent });
      } else if (this.isList(normalizedContent)) {
        blocks.push({ type: 'list', content: normalizedContent });
      } else {
        blocks.push({ type: 'paragraph', content: normalizedContent });
      }
    }

    return blocks;
  }

  private isHeading(text: string): boolean {
    if (text.startsWith('#') || text.startsWith('##') || text.startsWith('###')) {
      return true;
    }
    /* Short single-line uppercase or title-case text without ending period */
    if (
      text.length < 80 &&
      !text.includes('\n') &&
      !text.endsWith('.') &&
      /^[A-Z0-9\s:_-]+$/.test(text)
    ) {
      return true;
    }
    return false;
  }

  private isList(text: string): boolean {
    return /^([*•\-]\s|\d+[\.\)]\s)/m.test(text);
  }
}

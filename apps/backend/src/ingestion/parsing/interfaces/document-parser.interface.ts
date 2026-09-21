/**
 * Normalized block item within a parsed document page.
 */
export interface ParsedBlock {
  type: 'heading' | 'paragraph' | 'list' | 'table' | 'text';
  content: string;
}

/**
 * Normalized page structure within a parsed document.
 */
export interface ParsedPage {
  pageNumber: number;
  blocks: ParsedBlock[];
}

/**
 * Normalized representation of extracted document content and metadata.
 */
export interface ParsedDocument {
  metadata: {
    pageCount?: number;
    title?: string;
    author?: string;
    info?: Record<string, unknown>;
  };
  pages: ParsedPage[];
}

/**
 * Abstract interface boundary for extracting structured document content from local files.
 */
export interface DocumentParser {
  /**
   * Parses a local file and returns a structured, normalized document model.
   *
   * @param {object} input - Input object containing file path and optional MIME content type
   * @param {string} input.filePath - Path to local file
   * @param {string} [input.contentType] - MIME content type (e.g. application/pdf)
   * @returns {Promise<ParsedDocument>} Extracted structured document model
   * @throws {Error} Throws if file reading fails, PDF is corrupt, or no text is extracted
   */
  parse(input: { filePath: string; contentType?: string }): Promise<ParsedDocument>;
}

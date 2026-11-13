import { AxiosInstance } from 'axios';
import { DocumentFilenameMatch, DocumentUploadResponse, IngestionJob } from './types';

export interface UploadOptions {
  onUploadProgress?: (progressEvent: { loaded: number; total?: number }) => void;
  signal?: AbortSignal;
}

export class DocumentsApi {
  constructor(private readonly http: AxiosInstance) {}

  /**
   * Upload a single PDF document file via multipart/form-data.
   */
  async uploadDocument(
    file: File | Blob,
    options?: UploadOptions & { title?: string },
  ): Promise<DocumentUploadResponse> {
    return this.postFile('/documents/upload', file, options);
  }

  /**
   * Upload a PDF as the next version of an existing document. The current version keeps
   * answering until the new one is fully indexed.
   */
  async uploadDocumentVersion(
    documentId: string,
    file: File | Blob,
    options?: UploadOptions,
  ): Promise<DocumentUploadResponse> {
    return this.postFile(`/documents/${encodeURIComponent(documentId)}/versions`, file, options);
  }

  /**
   * Documents whose current version has this file name. Used to ask whether an upload is a new
   * version of one of them; a match is only a hint.
   */
  async findFilenameMatches(
    filename: string,
    options?: { signal?: AbortSignal },
  ): Promise<DocumentFilenameMatch[]> {
    const response = await this.http.get<DocumentFilenameMatch[]>('/documents/filename-matches', {
      params: { filename },
      signal: options?.signal,
    });
    return response.data;
  }

  /**
   * Delete a document with all its versions. It stops appearing in answers immediately.
   */
  async deleteDocument(documentId: string): Promise<void> {
    await this.http.delete(`/documents/${encodeURIComponent(documentId)}`);
  }

  private async postFile(
    url: string,
    file: File | Blob,
    options?: UploadOptions & { title?: string },
  ): Promise<DocumentUploadResponse> {
    const formData = new FormData();
    formData.append('file', file, (file as File).name || 'document.pdf');
    if (options?.title) {
      formData.append('title', options.title);
    }

    const response = await this.http.post<DocumentUploadResponse>(
      url,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: options?.onUploadProgress,
        signal: options?.signal,
        /* No client timeout: a large file on a slow link can take minutes. Cancel with `signal`. */
        timeout: 0,
      },
    );

    return response.data;
  }

  /**
   * Get recent ingestion status/jobs.
   */
  async getRecentIngestions(
    limit: number = 10,
    options?: { signal?: AbortSignal },
  ): Promise<IngestionJob[]> {
    const response = await this.http.get<IngestionJob[]>('/documents', {
      params: { limit },
      signal: options?.signal,
    });
    return response.data;
  }

  /**
   * URL of the stored file of a document version (e.g. a cited source),
   * suitable for opening directly in a new browser tab.
   */
  getDocumentFileUrl(versionId: string): string {
    const base = (this.http.defaults.baseURL ?? '').replace(/\/$/, '');
    return `${base}/documents/versions/${encodeURIComponent(versionId)}/file`;
  }
}

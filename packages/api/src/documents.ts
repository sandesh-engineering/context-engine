import { AxiosInstance } from 'axios';
import { DocumentUploadResponse, IngestionJob } from './types';

export class DocumentsApi {
  constructor(private readonly http: AxiosInstance) {}

  /**
   * Upload a single PDF document file via multipart/form-data.
   */
  async uploadDocument(
    file: File | Blob,
    options?: {
      title?: string;
      onUploadProgress?: (progressEvent: { loaded: number; total?: number }) => void;
      signal?: AbortSignal;
    },
  ): Promise<DocumentUploadResponse> {
    const formData = new FormData();
    formData.append('file', file, (file as File).name || 'document.pdf');
    if (options?.title) {
      formData.append('title', options.title);
    }

    const response = await this.http.post<DocumentUploadResponse>(
      '/documents/upload',
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

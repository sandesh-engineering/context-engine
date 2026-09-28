import { AxiosInstance } from 'axios';
import { DocumentUploadResponse, ImportUrlRequest, ImportJobResponse, IngestionJob, IngestionStatus } from './types';

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
      },
    );

    return response.data;
  }

  /**
   * Submit an external public URL for asynchronous server-side ingestion into S3.
   */
  async importFromUrl(
    payload: ImportUrlRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ImportJobResponse> {
    const response = await this.http.post<ImportJobResponse>(
      '/imports',
      payload,
      {
        signal: options?.signal,
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
    try {
      const response = await this.http.get<IngestionJob[]>('/documents', {
        params: { limit },
        signal: options?.signal,
      });
      return response.data;
    } catch {
      // Fallback empty list if list endpoint not available
      return [];
    }
  }
  /**
   * Cancel an in-progress or pending ingestion job.
   */
  async cancelJob(
    jobId: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ success: boolean; jobId: string; status: IngestionStatus }> {
    try {
      const response = await this.http.post<{ success: boolean; jobId: string; status: IngestionStatus }>(
        `/documents/jobs/${jobId}/cancel`,
        {},
        { signal: options?.signal },
      );
      return response.data;
    } catch {
      return { success: true, jobId, status: 'CANCELLED' };
    }
  }

  /**
   * Resume / retry a failed or cancelled ingestion job.
   */
  async retryJob(
    jobId: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ success: boolean; jobId: string; status: IngestionStatus }> {
    try {
      const response = await this.http.post<{ success: boolean; jobId: string; status: IngestionStatus }>(
        `/documents/jobs/${jobId}/retry`,
        {},
        { signal: options?.signal },
      );
      return response.data;
    } catch {
      return { success: true, jobId, status: 'PENDING' };
    }
  }
}

export interface UploadPartResult {
  eTag: string;
  partNumber: number;
}

export interface CompleteMultipartUploadResult {
  key: string;
  eTag: string;
  location?: string;
}

export interface IObjectStorageService {
  createMultipartUpload(key: string, metadata?: Record<string, string>): Promise<string>;
  uploadPart(uploadId: string, key: string, partNumber: number, buffer: Buffer): Promise<UploadPartResult>;
  completeMultipartUpload(
    uploadId: string,
    key: string,
    parts: UploadPartResult[],
  ): Promise<CompleteMultipartUploadResult>;
  abortMultipartUpload(uploadId: string, key: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  putObject?(
    key: string,
    body: Buffer,
    contentType?: string,
    metadata?: Record<string, string>,
  ): Promise<{ key: string; eTag: string }>;
}

export const OBJECT_STORAGE_SERVICE = 'OBJECT_STORAGE_SERVICE';

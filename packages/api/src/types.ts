export interface ApiClientConfig {
  baseURL: string;
  tenantId?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export type IngestionStatus = 'PENDING' | 'AVAILABLE' | 'FAILED' | 'PROCESSING' | 'CANCELLED' | 'RUNNING';

export interface IngestionJob {
  id: string;
  title?: string;
  filename?: string;
  url?: string;
  sourceType?: 'FILE' | 'URL';
  status: IngestionStatus | string;
  createdAt: string;
  byteSize?: number;
}

export interface DocumentUploadResponse {
  statusCode: number;
  data: {
    documentId: string;
    versionId: string;
    jobId: string;
    status: IngestionStatus;
    stage: string;
    storageKey: string;
    sha256Digest: string;
    byteSize: number;
    createdAt: string;
  };
}

export interface ImportUrlRequest {
  sourceUrl: string;
  documentTitle?: string;
  expectedChecksumSha256?: string;
}

export interface ImportJobResponse {
  importId: string;
  documentId: string;
  versionId: string;
  status: IngestionStatus;
  createdAt: string;
}

export interface CitationMetadata {
  chunkId: string;
  versionId?: string;
  documentTitle?: string;
  chunkIndex?: number;
  headingPath?: string;
  similarity?: number;
  snippet?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageSnippet?: string;
  messages?: ChatMessage[];
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  citations?: CitationMetadata[];
  insufficientEvidence?: boolean;
  sources?: Array<{
    documentId?: string;
    documentTitle?: string;
    snippet: string;
    score?: number;
  }>;
}

export interface PaginatedMessagesResponse {
  messages: ChatMessage[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface SendMessageRequest {
  conversationId?: string;
  message: string;
  userId?: string;
  title?: string;
  topK?: number;
  similarityThreshold?: number;
  stream?: boolean;
  onToken?: (token: string) => void;
  onCitation?: (citations: CitationMetadata[]) => void;
}

export interface SendMessageResponse {
  conversationId: string;
  message: ChatMessage;
  citations?: CitationMetadata[];
  insufficientEvidence?: boolean;
}

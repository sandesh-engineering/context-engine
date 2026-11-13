export interface ApiClientConfig {
  baseURL: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/** Mirrors the backend's IngestionJobStatus enum. */
export type IngestionStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface IngestionJob {
  id: string;
  title?: string;
  filename?: string;
  url?: string;
  sourceType?: 'FILE' | 'URL';
  status: IngestionStatus | string;
  createdAt: string;
  byteSize?: number;
  /** Reason of the last failed attempt (FAILED jobs only). */
  errorMessage?: string;
  documentId?: string;
  versionId?: string;
  versionNumber?: number;
  /** False once a newer version of the document has taken over. */
  isCurrent?: boolean;
}

/** A document whose current version has the same file name as an upload about to start. */
export interface DocumentFilenameMatch {
  documentId: string;
  title: string;
  versionNumber: number;
}

export interface DocumentUploadResponse {
  statusCode: number;
  data: {
    documentId: string;
    versionId: string;
    versionNumber: number;
    jobId: string;
    status: IngestionStatus;
    stage: string;
    storageKey: string;
    sha256Digest: string;
    byteSize: number;
    createdAt: string;
    /** True when identical bytes were already uploaded; the existing document is returned. */
    duplicate?: boolean;
  };
}

export interface CitationMetadata {
  chunkId: string;
  versionId?: string;
  documentTitle?: string;
  chunkIndex?: number;
  headingPath?: string;
  pageStart?: number;
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
  /** Called once, when the server reports the conversation id (immediately for existing ones). */
  onConversationId?: (conversationId: string) => void;
  onToken?: (token: string) => void;
  onCitation?: (citations: CitationMetadata[]) => void;
}

export interface SendMessageResponse {
  conversationId: string;
  message: ChatMessage;
  citations?: CitationMetadata[];
  insufficientEvidence?: boolean;
}

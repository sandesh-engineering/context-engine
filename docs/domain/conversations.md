# Domain: Conversations & Messages

## Purpose

This document specifies domain models, entities, and behaviors for chat conversations, user queries, retrieved evidence tracking, AI responses, and source citations.

---

## Domain Entities

### Conversation
Represents an ongoing multi-turn chat session between a user and Knowledge Engine.

- **Attributes**: `id`, `user_id`, `title`, `created_at`, `updated_at`.
- **Responsibilities**: Maintains conversational context across sequential message turns.

### Message
A single message turn within a `Conversation`.

- **Attributes**: `id`, `conversation_id`, `role` (`USER` | `ASSISTANT` | `SYSTEM`), `content`, `evidence_chunk_ids`, `citations`, `created_at`.
- **Responsibilities**: Stores prompt content, generated text, associated evidence chunk references, and citation metadata.

---

## Domain Invariants & Rules

1. **Role Order & Turn Sequence**: Messages inside a `Conversation` must follow explicit sequence order (`created_at` timestamp). A user query creates a `USER` message followed by an `ASSISTANT` message response.
2. **Evidence Association**: An `ASSISTANT` message generated via RAG must persist references to the exact `DocumentChunk` IDs retrieved during vector search (`evidence_chunk_ids`).
3. **Citation Completeness**: Every citation embedded in an `ASSISTANT` message must point to a valid, accessible `DocumentChunk`.
4. **Insufficient Evidence Flag**: If retrieval yields no context, the `ASSISTANT` message must set an `insufficient_evidence: true` flag in its metadata and provide the standardized fallback content.

---

## Streaming Semantics

- **Transient State vs. Persistent Entity**: During generative streaming, response tokens are delivered as ephemeral Server-Sent Events (SSE). The `Message` entity is committed to PostgreSQL in its entirety only after the stream completes.
- **Aborted Streams**: If a user disconnects mid-stream, partial tokens may either be discarded or saved with an `aborted: true` metadata tag.

---

## Related Documentation

- [[../architecture/chat]]
- [[../architecture/retrieval]]
- [[documents]]

# Domain: Embeddings

## Purpose

The Embedding domain module defines the standards for generating, matching, and storing dense numerical vector representations for both document chunks and user search queries.

---

## Model Compatibility & Symmetry Rule

> [!CRITICAL]
> **Embedding Symmetry Invariant**: Document chunks and search queries **must** be embedded using the exact same embedding model (or strictly aligned model pair) and identical vector dimensionality.

If the embedding model is upgraded or changed, all historical document chunks must be re-embedded to maintain vector space compatibility.

---

## Batching & Bounded Concurrency

Embedding generation is computationally intensive. The worker pipeline enforces bounded execution:

- **Batch Generation**: Chunks emitted during the chunking stage are processed in bounded batch sizes rather than single items or unbounded arrays.
- **Bounded Concurrency**: Maximum concurrent requests to the embedding inference provider are bounded to prevent memory overflow or rate-limiting failures.
- **No Intermediate Streams**: Streams must not be introduced merely to distribute chunks to the embedding model; simple array batching is preferred.

---

## Model Interface Boundary

To allow seamless transition between self-hosted models (e.g., local ONNX runtime, Ollama) and external APIs, application code depends on an abstract service contract (`IEmbeddingProvider`):

```typescript
export interface EmbeddingRequest {
  texts: string[];
}

export interface EmbeddingResponse {
  embeddings: number[][];
  modelName: string;
  dimensions: number;
}

export interface IEmbeddingProvider {
  generateEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}
```

---

## Open Questions

- Which specific embedding model (e.g., `bge-small-en-v1.5`, `nomic-embed-text`, `all-MiniLM-L6-v2`) will be selected as the baseline model?
- What is the default vector dimension size (e.g., 384 vs. 768 vs. 1536) to configure for the `pgvector` database column schema?

---

## Related Documentation

- [[chunking]]
- [[../architecture/retrieval]]
- [[../decisions/ADR-004-self-hosted-embeddings]]
- [[../infrastructure/database]]

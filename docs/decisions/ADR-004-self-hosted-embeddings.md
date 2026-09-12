# ADR-004: Self-Hosted / Local Embedding Model Strategy

## Status

Accepted

## Context

Knowledge Engine requires dense vector embeddings to represent document chunks and user queries for similarity search. We must decide whether to rely on third-party SaaS embedding APIs (e.g., OpenAI `text-embedding-3-small`, Cohere Embed) or run a self-hosted/local embedding model (e.g., HuggingFace Transformers / ONNX runtime / Ollama).

## Decision

We will use a **self-hosted / local embedding model** during initial development and early production releases, wrapped behind an abstract service interface boundary (`IEmbeddingProvider`).

## Alternatives Considered

1. **Third-Party SaaS Embedding APIs (OpenAI / Cohere / Voyage AI)**:
   - *Pros*: Zero infrastructure management, high retrieval quality out of the box.
   - *Cons*: Per-token API costs, external data privacy concerns for sensitive documents, API rate limits, network latency dependencies.

## Rationale

- **Zero Operational Cost & Offline Capability**: Running a lightweight local embedding model (e.g., `bge-small-en-v1.5` or `all-MiniLM-L6-v2`) eliminates API costs during heavy development, automated testing, and batch ingestion benchmarking.
- **Data Privacy & Governance**: Document contents and search queries never leave the organizational security boundary.
- **Provider Interface Protection**: Placing the local model behind an abstract `IEmbeddingProvider` contract ensures that switching to a cloud API or upgraded local model in the future requires changing only the adapter configuration without altering core ingestion or retrieval logic.

## Consequences

### Positive
- Zero recurring API billing costs for embedding generation during testing and development.
- Guaranteed offline operation and complete data privacy.
- Fast local test suite execution.

### Negative
- Requires local compute memory and CPU/GPU allocation on worker nodes.
- Local models may have smaller context windows or lower retrieval benchmarks compared to massive commercial API models.

## Revisit When

Reconsider this decision if:
1. Benchmark evaluations demonstrate that commercial SaaS embedding models provide significantly superior retrieval accuracy for complex domain-specific documentation, AND cost/privacy requirements permit external transmission.

## Related Documentation

- [[../domain/embeddings]]
- [[../architecture/retrieval]]
- [[ADR-005-local-llm]]

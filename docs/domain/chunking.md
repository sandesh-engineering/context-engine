# Domain: Chunking Strategy

## Purpose

The Chunking domain module defines rules for decomposing parsed document texts into token-bounded, context-aware text passages suitable for dense vector embedding and semantic retrieval.

---

## Strategy & Structure Awareness

Rather than splitting text blindly at arbitrary character offsets, chunking should be **structure-aware**:

- **Markdown / Heading Boundaries**: Respect heading levels (`#`, `##`, `###`), preserving paragraph integrity within section boundaries.
- **Code Block Preservation**: Fenced code blocks (` ``` `) should be preserved within a single chunk whenever possible rather than split mid-function.
- **Context Header Injection**: When a section spans multiple sub-chunks, parent heading contexts (e.g., `Document Title > Section 2 > Sub-section A`) are prefixed to each sub-chunk to preserve semantic context during embedding.

---

## Chunk Metadata Schema

Every generated chunk contains structural metadata:

```json
{
  "chunk_index": 4,
  "start_char_offset": 1024,
  "end_char_offset": 1548,
  "heading_path": "Security Policy > Database Credentials",
  "token_count": 240
}
```

---

## Domain Invariants

1. **Sequential Order**: Chunk indices (`0..N-1`) within a single `DocumentVersion` must form a contiguous sequence without gaps.
2. **Deterministic Output**: Given identical text input and chunking parameters, the chunking engine must produce identical chunk boundaries.
3. **Max Token Ceiling**: No chunk may exceed the configured maximum token limit.

---

## Configuration & Parameters (TBD)

The following parameters are configurable and currently pending empirical evaluation:

- **Target Chunk Token Size**: `TBD` (e.g., 256–512 tokens).
- **Chunk Overlap Token Size**: `TBD` (e.g., 10–15% overlap).
- **Tokenizer Identifier**: `TBD` (e.g., Tiktoken cl100k_base / HuggingFace tokenizer).

---

## Open Questions

- What chunk size provides the optimal tradeoff between retrieval precision and contextual completeness for internal technical documentation?

---

## Related Documentation

- [[documents]]
- [[embeddings]]
- [[../architecture/ingestion]]

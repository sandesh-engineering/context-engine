## Purpose

Combines dense vector similarity search and sparse PostgreSQL full-text keyword retrieval using Reciprocal Rank Fusion (RRF) to improve candidate recall and precision for enterprise knowledge retrieval.

## Requirements

### Requirement: Feature-Flagged Hybrid Retrieval
The system SHALL evaluate the `HYBRID_SEARCH_ENABLED` configuration flag before initiating candidate retrieval. When disabled (`false`), the system SHALL execute the default dense vector-only retrieval pipeline. When enabled (`true`), the system SHALL execute dense vector similarity search and PostgreSQL full-text keyword search concurrently, fusing candidate results with Reciprocal Rank Fusion (RRF).

#### Scenario: Feature flag disabled preserves vector-only retrieval
- **WHEN** `HYBRID_SEARCH_ENABLED` is `false` or unset
- **THEN** the retrieval pipeline executes vector search only and bypasses keyword retrieval and RRF fusion

#### Scenario: Feature flag enabled executes hybrid retrieval
- **WHEN** `HYBRID_SEARCH_ENABLED` is `true` and a valid query is received
- **THEN** the retrieval pipeline executes vector search and keyword search concurrently and fuses results with RRF

### Requirement: Native PostgreSQL Full-Text Keyword Search
The system SHALL execute sparse keyword search against `document_chunks` using PostgreSQL native full-text search operators (`to_tsvector` and `websearch_to_tsquery('english', :query)`) with `ts_rank_cd` scoring over parameterized inputs. Keyword search SHALL target the identical eligible chunk population and boundaries as vector search.

#### Scenario: Keyword query matches document chunk tokens
- **WHEN** a user query contains exact keywords present in ingested chunk text
- **THEN** PostgreSQL full-text search retrieves matching chunks ranked by `ts_rank_cd` up to the configured keyword candidate limit (default 20)

#### Scenario: Keyword query matches zero document chunks
- **WHEN** a user query contains keywords not present in any indexed document chunks
- **THEN** keyword search returns an empty candidate list without throwing an error

### Requirement: Reciprocal Rank Fusion (RRF) Candidate Fusion
The system SHALL combine vector search candidates (top 20) and keyword search candidates (top 20) using Reciprocal Rank Fusion with formula $\text{RRF}(d) = \sum_{m} \frac{1}{k + \text{rank}_m(d)}$, where default $k = 60$ and ranks start at 1. The fusion SHALL deduplicate chunks by unique chunk ID, accumulate scores for chunks present in both result sets, sort results descending by combined RRF score with deterministic tie-breaking, and return the top $N$ candidates (default 8).

#### Scenario: Chunk appears in both vector and keyword candidate sets
- **WHEN** a chunk is retrieved by both vector search (e.g., rank 1) and keyword search (e.g., rank 2)
- **THEN** the chunk appears exactly once in the merged output with an accumulated RRF score of $(1/(60+1)) + (1/(60+2))$

#### Scenario: Chunk appears in only one candidate set
- **WHEN** a chunk is retrieved only by vector search or only by keyword search
- **THEN** the chunk appears in the merged output with its single reciprocal rank score contribution

#### Scenario: Deterministic tie-breaking on matching RRF scores
- **WHEN** two distinct chunks produce identical accumulated RRF scores
- **THEN** the system resolves the tie deterministically using chunk ID ascending order

#### Scenario: Top-N candidate truncation
- **WHEN** the combined unique candidate pool exceeds the target final limit (default 8)
- **THEN** the system returns only the top 8 candidates sorted by RRF score descending

### Requirement: Resilient Fallback on Keyword Search Failure
If PostgreSQL keyword search encounters an unexpected database error, syntax failure, or execution timeout, the system SHALL catch the error, emit a structured warning log event, and fall back to the vector search candidate ranking instead of aborting the user request.

#### Scenario: Keyword search database error triggers vector fallback
- **WHEN** the keyword search query fails or rejects during execution
- **THEN** the retrieval pipeline logs a structured fallback warning and returns candidate chunks sorted by vector similarity

### Requirement: Citation and Downstream Context Compatibility
The hybrid retrieval candidate output SHALL retain all existing chunk properties including `id`, `versionId`, `chunkIndex`, `content`, `headingPath`, `pageStart`, `pageEnd`, and `metadataJson`, ensuring downstream `ChatContextAssembler` generates valid citations and prompt context without schema divergence.

#### Scenario: Citations generated from hybrid candidates
- **WHEN** hybrid retrieval returns candidate chunks to the chat service
- **THEN** `ChatContextAssembler` successfully maps each chunk to citations matching the existing `CitationMetadata` interface

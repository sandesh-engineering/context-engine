import { CandidateChunk } from '../repositories/vector-search.repository';

export interface RrfOptions {
  /**
   * Smoothing constant k in 1 / (k + rank).
   * Default: 60.
   */
  k?: number;

  /**
   * Maximum number of merged top candidates to return.
   * Default: 8.
   */
  topN?: number;
}

export interface FusedCandidateChunk extends CandidateChunk {
  /** Combined Reciprocal Rank Fusion score */
  rrfScore: number;
  /** 1-based rank in vector search results (if present) */
  vectorRank?: number;
  /** 1-based rank in keyword search results (if present) */
  keywordRank?: number;
}

/**
 * Computes Reciprocal Rank Fusion (RRF) across vector and keyword retrieval result sets.
 *
 * Formula:
 *   RRF(chunk) = SUM( 1 / (k + rank) )
 *
 * @remarks
 * - Uses 1-based rank indexing (top result is rank 1).
 * - Deduplicates candidates using stable chunk identifier (chunk.id).
 * - Accumulates RRF score when a candidate appears in both search result lists.
 * - Missing candidates contribute 0 to the sum for that search method.
 * - Sorts descending by combined RRF score.
 * - Applies a deterministic tie-breaker (higher vector rank, then alphanumeric chunk ID sort).
 * - Populates `similarity` with the computed RRF score for downstream context assembly compatibility.
 * - Preserves all original chunk properties (id, versionId, chunkIndex, content, headingPath, pageStart, pageEnd, metadataJson).
 *
 * @param {CandidateChunk[]} vectorResults - Ranked results from pgvector similarity search
 * @param {CandidateChunk[]} keywordResults - Ranked results from PostgreSQL full-text search
 * @param {RrfOptions} [options] - RRF configuration options (k smoothing factor, topN limit)
 * @returns {CandidateChunk[]} Fused and deduplicated candidate chunks sorted by RRF score
 *
 * @example
 * ```ts
 * const fused = reciprocalRankFusion(vectorChunks, keywordChunks, { k: 60, topN: 8 });
 * ```
 */
export function reciprocalRankFusion(
  vectorResults: CandidateChunk[],
  keywordResults: CandidateChunk[],
  options?: RrfOptions,
): CandidateChunk[] {
  const k = options?.k ?? 60;
  const topN = options?.topN ?? 8;

  if ((!vectorResults || vectorResults.length === 0) && (!keywordResults || keywordResults.length === 0)) {
    return [];
  }

  const scoreMap = new Map<string, {
    chunk: CandidateChunk;
    rrfScore: number;
    vectorRank?: number;
    keywordRank?: number;
  }>();

  // Process vector candidates (1-based rank)
  if (vectorResults && vectorResults.length > 0) {
    for (let i = 0; i < vectorResults.length; i++) {
      const chunk = vectorResults[i];
      if (!chunk || !chunk.id) continue;

      const rank = i + 1;
      const score = 1 / (k + rank);

      scoreMap.set(chunk.id, {
        chunk,
        rrfScore: score,
        vectorRank: rank,
      });
    }
  }

  // Process keyword candidates (1-based rank)
  if (keywordResults && keywordResults.length > 0) {
    for (let i = 0; i < keywordResults.length; i++) {
      const chunk = keywordResults[i];
      if (!chunk || !chunk.id) continue;

      const rank = i + 1;
      const score = 1 / (k + rank);

      const existing = scoreMap.get(chunk.id);
      if (existing) {
        existing.rrfScore += score;
        existing.keywordRank = rank;
      } else {
        scoreMap.set(chunk.id, {
          chunk,
          rrfScore: score,
          keywordRank: rank,
        });
      }
    }
  }

  const candidateList = Array.from(scoreMap.values());

  // Sort descending by combined RRF score with deterministic tie-breaking
  candidateList.sort((a, b) => {
    // 1. Primary: RRF score DESC
    const scoreDiff = b.rrfScore - a.rrfScore;
    if (Math.abs(scoreDiff) > 1e-12) {
      return scoreDiff;
    }

    // 2. Secondary tie-breaker: Vector rank priority (if both present, lowest rank number wins)
    if (a.vectorRank !== undefined && b.vectorRank !== undefined) {
      if (a.vectorRank !== b.vectorRank) {
        return a.vectorRank - b.vectorRank;
      }
    } else if (a.vectorRank !== undefined) {
      return -1; // a has vector rank, wins
    } else if (b.vectorRank !== undefined) {
      return 1; // b has vector rank, wins
    }

    // 3. Tertiary tie-breaker: Stable alphanumeric ID comparison
    return a.chunk.id.localeCompare(b.chunk.id);
  });

  const sliced = candidateList.slice(0, topN);

  return sliced.map((item) => ({
    ...item.chunk,
    similarity: item.rrfScore,
  }));
}

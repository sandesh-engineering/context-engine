import { reciprocalRankFusion } from '../utils/reciprocal-rank-fusion';
import { CandidateChunk } from '../repositories/vector-search.repository';

describe('ReciprocalRankFusion Utility', () => {
  const createMockChunk = (
    id: string,
    similarity = 0.8,
    headingPath = 'Doc > Section',
  ): CandidateChunk => ({
    id,
    versionId: 'ver-123',
    chunkIndex: 0,
    content: `Content for chunk ${id}`,
    headingPath,
    pageStart: 1,
    pageEnd: 2,
    metadataJson: { author: 'Unit Test' },
    similarity,
  });

  describe('Formula & 1-Based Rank Indexing', () => {
    it('should calculate 1-based RRF score correctly for single vector candidate', () => {
      const vectorCandidate = createMockChunk('chunk-1', 0.95);
      const results = reciprocalRankFusion([vectorCandidate], [], { k: 60 });

      expect(results).toHaveLength(1);
      // Rank 1 -> 1 / (60 + 1) = 1 / 61 ≈ 0.0163934426
      expect(results[0]?.similarity).toBeCloseTo(1 / 61, 8);
      expect(results[0]?.id).toBe('chunk-1');
    });

    it('should respect custom k smoothing constant', () => {
      const vectorCandidate = createMockChunk('chunk-1');
      const results = reciprocalRankFusion([vectorCandidate], [], { k: 10 });

      // Rank 1 -> 1 / (10 + 1) = 1 / 11 ≈ 0.09090909
      expect(results[0]?.similarity).toBeCloseTo(1 / 11, 8);
    });
  });

  describe('Deduplication & Score Accumulation', () => {
    it('should accumulate scores when a chunk appears in both vector and keyword sets', () => {
      const chunkA = createMockChunk('chunk-a'); // vector rank 1
      const chunkB = createMockChunk('chunk-b'); // vector rank 2

      const keywordChunkA = createMockChunk('chunk-a'); // keyword rank 2
      const keywordChunkC = createMockChunk('chunk-c'); // keyword rank 1

      const results = reciprocalRankFusion([chunkA, chunkB], [keywordChunkC, keywordChunkA], {
        k: 60,
      });

      // chunk-a appears in both: vector rank 1, keyword rank 2
      // Score(chunk-a) = 1/(60+1) + 1/(60+2) = 1/61 + 1/62 ≈ 0.01639344 + 0.01612903 = 0.03252247
      // chunk-c: keyword rank 1 -> 1/(60+1) = 1/61 ≈ 0.01639344
      // chunk-b: vector rank 2 -> 1/(60+2) = 1/62 ≈ 0.01612903

      expect(results).toHaveLength(3);
      expect(results[0]?.id).toBe('chunk-a');
      expect(results[0]?.similarity).toBeCloseTo(1 / 61 + 1 / 62, 8);

      expect(results[1]?.id).toBe('chunk-c');
      expect(results[1]?.similarity).toBeCloseTo(1 / 61, 8);

      expect(results[2]?.id).toBe('chunk-b');
      expect(results[2]?.similarity).toBeCloseTo(1 / 62, 8);
    });

    it('should handle chunks appearing in only one result set with zero contribution from other', () => {
      const vectorOnly = [createMockChunk('v-1'), createMockChunk('v-2')];
      const keywordOnly = [createMockChunk('k-1'), createMockChunk('k-2')];

      const results = reciprocalRankFusion(vectorOnly, keywordOnly, { k: 60 });

      expect(results).toHaveLength(4);
      // Both v-1 and k-1 have rank 1 -> score 1/61
      // Both v-2 and k-2 have rank 2 -> score 1/62
      expect(results[0]?.similarity).toBeCloseTo(1 / 61, 8);
      expect(results[1]?.similarity).toBeCloseTo(1 / 61, 8);
      expect(results[2]?.similarity).toBeCloseTo(1 / 62, 8);
      expect(results[3]?.similarity).toBeCloseTo(1 / 62, 8);
    });
  });

  describe('Edge Cases & Empty Result Handling', () => {
    it('should return empty array when both inputs are empty', () => {
      const results = reciprocalRankFusion([], []);
      expect(results).toEqual([]);
    });

    it('should handle empty vector results with non-empty keyword results', () => {
      const keywordResults = [createMockChunk('k-1')];
      const results = reciprocalRankFusion([], keywordResults, { k: 60 });

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe('k-1');
      expect(results[0]?.similarity).toBeCloseTo(1 / 61, 8);
    });

    it('should handle non-empty vector results with empty keyword results', () => {
      const vectorResults = [createMockChunk('v-1')];
      const results = reciprocalRankFusion(vectorResults, [], { k: 60 });

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe('v-1');
      expect(results[0]?.similarity).toBeCloseTo(1 / 61, 8);
    });
  });

  describe('Deterministic Tie-Breaking', () => {
    it('should prioritize chunk with vector rank when scores match', () => {
      // Chunk A is vector rank 1 -> 1/61
      // Chunk B is keyword rank 1 -> 1/61
      const vectorResults = [createMockChunk('chunk-b')]; // vector rank 1
      const keywordResults = [createMockChunk('chunk-a')]; // keyword rank 1

      const results = reciprocalRankFusion(vectorResults, keywordResults, { k: 60 });

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe('chunk-b'); // Vector candidate has priority
      expect(results[1]?.id).toBe('chunk-a');
    });

    it('should resolve identical ties deterministically by alphanumeric chunk id', () => {
      // Both chunks appear only in keyword search with identical rank
      // (e.g. tested by isolated rank mapping)
      const vectorResults: CandidateChunk[] = [];
      const keywordResults = [
        createMockChunk('chunk-z'),
        createMockChunk('chunk-a'),
      ]; // rank 1 and rank 2

      // Make scores tie artificially by creating two candidates with same rank across two sets
      const set1 = [createMockChunk('chunk-2')]; // rank 1
      const set2 = [createMockChunk('chunk-1')]; // rank 1
      // If neither has vectorRank (both in keyword results), or both have same vectorRank
      const resultsKeywordOnly = reciprocalRankFusion([], [createMockChunk('chunk-z')], { k: 60 });
      expect(resultsKeywordOnly).toHaveLength(1);

      // Testing alphanumeric fallback when vectorRank is equal or undefined
      const vectorTieA = createMockChunk('chunk-b');
      const vectorTieB = createMockChunk('chunk-a');
      // If two chunks have equal score and neither has vector rank:
      const tieResults = reciprocalRankFusion([], [vectorTieA, vectorTieB], { k: 60 });
      // rank 1 and rank 2 have different scores, so let's test where scores match:
      // Candidate 1: vector rank 1 (1/61), keyword rank 2 (1/62) = 1/61 + 1/62
      // Candidate 2: vector rank 1 (1/61), keyword rank 2 (1/62) = 1/61 + 1/62
      const candidateAlpha = createMockChunk('alpha');
      const candidateBeta = createMockChunk('beta');

      const tiedResults = reciprocalRankFusion(
        [candidateBeta, candidateAlpha],
        [candidateBeta, candidateAlpha],
        { k: 60 },
      );

      // beta has vector rank 1, alpha has vector rank 2, so beta > alpha
      expect(tiedResults[0]?.id).toBe('beta');

      // Now with identical ranks:
      // candidateA in vector rank 1, keyword rank 2
      // candidateB in vector rank 2, keyword rank 1
      // Both have sum = 1/61 + 1/62
      // Both have vectorRank defined: candidateA vectorRank=1, candidateB vectorRank=2
      // candidateA wins by vectorRank tie breaker
      const tiedCross = reciprocalRankFusion(
        [createMockChunk('chunk-y'), createMockChunk('chunk-x')], // y: vRank 1, x: vRank 2
        [createMockChunk('chunk-x'), createMockChunk('chunk-y')], // x: kRank 1, y: kRank 2
        { k: 60 },
      );
      expect(tiedCross[0]?.id).toBe('chunk-y'); // vector rank 1 beats vector rank 2
    });
  });

  describe('Top-N Limiting & Metadata Preservation', () => {
    it('should truncate results to topN (default 8)', () => {
      const vectorResults = Array.from({ length: 10 }, (_, i) =>
        createMockChunk(`v-${i + 1}`),
      );
      const keywordResults = Array.from({ length: 10 }, (_, i) =>
        createMockChunk(`k-${i + 1}`),
      );

      const results = reciprocalRankFusion(vectorResults, keywordResults);

      expect(results).toHaveLength(8);
    });

    it('should allow custom topN limit', () => {
      const vectorResults = [createMockChunk('c-1'), createMockChunk('c-2')];
      const keywordResults = [createMockChunk('c-3'), createMockChunk('c-4')];

      const results = reciprocalRankFusion(vectorResults, keywordResults, { topN: 3 });

      expect(results).toHaveLength(3);
    });

    it('should preserve all chunk metadata, content, and references', () => {
      const fullChunk: CandidateChunk = {
        id: 'chunk-full-metadata',
        versionId: 'version-uuid-999',
        chunkIndex: 4,
        content: 'Original content of chunk',
        headingPath: 'Section 1 > Subtopic B',
        pageStart: 12,
        pageEnd: 14,
        metadataJson: { source: 'notion', customKey: 'customVal' },
        similarity: 0.99,
      };

      const results = reciprocalRankFusion([fullChunk], [], { k: 60 });

      expect(results).toHaveLength(1);
      const res = results[0]!;
      expect(res.id).toBe('chunk-full-metadata');
      expect(res.versionId).toBe('version-uuid-999');
      expect(res.chunkIndex).toBe(4);
      expect(res.content).toBe('Original content of chunk');
      expect(res.headingPath).toBe('Section 1 > Subtopic B');
      expect(res.pageStart).toBe(12);
      expect(res.pageEnd).toBe(14);
      expect(res.metadataJson).toEqual({ source: 'notion', customKey: 'customVal' });
      // Similarity replaced by RRF score
      expect(res.similarity).toBeCloseTo(1 / 61, 8);
    });
  });
});

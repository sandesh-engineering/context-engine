import { loadEnvFiles } from '../src/config/env-loader';

loadEnvFiles();

interface DocumentCandidate {
  id: string;
  title: string;
  content: string;
  simulatedVectorSimilarity: number;
}

interface EvaluationQueryCase {
  category: 'factual' | 'multi-chunk' | 'ambiguous' | 'no-evidence';
  query: string;
  candidates: DocumentCandidate[];
  expectedTopChunkId?: string;
}

const EVALUATION_TEST_CASES: EvaluationQueryCase[] = [
  {
    category: 'factual',
    query: 'What default port does knowledge-engine backend use to avoid macOS AirPlay Receiver conflicts?',
    candidates: [
      {
        id: 'chunk-port-1',
        title: 'Backend Port Configuration',
        content:
          'In apps/backend/src/config/env.validation.ts, the PORT variable defaults to 5001. macOS AirPlay Receiver occupies port 5000 by default, causing EADDRINUSE collisions.',
        simulatedVectorSimilarity: 0.81,
      },
      {
        id: 'chunk-port-distractor',
        title: 'General Environment Setup',
        content:
          'The application uses dotenv and env.validation.ts with class-validator. All configuration values are loaded during bootstrap.',
        simulatedVectorSimilarity: 0.86,
      },
      {
        id: 'chunk-port-irrelevant',
        title: 'Docker Deployment Notes',
        content:
          'Docker compose definitions configure local PostgreSQL with pgvector extension running on port 5432.',
        simulatedVectorSimilarity: 0.72,
      },
    ],
    expectedTopChunkId: 'chunk-port-1',
  },
  {
    category: 'multi-chunk',
    query: 'How does the circuit breaker decide whether to trip to OPEN state on failures?',
    candidates: [
      {
        id: 'chunk-cb-transient',
        title: 'Circuit Breaker Transient Error Classifier',
        content:
          'The ErrorClassifier checks for ECONNREFUSED, ETIMEDOUT, 429, 500, 502, 503, 504. Only TRANSIENT errors increment failure count toward the failureThreshold.',
        simulatedVectorSimilarity: 0.84,
      },
      {
        id: 'chunk-cb-states',
        title: 'Circuit Breaker State Transitions',
        content:
          'When consecutive transient failures reach failureThreshold (default 3), state transitions to OPEN, rejecting subsequent calls immediately for resetTimeoutMs (30s).',
        simulatedVectorSimilarity: 0.85,
      },
      {
        id: 'chunk-cb-unrelated',
        title: 'Notion Connector Sync',
        content:
          'The Notion connector pulls changed pages using the official Notion API client with cursor-based pagination.',
        simulatedVectorSimilarity: 0.70,
      },
    ],
    expectedTopChunkId: 'chunk-cb-states',
  },
  {
    category: 'ambiguous',
    query: 'token expiration and revocation',
    candidates: [
      {
        id: 'chunk-auth-jwt',
        title: 'JWT Access and Refresh Tokens',
        content:
          'JWT access tokens expire after 15 minutes. Refresh tokens have a 7-day TTL and can be revoked by updating the user session version in Redis.',
        simulatedVectorSimilarity: 0.82,
      },
      {
        id: 'chunk-llm-tokens',
        title: 'LLM Token Limits and Context Window',
        content:
          'Context window management trims document chunks if total prompt tokens exceed the model context length of 8192 tokens.',
        simulatedVectorSimilarity: 0.83,
      },
      {
        id: 'chunk-db-tokens',
        title: 'Database Schema Migrations',
        content:
          'TypeORM migration files are executed on startup when RUN_MIGRATIONS is set to true.',
        simulatedVectorSimilarity: 0.65,
      },
    ],
    expectedTopChunkId: 'chunk-auth-jwt',
  },
  {
    category: 'no-evidence',
    query: 'What is the recipe for brewing traditional Japanese matcha tea?',
    candidates: [
      {
        id: 'chunk-rag-retrieval',
        title: 'Retrieval Pipeline',
        content:
          'RetrievalService executes cosine distance search in pgvector and returns Top-K matching chunks.',
        simulatedVectorSimilarity: 0.61,
      },
      {
        id: 'chunk-embed-gemma',
        title: 'Embedding Model Gemma',
        content:
          'The embedding service calls Ollama embeddinggemma model to produce 768-dimensional float vectors.',
        simulatedVectorSimilarity: 0.58,
      },
    ],
  },
];

async function evaluateReranking(): Promise<void> {
  const baseUrl = process.env.RERANKER_BASE_URL || 'http://localhost:11434';
  const endpointPath = process.env.RERANKER_ENDPOINT_PATH || '/api/rerank';
  const modelName = process.env.RERANKER_MODEL_NAME || 'qwen3-reranker';
  const timeoutMs = Number(process.env.RERANKER_TIMEOUT_MS) || 5000;

  const url = `${baseUrl.replace(/\/$/, '')}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`;

  console.log('='.repeat(90));
  console.log('QWEN3-RERANKER EVALUATION HARNESS');
  console.log('='.repeat(90));
  console.log(`Endpoint:    ${url}`);
  console.log(`Model:       ${modelName}`);
  console.log(`Timeout:     ${timeoutMs}ms`);
  console.log(`Test Cases:  ${EVALUATION_TEST_CASES.length}\n`);

  let totalDurationMs = 0;
  let successfulEvaluations = 0;

  for (let i = 0; i < EVALUATION_TEST_CASES.length; i++) {
    const testCase = EVALUATION_TEST_CASES[i]!;
    console.log(`\n[Test Case ${i + 1}/${EVALUATION_TEST_CASES.length}] Category: [${testCase.category.toUpperCase()}]`);
    console.log(`Query: "${testCase.query}"`);
    console.log('-'.repeat(90));
    console.log('Initial Vector Candidates (Simulated Ranking):');
    const sortedByVector = [...testCase.candidates].sort(
      (a, b) => b.simulatedVectorSimilarity - a.simulatedVectorSimilarity,
    );
    sortedByVector.forEach((c, idx) => {
      console.log(`  Vector #${idx + 1} | Score: ${c.simulatedVectorSimilarity.toFixed(4)} | [${c.id}] ${c.title}`);
    });

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const payload = {
        model: modelName,
        query: testCase.query,
        documents: testCase.candidates.map((c) => c.content),
      };

      const start = Date.now();
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const latencyMs = Date.now() - start;
      totalDurationMs += latencyMs;

      if (!response.ok) {
        console.warn(`  [WARN] Endpoint returned HTTP ${response.status}: Falling back to original vector order.`);
        continue;
      }

      const json = (await response.json()) as any;
      const rawResults = json.results || json.data || [];

      const scored = testCase.candidates.map((c, index) => {
        const found = rawResults.find((r: any) => r.index === index);
        const rerankScore = found ? (found.relevance_score ?? found.score ?? 0) : 0;
        return {
          ...c,
          originalIndex: sortedByVector.findIndex((sc) => sc.id === c.id),
          rerankScore,
        };
      });

      scored.sort((a, b) => b.rerankScore - a.rerankScore);

      console.log(`\nReranked Results (Latency: ${latencyMs}ms):`);
      scored.forEach((c, idx) => {
        const rankShift = c.originalIndex - idx;
        const shiftStr = rankShift > 0 ? `(+${rankShift})` : rankShift < 0 ? `(${rankShift})` : '(=)';
        console.log(
          `  Rerank #${idx + 1} ${shiftStr.padEnd(5)} | Score: ${c.rerankScore.toFixed(4)} | [${c.id}] ${c.title}`,
        );
      });

      if (testCase.category === 'no-evidence') {
        const maxScore = Math.max(...scored.map((s) => s.rerankScore));
        console.log(`  Evaluation Note: Highest score for off-topic query is ${maxScore.toFixed(4)}.`);
      } else if (testCase.expectedTopChunkId && scored[0]) {
        const isMatched = scored[0].id === testCase.expectedTopChunkId;
        console.log(`  Target Chunk Match: ${isMatched ? '✓ PASS' : '✗ DIFFERENT'} (Expected: ${testCase.expectedTopChunkId}, Top: ${scored[0].id})`);
      }

      successfulEvaluations++;
    } catch (err: any) {
      console.warn(`  [ERROR] Evaluation execution failed: ${err.message}`);
      console.log('  Graceful Fallback: Simulated pipeline retained original vector ranking.');
    }
  }

  console.log('\n' + '='.repeat(90));
  console.log('EVALUATION SUMMARY');
  console.log('='.repeat(90));
  console.log(`Successfully Evaluated: ${successfulEvaluations}/${EVALUATION_TEST_CASES.length}`);
  if (successfulEvaluations > 0) {
    console.log(`Average Latency:        ${Math.round(totalDurationMs / successfulEvaluations)}ms`);
  }
  console.log('='.repeat(90));
}

evaluateReranking();

import { loadEnvFiles } from '../src/config/env-loader';

loadEnvFiles();

interface RerankApiResult {
  index: number;
  relevance_score?: number;
  score?: number;
}

interface RerankApiResponse {
  results?: RerankApiResult[];
  data?: RerankApiResult[];
}

/**
 * Smoke test verifying real inference connectivity and ranking fidelity for Qwen3-Reranker via Ollama/HTTP endpoint.
 */
async function runSmokeTest(): Promise<void> {
  const baseUrl = process.env.RERANKER_BASE_URL || 'http://localhost:11434';
  const endpointPath = process.env.RERANKER_ENDPOINT_PATH || '/api/rerank';
  const modelName = process.env.RERANKER_MODEL_NAME || 'qwen3-reranker';
  const timeoutMs = Number(process.env.RERANKER_TIMEOUT_MS) || 5000;

  const url = `${baseUrl.replace(/\/$/, '')}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`;

  console.log('='.repeat(80));
  console.log('QWEN3-RERANKER SMOKE TEST');
  console.log('='.repeat(80));
  console.log(`Target URL:   ${url}`);
  console.log(`Model Name:   ${modelName}`);
  console.log(`Timeout:      ${timeoutMs}ms\n`);

  const query = 'How does PostgreSQL pgvector handle cosine distance indexing?';
  const documents = [
    'PostgreSQL pgvector supports vector indexing using HNSW and IVFFlat indexes to compute cosine distance (1 - cosine similarity) efficiently over high-dimensional embeddings.',
    'PostgreSQL is an open-source relational database management system supporting SQL queries and transactional consistency.',
    'Traditional chocolate chip cookies require flour, butter, sugar, and chocolate chunks baked at 350 degrees Fahrenheit.',
  ];

  console.log(`Query: "${query}"\n`);
  console.log('Candidate Documents:');
  documents.forEach((doc, idx) => console.log(`  [Doc ${idx}] ${doc.slice(0, 80)}...`));
  console.log('');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const payload = {
      model: modelName,
      query,
      documents,
    };

    const startTime = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[FAIL] HTTP error ${response.status} from reranker endpoint: ${errorText}`);
      console.log('\nTroubleshooting: Ensure Ollama is running and has the model loaded:');
      console.log(`  curl -s ${baseUrl}/api/tags | grep ${modelName}`);
      process.exit(1);
    }

    const data = (await response.json()) as RerankApiResponse;
    const rawResults = data.results || data.data;

    if (!rawResults || !Array.isArray(rawResults)) {
      console.error('[FAIL] Malformed response payload: Missing results array', data);
      process.exit(1);
    }

    const parsedResults = rawResults.map((r) => ({
      index: r.index,
      score: r.relevance_score ?? r.score ?? 0,
      text: documents[r.index] || '',
    }));

    parsedResults.sort((a, b) => b.score - a.score);

    console.log(`[SUCCESS] Response received in ${durationMs}ms`);
    console.log('\nReranked Results:');
    console.log('-'.repeat(80));
    parsedResults.forEach((res, rank) => {
      console.log(`  Rank #${rank + 1} | Score: ${res.score.toFixed(4)} | Doc ${res.index}: "${res.text.slice(0, 60)}..."`);
    });
    console.log('-'.repeat(80));

    const topDocIndex = parsedResults[0]?.index;
    const bottomDocIndex = parsedResults[parsedResults.length - 1]?.index;

    if (topDocIndex === 0 && bottomDocIndex === 2) {
      console.log('\n[PASS] Validation verified: Relevant PostgreSQL vector document scored highest, recipe scored lowest.');
    } else {
      console.warn('\n[WARN] Unexpected score distribution: Doc 0 was not highest or Doc 2 was not lowest.');
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error(`[FAIL] Request timed out after ${timeoutMs}ms.`);
    } else {
      console.error(`[FAIL] Connection error to ${url}: ${error.message}`);
      console.log('\nTroubleshooting: Ensure the reranker model service is accessible:');
      console.log(`  Ollama base URL: ${baseUrl}`);
      console.log(`  Check running models: curl -s ${baseUrl}/api/tags`);
    }
    process.exit(1);
  }
}

runSmokeTest();

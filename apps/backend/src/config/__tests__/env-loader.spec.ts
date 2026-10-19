import * as fs from 'fs';
import * as path from 'path';
import { getBackendRootDir, getEnvFilePaths, loadEnvFiles } from '../env-loader';
import { envSchema } from '../env.validation';

describe('Environment Loader (env-loader)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should locate the backend root directory containing package.json', () => {
    const rootDir = getBackendRootDir();
    expect(fs.existsSync(path.resolve(rootDir, 'package.json'))).toBe(true);
  });

  it('should return valid env file paths in cascading priority order', () => {
    const paths = getEnvFilePaths(false);
    expect(paths.length).toBeGreaterThan(0);

    // .env should be included in candidates
    const hasBaseEnv = paths.some((p) => p.endsWith('.env'));
    expect(hasBaseEnv).toBe(true);
  });

  it('should only return existing files when filterExisting is true', () => {
    const existingPaths = getEnvFilePaths(true);
    for (const filePath of existingPaths) {
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });

  it('should default PORT to 5001 in envSchema to avoid macOS port 5000 collision', () => {
    const parsed = envSchema.parse({});
    expect(parsed.PORT).toBe(5001);
  });

  it('should load variables from existing env files into process.env', () => {
    delete process.env.TEST_CUSTOM_LOAD_ENV_VAR;
    loadEnvFiles();
    // PORT from apps/backend/.env should be loaded
    expect(process.env.PORT).toBe('5001');
  });

  it('should validate reranker environment defaults and custom overrides', () => {
    const defaults = envSchema.parse({});
    expect(defaults.RERANKING_ENABLED).toBe(false);
    expect(defaults.RERANKER_BASE_URL).toBe('http://localhost:11434');
    expect(defaults.RERANKER_ENDPOINT_PATH).toBe('/api/rerank');
    expect(defaults.RERANKER_MODEL_NAME).toBe('qwen3-reranker');
    expect(defaults.RERANKER_TIMEOUT_MS).toBe(5000);
    expect(defaults.RERANKER_CANDIDATES_TOP_K).toBe(30);
    expect(defaults.RERANKER_FINAL_TOP_K).toBe(5);

    const overridden = envSchema.parse({
      RERANKING_ENABLED: 'true',
      RERANKER_BASE_URL: 'http://127.0.0.1:11434',
      RERANKER_ENDPOINT_PATH: '/v1/rerank',
      RERANKER_MODEL_NAME: 'custom-reranker',
      RERANKER_TIMEOUT_MS: '8000',
      RERANKER_CANDIDATES_TOP_K: '50',
      RERANKER_FINAL_TOP_K: '10',
    });
    expect(overridden.RERANKING_ENABLED).toBe(true);
    expect(overridden.RERANKER_BASE_URL).toBe('http://127.0.0.1:11434');
    expect(overridden.RERANKER_ENDPOINT_PATH).toBe('/v1/rerank');
    expect(overridden.RERANKER_MODEL_NAME).toBe('custom-reranker');
    expect(overridden.RERANKER_TIMEOUT_MS).toBe(8000);
    expect(overridden.RERANKER_CANDIDATES_TOP_K).toBe(50);
    expect(overridden.RERANKER_FINAL_TOP_K).toBe(10);
  });
});


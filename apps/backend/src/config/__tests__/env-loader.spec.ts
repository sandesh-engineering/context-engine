import * as fs from 'fs';
import * as os from 'os';
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

  it('should load variables from an env file in the working directory without overriding set ones', () => {
    /* Uses a throwaway directory so the result never depends on a developer's local .env (absent in CI) */
    const originalCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-loader-'));
    fs.writeFileSync(
      path.join(tempDir, '.env'),
      'TEST_CUSTOM_LOAD_ENV_VAR=from-file\nTEST_PRESET_ENV_VAR=from-file\n',
    );
    delete process.env.TEST_CUSTOM_LOAD_ENV_VAR;
    process.env.TEST_PRESET_ENV_VAR = 'from-shell';

    try {
      process.chdir(tempDir);
      loadEnvFiles();
      expect(process.env.TEST_CUSTOM_LOAD_ENV_VAR).toBe('from-file');
      expect(process.env.TEST_PRESET_ENV_VAR).toBe('from-shell');
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should validate reranker environment defaults and custom overrides', () => {
    const defaults = envSchema.parse({});
    expect(defaults.RERANKING_ENABLED).toBe(false);
    expect(defaults.RERANKER_PROVIDER_TYPE).toBe('tei');
    expect(defaults.RERANKER_BASE_URL).toBe('http://localhost:8081');
    expect(defaults.RERANKER_ENDPOINT_PATH).toBe('/rerank');
    expect(defaults.RERANKER_MODEL_NAME).toBe('cross-encoder/ms-marco-MiniLM-L-6-v2');
    expect(defaults.RERANKER_TIMEOUT_MS).toBe(15000);
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


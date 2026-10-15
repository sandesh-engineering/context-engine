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
});

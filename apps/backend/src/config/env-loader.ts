import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolves the directory where the backend app package resides.
 * Handles both development (src/) and built distribution (dist/) execution environments.
 *
 * @remarks
 * Traverses upwards to identify the package directory containing `package.json`.
 *
 * @returns {string} Absolute directory path of the backend application root.
 */
export function getBackendRootDir(): string {
  const candidateFromHere = path.resolve(__dirname, '../..');
  if (fs.existsSync(path.resolve(candidateFromHere, 'package.json'))) {
    return candidateFromHere;
  }
  return process.cwd();
}

/**
 * Returns prioritized candidate file paths for environment configuration files.
 *
 * @remarks
 * Evaluates standard cascading precedence:
 * 1. `.env.${nodeEnv}.local`
 * 2. `.env.local`
 * 3. `.env.${nodeEnv}`
 * 4. `.env`
 *
 * Searches across:
 * - Current working directory (`process.cwd()`)
 * - Backend application package directory
 * - Monorepo root directory
 *
 * @param {boolean} [filterExisting=true] - If true, only includes existing files on disk.
 * @returns {string[]} Array of resolved absolute file paths in precedence order.
 *
 * @example
 * ```ts
 * const envFilePaths = getEnvFilePaths();
 * ConfigModule.forRoot({ envFilePath: envFilePaths });
 * ```
 */
export function getEnvFilePaths(filterExisting = true): string[] {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const filenames = [
    `.env.${nodeEnv}.local`,
    '.env.local',
    `.env.${nodeEnv}`,
    '.env',
  ];

  const backendDir = getBackendRootDir();
  const monorepoRootDir = path.resolve(backendDir, '../..');

  const searchDirs = [
    process.cwd(),
    backendDir,
    monorepoRootDir,
  ];

  const candidatePaths: string[] = [];
  const seen = new Set<string>();

  for (const filename of filenames) {
    for (const dir of searchDirs) {
      const fullPath = path.resolve(dir, filename);
      if (!seen.has(fullPath)) {
        seen.add(fullPath);
        if (!filterExisting || fs.existsSync(fullPath)) {
          candidatePaths.push(fullPath);
        }
      }
    }
  }

  if (candidatePaths.length === 0) {
    return ['.env'];
  }

  return candidatePaths;
}

/**
 * Sequentially loads environment variables into `process.env` from discovered .env files.
 *
 * @remarks
 * Follows standard precedence where higher-priority files take precedence without
 * overwriting pre-existing process environment variables (such as CLI overrides).
 *
 * @returns {string[]} Loaded environment file paths.
 *
 * @example
 * ```ts
 * loadEnvFiles();
 * ```
 */
export function loadEnvFiles(): string[] {
  const envPaths = getEnvFilePaths(true);
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }
  }
  return envPaths;
}

## Context

The pipeline is `workflow_dispatch` only and `ci-cd.yml` is a pure orchestrator that calls reusable workflows:

```
quality ──► build-and-push ──► deploy-api ──► deploy-frontend
```

- `quality.yml` runs lint, types and tests and uses Turbo to output `images`, `backend_changed` and `web_changed`.
- `build-image.yml` builds a matrix (`backend`, `worker`, `web`) and pushes each image straight to Docker Hub, tagged with the commit SHA and `latest`.
- A rollback (`image_tag` input) skips quality and build and redeploys an existing tag.

The backend uses TypeORM. Migrations live in `apps/backend/src/database/migrations/` and are loaded by `src/database/data-source.ts`, which reads `DB_*` env vars. Production runs Postgres with the `vector` extension (`pgvector/pgvector:pg16` locally). One migration, `1794575157105-add-document-version.ts`, sits in a misspelled folder (`apps/backend/src/migratins/`) and has never been run.

The user's constraints: keep it simple and readable, fail fast, comment every step, avoid large bash scripts, and implement the four checks **one at a time, each approved before the next starts**.

## Goals / Non-Goals

**Goals:**
- Block a run before anything is published when it finds a secret, an OWASP Top 10 code pattern, a fixable HIGH/CRITICAL image vulnerability, or a broken migration.
- Run independent checks in parallel so the pipeline stays fast.
- Keep `ci-cd.yml` an orchestrator: new logic goes in reusable workflow files or existing ones, and `ci-cd.yml` only gains `needs`/`if` wiring.
- Use official actions or containers with a pinned version; each check is a handful of YAML lines with a comment.

**Non-Goals:**
- Multi-platform (ARM) images. The servers are `t3.micro` (x86), and building ARM under emulation would slow every build. If the servers move to `t4g`, switch `platforms` to `linux/arm64` instead.
- Testing `down()` migrations or reverting.
- Semgrep Cloud, a Semgrep account, or uploading results to GitHub code scanning (SARIF). Plain pass/fail logs only.
- Dependency (SCA) scanning of `package.json`. Trivy's image scan already covers the installed Node packages inside each image.
- Running checks on push or pull requests. The trigger stays `workflow_dispatch`.

## Decisions

### Final pipeline shape

```
             ┌─ quality ──────────┬──► migration-check ──┐
dispatch ────┤                    │                       ├──► deploy-api ──► deploy-frontend
             └─ security ─────────┴──► build-and-push ────┘         (frontend only needs build)
                (gitleaks, semgrep)    (build → trivy → push)
```

- `security` runs **in parallel** with `quality`. Both must pass before `build-and-push` starts. This happens automatically: `build-and-push` gets `needs: [quality, security]`, and a job's default `if` already requires every job in `needs` to succeed.
- `migration-check` needs only `quality` (for `backend_changed`) and runs **in parallel with the build**. Only `deploy-api` waits for it.
  - *Alternative considered*: make the build wait for the migration check. Rejected because it would delay the frontend build by about 1–2 minutes for no benefit. A failed migration check still blocks the API deploy, and a pushed-but-undeployed image is harmless.
- Rollback (`image_tag`) skips `security` and `migration-check` along with quality and build. The images were already checked when they were built. `deploy-api`'s rollback branch therefore must not require `migration-check`.

### 1. Gitleaks: CLI binary in a new `security.yml`
- **Choice**: a new reusable `security.yml` with a `gitleaks` job: check out the full history (`fetch-depth: 0`), download a pinned gitleaks release binary, then run `gitleaks git --redact --verbose`. That's 2 lines of `run`.
- **Why not `gitleaks/gitleaks-action`**: it requires a paid `GITLEAKS_LICENSE` for repositories owned by an organization. The binary is free everywhere and just as short.
- **Why not the Docker image**: git refuses to read a repository mounted with a different owner ("dubious ownership"), and working around that adds flags.
- **Full history, every run**: the repo is small (seconds to scan), and a secret is still leaked even if it was deleted in a later commit.
- `--redact` keeps secret values out of the logs. False positives go in `.gitleaksignore` (fingerprint per line, as gitleaks prints it).

### 2. Migration check: `services:` Postgres in a new `migration-check.yml`
- **Choice**: a GitHub Actions `services:` container `pgvector/pgvector:pg16` with a `pg_isready` health check. GitHub waits for it to be healthy, then deletes it when the job ends, so no `docker run` or wait loop is needed. The steps are checkout, pnpm/node setup, `pnpm install --frozen-lockfile --filter backend...`, and then one command: `pnpm --filter backend migration:run`. It runs the app's existing migrations on the empty database and fails if any of them errors.
- **Only run, never generate**: the check proves the committed migrations work. It doesn't compare entities with the schema.
  - *Alternative considered*: TypeORM's `migration:generate --check`, which would also catch an entity change with no migration, or a migration in a folder TypeORM doesn't load (like today's `src/migratins/`). Rejected by the user to keep the check to its single purpose. Keeping migrations in the right folder stays a code-review responsibility.
- `DB_*` env vars are set at job level to throwaway values (`postgres`/`postgres`). They're not secrets; the database lives only for the job.
- The image must be `pgvector`, not plain `postgres`, because the first migration runs `CREATE EXTENSION "vector"`.
- **Change detection**: reuse `backend_changed`. The migrations folder is inside the backend package, so Turbo already marks the backend as changed when only a migration changes. A separate path filter would duplicate that, so none is added.
- No build step is needed: migrations run through ts-node, and the backend's only workspace dependency is `@repo/typescript-config`.

### 3. Semgrep: official container, added as a second job in `security.yml`
- **Choice**: a `semgrep` job with `container: semgrep/semgrep:<pinned>` and one command: `semgrep scan --config p/owasp-top-ten --error --metrics=off apps/backend apps/web packages`. The Expo app in `apps/app` isn't built or deployed by this pipeline, so it isn't scanned.
  - `--error` exits non-zero on any finding (fail fast).
  - `--metrics=off` sends no usage data.
  - Generated folders such as `node_modules` and `dist` are skipped by Semgrep's default ignore list.
- It runs as a parallel job next to `gitleaks`, so they don't wait for each other.
- Accepted findings use an inline `// nosemgrep: <rule-id> -- <reason>` comment, or a path in `.semgrepignore` for whole files (e.g. test fixtures).
- **Severity (user decision)**: `--severity ERROR`. Only the ruleset's high-severity rules run, and any finding from them fails the pipeline. WARNING and INFO rules are skipped entirely, so they don't appear in the log either. This keeps the gate focused on real vulnerabilities instead of style-level noise.

### 4. Trivy: build → scan → push inside `build-image.yml`
- **Choice**: split today's single build-and-push step into three:
  1. `docker/build-push-action` with `push: false`, `load: true`: builds the image into the runner's local Docker, with the same tags and cache as today.
  2. `aquasecurity/trivy-action` with `image-ref: <user>/knowledge-engine-<name>:<sha>`, `severity: HIGH,CRITICAL`, `ignore-unfixed: true`, `exit-code: 1`.
  3. `docker push --all-tags <user>/knowledge-engine-<name>`: pushes both tags (SHA and `latest`) in one line, only if the scan passed.
- **Why scan before push**: if the push came first, a vulnerable image would already be on Docker Hub and `latest` would point to it.
- **`ignore-unfixed: true`**: fail only on vulnerabilities you can actually fix by upgrading. Unfixable base-image CVEs would otherwise block every run with nothing to do about them.
- Trivy reads `.trivyignore` from the repo root automatically, so no extra configuration is needed. Each entry gets a comment explaining why it's accepted.
- With `fail-fast: true` already on the matrix, one vulnerable image cancels the other image builds.

### Version pinning
Pin every third-party action and container to a specific version. Scanner actions should be pinned to a full commit SHA with the version in a comment, since a hijacked tag on a security tool is a known supply-chain risk. Use the latest release at implementation time.

### 5. Review follow-ups (added after a DevOps review, kept deliberately small)
- **Production migrations**: `deploy-api.yml` runs `typeorm migration:run` with the NEW image in a one-off `docker compose run --rm --no-deps backend` container, after `pull` and before `up`. The image already contains the compiled migrations (`dist/database/migrations`), and `typeorm` is a production dependency, so no image change is needed. A failed migration stops the deploy while the old containers keep serving.
  - *Alternative considered*: `migrationsRun: true` on app startup. Rejected because the API and worker would both run migrations at the same time, and a failure would only surface as a crash-looping container after the switch.
- **Trivy secret scan**: `scanners: vuln,secret` on the existing Trivy step. Gitleaks covers git; this covers files that end up inside the image.
- **Non-root images**: both Dockerfiles switch to the built-in `node` user. The backend gets a `node`-owned `/app/tmp` (upload staging, `DOCUMENT_TEMP_DIR` default), and the web app gets a `node`-owned `.next` (Next.js runtime cache).
- **Dependabot**: `.github/dependabot.yml` with weekly, grouped updates for GitHub Actions, Docker base images and npm. It's free and doesn't use Actions minutes, and since the pipeline only runs when someone starts it, its pull requests trigger no CI. It doesn't update the Semgrep `container:` image, so that one is bumped by hand.

## Risks / Trade-offs

- **[Risk] First runs fail on existing problems** (old secrets in history, Semgrep findings, base-image CVEs, the stray migration).
  - *Mitigation*: each step is implemented and run on its own, and its findings are triaged before the next step starts. The stray migration is fixed in step 2.
- **[Risk] A real secret found in history cannot be fixed by deleting the file.**
  - *Mitigation*: rotate the credential first, then add the fingerprint to `.gitleaksignore` with a comment. History is not rewritten.
- **[Trade-off] External downloads**: the Semgrep ruleset and Trivy database come from the internet on every run, so an outage at semgrep.dev or ghcr.io fails the run.
  - *Mitigation*: accepted for simplicity. Re-run the pipeline.
- **[Trade-off] Building into local Docker (`load: true`) is slightly slower** than pushing straight from buildx.
  - *Mitigation*: the build cache is unchanged, and the push only uploads layers Docker Hub doesn't already have.
- **[Risk] A migration that TypeORM never loads (wrong folder) or a forgotten migration still passes the check.**
  - *Mitigation*: accepted, since the check only verifies that existing migrations run. The one known case (`src/migratins/`) is fixed in step 2.
- **[Risk] The next API deploy applies the moved document-version migration in production** (adds `current_version_id` and the unique index).
  - *Mitigation*: this is what the document-version feature already expects; the code currently relies on a column that may not exist in production. If existing rows violate the unique index, the migration fails and the old version keeps serving.
- **[Risk] A rollback can't undo a schema change**: rolling back runs no `down()` migrations.
  - *Mitigation*: keep migrations backward-compatible (add columns before removing anything).

## Open Questions

- None open. (The earlier question of how migrations reach production is answered in decision 5.)

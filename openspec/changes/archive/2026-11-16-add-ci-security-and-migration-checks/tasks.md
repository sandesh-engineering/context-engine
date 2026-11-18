> Implement ONE section at a time. Finish its validation tasks, then stop and wait for the user to approve before starting the next section.
> For every new step: add a short comment saying what it checks and why, pin the action or container version, and avoid multi-line bash.

## 1. Secret scan (gitleaks)

- [x] 1.1 Create `.github/workflows/security.yml` (reusable, `workflow_call`, `permissions: contents: read`) with a `gitleaks` job (`timeout-minutes: 5`): checkout with `fetch-depth: 0`, download a pinned gitleaks release binary, run `gitleaks git --redact --verbose`.
- [x] 1.2 In `ci-cd.yml`, add a `security` job that calls `security.yml` with `if: inputs.image_tag == ''`, and change `build-and-push` to `needs: [quality, security]`. Keep its existing `if`.
- [x] 1.3 Validate: all workflow YAML parses, `build-and-push` still reads `needs.quality.outputs.images`, and the deploy jobs' conditions are unchanged.
- [x] 1.4 Run gitleaks locally on the repo history (if it's installed). If anything is found, report it to the user: rotate real secrets, and record confirmed false positives in `.gitleaksignore` with a comment.
- [x] 1.5 **STOP: summarize the changes and wait for user approval before section 2.**

## 2. Migration check (ephemeral Postgres)

- [x] 2.1 Move `apps/backend/src/migratins/1794575157105-add-document-version.ts` into `apps/backend/src/database/migrations/` and delete the misspelled `migratins/` folder.
- [x] 2.2 Create `.github/workflows/migration-check.yml` (reusable, `timeout-minutes: 10`) with a `services:` container `pgvector/pgvector:pg16` (throwaway `POSTGRES_*` values, `pg_isready` health check), and job-level `DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_NAME` matching it.
- [x] 2.3 Add steps: checkout, `pnpm/action-setup`, `setup-node` (node 24, pnpm cache), `pnpm install --frozen-lockfile --filter backend...`, `pnpm --filter backend migration:run`. Run migrations only; don't generate any.
- [x] 2.4 In `ci-cd.yml`, add a `migration-check` job: `needs: quality`, `if: needs.quality.outputs.backend_changed == 'true'`. Add it to `deploy-api`'s `needs`, and require `needs.migration-check.result == 'success'` in the **normal** branch of its condition only (the rollback branch must not depend on it). Update the condition comment block.
- [x] 2.5 Validate: YAML parses; `deploy-frontend`'s condition is unchanged; tracing the conditions confirms a frontend-only change skips the migration check and still deploys web, and a rollback still deploys the API.
- [x] 2.6 If Docker is available locally, run `migration:run` against a local `pgvector/pgvector:pg16` container to confirm they pass. Report results; do not trigger the pipeline. _(Skipped at the user's request: no local servers. The first pipeline run is the real test.)_
- [x] 2.7 **STOP: summarize the changes and wait for user approval before section 3.**

## 3. SAST (Semgrep, OWASP Top 10)

- [x] 3.1 Add a `semgrep` job to `security.yml` (`timeout-minutes: 10`, `container: semgrep/semgrep:<pinned>`): checkout, then `semgrep scan --config p/owasp-top-ten --error --metrics=off apps/backend apps/web packages` (the Expo app `apps/app` is not deployed, so it is not scanned).
- [x] 3.2 Validate: YAML parses and the `gitleaks` and `semgrep` jobs run in parallel (no `needs` between them). No `ci-cd.yml` change is needed, since `security` is already wired in.
- [x] 3.3 If Semgrep is available locally, run the same command and list the findings for the user. For each one, the user decides: fix the code, add `// nosemgrep: <rule-id> -- <reason>`, or add a `.semgrepignore` path. _(Not run: Semgrep is not installed locally, and fetching its ruleset is a network call the user ruled out. The findings will come from the first pipeline run.)_
- [x] 3.4 If the findings are mostly low-severity noise, ask the user whether to limit the job to `--severity ERROR`, and record the decision in `design.md`. _(Decided: the user chose `--severity ERROR`.)_
- [x] 3.5 **STOP: summarize the changes and wait for user approval before section 4.**

## 4. Image scan (Trivy)

- [x] 4.1 In `build-image.yml`, change the build step to `push: false` and `load: true`, keeping the same tags, build args and cache.
- [x] 4.2 Add a Trivy step (`aquasecurity/trivy-action`, pinned to a commit SHA): `image-ref` set to the commit-SHA tag, `severity: HIGH,CRITICAL`, `ignore-unfixed: true`, `exit-code: '1'`.
- [x] 4.3 Add a push step after the scan: `docker push --all-tags <DOCKERHUB_USERNAME>/knowledge-engine-<name>`. Check the existing Docker Hub login step still runs before it.
- [x] 4.4 Validate: YAML parses; both tags (SHA and `latest`) are still pushed; the order is build → scan → push; deploy jobs are unchanged.
- [x] 4.5 If Trivy is available locally, scan the locally built images and report any HIGH/CRITICAL fixable findings. Accepted ones go in `.trivyignore` with a comment. _(Not run: Trivy is not installed locally, and downloading its vulnerability database is a network call the user ruled out. The findings will come from the first pipeline run.)_
- [x] 4.6 **STOP: summarize the final pipeline shape and all changed files for the user.**

## 5. Review follow-ups

- [x] 5.1 Run production migrations in `deploy-api.yml` with the new image (`docker compose run --rm --no-deps backend ... migration:run`) between `pull` and `up`.
- [x] 5.2 Add `scanners: vuln,secret` to the Trivy step in `build-image.yml`.
- [x] 5.3 Run the backend, worker and web images as the `node` user (`USER node`), with `node`-owned `/app/tmp` (backend) and `.next` (web).
- [x] 5.4 Add `.github/dependabot.yml` (weekly, grouped: GitHub Actions, Docker base images, npm).
- [x] 5.5 Validate: YAML parses (workflows and `dependabot.yml`), the deploy script passes `bash -n`, and the migration command's paths exist in a backend build.

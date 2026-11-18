## Why

The pipeline currently checks code quality (lint, types, tests) and then ships images straight to the server. Nothing stops a leaked secret, a known vulnerability in the code or in an image, or a broken database migration from reaching production. This has already happened once: the document-version migration was committed to a misspelled folder (`apps/backend/src/migratins/`), so TypeORM never runs it and the production schema is missing the `documents.current_version_id` column and the version unique index.

## What Changes

Four new gates, each added and approved one at a time, in this order:

1. **Secret scan (gitleaks)**: scans the full git history before anything is built. A finding stops the pipeline.
2. **Migration check (ephemeral Postgres)**: when the backend changed, starts a throwaway `pgvector/pgvector:pg16` container, runs the app's existing migrations on an empty database (nothing is generated). The API is deployed only if this passes. Changes to the migrations folder are already covered, because it's part of the backend package that Turbo watches.
3. **SAST (Semgrep, OWASP Top 10)**: scans backend, frontend and shared packages with Semgrep's `p/owasp-top-ten` ruleset. A finding stops the pipeline.
4. **Image scan (Trivy)**: scans every built image for fixable HIGH/CRITICAL vulnerabilities **before** it is pushed to Docker Hub, so a vulnerable image is never published or deployed.

Every gate fails fast, has a short comment explaining it, and uses an official action or container instead of hand-written shell scripts.

**BREAKING (pipeline behaviour)**: runs that passed before can now fail. Expected first failures:
- a migration that errors on an empty database (the stray `src/migratins/` migration isn't loaded by TypeORM, so the check won't see it; step 2 moves it into `src/database/migrations/`)
- existing secrets in history, Semgrep findings or image CVEs may need fixing or an explicit, commented ignore entry

## Capabilities

### New Capabilities
- `infra/ci-pipeline`: the checks a change must pass before images are published and deployed (secret scan, SAST, migration check, image scan) and when each one runs.

### Modified Capabilities
<!-- None: no existing spec covers the CI/CD pipeline. -->

## Impact

- **Workflows**: new `.github/workflows/security.yml` (gitleaks + Semgrep) and `.github/workflows/migration-check.yml`. `build-image.yml` gains a Trivy step and builds → scans → pushes instead of building and pushing in one step. `ci-cd.yml` only gains job wiring (`needs` / `if`).
- **New config files**: `.gitleaksignore`, `.semgrepignore` and `.trivyignore`, created only when a false positive or accepted risk needs to be recorded.
- **Backend code**: the misspelled `apps/backend/src/migratins/` folder is removed and its migration is moved into `src/database/migrations/`. This is the only application change.
- **Pipeline time**: about 1–3 extra minutes. Gitleaks and Semgrep run in parallel with the quality job; the migration check runs in parallel with the build; Trivy adds roughly 30–60 s per image.
- **External services**: Semgrep downloads its public ruleset from semgrep.dev and Trivy downloads its vulnerability database. Neither needs an account or token.

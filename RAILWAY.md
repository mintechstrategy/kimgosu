# Railway API build

The repository root is the Docker build context. Keep Railway Root Directory `/`.
`railway.json` explicitly selects `Dockerfile`; Railpack autodetection is not used.

## Development service

- Project `kimgosu`, environment `dev`, service `api`, GitHub branch `dev`.
- Config file: repository-root `railway.json` (if a custom path is configured, use `/railway.json`).
- Remove obsolete custom build/start command overrides: Dockerfile supplies both.
- `KIMGOSU_RUNTIME=cloud` is set in the image. Railway supplies `PORT`.
- Do not set `HOST`; the application rejects it. Cloud mode binds `0.0.0.0`.
- Health check `/health` proves liveness only, not authentication or DB readiness.
- Initial connection/build verification is complete; development pushes now trigger deployment.
- Production `main` is separate and automatic deployment remains disabled.

The two-stage image installs the backend's committed npm lock on Linux, compiles
TypeScript, and carries `dist`, production dependencies and `/app/contracts` into
the runtime. The schema path resolves from `/app/services/backend/dist` to
`/app/contracts/registration-inputs.schema.json`. No database migration is run.
The container runs as the unprivileged `node` user; no secrets are baked in.
`.dockerignore` allowlists backend build inputs and contracts only.

## Protected development database

The development API is `https://api-dev-5cda.up.railway.app`. This is the tested
Railway domain, not a claim that custom DNS or production is configured.

Storage is enabled only when all of these runtime variables are valid:

- `KIMGOSU_DEVELOPMENT_STORAGE=synthetic-only`
- Railway project ID `95b52b2c-e1c0-45da-909b-d7989ce08a90`
- Railway environment ID `a1b5a11e-88a1-417e-84bc-2bbb2ba0fc18` (`dev`)
- `DATABASE_URL`: a private `*.railway.internal` PostgreSQL connection, delivered
  through Railway variables. Never paste its value into commands, logs or Git.

The existing `Postgres` service has a persistent volume. The API uses the separate
`kg_dev_runtime` login, not the database-owner credential. Runtime permissions are
schema USAGE, registrations SELECT/INSERT/UPDATE/DELETE and sessions SELECT only.
It cannot create tables, issue/revoke sessions, or update migration metadata.

The additive schema is `kg_dev_slice`, version `v0.1-dev-slice`, with three tables:
`schema_versions`, `registrations`, and `sessions`. These are a narrow synthetic
development slice, not the historical full product DB schema.

## Operator procedure

1. Verify project/environment/service IDs with `railway status` before writes.
   Use explicit `--project`, `--environment dev` and `--service` on operator commands.
2. Use official Railway SSH to reach the private network. The local computer
   cannot resolve Railway's internal DB hostname. Register an authorized SSH key,
   use `railway ssh --identity-file <private-key-path> ... -- <command>`, and verify
   the server's first-use host identity; do not disable host-key checks.
3. For a **new, reviewed, empty installation only**, apply the committed files
   `services/backend/migrations/001_v0.1-dev-slice.up.sql` then
   `services/backend/migrations/002_development-sessions.up.sql` with
   `psql -X -v ON_ERROR_STOP=1 -P pager=off`. Inspect existing schema first.
   The current dev database is already initialized: **do not rerun first-install
   migrations, run down migrations or drop data on subsequent deployments**.
4. Keep operator and runtime roles separate. Provision/grant the bounded runtime
   role and store its connection via `railway variable set --stdin` without
   printing credentials. Read back the exact target/value privately, then redeploy.
   Never give the app or browser a DB credential or common embedded bearer token.
5. Issue each synthetic user a random, short-lived opaque session. Store only its
   SHA-256 digest in `kg_dev_slice.sessions`; bind owner and synthetic namespace on
   the server. The reviewed operator script is
   `services/backend/scripts/development-session.mjs` (20-minute expiry).
   It must run in an authorized private-network checkout with operator privileges,
   not under the restricted API role. The runtime image intentionally does not
   contain operator scripts/migrations. Deliver tokens privately, never in logs.
6. Send authenticated requests to `/v1/development/registrations/quotes` or
   `/v1/development/registrations/services`. POST uses `{id,input}`; PUT uses
   `{expectedVersion,input}`; DELETE requires `If-Match: "<version>"`.
   Reuse the original UUID after an uncertain response and GET it before retrying.
7. Verify HTTP response **and** the exact database row. Revoke test sessions and
   delete only the current run's synthetic rows, preserving any designated evidence
   row. Remove temporary operator SSH access after the session.

Storage-disabled `503` means configuration is missing; session-required `401`
means a valid individual session is required. Neither is a successful transaction.
`/v1/validation/*` intentionally remains validation-only with `persisted=false`.

## Executed verification and remaining boundaries

On 2026-10-27, the protected backend revision was built and deployed on Railway.
Both reviewed migrations were applied to the actual development Postgres, with
schema and least-privilege role readback. Real HTTPS quote/service create, read,
update and delete passed, including direct SQL comparison, duplicate-ID rejection,
cross-owner/namespace rejection, expired sessions and concurrent version conflicts.
Local mocked SQL tests are not the evidence for these remote results.

For every subsequent authorized change: run scoped checks, push `dev`, verify the
exact successful deployment SHA, then repeat authenticated API write/readback.
Do not infer database readiness from `/health` or an older healthy deployment.
Docker is still unavailable locally; the Linux image build is verified on Railway.
Installed iOS UI, web UI E2E, real OAuth, full business workflows, media upload,
custom DNS and production remain separate acceptance scopes. No real payment or
settlement is performed. Existing `railway.json` is accepted by the installed CLI;
its deprecation warning requires migration before 2026-12-01, not an unreviewed
configuration replacement during this database verification.

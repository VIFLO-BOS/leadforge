# LeadForge

Business discovery, lead enrichment and sales intelligence SaaS. Initial market: Nigeria.

**Status: release 1 is feature-complete on the backend and in its final hardening stage (Phase 7).** Directory with provenance, CSV import, discovery from Overture Maps Places, website analysis, contact enrichment, scoring, duplicate review, pipeline, lists, activities, outreach, bulk operations, exports, usage, reports and Paystack billing. Before launch: Paystack test-mode run, approved prices, legal reviews and the other items in [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md#10-pre-launch-checklist).

## Quick start (development)

Prerequisites: Node.js 22 or newer, pnpm 11, Docker Desktop.

```bash
pnpm install
cp .env.example .env && pnpm gen:keys --write      # development values; never commit .env
pnpm dev:infra                                      # Postgres, MongoDB (replica set), Redis, Mailpit
pnpm db:migrate:deploy && pnpm db:mongo:sync        # PostgreSQL migrations, MongoDB validators and indexes
pnpm db:seed                                        # synthetic "(Sample)" data; sign in as owner@example.test
pnpm build && pnpm dev                              # web :3000, API :4000, worker
```

Mail goes to Mailpit at http://localhost:8025. Optional: `pnpm overture:sync` loads the Overture Maps Places release used by discovery (7 to 26 minutes). Billing stays "not configured" until a Paystack test key is set (docs/DEVELOPMENT.md).

Everyday checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` (integration tests use separate `*_test` databases), `pnpm test:e2e`.

## Testing

| Layer              | Command                             | What it covers                                                                                                                                                                                                                                                            |
| ------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit and component | `pnpm test`                         | Vitest across the packages and the web app                                                                                                                                                                                                                                |
| API integration    | `pnpm --filter @leadforge/api test` | Every route against real PostgreSQL, MongoDB and Redis on `*_test` databases: tenant isolation, permissions, billing with a Paystack fixture server, workflows                                                                                                            |
| Web viewport suite | `pnpm test:e2e`                     | Playwright against mocked APIs at 240, 320, 375, 768, 1024 and 1440 px: flows, keyboard, accessibility (axe), motion and zoom                                                                                                                                             |
| Release suite      | `pnpm e2e:release`                  | The 16 Final Acceptance Criteria through the real UI against a live API, worker and web app on dedicated `*_e2e` databases, with Mailpit, a Paystack fixture server and a local test website; the full flow at 1440 and 375 px and a smoke subset at 240, 768 and 1024 px |

The release suite needs Docker's PostgreSQL, MongoDB (replica set), Redis and Mailpit and a backend build; it creates and tears down everything else. Details: [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md#release-end-to-end-suite-stage-9). CI runs it on pull requests to main and nightly.

## Documentation

- [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) - setup, commands, testing notes, local Paystack and Overture
- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) - processes, every environment variable, migrations, Overture sync, billing, storage, scaling, CI, pre-launch checklist
- [docs/OPERATIONS.md](./docs/OPERATIONS.md) - monitoring, runbooks (failed jobs, payments, webhooks, Overture, credits, secrets), backup and restore, incidents
- [ARCHITECTURE.md](./ARCHITECTURE.md) - system shape, module boundaries, database ownership, queues, key decisions
- [docs/PRODUCT_REQUIREMENTS.md](./docs/PRODUCT_REQUIREMENTS.md) - objectives, roles, scope, credits and plans, page inventory
- [docs/DESIGN_SYSTEM.md](./docs/DESIGN_SYSTEM.md) - tokens, typography, components, responsive rules (240px baseline)
- [docs/DATABASE_DESIGN.md](./docs/DATABASE_DESIGN.md) - MongoDB collections, PostgreSQL models, indexes, cross-database workflows
- [docs/API_CONTRACTS.md](./docs/API_CONTRACTS.md) - `/api/v1` endpoints, response envelope, error codes
- [docs/SECURITY_AND_DATA_COLLECTION.md](./docs/SECURITY_AND_DATA_COLLECTION.md) - authz, tenant isolation, SSRF, collection policy, privacy, billing security, Phase 7 review
- [docs/IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md) - phases, status, deviations, testing strategy
- [infra/](./infra) - local services (`docker-compose.yml`), monitoring, load tests, backup scripts

# LeadForge Development Guide

## Prerequisites

- Node.js 22 or newer (24 is used in CI)
- pnpm 11 (`corepack enable` or `npm i -g pnpm`)
- Docker Desktop (Postgres 16, MongoDB 7 replica set, Redis 7 and Mailpit run in containers)

## First-time setup

```bash
pnpm install
cp .env.example .env            # Windows PowerShell: Copy-Item .env.example .env
pnpm gen:keys --write           # writes JWT_PRIVATE_KEY / JWT_PUBLIC_KEY into .env
pnpm dev:infra                  # starts postgres, mongo (+ replica set init), redis, mailpit
pnpm db:migrate:deploy          # prisma generate + apply migrations
pnpm db:mongo:sync              # create collections, validators and indexes
pnpm db:seed                    # synthetic org + placeholder plans (development only)
pnpm build                      # builds every workspace once so dist/ exists
pnpm dev                        # web :3000, api :4000, worker, with watchers
```

Mailpit UI: http://localhost:8025 (all outgoing email lands here). API docs: http://localhost:4000/api/docs.

Synthetic sign-in after seeding: `owner@example.test` / `synthetic-owner-pass-2026`. The seeded organization is named "Acme Demo (Synthetic)" and the seeded plans are flagged as placeholders, so the pricing page shows "Pricing not yet published".

## Repository layout

See `ARCHITECTURE.md` section 3. In short: `apps/web` (Next.js), `apps/api` (NestJS HTTP), `apps/worker` (BullMQ processors), `packages/contracts` (Zod schemas shared by all), `packages/core` (NestJS modules shared by api and worker), `packages/db-postgres` (Prisma), `packages/db-mongo` (driver, validators, indexes), `packages/ui` (tokens and components), `packages/config` (eslint and tsconfig presets).

Node packages build to `dist/` with `tsc`; the web app consumes `@leadforge/ui` from source via `transpilePackages`.

## Everyday commands

| Command                  | What it does                                                                   |
| ------------------------ | ------------------------------------------------------------------------------ |
| `pnpm dev`               | All apps in watch mode (Turborepo)                                             |
| `pnpm build`             | Build everything in dependency order                                           |
| `pnpm typecheck`         | `tsc --noEmit` everywhere                                                      |
| `pnpm lint`              | ESLint (flat config, security plugin, repository import rule)                  |
| `pnpm test`              | Vitest unit and integration tests (integration tests need the Docker services) |
| `pnpm test:e2e`          | Playwright viewport suite for the web app (240 to 1440 px)                     |
| `pnpm db:migrate`        | Create a new Prisma migration from schema changes (interactive)                |
| `pnpm db:migrate:deploy` | Apply pending migrations (CI and production)                                   |
| `pnpm db:mongo:sync`     | Idempotently apply Mongo validators and indexes                                |
| `pnpm format`            | Prettier                                                                       |

## Environment variables

Every variable is documented in `.env.example`. The API and worker validate the environment at boot with the `ServerEnv` schema in `packages/contracts/src/env.ts` and refuse to start if anything is missing or malformed. Secrets never go in the repository; production uses the hosting platform's secret store.

## Testing notes

- API integration tests live in `apps/api/test` and run against the real Postgres, Mongo and Redis from Docker. They use Redis database 9 and the Mongo database `leadforge_test`, and they truncate the Postgres tables, so never point them at a database you care about.
- Email flows are tested end to end by reading the queued mail job from BullMQ and extracting the link token. No worker needs to run during tests.
- Tenant isolation, CSRF, refresh-token reuse detection, last-owner protection and rate limits each have explicit failing-path tests.

## Conventions

- Every route handler declares `@Public()`, `@AuthOnly()` or `@RequirePermission(...)`. The API refuses to boot otherwise (`assertRoutePolicies`).
- Repositories take `organizationId` as a required argument for org-owned data. Importing `PrismaClient`, `MongoClient` or `Db` outside repositories fails lint.
- Request bodies are validated with Zod schemas from `@leadforge/contracts` through `ZodBody`; the same schemas drive the frontend forms.
- Money is `BigInt` minor units. Credits are integers. No floats.
- Responses use the `{ data, meta? }` envelope; errors use `{ error: { code, message, details?, requestId } }`.

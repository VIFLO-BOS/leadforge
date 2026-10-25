# LeadForge

Business discovery, lead enrichment and sales intelligence SaaS. Initial market: Nigeria.

**Status: Phase 1 (foundation) in progress.** Authentication, organizations, roles, invitations, health, mail queue, design tokens, marketing and dashboard shells. No business data features yet.

- [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) - setup and everyday commands
- [ARCHITECTURE.md](./ARCHITECTURE.md) - system shape, module boundaries, database ownership, key decisions
- [docs/PRODUCT_REQUIREMENTS.md](./docs/PRODUCT_REQUIREMENTS.md) - objectives, personas, first-release scope, page inventory
- [docs/DESIGN_SYSTEM.md](./docs/DESIGN_SYSTEM.md) - tokens, typography, components, responsive rules (240px baseline)
- [docs/DATABASE_DESIGN.md](./docs/DATABASE_DESIGN.md) - MongoDB collections, PostgreSQL models, indexes, cross-database workflows
- [docs/API_CONTRACTS.md](./docs/API_CONTRACTS.md) - `/api/v1` endpoints, response envelope, error codes
- [docs/SECURITY_AND_DATA_COLLECTION.md](./docs/SECURITY_AND_DATA_COLLECTION.md) - authz, tenant isolation, SSRF, collection policy, privacy
- [docs/IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md) - phases, approval gates, testing strategy

Quick start:

```bash
pnpm install && cp .env.example .env && pnpm gen:keys --write
pnpm dev:infra && pnpm db:migrate:deploy && pnpm db:mongo:sync && pnpm db:seed
pnpm build && pnpm dev
```

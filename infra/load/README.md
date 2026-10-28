# Load tests (k6)

Phase 7 load tests for the directory and the discovery queue. They run against a dedicated load-test stack and never against development, test or customer data.

## 1. Load-test databases and seed

```bash
docker exec leadforge-postgres createdb -U leadforge leadforge_perf
DATABASE_URL=postgresql://leadforge:leadforge@127.0.0.1:5432/leadforge_perf pnpm --filter @leadforge/db-postgres exec prisma migrate deploy
MONGODB_DB=leadforge_perf node packages/db-mongo/dist/scripts/sync.js          # with MONGODB_URI pointing at the local replica set
# Then, with DATABASE_URL, MONGODB_DB=leadforge_perf, a separate REDIS_URL database and QUEUE_PREFIX=leadforge-perf:
PERF_BUSINESSES=100000 PERF_OVERTURE_PLACES=20000 pnpm perf:seed
```

`apps/api/src/scripts/seed-perf.ts` refuses production and refuses unless both database names end in `_perf`. It creates "Perf Load Test (Synthetic)" with the owner `perf-owner@example.test` (password from `PERF_OWNER_PASSWORD`, default `synthetic-perf-pass-2026`), grants 1,000,000 development credits, ingests the businesses through the real ingest path (every name ends in "(Sample)", domains and emails are under `example.test`, the only phone numbers are 4,000 Ofcom drama-range numbers) and loads a synthetic Overture catalogue (the 25 fixture records plus "(Sample)" pharmacies in a synthetic Ikeja boundary, no phone numbers). It is idempotent.

Start the API and the worker against the same databases with `RATE_LIMIT_PER_MINUTE` raised (the default 600 requests per minute per user would throttle a single signed-in load generator), `DISCOVERY_JOBS_PER_HOUR` raised for the queue test, and `JWT_ACCESS_TTL_SECONDS` longer than the run.

## 2. Scripts

| Script                 | What it measures                                                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `directory.js`         | `GET /businesses` first pages (default, category+region+website, locality+email, field states, one-word and two-word search, name, created and fit sorts, filter plus sort), second pages through the cursor, business detail, facets. Thresholds: p95 under 300 ms per request type |
| `discovery-enqueue.js` | `POST /discovery/jobs` at a fixed arrival rate (`RATE` per second for `DURATION`): exact estimate, credit hold, job document, orchestrator enqueue. Processing is measured from the job documents afterwards                                                                         |

```bash
docker run --rm -v "$PWD/infra/load:/scripts:ro" -v "$PWD/.k6:/out" \
  -e BASE_URL=http://host.docker.internal:4200 -e PASSWORD=synthetic-perf-pass-2026 -e VUS=8 -e DURATION=2m \
  grafana/k6:1.3.0 run /scripts/directory.js --summary-export /out/directory.json
```

## 3. Results (2026-10-26, development laptop)

Environment, so read these as pessimistic: Intel Core i7-10510U (4 cores, 8 threads, 1.8 GHz), 16 GB RAM with about 1 GB free, Windows 11; PostgreSQL, Redis and MongoDB in Docker Desktop (WSL2) on the same machine as the API, the worker, k6 and another agent's browser test run. One API process, one worker process.

Data: 100,000 businesses in one organization, 20,025 staged Overture places.

Fixes made from the first run (k6 `directory`, 8 virtual users): the directory's first-page total now counts from a new `{organizationId, flags.suppressed, deletedAt}` index without reading documents (default count 88 to 460 ms became 4 ms), multi-word searches count through the search-token index (1.2 s became 53 ms) and drive the index scan with the longest word. List p95 went from 2.82 s to 0.80 s at 8 users with 43% more throughput.

Directory, after the fixes:

| Request type                                | p95, 2 users (27 req/s) | p95, 8 users (29 req/s)             |
| ------------------------------------------- | ----------------------- | ----------------------------------- |
| All list requests                           | **265 ms**              | 804 ms                              |
| Default list (`updatedAt` desc)             | 150 ms                  | 481 ms                              |
| Category + region + has website             | 135 ms                  | 455 ms                              |
| Region + locality + has email               | 126 ms                  | 522 ms                              |
| Field states (website and email unverified) | 453 ms                  | 1,060 ms                            |
| One-word search                             | 169 ms                  | 462 ms                              |
| Two-word search                             | 415 ms                  | 986 ms                              |
| Sort by name, by created, by fit            | 92 to 116 ms            | 397 to 477 ms                       |
| Region filter + name sort                   | 312 ms                  | 981 ms                              |
| Second page (cursor)                        | 139 ms                  | 596 ms                              |
| Business detail                             | 72 ms                   | 355 ms                              |
| Facets (cached 60 s in Redis; cold 1.6 s)   | 27 ms                   | 4.23 s (cold recomputes under load) |

After these runs, concurrent cold facet computations were made single-flight per API process (one aggregation serves every waiting request), which removes the 4 s tail seen at 8 users; not re-measured.

0 failed requests in every run. At 2 concurrent users (27 requests per second) the list target of p95 under 300 ms is met overall and for 8 of the 11 request types; the exceptions are field-state filters (dates evaluated per record), two-word search (reads every record matching the longest word) and filter plus a different sort (in-memory sort). At 8 users the single API process and the shared Docker MongoDB on this laptop are saturated (medians 180 to 560 ms) and no type meets the target; this measures the host, not a production configuration.

Discovery queue (`discovery-enqueue`, 5 jobs per second for 60 s, each job up to 5 records, worker on the same machine with concurrency 4):

- Creation: 295 jobs accepted, 0 failures, 4.7 per second sustained; p50 790 ms, p95 2.96 s. Creation runs the exact estimate (a catalogue count minus places already linked to the organization), so it slows as an organization links more places.
- Processing: all 295 completed and settled; 1,475 businesses created; 2,310 queue jobs (590 orchestrator, 1,720 page fetches), 6.6 s per attempt on average; the last job finished about 63 minutes after the first was created. Every job searched the same 20,000 places in the same order, so each later job paged past the places earlier jobs had already linked (5.8 pages per job on average): a deliberately worst case. A production deployment runs MongoDB on its own host and can raise the discovery worker's concurrency or add workers (`WORKER_QUEUES=discovery`).

Raw summaries: the k6 `--summary-export` JSON files of these runs are kept outside the repository (agent scratchpad); rerun the scripts to reproduce.

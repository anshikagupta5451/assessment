# Hotel Offer Orchestrator

Aggregates hotel offers from two mock suppliers, de-duplicates hotels by name, keeps the best (cheapest) offer per hotel, and supports price-range filtering in Redis. The comparison is orchestrated by a **Temporal** workflow.

**Stack:** Node.js (TypeScript), Express, Temporal, Redis, Docker / Docker Compose

---

## Architecture

```
            ┌──────────────── api container (Express, :3000) ─────────────────┐
 client ──► │ GET /api/hotels ──► Temporal client ──► hotelOffersWorkflow      │
            │ GET /health                                                      │
            │ GET /supplierA/hotels   GET /supplierB/hotels   (mock suppliers) │
            └───────────▲──────────────────────────────┬──────────────────────┘
                        │ HTTP                          │ gRPC
                        │                               ▼
            ┌───────────┴──── worker container ────┐  Temporal server (+ Postgres, UI :8080)
            │ hotelOffersWorkflow                  │◄─┘
            │  ├─ fetchSupplierHotels(A) ┐ parallel│
            │  ├─ fetchSupplierHotels(B) ┘         │
            │  ├─ selectBestOffers (dedupe)        │
            │  └─ cacheHotelOffers ───────────────►│──► Redis
            └──────────────────────────────────────┘
```

### Workflow (`src/temporal/workflows.ts`)
1. Calls Supplier A and Supplier B **in parallel** (`fetchSupplierHotels` activity, 3 attempts with exponential backoff, 10 s timeout).
2. If one supplier fails after retries, the workflow continues with the other one and logs a warning. If **both** fail it throws a non-retryable `AllSuppliersDown` failure (API returns `502`).
3. De-duplicates by hotel name (case-insensitive, trimmed). For hotels offered by both suppliers the **cheaper** one wins (tie → higher commission). Hotels from only one supplier are kept as-is.
4. Saves the de-duplicated list in Redis (`cacheHotelOffers` activity) and returns it.

### Redis layout & price filtering (`src/redis/hotelStore.ts`)
| Key | Type | Content |
|---|---|---|
| `hotels:{city}:byPrice` | ZSET | member = hotel name, score = price |
| `hotels:{city}:offers` | HASH | hotel name → offer JSON |
| `hotels:{city}:meta` | STRING | last refresh time (marks the city as cached, even if it has no hotels) |

Keys are written atomically (`MULTI/EXEC`) and expire after `CACHE_TTL_SECONDS` (default 300).
Price filtering happens **inside Redis** with a Lua script: `ZRANGEBYSCORE` on the price index, then `HMGET` for the offer payloads, in a single round trip. Bounds are inclusive.

---

## API

### `GET /api/hotels?city=delhi`
Runs the Temporal workflow and returns the de-duplicated list, sorted by price.

```json
[
  { "name": "Ibis",       "price": 2900,  "supplier": "Supplier B", "commissionPct": 7 },
  { "name": "Lemon Tree", "price": 3200,  "supplier": "Supplier A", "commissionPct": 8 },
  { "name": "Holtin",     "price": 5340,  "supplier": "Supplier B", "commissionPct": 20 },
  { "name": "Radison",    "price": 5900,  "supplier": "Supplier A", "commissionPct": 13 },
  ...
]
```

### `GET /api/hotels?city=delhi&minPrice=3000&maxPrice=7000`
Filters the cached list in Redis. If the city isn't cached yet (or the cache expired), the workflow runs first to populate Redis, then the filter is applied. `minPrice` and `maxPrice` are each optional.

Response headers help with debugging:
- `X-Data-Source`: `temporal-workflow`, `redis-cache` or `temporal-workflow+redis`
- `X-Suppliers-Status`: e.g. `A=ok;B=down` (when the workflow ran)

| Case | Status |
|---|---|
| Success (including a city with no hotels → `[]`) | 200 |
| Missing `city`, invalid/negative price, `minPrice > maxPrice` | 400 |
| Both suppliers unavailable | 502 |

### `GET /health`
Health of both suppliers plus Redis and Temporal. `200` when everything is up, `503` otherwise (`status: "degraded"` when only one supplier is up).

```json
{
  "status": "ok",
  "suppliers": {
    "Supplier A": { "status": "up", "latencyMs": 4 },
    "Supplier B": { "status": "up", "latencyMs": 3 }
  },
  "dependencies": { "redis": { "status": "up", ... }, "temporal": { "status": "up", ... } }
}
```
`GET /health/live` is a plain liveness probe (used by the Docker `HEALTHCHECK`).

### Mock suppliers
- `GET /supplierA/hotels?city=delhi`, `GET /supplierB/hotels?city=delhi` (no `city` → full inventory)
- Static data in `src/suppliers/mockData.ts`: `delhi` and `mumbai` with overlapping hotel names (Holtin, Radison, Taj Palace, ITC Maratha, Trident). Any other city returns `[]`.

### Simulating a supplier outage
```bash
curl -X POST localhost:3000/admin/suppliers/A/down   # supplier A returns 503
curl -X POST localhost:3000/admin/suppliers/A/up     # restore
curl localhost:3000/admin/suppliers                  # current state
```
A supplier can also start down with the env var `SUPPLIER_A_DOWN=true` / `SUPPLIER_B_DOWN=true`.

---

## Running with Docker Compose (recommended)

Prerequisites: Docker with Compose v2.

```bash
docker compose up -d --build
```

This starts:
| Service | Port | Purpose |
|---|---|---|
| `api` | 3000 | Express API + mock suppliers |
| `worker` | – | Temporal worker (same image, different command) |
| `temporal` | 7233 | Temporal server (`temporalio/auto-setup`) |
| `postgresql` | – | Temporal persistence |
| `temporal-ui` | 8080 | Temporal Web UI – inspect workflow runs at http://localhost:8080 |
| `redis` | 6379 | Cache & price index |

Temporal needs ~20–30 s on the first start to set up its schema; the API and worker retry their connection until it is ready. Check with:

```bash
docker compose logs -f worker     # wait for "Temporal worker started"
curl localhost:3000/health
curl "localhost:3000/api/hotels?city=delhi"
curl "localhost:3000/api/hotels?city=delhi&minPrice=3000&maxPrice=7000"
```

Stop: `docker compose down` (add `-v` to also drop the Temporal database volume).

## Running locally (without Docker for the app)

Prerequisites: Node.js 20+, a Redis server, and a Temporal server — e.g. the [Temporal CLI](https://docs.temporal.io/cli) dev server:

```bash
temporal server start-dev            # Temporal on :7233, UI on :8233
redis-server                         # or: docker run -p 6379:6379 redis:7-alpine

npm install
npm run build
npm run start:api                    # terminal 1
npm run start:worker                 # terminal 2
```
For development without a build step: `npm run dev:api` and `npm run dev:worker`.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | API port |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal frontend address |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `TEMPORAL_TASK_QUEUE` | `hotel-offers` | Task queue shared by API and worker |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `CACHE_TTL_SECONDS` | `300` | TTL of cached city results |
| `SUPPLIER_BASE_URL` | `http://localhost:3000` | Where the worker/health check reach the mock suppliers |
| `SUPPLIER_TIMEOUT_MS` | `3000` | Per-request supplier timeout |
| `SUPPLIER_A_DOWN` / `SUPPLIER_B_DOWN` | `false` | Start a mock supplier in the "down" state |
| `LOG_LEVEL` | `info` | pino log level |

## Postman

Import `postman/hotel-offer-orchestrator.postman_collection.json`. The `baseUrl` collection variable defaults to `http://localhost:3000`. It covers:
- Health check (both suppliers up)
- Mock supplier endpoints
- Valid city with overlaps (`city=delhi`) – asserts uniqueness and the cheaper offer wins
- Price range filter via Redis, min-price only
- City with no results (`city=paris` → `[]`)
- Validation errors (400)
- Supplier A down (partial results + degraded health), both down (502), then restore

Run the whole collection in order with the Collection Runner, or from the CLI: `npx newman run postman/hotel-offer-orchestrator.postman_collection.json`.

## Tests

```bash
npm test     # unit tests for the de-duplication / best-offer logic
```

## Logging & error handling
- Structured JSON logs (pino) for every HTTP request, Redis/Temporal connection events and errors.
- Activities and workflows log through Temporal's logger (`Context.current().log`, `workflow.log`) with supplier, city, attempt and timing info.
- Supplier calls: timeout via `AbortSignal`, 5xx/network errors are retried, 4xx and malformed payloads fail fast (non-retryable); malformed records are dropped and logged.
- A single supplier outage degrades gracefully; a Redis write failure doesn't fail the request; if Redis is down during a filtered request that just ran the workflow, filtering falls back to in-memory.
- Graceful shutdown of the API and worker on `SIGTERM`/`SIGINT`.

## Project structure

```
src/
├── server.ts                 # Express app, routes, error handler
├── config.ts, logger.ts, types.ts
├── routes/hotels.ts          # GET /api/hotels
├── routes/health.ts          # GET /health, /health/live
├── suppliers/                # mock supplier data + routes + outage toggle
├── domain/dedupe.ts          # pure best-offer selection (used inside the workflow)
├── redis/hotelStore.ts       # Redis persistence + Lua price filter
└── temporal/
    ├── workflows.ts          # hotelOffersWorkflow
    ├── activities.ts         # fetchSupplierHotels, cacheHotelOffers
    ├── worker.ts             # worker entry point
    └── client.ts             # Temporal client used by the API
Dockerfile, docker-compose.yml, postman/
```

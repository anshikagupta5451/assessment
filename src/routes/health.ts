import { Router } from 'express';
import { config } from '../config';
import { getRedis } from '../redis/hotelStore';
import { getTemporal } from '../temporal/client';

export const healthRouter = Router();

type Check = { status: 'up' | 'down'; latencyMs: number; error?: string };

const timed = async (fn: () => Promise<unknown>, timeoutMs = 2000): Promise<Check> => {
  const started = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)),
    ]);
    return { status: 'up', latencyMs: Date.now() - started };
  } catch (err) {
    return { status: 'down', latencyMs: Date.now() - started, error: (err as Error).message };
  }
};

const probeSupplier = (path: string) => async () => {
  const res = await fetch(`${config.suppliers.baseUrl}${path}`, {
    signal: AbortSignal.timeout(config.suppliers.timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
};

/** Liveness: the process is up (used by the Docker healthcheck). */
healthRouter.get('/live', (_req, res) => {
  res.json({ status: 'ok' });
});

/**
 * GET /health — reports the health of both suppliers plus Redis and Temporal.
 * 200 when everything is up, 503 otherwise ("degraded" if at least one supplier still works).
 */
healthRouter.get('/', async (_req, res) => {
  const [supplierA, supplierB, redis, temporal] = await Promise.all([
    timed(probeSupplier('/supplierA/health')),
    timed(probeSupplier('/supplierB/health')),
    timed(() => getRedis().ping()),
    timed(async () => (await getTemporal()).connection.healthService.check({})),
  ]);

  const suppliersUp = [supplierA, supplierB].filter((s) => s.status === 'up').length;
  const allUp = suppliersUp === 2 && redis.status === 'up' && temporal.status === 'up';
  const status = allUp ? 'ok' : suppliersUp > 0 && redis.status === 'up' && temporal.status === 'up' ? 'degraded' : 'down';

  res.status(allUp ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    suppliers: { 'Supplier A': supplierA, 'Supplier B': supplierB },
    dependencies: { redis, temporal },
  });
});

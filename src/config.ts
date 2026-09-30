const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: num(process.env.PORT, 3000),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  temporal: {
    address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'hotel-offers',
  },

  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    ttlSeconds: num(process.env.CACHE_TTL_SECONDS, 300),
  },

  suppliers: {
    // Base URL the worker uses to reach the mock supplier endpoints hosted by the API.
    baseUrl: process.env.SUPPLIER_BASE_URL ?? 'http://localhost:3000',
    timeoutMs: num(process.env.SUPPLIER_TIMEOUT_MS, 3000),
  },
};

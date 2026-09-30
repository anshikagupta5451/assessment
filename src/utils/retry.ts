import { logger } from '../logger';

export async function retry<T>(
  fn: () => Promise<T>,
  opts: { attempts: number; delayMs: number; label: string },
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= opts.attempts) throw err;
      logger.warn({ attempt, err: (err as Error).message }, `${opts.label} failed, retrying in ${opts.delayMs}ms`);
      await new Promise((r) => setTimeout(r, opts.delayMs));
    }
  }
}

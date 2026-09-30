import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config';
import { logger } from './logger';
import { closeRedis } from './redis/hotelStore';
import { healthRouter } from './routes/health';
import { hotelsRouter } from './routes/hotels';
import { supplierAdminRouter, supplierARouter, supplierBRouter } from './suppliers/supplierRouter';
import { AllSuppliersDownError, closeTemporal } from './temporal/client';
import { HttpError } from './utils/httpError';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  // Request logging
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      logger.info(
        { method: req.method, url: req.originalUrl, status: res.statusCode, ms: Date.now() - started },
        'request',
      );
    });
    next();
  });

  app.use('/supplierA', supplierARouter);
  app.use('/supplierB', supplierBRouter);
  app.use('/admin/suppliers', supplierAdminRouter);
  app.use('/api/hotels', hotelsRouter);
  app.use('/health', healthRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Central error handler
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof AllSuppliersDownError) {
      logger.error({ url: req.originalUrl }, err.message);
      res.status(502).json({ error: 'All hotel suppliers are currently unavailable' });
      return;
    }
    logger.error({ err, url: req.originalUrl }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

if (require.main === module) {
  const server = createApp().listen(config.port, () => {
    logger.info({ port: config.port }, 'API listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down API');
    server.close(async () => {
      await Promise.allSettled([closeRedis(), closeTemporal()]);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

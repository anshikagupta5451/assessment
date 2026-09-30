import pino from 'pino';
import { config } from './config';

export const logger = pino({
  level: config.logLevel,
  base: { service: process.env.SERVICE_NAME ?? 'hotel-orchestrator' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

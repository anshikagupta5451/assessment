import { NativeConnection, Worker } from '@temporalio/worker';
import { config } from '../config';
import { logger } from '../logger';
import { closeRedis } from '../redis/hotelStore';
import { retry } from '../utils/retry';
import * as activities from './activities';

async function run(): Promise<void> {
  const connection = await retry(
    () => NativeConnection.connect({ address: config.temporal.address }),
    { attempts: 30, delayMs: 2000, label: 'Temporal connection (worker)' },
  );

  // Namespace registration can lag behind the server becoming reachable, so retry creation too.
  const worker = await retry(
    () =>
      Worker.create({
        connection,
        namespace: config.temporal.namespace,
        taskQueue: config.temporal.taskQueue,
        workflowsPath: require.resolve('./workflows'),
        activities,
      }),
    { attempts: 30, delayMs: 2000, label: 'Temporal worker creation' },
  );

  logger.info({ taskQueue: config.temporal.taskQueue }, 'Temporal worker started');
  try {
    await worker.run(); // resolves after SIGINT/SIGTERM triggers a graceful shutdown
  } finally {
    await connection.close();
    await closeRedis();
    logger.info('Temporal worker stopped');
  }
}

run().catch((err) => {
  logger.fatal({ err }, 'Worker crashed');
  process.exit(1);
});

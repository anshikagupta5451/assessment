import { randomUUID } from 'node:crypto';
import { ApplicationFailure, Client, Connection, WorkflowFailedError } from '@temporalio/client';
import { config } from '../config';
import { retry } from '../utils/retry';
import type { HotelSearchResult } from '../types';
import type { hotelOffersWorkflow } from './workflows';

let clientPromise: Promise<{ client: Client; connection: Connection }> | undefined;

export function getTemporal(): Promise<{ client: Client; connection: Connection }> {
  if (!clientPromise) {
    clientPromise = retry(
      async () => {
        const connection = await Connection.connect({ address: config.temporal.address });
        return { connection, client: new Client({ connection, namespace: config.temporal.namespace }) };
      },
      { attempts: 30, delayMs: 2000, label: 'Temporal connection (api)' },
    ).catch((err) => {
      clientPromise = undefined; // allow a later request to try again
      throw err;
    });
  }
  return clientPromise;
}

export class AllSuppliersDownError extends Error {}

/** Starts the orchestration workflow and waits for its result. */
export async function runHotelOffersWorkflow(city: string): Promise<HotelSearchResult> {
  const { client } = await getTemporal();
  try {
    return await client.workflow.execute<typeof hotelOffersWorkflow>('hotelOffersWorkflow', {
      taskQueue: config.temporal.taskQueue,
      workflowId: `hotel-offers-${city}-${randomUUID()}`,
      args: [{ city }],
      workflowExecutionTimeout: '30 seconds',
    });
  } catch (err) {
    if (
      err instanceof WorkflowFailedError &&
      err.cause instanceof ApplicationFailure &&
      err.cause.type === 'AllSuppliersDown'
    ) {
      throw new AllSuppliersDownError(err.cause.message);
    }
    throw err;
  }
}

export async function closeTemporal(): Promise<void> {
  if (clientPromise) {
    const { connection } = await clientPromise.catch(() => ({ connection: undefined }));
    await connection?.close();
    clientPromise = undefined;
  }
}

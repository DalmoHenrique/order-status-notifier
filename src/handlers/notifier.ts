import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { config } from '../config';
import { parseOrderEvent, type OrderEvent } from '../domain/order-event';
import { isNewer, messageFor } from '../domain/order-status';
import { ddb } from '../infra/aws-clients';
import { logger } from '../infra/logger';
import { createProvider, type MessageProvider } from '../providers';
import { NotificationStore, type Outcome } from '../store/notification-store';

export interface NotifierDeps {
  store: NotificationStore;
  provider: MessageProvider;
  notificationsEnabled: () => boolean;
}

export function createNotifier(deps: NotifierDeps) {
  async function process(event: OrderEvent): Promise<Outcome> {
    const { store, provider } = deps;

    if (!deps.notificationsEnabled()) {
      await store.recordActivity(event, 'disabled', { detail: 'Notifications are switched off' });
      return 'disabled';
    }

    // First line of defense: the customer already saw this status or a later one.
    const current = await store.getCurrentStatus(event.orderId);
    if (current && !isNewer(event.status, current)) {
      const outcome: Outcome = current === event.status ? 'duplicate' : 'out_of_order';
      await store.recordActivity(event, outcome, { detail: `Customer was already told: ${current}` });
      return outcome;
    }

    // Second line: two copies of the event racing each other. Only one wins the claim.
    if (!(await store.claim(event))) {
      await store.recordActivity(event, 'duplicate', { detail: 'Already being sent or sent by another delivery' });
      return 'duplicate';
    }

    const text = messageFor(event.status, event.customer.name, event.orderId);
    try {
      const { providerMessageId } = await provider.send({
        to: event.customer.phone,
        customerName: event.customer.name,
        orderId: event.orderId,
        status: event.status,
        text,
      });
      await store.markSent(event, providerMessageId);
      await store.recordActivity(event, 'sent', { message: text, detail: `${provider.name}:${providerMessageId}` });
      return 'sent';
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await store.markFailed(event, reason);
      await store.recordActivity(event, 'failed', { detail: reason });
      throw error;
    }
  }

  async function handleRecord(record: SQSRecord): Promise<void> {
    let payload: unknown;
    try {
      payload = JSON.parse(record.body);
    } catch {
      payload = undefined;
    }

    const parsed = parseOrderEvent(payload);
    if (!parsed.ok) {
      // A broken message will never succeed. Retrying it only delays the DLQ, so I log and drop it.
      logger.error('poison_message', { messageId: record.messageId, errors: parsed.errors });
      return;
    }

    const outcome = await process(parsed.event);
    logger.info('event_processed', {
      eventId: parsed.event.eventId,
      orderId: parsed.event.orderId,
      status: parsed.event.status,
      outcome,
      receiveCount: record.attributes?.ApproximateReceiveCount,
    });
  }

  // I report failures per message, so one bad delivery doesn't make SQS redeliver the whole batch.
  // Records run one at a time to keep updates for the same order in arrival order.
  return async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
    const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];
    for (const record of event.Records) {
      try {
        await handleRecord(record);
      } catch (error) {
        logger.error('delivery_failed', {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}

let defaultHandler: ReturnType<typeof createNotifier> | undefined;

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  defaultHandler ??= createNotifier({
    store: new NotificationStore(ddb, config.tableName),
    provider: createProvider(config.messageProvider),
    notificationsEnabled: () => config.notificationsEnabled,
  });
  return defaultHandler(event);
}

import type { SQSEvent, SQSRecord } from 'aws-lambda';
import type { OrderEvent } from '../../src/domain/order-event';
import type { OrderStatus } from '../../src/domain/order-status';
import { createNotifier } from '../../src/handlers/notifier';
import type { MessageProvider } from '../../src/providers';
import type { NotificationStore } from '../../src/store/notification-store';
import { buildEvent } from '../fixtures';

// An in-memory store with the same rules as DynamoDB: claims are exclusive
// and a FAILED claim can be retried.
function memoryStore() {
  const state = new Map<string, OrderStatus>();
  const claims = new Map<string, 'PENDING' | 'SENT' | 'FAILED'>();
  const activity: Array<{ eventId: string; outcome: string }> = [];
  const key = (e: OrderEvent) => `${e.orderId}#${e.status}`;

  const store = {
    getCurrentStatus: jest.fn(async (orderId: string) => state.get(orderId)),
    claim: jest.fn(async (e: OrderEvent) => {
      const existing = claims.get(key(e));
      if (existing && existing !== 'FAILED') return false;
      claims.set(key(e), 'PENDING');
      return true;
    }),
    markSent: jest.fn(async (e: OrderEvent) => {
      claims.set(key(e), 'SENT');
      state.set(e.orderId, e.status);
    }),
    markFailed: jest.fn(async (e: OrderEvent) => {
      claims.set(key(e), 'FAILED');
    }),
    recordActivity: jest.fn(async (e: OrderEvent, outcome: string) => {
      activity.push({ eventId: e.eventId, outcome });
    }),
  };
  return { store: store as unknown as NotificationStore, activity, raw: store };
}

function fakeProvider(): MessageProvider & { send: jest.Mock } {
  return { name: 'fake', send: jest.fn().mockResolvedValue({ providerMessageId: 'msg-1' }) };
}

function sqsEvent(...events: Array<OrderEvent | string>): SQSEvent {
  return {
    Records: events.map(
      (e, i) =>
        ({
          messageId: `m-${i}`,
          body: typeof e === 'string' ? e : JSON.stringify(e),
          attributes: { ApproximateReceiveCount: '1' },
        }) as unknown as SQSRecord,
    ),
  };
}

function setup(enabled = true) {
  const mem = memoryStore();
  const provider = fakeProvider();
  const handler = createNotifier({ store: mem.store, provider, notificationsEnabled: () => enabled });
  return { ...mem, provider, handler };
}

describe('notifier', () => {
  it('sends the first update of an order', async () => {
    const { handler, provider, activity } = setup();

    const result = await handler(sqsEvent(buildEvent()));

    expect(result.batchItemFailures).toEqual([]);
    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({ to: '+5511999990000', status: 'SHIPPED' }));
    expect(activity).toEqual([{ eventId: 'evt-1', outcome: 'sent' }]);
  });

  it('sends a duplicated event only once', async () => {
    const { handler, provider, activity } = setup();
    const event = buildEvent();

    await handler(sqsEvent(event, { ...event, eventId: 'evt-1-retry' }));

    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(activity.map((a) => a.outcome)).toEqual(['sent', 'duplicate']);
  });

  it('ignores an update that arrives after a newer one', async () => {
    const { handler, provider, activity } = setup();

    await handler(
      sqsEvent(
        buildEvent({ eventId: 'evt-2', status: 'OUT_FOR_DELIVERY' }),
        buildEvent({ eventId: 'evt-1', status: 'SHIPPED' }),
      ),
    );

    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(activity.map((a) => a.outcome)).toEqual(['sent', 'out_of_order']);
  });

  it('loses the race when another delivery already claimed the event', async () => {
    const { handler, provider, raw, activity } = setup();
    raw.claim.mockResolvedValueOnce(false);

    await handler(sqsEvent(buildEvent()));

    expect(provider.send).not.toHaveBeenCalled();
    expect(activity[0]!.outcome).toBe('duplicate');
  });

  it('reports only the failed message back to SQS', async () => {
    const { handler, provider } = setup();
    provider.send.mockRejectedValueOnce(new Error('provider timeout'));

    const result = await handler(
      sqsEvent(buildEvent({ eventId: 'a', orderId: 'ORD-A' }), buildEvent({ eventId: 'b', orderId: 'ORD-B' })),
    );

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'm-0' }]);
    expect(provider.send).toHaveBeenCalledTimes(2);
  });

  it('sends on the retry after a failure', async () => {
    const { handler, provider, activity } = setup();
    provider.send.mockRejectedValueOnce(new Error('provider timeout'));
    const event = buildEvent();

    await handler(sqsEvent(event));
    const retry = await handler(sqsEvent(event));

    expect(retry.batchItemFailures).toEqual([]);
    expect(activity.map((a) => a.outcome)).toEqual(['failed', 'sent']);
  });

  it('sends nothing while notifications are switched off', async () => {
    const { handler, provider, activity } = setup(false);

    await handler(sqsEvent(buildEvent()));

    expect(provider.send).not.toHaveBeenCalled();
    expect(activity[0]!.outcome).toBe('disabled');
  });

  it('drops a message that can never be valid instead of retrying it', async () => {
    const { handler, provider } = setup();

    const result = await handler(sqsEvent('{"orderId": 42}'));

    expect(result.batchItemFailures).toEqual([]);
    expect(provider.send).not.toHaveBeenCalled();
  });
});

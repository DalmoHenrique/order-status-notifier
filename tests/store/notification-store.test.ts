import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { ddb } from '../../src/infra/aws-clients';
import { NotificationStore } from '../../src/store/notification-store';
import { buildEvent } from '../fixtures';

const ddbMock = mockClient(DynamoDBDocumentClient);
const fixedNow = new Date('2026-11-16T12:00:00.000Z');
const store = new NotificationStore(ddb, 'order-notifications', () => fixedNow);

function conditionFailed() {
  return new ConditionalCheckFailedException({ message: 'The conditional request failed', $metadata: {} });
}

describe('NotificationStore', () => {
  beforeEach(() => ddbMock.reset());

  it('reads the current status from the STATE item', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { currentStatus: 'SHIPPED' } });

    await expect(store.getCurrentStatus('ORD-1001')).resolves.toBe('SHIPPED');
    expect(ddbMock.commandCalls(GetCommand)[0]!.args[0].input.Key).toEqual({ PK: 'ORDER#ORD-1001', SK: 'STATE' });
  });

  it('claims a notification the first time it sees it', async () => {
    ddbMock.on(PutCommand).resolves({});

    await expect(store.claim(buildEvent())).resolves.toBe(true);
    const input = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
    expect(input.Item).toMatchObject({ SK: 'NOTIFICATION#SHIPPED', state: 'PENDING' });
    expect(input.ConditionExpression).toContain('attribute_not_exists(PK)');
  });

  it('does not claim a notification that already exists', async () => {
    ddbMock.on(PutCommand).rejects(conditionFailed());

    await expect(store.claim(buildEvent())).resolves.toBe(false);
  });

  it('lets a stale PENDING claim be taken over', async () => {
    ddbMock.on(PutCommand).resolves({});

    await store.claim(buildEvent());
    const values = ddbMock.commandCalls(PutCommand)[0]!.args[0].input.ExpressionAttributeValues!;
    expect(values[':staleBefore']).toBe(fixedNow.getTime() - 5 * 60 * 1000);
  });

  it('rethrows errors that are not a failed condition', async () => {
    ddbMock.on(PutCommand).rejects(new Error('throttled'));

    await expect(store.claim(buildEvent())).rejects.toThrow('throttled');
  });

  it('marks as sent and moves the order forward', async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await store.markSent(buildEvent(), 'msg-1');

    const [notification, state] = ddbMock.commandCalls(UpdateCommand).map((c) => c.args[0].input);
    expect(notification!.ExpressionAttributeValues).toMatchObject({ ':sent': 'SENT', ':id': 'msg-1' });
    expect(state!.ConditionExpression).toBe('attribute_not_exists(currentRank) OR currentRank < :rank');
  });

  it('keeps a newer status when an older one finishes sending later', async () => {
    ddbMock
      .on(UpdateCommand)
      .resolvesOnce({})
      .rejectsOnce(conditionFailed());

    await expect(store.markSent(buildEvent(), 'msg-1')).resolves.toBeUndefined();
  });

  it('records a failure with the reason', async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await store.markFailed(buildEvent(), 'provider timeout');

    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.ExpressionAttributeValues).toMatchObject({ ':failed': 'FAILED', ':reason': 'provider timeout' });
  });

  it('lists the activity timeline of an order', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ PK: 'ORDER#ORD-1001', SK: 'ACTIVITY#x', eventId: 'evt-1', orderId: 'ORD-1001', status: 'SHIPPED', outcome: 'sent', at: 'x' }],
    });

    const items = await store.listActivity('ORD-1001');

    expect(items).toEqual([expect.objectContaining({ eventId: 'evt-1', outcome: 'sent' })]);
    expect(items[0]).not.toHaveProperty('PK');
  });
});

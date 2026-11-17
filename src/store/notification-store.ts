import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { OrderEvent } from '../domain/order-event';
import { statusRank, type OrderStatus } from '../domain/order-status';

export type Outcome = 'sent' | 'duplicate' | 'out_of_order' | 'failed' | 'disabled';

export interface ActivityItem {
  eventId: string;
  orderId: string;
  status: OrderStatus;
  outcome: Outcome;
  message?: string;
  detail?: string;
  at: string;
}

// If a worker dies between claiming a notification and sending it, the claim stays PENDING.
// After this window another delivery attempt may take it over.
const STALE_CLAIM_MS = 5 * 60 * 1000;

const pk = (orderId: string) => `ORDER#${orderId}`;
const notificationSk = (status: OrderStatus) => `NOTIFICATION#${status}`;

// Single-table layout, one partition per order:
//   STATE                      -> last status the customer was told about
//   NOTIFICATION#<status>      -> idempotency record for that status (PENDING | SENT | FAILED)
//   ACTIVITY#<time>#<eventId>  -> what happened to each event, used by the simulator timeline
export class NotificationStore {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getCurrentStatus(orderId: string): Promise<OrderStatus | undefined> {
    const { Item } = await this.db.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: pk(orderId), SK: 'STATE' }, ConsistentRead: true }),
    );
    return Item?.currentStatus as OrderStatus | undefined;
  }

  // The conditional write is the actual duplicate guard. Two copies of the same event can
  // arrive at the same time; only one of them gets the claim.
  async claim(event: OrderEvent): Promise<boolean> {
    const now = this.now();
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: pk(event.orderId),
            SK: notificationSk(event.status),
            state: 'PENDING',
            eventId: event.eventId,
            claimedAt: now.getTime(),
            updatedAt: now.toISOString(),
          },
          ConditionExpression:
            'attribute_not_exists(PK) OR #state = :failed OR (#state = :pending AND claimedAt < :staleBefore)',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: {
            ':failed': 'FAILED',
            ':pending': 'PENDING',
            ':staleBefore': now.getTime() - STALE_CLAIM_MS,
          },
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }

  async markSent(event: OrderEvent, providerMessageId: string): Promise<void> {
    const at = this.now().toISOString();
    await this.db.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: pk(event.orderId), SK: notificationSk(event.status) },
        UpdateExpression: 'SET #state = :sent, providerMessageId = :id, updatedAt = :at',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: { ':sent': 'SENT', ':id': providerMessageId, ':at': at },
      }),
    );

    // Only move the order forward. If a newer status was already sent in the meantime,
    // the condition fails and I keep the newer one.
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: pk(event.orderId), SK: 'STATE' },
          UpdateExpression: 'SET currentStatus = :status, currentRank = :rank, updatedAt = :at',
          ConditionExpression: 'attribute_not_exists(currentRank) OR currentRank < :rank',
          ExpressionAttributeValues: { ':status': event.status, ':rank': statusRank(event.status), ':at': at },
        }),
      );
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
    }
  }

  async markFailed(event: OrderEvent, reason: string): Promise<void> {
    await this.db.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: pk(event.orderId), SK: notificationSk(event.status) },
        UpdateExpression: 'SET #state = :failed, lastError = :reason, updatedAt = :at ADD attempts :one',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':failed': 'FAILED',
          ':reason': reason,
          ':at': this.now().toISOString(),
          ':one': 1,
        },
      }),
    );
  }

  async recordActivity(event: OrderEvent, outcome: Outcome, extra: { message?: string; detail?: string } = {}) {
    const at = this.now().toISOString();
    await this.db.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: pk(event.orderId),
          SK: `ACTIVITY#${at}#${event.eventId}`,
          eventId: event.eventId,
          orderId: event.orderId,
          status: event.status,
          outcome,
          message: extra.message,
          detail: extra.detail,
          at,
        },
      }),
    );
  }

  async listActivity(orderId: string): Promise<ActivityItem[]> {
    const { Items = [] } = await this.db.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': pk(orderId), ':prefix': 'ACTIVITY#' },
      }),
    );
    return Items.map(({ eventId, orderId: id, status, outcome, message, detail, at }) => ({
      eventId,
      orderId: id,
      status,
      outcome,
      message,
      detail,
      at,
    })) as ActivityItem[];
  }
}

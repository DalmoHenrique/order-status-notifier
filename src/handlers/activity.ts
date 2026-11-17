import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { config } from '../config';
import { ddb } from '../infra/aws-clients';
import { NotificationStore } from '../store/notification-store';

let store: NotificationStore | undefined;

export function setStore(custom: NotificationStore) {
  store = custom;
}

// GET /orders/{orderId}/activity
// Shows what happened to every event of an order: sent, duplicate, out of order, failed.
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const orderId = event.pathParameters?.orderId;
  if (!orderId) {
    return { statusCode: 400, body: JSON.stringify({ errors: ['orderId: required'] }) };
  }

  store ??= new NotificationStore(ddb, config.tableName);
  const items = await store.listActivity(orderId);
  items.sort((a, b) => a.at.localeCompare(b.at));

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId, items }),
  };
}

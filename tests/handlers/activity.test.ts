import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { handler, setStore } from '../../src/handlers/activity';
import type { NotificationStore } from '../../src/store/notification-store';

const listActivity = jest.fn();
setStore({ listActivity } as unknown as NotificationStore);

async function call(orderId?: string) {
  const event = { pathParameters: orderId ? { orderId } : undefined } as APIGatewayProxyEventV2;
  return (await handler(event)) as APIGatewayProxyStructuredResultV2;
}

describe('activity handler', () => {
  it('returns the timeline oldest first', async () => {
    listActivity.mockResolvedValue([
      { eventId: 'b', outcome: 'duplicate', at: '2026-11-16T12:00:02.000Z' },
      { eventId: 'a', outcome: 'sent', at: '2026-11-16T12:00:01.000Z' },
    ]);

    const response = await call('ORD-1001');

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body!).items.map((i: { eventId: string }) => i.eventId)).toEqual(['a', 'b']);
  });

  it('answers 400 without an order id', async () => {
    const response = await call();
    expect(response.statusCode).toBe(400);
  });
});

import { SendMessageCommand } from '@aws-sdk/client-sqs';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { config } from '../config';
import { parseOrderEvent } from '../domain/order-event';
import { sqs } from '../infra/aws-clients';
import { logger } from '../infra/logger';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

// I keep this handler thin on purpose: validate, enqueue, answer 202.
// Anything slow or flaky (the messaging provider) happens behind the queue.
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  let payload: unknown;
  try {
    payload = JSON.parse(event.body ?? '');
  } catch {
    return json(400, { errors: ['body: must be valid JSON'] });
  }

  const parsed = parseOrderEvent(payload);
  if (!parsed.ok) {
    logger.warn('event_rejected', { errors: parsed.errors });
    return json(400, { errors: parsed.errors });
  }

  const { event: orderEvent } = parsed;
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: config.queueUrl,
      MessageBody: JSON.stringify(orderEvent),
      MessageAttributes: {
        eventId: { DataType: 'String', StringValue: orderEvent.eventId },
        orderId: { DataType: 'String', StringValue: orderEvent.orderId },
      },
    }),
  );

  logger.info('event_accepted', { eventId: orderEvent.eventId, orderId: orderEvent.orderId, status: orderEvent.status });
  return json(202, { accepted: true, eventId: orderEvent.eventId });
}

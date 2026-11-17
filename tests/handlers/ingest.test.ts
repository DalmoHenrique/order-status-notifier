import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../src/handlers/ingest';
import { buildEvent } from '../fixtures';

const sqsMock = mockClient(SQSClient);

function request(body: string | undefined): APIGatewayProxyEventV2 {
  return { body } as APIGatewayProxyEventV2;
}

async function call(body: string | undefined) {
  return (await handler(request(body))) as APIGatewayProxyStructuredResultV2;
}

describe('ingest handler', () => {
  beforeEach(() => sqsMock.reset());

  it('enqueues a valid event and answers 202', async () => {
    sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-1' });

    const response = await call(JSON.stringify(buildEvent()));

    expect(response.statusCode).toBe(202);
    const sent = sqsMock.commandCalls(SendMessageCommand)[0]!.args[0].input;
    expect(JSON.parse(sent.MessageBody!)).toMatchObject({ orderId: 'ORD-1001', status: 'SHIPPED' });
    expect(sent.MessageAttributes?.eventId?.StringValue).toBe('evt-1');
  });

  it('answers 400 for malformed JSON without touching the queue', async () => {
    const response = await call('{not json');

    expect(response.statusCode).toBe(400);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });

  it('answers 400 with the validation errors', async () => {
    const response = await call(JSON.stringify({ ...buildEvent(), status: 'TELEPORTED' }));

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body!).errors[0]).toContain('status');
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });
});

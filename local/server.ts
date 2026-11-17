import { DeleteMessageCommand, GetQueueAttributesCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, SQSEvent, SQSRecord } from 'aws-lambda';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { handler as activityHandler } from '../src/handlers/activity';
import { handler as ingestHandler } from '../src/handlers/ingest';
import { handler as notifierHandler } from '../src/handlers/notifier';
import { isSimulatorDown, setSimulatorOutage } from '../src/providers/simulator-provider';
import { ensureResources, type LocalResources } from './resources';

// Local stand-in for API Gateway + the SQS event source mapping.
// The handlers are the same ones that run in Lambda; only the wiring around them is local.

const PORT = Number(process.env.PORT ?? 3000);
const STATIC_DIR = join(__dirname, 'simulator');
const CONTENT_TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const sqs = new SQSClient({ endpoint: process.env.AWS_ENDPOINT_URL });

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function reply(res: ServerResponse, result: APIGatewayProxyStructuredResultV2) {
  res.writeHead(result.statusCode ?? 200, { 'content-type': 'application/json' });
  res.end(result.body ?? '');
}

async function serveStatic(res: ServerResponse, path: string) {
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (file.includes('..')) return send(res, 404, { error: 'not found' });
  try {
    const content = await readFile(join(STATIC_DIR, file));
    res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(content);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

async function queueDepth(url: string): Promise<number> {
  const { Attributes } = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: url,
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
    }),
  );
  return Number(Attributes?.ApproximateNumberOfMessages ?? 0) + Number(Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0);
}

function startServer(resources: LocalResources) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    try {
      if (req.method === 'POST' && url.pathname === '/events') {
        const body = await readBody(req);
        return reply(res, (await ingestHandler({ body } as APIGatewayProxyEventV2)) as APIGatewayProxyStructuredResultV2);
      }

      const activity = url.pathname.match(/^\/orders\/([^/]+)\/activity$/);
      if (req.method === 'GET' && activity) {
        const event = { pathParameters: { orderId: decodeURIComponent(activity[1]!) } } as unknown as APIGatewayProxyEventV2;
        return reply(res, (await activityHandler(event)) as APIGatewayProxyStructuredResultV2);
      }

      if (url.pathname === '/admin/state') {
        if (req.method === 'POST') {
          const body = JSON.parse((await readBody(req)) || '{}') as { providerDown?: boolean; notificationsEnabled?: boolean };
          if (typeof body.providerDown === 'boolean') setSimulatorOutage(body.providerDown);
          if (typeof body.notificationsEnabled === 'boolean') {
            process.env.NOTIFICATIONS_ENABLED = String(body.notificationsEnabled);
          }
        }
        return send(res, 200, {
          providerDown: isSimulatorDown(),
          notificationsEnabled: process.env.NOTIFICATIONS_ENABLED !== 'false',
          queueDepth: await queueDepth(resources.queueUrl),
          dlqDepth: await queueDepth(resources.dlqUrl),
        });
      }

      if (req.method === 'GET') return serveStatic(res, url.pathname);
      send(res, 404, { error: 'not found' });
    } catch (error) {
      console.error(error);
      send(res, 500, { error: error instanceof Error ? error.message : 'unexpected error' });
    }
  });

  server.listen(PORT, () => console.log(`Simulator running at http://localhost:${PORT}`));
}

// Long-polls the queue and hands batches to the notifier, the way Lambda's SQS trigger does.
// Messages the handler reports as failed are left alone, so they reappear after the
// visibility timeout and, after enough attempts, the redrive policy moves them to the DLQ.
async function pollQueue(queueUrl: string) {
  for (;;) {
    try {
      const { Messages = [] } = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 2,
          MessageSystemAttributeNames: ['All'],
        }),
      );
      if (Messages.length === 0) continue;

      const event: SQSEvent = {
        Records: Messages.map(
          (m) =>
            ({
              messageId: m.MessageId!,
              receiptHandle: m.ReceiptHandle!,
              body: m.Body ?? '',
              attributes: m.Attributes ?? {},
            }) as unknown as SQSRecord,
        ),
      };

      const { batchItemFailures } = await notifierHandler(event);
      const failed = new Set(batchItemFailures.map((f) => f.itemIdentifier));
      for (const message of Messages) {
        if (!failed.has(message.MessageId!)) {
          await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle! }));
        }
      }
    } catch (error) {
      console.error('poller error', error);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function main() {
  const resources = await ensureResources();
  process.env.QUEUE_URL = resources.queueUrl;
  process.env.TABLE_NAME = resources.tableName;
  process.env.MESSAGE_PROVIDER ??= 'simulator';

  startServer(resources);
  void pollQueue(resources.queueUrl);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

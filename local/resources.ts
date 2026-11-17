import { CreateTableCommand, DescribeTableCommand, DynamoDBClient, ResourceInUseException } from '@aws-sdk/client-dynamodb';
import { CreateQueueCommand, GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';

export const TABLE_NAME = 'order-notifications';
export const QUEUE_NAME = 'order-events';
export const DLQ_NAME = 'order-events-dlq';
export const MAX_RECEIVE_COUNT = 3;

export interface LocalResources {
  queueUrl: string;
  dlqUrl: string;
  tableName: string;
}

// Same shape as template.yaml, created through the SDK so the emulator matches what I deploy.
export async function ensureResources(): Promise<LocalResources> {
  const endpoint = process.env.AWS_ENDPOINT_URL;
  const sqs = new SQSClient({ endpoint });
  const dynamo = new DynamoDBClient({ endpoint });

  const { QueueUrl: dlqUrl } = await sqs.send(new CreateQueueCommand({ QueueName: DLQ_NAME }));
  const { Attributes } = await sqs.send(
    new GetQueueAttributesCommand({ QueueUrl: dlqUrl, AttributeNames: ['QueueArn'] }),
  );

  const { QueueUrl: queueUrl } = await sqs.send(
    new CreateQueueCommand({
      QueueName: QUEUE_NAME,
      Attributes: {
        // Short on purpose so a failed delivery comes back quickly in the demo.
        VisibilityTimeout: '10',
        RedrivePolicy: JSON.stringify({ deadLetterTargetArn: Attributes?.QueueArn, maxReceiveCount: MAX_RECEIVE_COUNT }),
      },
    }),
  );

  try {
    await dynamo.send(
      new CreateTableCommand({
        TableName: TABLE_NAME,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
      }),
    );
  } catch (error) {
    if (!(error instanceof ResourceInUseException)) throw error;
  }

  for (let attempt = 0; attempt < 30; attempt++) {
    const { Table } = await dynamo.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    if (Table?.TableStatus === 'ACTIVE') break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return { queueUrl: queueUrl!, dlqUrl: dlqUrl!, tableName: TABLE_NAME };
}

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';

// Locally I point the SDK at AWS Emulator through AWS_ENDPOINT_URL.
// In AWS the variable isn't set and the SDK uses the regular endpoints.
const endpoint = process.env.AWS_ENDPOINT_URL || undefined;

export const sqs = new SQSClient({ endpoint });

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint }), {
  marshallOptions: { removeUndefinedValues: true },
});

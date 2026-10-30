import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { jobSchema, type Job } from '@fim/shared';

export interface JobQueue {
  enqueue(job: Job): Promise<void>;
}

export function createSqsQueue(opts: {
  region: string;
  queueUrl: string;
  endpoint?: string | undefined;
}): JobQueue {
  const sqs = new SQSClient({
    region: opts.region,
    ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
  });
  return {
    async enqueue(job) {
      const parsed = jobSchema.parse(job);
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: opts.queueUrl,
          MessageBody: JSON.stringify(parsed),
          MessageAttributes: {
            correlationId: { DataType: 'String', StringValue: parsed.correlationId },
            type: { DataType: 'String', StringValue: parsed.type },
          },
        }),
      );
    },
  };
}

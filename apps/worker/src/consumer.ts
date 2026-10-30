import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient, type Message } from '@aws-sdk/client-sqs';
import { jobSchema, type Job } from '@fim/shared';
import type { Logger } from 'pino';

export type JobHandler = (job: Job, log: Logger) => Promise<unknown>;

/**
 * Long-polls SQS and runs each job. A message is deleted only after its handler succeeds;
 * otherwise it reappears after the visibility timeout and lands in the DLQ after 5 tries.
 */
export class QueueConsumer {
  private stopping = false;
  private readonly sqs: SQSClient;

  constructor(
    private readonly opts: {
      region: string;
      queueUrl: string;
      endpoint?: string | undefined;
      handler: JobHandler;
      log: Logger;
      waitSeconds?: number;
    },
  ) {
    this.sqs = new SQSClient({ region: opts.region, ...(opts.endpoint ? { endpoint: opts.endpoint } : {}) });
  }

  async processMessage(msg: Message): Promise<boolean> {
    const correlationId = msg.MessageAttributes?.correlationId?.StringValue ?? msg.MessageId ?? 'unknown';
    const log = this.opts.log.child({ correlationId, messageId: msg.MessageId });
    let job: Job;
    try {
      job = jobSchema.parse(JSON.parse(msg.Body ?? ''));
    } catch (err) {
      // Poison message: retrying cannot fix it, so let it go to the DLQ untouched.
      log.error({ err }, 'unparseable job');
      return false;
    }
    const started = Date.now();
    try {
      await this.opts.handler(job, log.child({ jobType: job.type }));
      await this.sqs.send(new DeleteMessageCommand({ QueueUrl: this.opts.queueUrl, ReceiptHandle: msg.ReceiptHandle }));
      log.info({ jobType: job.type, ms: Date.now() - started }, 'job done');
      return true;
    } catch (err) {
      log.error({ err, jobType: job.type }, 'job failed; will retry');
      return false;
    }
  }

  async pollOnce(): Promise<number> {
    const res = await this.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: this.opts.queueUrl,
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: this.opts.waitSeconds ?? 20,
        MessageAttributeNames: ['All'],
      }),
    );
    const messages = res.Messages ?? [];
    await Promise.all(messages.map((m) => this.processMessage(m)));
    return messages.length;
  }

  async run() {
    this.opts.log.info({ queueUrl: this.opts.queueUrl }, 'worker polling');
    while (!this.stopping) {
      try {
        await this.pollOnce();
      } catch (err) {
        this.opts.log.error({ err }, 'poll failed; backing off');
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  stop() {
    this.stopping = true;
  }
}

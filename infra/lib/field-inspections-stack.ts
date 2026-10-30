import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  aws_applicationautoscaling as appscaling,
  aws_cloudwatch as cloudwatch,
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_ecs_patterns as ecsPatterns,
  aws_logs as logs,
  aws_rds as rds,
  aws_s3 as s3,
  aws_secretsmanager as secretsmanager,
  aws_sqs as sqs,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface FieldInspectionsStackProps extends StackProps {
  /** Short environment name used in resource names, e.g. "dev" or "prod". */
  envName: string;
  /** Keep the database and bucket when the stack is deleted (true for prod). */
  retainData?: boolean;
}

/**
 * API and worker on ECS Fargate, Postgres + PostGIS on RDS, S3 for photos and reports,
 * SQS (+ DLQ) for report and push jobs. Synthesised in CI; deploying is optional.
 */
export class FieldInspectionsStack extends Stack {
  constructor(scope: Construct, id: string, props: FieldInspectionsStackProps) {
    super(scope, id, props);
    const removalPolicy = props.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC },
        { name: 'app', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
    });

    // --- Data ---------------------------------------------------------------
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSg', { vpc, description: 'Postgres' });
    const database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      databaseName: 'fim',
      credentials: rds.Credentials.fromGeneratedSecret('fim'),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      backupRetention: Duration.days(7),
      deletionProtection: !!props.retainData,
      removalPolicy,
      // PostGIS ships with RDS Postgres; the first migration runs CREATE EXTENSION postgis.
    });

    const bucket = new s3.Bucket(this, 'Media', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      removalPolicy,
      autoDeleteObjects: !props.retainData,
      cors: [
        {
          // The app PUTs photo parts straight to S3 with pre-signed URLs and reads the ETag.
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: Duration.days(7) },
        {
          prefix: 'inspections/',
          transitions: [
            { storageClass: s3.StorageClass.INFREQUENT_ACCESS, transitionAfter: Duration.days(90) },
          ],
        },
      ],
    });

    const dlq = new sqs.Queue(this, 'JobsDlq', {
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });
    const queue = new sqs.Queue(this, 'Jobs', {
      visibilityTimeout: Duration.seconds(120),
      receiveMessageWaitTime: Duration.seconds(20),
      enforceSSL: true,
      deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
    });

    const jwtSecret = new secretsmanager.Secret(this, 'JwtSecret', {
      description: 'HS256 signing key for access tokens',
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
    });

    // --- Compute ------------------------------------------------------------
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });
    const dbSecret = database.secret!;
    const dbEnv = {
      DB_HOST: ecs.Secret.fromSecretsManager(dbSecret, 'host'),
      DB_PORT: ecs.Secret.fromSecretsManager(dbSecret, 'port'),
      DB_NAME: ecs.Secret.fromSecretsManager(dbSecret, 'dbname'),
      DB_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
      DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
    };
    const shared = {
      NODE_ENV: 'production',
      AWS_REGION: this.region,
      S3_BUCKET: bucket.bucketName,
      SQS_QUEUE_URL: queue.queueUrl,
      LOG_LEVEL: 'info',
    };

    const api = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Api', {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: 2,
      minHealthyPercent: 100,
      publicLoadBalancer: true,
      circuitBreaker: { rollback: true },
      taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset(REPO_ROOT, { file: 'apps/api/Dockerfile' }),
        containerPort: 3000,
        environment: { ...shared, PORT: '3000' },
        secrets: { ...dbEnv, JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret) },
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: 'api',
          logGroup: new logs.LogGroup(this, 'ApiLogs', {
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy,
          }),
        }),
      },
    });
    api.targetGroup.configureHealthCheck({
      path: '/health',
      healthyHttpCodes: '200',
      interval: Duration.seconds(15),
    });
    const apiScaling = api.service.autoScaleTaskCount({ minCapacity: 2, maxCapacity: 6 });
    apiScaling.scaleOnCpuUtilization('Cpu', { targetUtilizationPercent: 60 });

    const workerTask = new ecs.FargateTaskDefinition(this, 'WorkerTask', {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    workerTask.addContainer('worker', {
      image: ecs.ContainerImage.fromAsset(REPO_ROOT, { file: 'apps/worker/Dockerfile' }),
      environment: shared,
      secrets: dbEnv,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'worker',
        logGroup: new logs.LogGroup(this, 'WorkerLogs', {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy,
        }),
      }),
    });
    const worker = new ecs.FargateService(this, 'Worker', {
      cluster,
      taskDefinition: workerTask,
      desiredCount: 1,
      minHealthyPercent: 100,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { rollback: true },
    });
    // Scale the worker on queue depth.
    const workerScaling = worker.autoScaleTaskCount({ minCapacity: 1, maxCapacity: 4 });
    workerScaling.scaleOnMetric('QueueDepth', {
      metric: queue.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(1) }),
      scalingSteps: [
        { upper: 10, change: 0 },
        { lower: 10, change: +1 },
        { lower: 100, change: +2 },
      ],
      adjustmentType: appscaling.AdjustmentType.CHANGE_IN_CAPACITY,
    });

    // --- Access -------------------------------------------------------------
    for (const svc of [api.service, worker]) {
      database.connections.allowDefaultPortFrom(svc, 'App to Postgres');
    }
    bucket.grantReadWrite(api.taskDefinition.taskRole);
    bucket.grantReadWrite(workerTask.taskRole);
    queue.grantSendMessages(api.taskDefinition.taskRole);
    queue.grantConsumeMessages(workerTask.taskRole);

    // --- Alarms -------------------------------------------------------------
    new cloudwatch.Alarm(this, 'DlqNotEmpty', {
      alarmDescription: 'Jobs are failing repeatedly and landing in the DLQ',
      metric: dlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    new CfnOutput(this, 'ApiUrl', { value: `http://${api.loadBalancer.loadBalancerDnsName}` });
    new CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new CfnOutput(this, 'QueueUrl', { value: queue.queueUrl });
    new CfnOutput(this, 'DeadLetterQueueUrl', { value: dlq.queueUrl });
  }
}

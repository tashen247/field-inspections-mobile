import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { FieldInspectionsStack } from '../lib/field-inspections-stack.js';

function synth(retainData = false) {
  const app = new App();
  const stack = new FieldInspectionsStack(app, 'Test', {
    envName: 'test',
    retainData,
    env: { account: '123456789012', region: 'af-south-1' },
  });
  return Template.fromStack(stack);
}

describe('FieldInspectionsStack', () => {
  const t = synth();

  it('runs the API and worker on Fargate behind a load balancer', () => {
    t.resourceCountIs('AWS::ECS::Service', 2);
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      HealthCheckPath: '/health',
    });
  });

  it('uses Postgres 16 in isolated subnets with encrypted storage', () => {
    t.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      EngineVersion: Match.stringLikeRegexp('^16'),
      StorageEncrypted: true,
      DBName: 'fim',
    });
  });

  it('keeps the bucket private with CORS for direct uploads and cleans up abandoned multipart uploads', () => {
    t.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: Match.objectLike({
        BlockPublicAcls: true,
        RestrictPublicBuckets: true,
      }),
      CorsConfiguration: { CorsRules: [Match.objectLike({ ExposedHeaders: ['ETag'] })] },
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({ AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 } }),
        ]),
      },
    });
  });

  it('wires the job queue to a dead-letter queue after five attempts', () => {
    t.resourceCountIs('AWS::SQS::Queue', 2);
    t.hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 120,
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 5 }),
    });
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmDescription: Match.stringLikeRegexp('DLQ'),
      Threshold: 1,
    });
  });

  it('passes database credentials as secrets, never plain environment', () => {
    const defs = t.findResources('AWS::ECS::TaskDefinition');
    const containers = Object.values(defs).flatMap(
      (d) =>
        (
          d as {
            Properties: {
              ContainerDefinitions: {
                Environment?: { Name: string }[];
                Secrets?: { Name: string }[];
              }[];
            };
          }
        ).Properties.ContainerDefinitions,
    );
    expect(containers).toHaveLength(2);
    for (const c of containers) {
      expect((c.Secrets ?? []).map((s) => s.Name)).toEqual(
        expect.arrayContaining(['DB_HOST', 'DB_PASSWORD']),
      );
      expect((c.Environment ?? []).map((e) => e.Name)).not.toContain('DB_PASSWORD');
    }
  });

  it('protects data in prod', () => {
    const prod = synth(true);
    prod.hasResource('AWS::RDS::DBInstance', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({ DeletionProtection: true }),
    });
    prod.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain' });
  });
});

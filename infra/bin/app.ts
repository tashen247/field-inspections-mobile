import { App, Tags } from 'aws-cdk-lib';
import { FieldInspectionsStack } from '../lib/field-inspections-stack.js';

const app = new App();
const envName = (app.node.tryGetContext('env') as string | undefined) ?? 'dev';

const stack = new FieldInspectionsStack(app, `FieldInspections-${envName}`, {
  envName,
  retainData: envName === 'prod',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    // Cape Town keeps claim data in South Africa (POPIA).
    region: process.env.CDK_DEFAULT_REGION ?? 'af-south-1',
  },
});
Tags.of(stack).add('project', 'field-inspections');
Tags.of(stack).add('environment', envName);

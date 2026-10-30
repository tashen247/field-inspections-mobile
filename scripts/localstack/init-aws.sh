#!/bin/bash
# Creates the bucket and queues the API and worker expect when running locally.
set -euo pipefail
awslocal s3 mb s3://fim-media || true
awslocal s3api put-bucket-cors --bucket fim-media --cors-configuration '{
  "CORSRules": [{"AllowedOrigins": ["*"], "AllowedMethods": ["GET", "PUT"], "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"]}]
}'
DLQ_URL=$(awslocal sqs create-queue --queue-name fim-jobs-dlq --query QueueUrl --output text)
DLQ_ARN=$(awslocal sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names QueueArn --query Attributes.QueueArn --output text)
awslocal sqs create-queue --queue-name fim-jobs --attributes "{\"VisibilityTimeout\":\"120\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\"}"
echo "fim: bucket and queues ready"

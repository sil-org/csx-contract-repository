#!/usr/bin/env bash
# Creates the private S3 bucket that holds executed contracts (spec R-D2, R-D9).
#
#   BUCKET=sil-contract-repository REGION=us-east-1 \
#   ALLOWED_ORIGINS='https://contracts.sil.org,http://localhost:5173' ./infra/create-bucket.sh
#
# Needs the AWS CLI, signed in as someone who may create buckets and set Object Lock
# (NOT the limited IAM user in iam-policy.json). Safe to read before running; it only
# touches the bucket named in $BUCKET.
set -euo pipefail

: "${BUCKET:?set BUCKET (globally unique S3 bucket name)}"
REGION="${REGION:-us-east-1}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:?set ALLOWED_ORIGINS (comma-separated app origins that upload from the browser)}"
# PLACEHOLDER retention until the records-retention policy is confirmed (spec §11 #6).
# GOVERNANCE mode: a privileged admin can still shorten/override it, so this is reversible.
# Do NOT switch to COMPLIANCE mode until counsel confirms — nobody (not even the AWS root
# account) can undo compliance-mode retention.
RETENTION_DAYS="${RETENTION_DAYS:-2555}"   # ~7 years
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "Creating s3://$BUCKET in $REGION (Object Lock on — this also turns on versioning)…"
if [ "$REGION" = "us-east-1" ]; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" --object-lock-enabled-for-bucket
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" --object-lock-enabled-for-bucket \
    --create-bucket-configuration "LocationConstraint=$REGION"
fi

aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'

aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled

aws s3api put-object-lock-configuration --bucket "$BUCKET" --object-lock-configuration \
  "{\"ObjectLockEnabled\":\"Enabled\",\"Rule\":{\"DefaultRetention\":{\"Mode\":\"GOVERNANCE\",\"Days\":$RETENTION_DAYS}}}"

# Browser uploads go straight to S3 via presigned URLs, so the bucket needs CORS for the app origins.
ORIGINS_JSON="$(printf '%s' "$ALLOWED_ORIGINS" | python3 -c 'import json,sys; print(json.dumps([o.strip() for o in sys.stdin.read().split(",") if o.strip()]))')"
python3 - "$HERE/cors.json" "$ORIGINS_JSON" > /tmp/contracts-cors.json <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1]))
cfg["CORSRules"][0]["AllowedOrigins"] = json.loads(sys.argv[2])
print(json.dumps(cfg))
PY
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration file:///tmp/contracts-cors.json

echo
echo "Done. Next: create the limited IAM user from infra/iam-policy.json (replace BUCKET_NAME),"
echo "then set the secrets listed in supabase/functions/README.md."

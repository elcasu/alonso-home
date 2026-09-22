#!/usr/bin/env bash
# Crea el bucket privado en us-east-2 si AWS CLI tiene credenciales.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env"
  set +a
fi

REGION="${AWS_REGION:-us-east-2}"
BUCKET="${S3_BUCKET:-alonso-home-nvr}"

if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "AWS CLI no tiene credenciales. El stack igual corre en modo ensayo (data/s3-dry)."
  echo "Cuando quieras S3 de verdad: aws configure (cuenta 589324424853, región ${REGION})"
  exit 1
fi

if aws s3api head-bucket --bucket "${BUCKET}" --region "${REGION}" 2>/dev/null; then
  echo "El bucket ${BUCKET} ya existe."
else
  if [[ "${REGION}" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "${BUCKET}" --region "${REGION}"
  else
    aws s3api create-bucket \
      --bucket "${BUCKET}" \
      --region "${REGION}" \
      --create-bucket-configuration LocationConstraint="${REGION}"
  fi
  echo "Creé ${BUCKET} en ${REGION}."
fi

aws s3api put-public-access-block \
  --bucket "${BUCKET}" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-lifecycle-configuration \
  --bucket "${BUCKET}" \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "expire-events",
      "Status": "Enabled",
      "Filter": {"Prefix": "events/"},
      "Expiration": {"Days": 90}
    }]
  }'

echo "Bucket privado listo. Lifecycle: 90 días en events/."

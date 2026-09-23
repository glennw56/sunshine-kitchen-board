#!/usr/bin/env bash
# Deploy ONLY the kitchen board test service.
# Refuses any other Cloud Run service, project, or region.
set -euo pipefail

ALLOWED_SERVICE="sunshine-kitchen-board-test"
ALLOWED_PROJECT="bakery-444323"
ALLOWED_REGION="us-east1"
ALLOWED_BUCKET="bakery-444323-sunshine-kitchen-board-test"
ALLOWED_INVENTORY_SERVICE="sunshine-inventory-test"

refuse() {
  echo "REFUSING deploy: $*" >&2
  echo "This script only deploys ${ALLOWED_SERVICE} in ${ALLOWED_PROJECT} / ${ALLOWED_REGION}." >&2
  exit 1
}

if [[ $# -gt 0 ]]; then
  refuse "arguments are not accepted (got: $*). Service is fixed to ${ALLOWED_SERVICE}."
fi

if [[ -n "${CLOUD_RUN_SERVICE:-}" && "${CLOUD_RUN_SERVICE}" != "${ALLOWED_SERVICE}" ]]; then
  refuse "CLOUD_RUN_SERVICE=${CLOUD_RUN_SERVICE}"
fi
if [[ -n "${SERVICE:-}" && "${SERVICE}" != "${ALLOWED_SERVICE}" ]]; then
  refuse "SERVICE=${SERVICE}"
fi
if [[ -n "${GCP_PROJECT:-}" && "${GCP_PROJECT}" != "${ALLOWED_PROJECT}" ]]; then
  refuse "GCP_PROJECT=${GCP_PROJECT}"
fi
if [[ -n "${REGION:-}" && "${REGION}" != "${ALLOWED_REGION}" ]]; then
  refuse "REGION=${REGION}"
fi

SERVICE="${ALLOWED_SERVICE}"
PROJECT="${ALLOWED_PROJECT}"
REGION="${ALLOWED_REGION}"
BUCKET="${ALLOWED_BUCKET}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT}/deploy.env}"
if [[ ! -f "${ENV_FILE}" ]]; then
  refuse "missing ${ENV_FILE}. Copy deploy.env.example and fill it in. Do not point it at any service but ${ALLOWED_SERVICE}."
fi

# shellcheck disable=SC1090
set -a
source "${ENV_FILE}"
set +a

if [[ -n "${SERVICE:-}" && "${SERVICE}" != "${ALLOWED_SERVICE}" ]]; then
  refuse "deploy.env SERVICE=${SERVICE}"
fi
SERVICE="${ALLOWED_SERVICE}"
PROJECT="${ALLOWED_PROJECT}"
REGION="${ALLOWED_REGION}"
BUCKET="${ALLOWED_BUCKET}"

if [[ "${INVENTORY_BASE_URL:-}" == *"/sunshine-inventory/"* ]]; then
  refuse "inventory URL must be the test service"
fi
if [[ -n "${INVENTORY_SERVICE:-}" && "${INVENTORY_SERVICE}" != "${ALLOWED_INVENTORY_SERVICE}" ]]; then
  refuse "INVENTORY_SERVICE=${INVENTORY_SERVICE}"
fi

: "${AUTH_SECRET:?AUTH_SECRET is required in deploy.env}"
if [[ ${#AUTH_SECRET} -lt 16 ]]; then
  refuse "AUTH_SECRET must be at least 16 characters"
fi

if ! command -v gcloud >/dev/null 2>&1; then
  refuse "gcloud is not installed"
fi

TAG="$(git -C "${ROOT}" rev-parse --short HEAD)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/sunshine/${SERVICE}:${TAG}"

echo "Deploying ${SERVICE} to ${PROJECT} / ${REGION}"
echo "Image ${IMAGE}"
echo "Data bucket gs://${BUCKET} mounted at /data"
echo "Inventory stays on sunshine-inventory-test only."

gcloud artifacts repositories describe sunshine \
  --project="${PROJECT}" \
  --location="${REGION}" >/dev/null 2>&1 \
  || gcloud artifacts repositories create sunshine \
    --project="${PROJECT}" \
    --location="${REGION}" \
    --repository-format=docker \
    --description="Sunshine test images"

gcloud builds submit "${ROOT}" \
  --project="${PROJECT}" \
  --tag="${IMAGE}"

ENV_YAML="$(mktemp)"
trap 'rm -f "${ENV_YAML}"' EXIT
python3 - "${ENV_YAML}" <<'PY'
import os, sys
path = sys.argv[1]
values = {
    "DATA_DIR": "/data",
    "TZ": "America/Chicago",
    "INVENTORY_TRANSPORT": "http",
    "INVENTORY_BASE_URL": os.environ.get("INVENTORY_BASE_URL") or "https://sunshine-inventory-test-k6uuoen7wa-ue.a.run.app",
    "TIMECLOCK_BASE_URL": os.environ.get("TIMECLOCK_BASE_URL") or "https://sunshine-timeclock-k6uuoen7wa-ue.a.run.app",
    "SQUARE_API_BASE": os.environ.get("SQUARE_API_BASE") or "https://connect.squareup.com",
    "AUTH_SECRET": os.environ["AUTH_SECRET"],
    "ADMIN_EMAIL": os.environ.get("ADMIN_EMAIL") or "glenn.will799@gmail.com",
    "TIMECLOCK_DEFAULT_STORE": os.environ.get("TIMECLOCK_DEFAULT_STORE") or "Irondale",
    "OVERDUE_BUFFER_MINUTES": os.environ.get("OVERDUE_BUFFER_MINUTES") or "10",
    "REALERT_MINUTES": os.environ.get("REALERT_MINUTES") or "15",
}
optional = [
    "ADMIN_INITIAL_PASSWORD",
    "INVENTORY_EMAIL",
    "INVENTORY_PASSWORD",
    "INVENTORY_GCS_BUCKET",
    "TIMECLOCK_IDENTIFIER",
    "TIMECLOCK_PASSWORD",
    "SLACK_BOT_TOKEN",
    "SLACK_SIGNING_SECRET",
    "SLACK_CHANNEL_ID",
    "SLACK_ASSIGNEE_MAP",
    "SQUARE_ACCESS_TOKEN",
    "PUBLIC_BASE_URL",
    "CRON_SECRET",
]
for key in optional:
    if os.environ.get(key):
        values[key] = os.environ[key]
def quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
with open(path, "w", encoding="utf-8") as handle:
    for key, value in values.items():
        handle.write(f"{key}: {quote(value)}\n")
PY

gcloud run deploy "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --port=8080 \
  --allow-unauthenticated \
  --execution-environment=gen2 \
  --memory=512Mi \
  --env-vars-file="${ENV_YAML}" \
  --add-volume="name=data,type=cloud-storage,bucket=${BUCKET}" \
  --add-volume-mount="volume=data,mount-path=/data"

echo
echo "Deployed https://console.cloud.google.com/run/detail/${REGION}/${SERVICE}/revisions?project=${PROJECT}"
echo "Owner login: ${ADMIN_EMAIL:-glenn.will799@gmail.com}"
echo "If ADMIN_INITIAL_PASSWORD was empty, read gs://${BUCKET}/owner-password.txt once, hand it to the owner, then delete that object."
echo "Square stock target is Test Cook variation HRFLTIDM2ZHZNXN4N4EN6WFQ at L4CK6YWGT5XQX only."

#!/usr/bin/env bash
# Deploy StudyBuddy chat API to Google Cloud Run and print the service URL.
#
# Required env:
#   GCP_PROJECT_ID
#   DATABASE_URL          # Neon pooled URL, e.g. postgresql://...@.../neondb?sslmode=require
#   CHAT_JWT_SECRET       # long random secret
#
# Optional env:
#   GCP_REGION            # default: us-central1
#   SERVICE_NAME          # default: studybuddy-chat-api
#   ARTIFACT_REPO         # default: studybuddy
#   IMAGE_TAG             # default: latest
#
# Auth: run `gcloud auth login` (or set GOOGLE_APPLICATION_CREDENTIALS to a SA key).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-studybuddy-chat-api}"
ARTIFACT_REPO="${ARTIFACT_REPO:-studybuddy}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
DATABASE_URL="${DATABASE_URL:?Set DATABASE_URL}"
CHAT_JWT_SECRET="${CHAT_JWT_SECRET:?Set CHAT_JWT_SECRET}"

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO}/chat-api:${IMAGE_TAG}"

echo "==> Using project ${PROJECT_ID} (${REGION})"
gcloud config set project "${PROJECT_ID}" >/dev/null

echo "==> Enabling required APIs"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  --project "${PROJECT_ID}"

echo "==> Ensuring Artifact Registry repo exists"
if ! gcloud artifacts repositories describe "${ARTIFACT_REPO}" \
  --location="${REGION}" \
  --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${ARTIFACT_REPO}" \
    --repository-format=docker \
    --location="${REGION}" \
    --project="${PROJECT_ID}" \
    --description="StudyBuddy container images"
fi

echo "==> Building and pushing ${IMAGE}"
gcloud builds submit --tag "${IMAGE}" --project "${PROJECT_ID}"

echo "==> Deploying Cloud Run service ${SERVICE_NAME}"
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --set-env-vars "DATABASE_URL=${DATABASE_URL},CHAT_JWT_SECRET=${CHAT_JWT_SECRET}" \
  --project "${PROJECT_ID}"

SERVICE_URL="$(
  gcloud run services describe "${SERVICE_NAME}" \
    --region "${REGION}" \
    --project "${PROJECT_ID}" \
    --format='value(status.url)'
)"

echo
echo "=============================================="
echo "Cloud Run URL:"
echo "  ${SERVICE_URL}"
echo
echo "Set this in mobile/.env and EAS env:"
echo "  EXPO_PUBLIC_CHAT_API_URL=${SERVICE_URL}"
echo
echo "Health check:"
echo "  curl ${SERVICE_URL}/api/health"
echo "=============================================="

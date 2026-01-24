#!/usr/bin/env bash
set -euo pipefail

echo "Enabling required Google Cloud services..."

gcloud services enable run.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com

echo "All required services enabled."

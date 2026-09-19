#!/bin/bash
# GWS Admin — build the Docker image locally.
# Usage: ./scripts/build-docker.sh [image-tag]
#
# PocketBase and the Go signer are both fetched/built inside the image,
# so nothing needs to be present in the repo before running this.
set -euo pipefail

cd "$(dirname "$0")/.."
TAG="${1:-gws-admin:latest}"

echo "Building $TAG ..."
docker build -t "$TAG" .
echo "Done."
echo
echo "Run with:  docker compose up -d"
echo "Or push:   docker push $TAG"

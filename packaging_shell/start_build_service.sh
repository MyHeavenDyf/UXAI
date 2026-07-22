#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ARTIFACT_ENV_FILE="${BUILD_ARTIFACT_ENV_FILE:-$SCRIPT_DIR/.env.artifact}"
if [ -f "$ARTIFACT_ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ARTIFACT_ENV_FILE"
    set +a
fi

export BUILD_SERVICE_HOST="${BUILD_SERVICE_HOST:-0.0.0.0}"
export BUILD_SERVICE_PORT="${BUILD_SERVICE_PORT:-8787}"

exec bun "$SCRIPT_DIR/build_service.ts"

#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export BUILD_SERVICE_HOST="${BUILD_SERVICE_HOST:-0.0.0.0}"
export BUILD_SERVICE_PORT="${BUILD_SERVICE_PORT:-8787}"

exec bun "$SCRIPT_DIR/build_service.ts"

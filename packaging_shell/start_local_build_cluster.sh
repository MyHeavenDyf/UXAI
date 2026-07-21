#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECTS_ROOT="$(cd "$PROJECT_ROOT/.." && pwd)"
TEST1_ROOT="$PROJECTS_ROOT/UXAITEST1"
TEST2_ROOT="$PROJECTS_ROOT/UXAITEST2"

for project in "$PROJECT_ROOT" "$TEST1_ROOT" "$TEST2_ROOT"; do
    if [ ! -f "$project/packaging_shell/start_build_service.sh" ]; then
        echo "❌ 缺少打包服务脚本: $project/packaging_shell/start_build_service.sh"
        exit 1
    fi
done

if [ ! -s "$PROJECT_ROOT/.env.proxy" ]; then
    echo "❌ 代理配置不存在或为空: $PROJECT_ROOT/.env.proxy"
    exit 1
fi

for port in 8787 8788 8789 8790; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
        echo "❌ 端口 $port 已被占用，请先在旧服务终端按 Ctrl+C 停止服务。"
        exit 1
    fi
done

PIDS=()

stop_cluster() {
    echo ""
    echo "正在停止本地模拟集群..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
}

trap stop_cluster EXIT INT TERM

echo "启动 UXAI：macOS x64 节点，端口 8787"
(
    cd "$PROJECT_ROOT"
    PACKAGING_PROXY_ENV_FILE="$PROJECT_ROOT/.env.proxy" \
    BUILD_NODE_TARGET=mac-x64 BUILD_ALLOW_CROSS_TARGET=1 BUILD_SERVICE_PORT=8787 \
        bash packaging_shell/start_build_service.sh
) &
PIDS+=("$!")

echo "启动 UXAITEST1：macOS ARM64 节点，端口 8788"
(
    cd "$TEST1_ROOT"
    PACKAGING_PROXY_ENV_FILE="$PROJECT_ROOT/.env.proxy" \
    BUILD_NODE_TARGET=mac-arm64 BUILD_ALLOW_CROSS_TARGET=1 BUILD_SERVICE_PORT=8788 \
        bash packaging_shell/start_build_service.sh
) &
PIDS+=("$!")

echo "启动 UXAITEST2：Windows x64 节点，端口 8789"
(
    cd "$TEST2_ROOT"
    PACKAGING_PROXY_ENV_FILE="$PROJECT_ROOT/.env.proxy" \
    BUILD_NODE_TARGET=win-x64 BUILD_ALLOW_CROSS_TARGET=1 BUILD_SERVICE_PORT=8789 \
        bash packaging_shell/start_build_service.sh
) &
PIDS+=("$!")

echo "启动统一主控网页，端口 8790"
(
    cd "$PROJECT_ROOT"
    BUILD_SERVICE_PORT=8790 \
    BUILD_WORKERS="mac-x64=http://127.0.0.1:8787,mac-arm64=http://127.0.0.1:8788,win-x64=http://127.0.0.1:8789" \
        bash packaging_shell/start_build_service.sh
) &
PIDS+=("$!")

echo ""
echo "✅ 本地模拟集群已启动：http://127.0.0.1:8790"
echo "按 Ctrl+C 可一次停止全部服务。"

wait

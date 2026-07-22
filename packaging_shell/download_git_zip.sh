#!/bin/bash

BRANCH_NAME="${1:-dev}"
SAFE_BRANCH_NAME="${BRANCH_NAME//\//__}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${PACKAGING_DATA_DIR:-$SCRIPT_DIR}"
PROJECT_ROOT="${PACKAGING_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

URL="https://github.com/MyHeavenDyf/UXAI/archive/refs/heads/${BRANCH_NAME}.zip"
TARGET_DIR="${DATA_DIR}/zip"
OUTPUT="${TARGET_DIR}/UXAI-${SAFE_BRANCH_NAME}.zip"

# 1. 创建并清空相对路径保存目录
mkdir -p "$TARGET_DIR"
rm -rf "${TARGET_DIR:?}"/*

# 2. 读取并启用内网代理配置
ENV_FILE="${PACKAGING_PROXY_ENV_FILE:-$PROJECT_ROOT/.env.proxy}"

if [ ! -f "$ENV_FILE" ]; then
    echo "❌ 未找到 .env.proxy 配置文件！"
    exit 1
fi

set -a
. "$ENV_FILE"
set +a

if [ -z "$HW_USER" ] || [ -z "$HW_PASS" ]; then
    echo "❌ $ENV_FILE 中缺少 HW_USER 或 HW_PASS"
    exit 1
fi

PROXY_HOST="${HW_PROXY_HOST:-proxyhk.huawei.com:8080}"
NO_PROXY_VAL="localhost,127.0.0.1,.local,.huawei.com,.inhuawei.com"
HW_USER_ENCODED="$(bun -e 'process.stdout.write(encodeURIComponent(Bun.env.HW_USER || ""))')"
HW_PASS_ENCODED="$(bun -e 'process.stdout.write(encodeURIComponent(Bun.env.HW_PASS || ""))')"
PROXY_URL="http://${HW_USER_ENCODED}:${HW_PASS_ENCODED}@${PROXY_HOST}"

export http_proxy="$PROXY_URL"
export https_proxy="$PROXY_URL"
export HTTP_PROXY="$PROXY_URL"
export HTTPS_PROXY="$PROXY_URL"
export no_proxy="$NO_PROXY_VAL"
export NO_PROXY="$NO_PROXY_VAL"

echo "🌐 已加载代理配置文件 ($ENV_FILE)"
echo "🧹 已清空 $TARGET_DIR 目录中的旧文件"
echo "🚀 开始下载分支 [${BRANCH_NAME}]，保存目标: $OUTPUT ..."
echo "------------------------------------------------------"

# 3. 通过代理执行下载
curl -k --ssl-no-revoke --proxy-basic -L -o "$OUTPUT" "$URL" && \
    echo -e "\n✅ [${BRANCH_NAME}] 分支下载成功！已保存至: $OUTPUT" || \
    echo -e "\n❌ 下载失败，请检查分支名称 [${BRANCH_NAME}] 是否拼写正确。"

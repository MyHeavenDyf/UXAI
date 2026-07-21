#!/bin/bash

BRANCH_NAME="${1:-dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

URL="https://github.com/MyHeavenDyf/UXAI/archive/refs/heads/${BRANCH_NAME}.zip"
TARGET_DIR="${SCRIPT_DIR}/zip"
OUTPUT="${TARGET_DIR}/UXAI-${BRANCH_NAME}.zip"

# 1. 创建并清空相对路径保存目录
mkdir -p "$TARGET_DIR"
rm -rf "${TARGET_DIR:?}"/*

# 2. 强制直连，不继承当前终端中的代理配置
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY

echo "🌐 已启用直连模式（不使用代理）"
echo "🧹 已清空 $TARGET_DIR 目录中的旧文件"
echo "🚀 开始下载分支 [${BRANCH_NAME}]，保存目标: $OUTPUT ..."
echo "------------------------------------------------------"

# 3. 执行下载
curl -k --ssl-no-revoke --noproxy '*' -L -o "$OUTPUT" "$URL" && \
    echo -e "\n✅ [${BRANCH_NAME}] 分支下载成功！已保存至: $OUTPUT" || \
    echo -e "\n❌ 下载失败，请检查分支名称 [${BRANCH_NAME}] 是否拼写正确。"

#!/bin/bash

# Build and package desktop app tailored for current OS and Architecture

# 强制直连，不读取 .env.proxy，也不继承当前终端中的代理配置。
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY
unset npm_config_proxy npm_config_https_proxy NPM_CONFIG_PROXY NPM_CONFIG_HTTPS_PROXY
unset NODE_TLS_REJECT_UNAUTHORIZED
export no_proxy="*"
export NO_PROXY="*"

echo "🌐 已启用直连模式（不使用代理）"

# ========================================================
# 🧠 1. 宽容处理：缺参数就默认为 beta
# ========================================================
VERSION_CHANNEL="${1:-beta}"
BUILD_TARGET="${2:-}"

if [ "$VERSION_CHANNEL" != "beta" ] && [ "$VERSION_CHANNEL" != "prod" ]; then
    echo "❌ 构建环境仅支持 beta 或 prod，当前为: $VERSION_CHANNEL"
    exit 1
fi

echo "开始构建 [ ${VERSION_CHANNEL} ] 环境桌面应用..."

# 2. 动态执行对应环境的编译
VITE_CMD="build:${VERSION_CHANNEL}"

# 3. 判断当前构建机平台，并校验任务目标必须与构建机一致
OS_TYPE=$(uname -s 2>/dev/null || echo "Windows_NT")
ARCH_TYPE=$(uname -m 2>/dev/null || echo "x86_64")

if [[ "$OS_TYPE" == "Darwin" ]]; then
    if [[ "$ARCH_TYPE" == "arm64" ]]; then
        LOCAL_TARGET="mac-arm64"
    else
        LOCAL_TARGET="mac-x64"
    fi
else
    LOCAL_TARGET="win-x64"
fi

BUILD_TARGET="${BUILD_TARGET:-$LOCAL_TARGET}"
if [ "$BUILD_TARGET" != "$LOCAL_TARGET" ]; then
    if [ "$BUILD_ALLOW_CROSS_TARGET" != "1" ]; then
        echo "❌ 当前构建机是 $LOCAL_TARGET，不能执行 $BUILD_TARGET 任务。请把任务发送到对应构建机。"
        exit 1
    fi
    echo "⚠️ 已启用本机模拟：当前构建机 $LOCAL_TARGET 将尝试执行 $BUILD_TARGET 任务"
fi

case "$BUILD_TARGET" in
    mac-arm64) RELEASE_CMD="release:mac-arm64" ;;
    mac-x64) RELEASE_CMD="release:mac-x64" ;;
    win-x64) RELEASE_CMD="release:win" ;;
    *) echo "❌ 不支持的目标平台: $BUILD_TARGET"; exit 1 ;;
esac

echo "🎯 构建机探测完成 -> 系统: $OS_TYPE, 架构: $ARCH_TYPE，目标平台: $BUILD_TARGET"

# 校验通过后再删除旧产物，避免发错构建机的任务影响现有安装包。
if [ -d "packages/desktop/dist" ]; then
    echo "删除旧的 dist 目录..."
    rm -rf "packages/desktop/dist"
fi

# ========================================================
# 🚀 4. 编译与打包执行阶段
# ========================================================

if [[ "$OS_TYPE" == "Darwin" ]]; then
    echo "🍏 [Mac 模式] 正在切换到 packages/desktop 目录执行命令..."
    (
        cd packages/desktop || { echo "❌ 错误：无法进入目录 packages/desktop"; exit 1; }
        
        echo "执行前端编译: bun run $VITE_CMD ..."
        bun run "$VITE_CMD"
        if [ $? -ne 0 ]; then
            echo "❌ 错误：Mac 前端编译 $VITE_CMD 失败！"
            exit 1
        fi

        echo "执行正式打包: bun run $RELEASE_CMD --channel $VERSION_CHANNEL ..."
        bun run $RELEASE_CMD --channel $VERSION_CHANNEL
        if [ $? -ne 0 ]; then
            echo "❌ 错误：Mac 打包 $RELEASE_CMD 失败！"
            exit 1
        fi
    )
    if [ $? -ne 0 ]; then
        exit 1
    fi
else
    # 🪟 Windows / Linux 逻辑
    echo "执行前端编译: bun run $VITE_CMD ..."
    bun run --cwd packages/desktop "$VITE_CMD"
    if [ $? -ne 0 ]; then
        echo "❌ 错误：前端编译 $VITE_CMD 失败！"
        exit 1
    fi

    echo "执行正式打包: bun run $RELEASE_CMD --channel $VERSION_CHANNEL ..."
    bun run --cwd packages/desktop $RELEASE_CMD -- --channel $VERSION_CHANNEL
    if [ $? -ne 0 ]; then
        echo "❌ 错误：打包 $RELEASE_CMD 失败！"
        exit 1
    fi
fi

echo "✨ [ $VERSION_CHANNEL ] 桌面应用在当前平台 ($RELEASE_CMD) 构建和打包完成！"

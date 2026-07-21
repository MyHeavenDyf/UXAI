#!/bin/bash

# 总脚本 - 按相对路径顺序执行 packaging_shell 目录下的所有脚本

# 1. 自动切换当前终端工作目录至项目根目录（确保后续相对路径 100% 生效）
SCRIPT_SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${PACKAGING_PROJECT_ROOT:-}"
if [ -z "$PROJECT_ROOT" ]; then
    if [ "$(basename "$SCRIPT_SELF_DIR")" = "packaging_shell" ]; then
        PROJECT_ROOT="$SCRIPT_SELF_DIR/.."
    else
        PROJECT_ROOT="$SCRIPT_SELF_DIR"
    fi
fi
cd "$PROJECT_ROOT" || exit 1

# 2. 统一使用相对路径目录
SCRIPT_DIR="${PACKAGING_SCRIPT_DIR:-packaging_shell}"

echo "开始执行 packaging_shell 脚本..."
echo "📂 工作目录已锁定至项目根目录: $(pwd)"
echo "📂 子脚本相对路径: $SCRIPT_DIR"

# 3. 设置默认兜底值
GIT_BRANCH="dev"
VERSION_NUMBER="0.1.0"
VERSION_CHANNEL="beta"
BUILD_TARGET=""

# 4. 💡 智能 & Flag 双模参数解析引擎
while [[ $# -gt 0 ]]; do
    case "$1" in
        -b|--branch)
            GIT_BRANCH="$2"
            shift 2
            ;;
        -v|--version)
            VERSION_NUMBER="$2"
            shift 2
            ;;
        -c|--channel)
            VERSION_CHANNEL="$2"
            shift 2
            ;;
        -t|--target)
            BUILD_TARGET="$2"
            shift 2
            ;;
        *)
            if [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
                VERSION_NUMBER="$1"
            elif [[ "$1" == "beta" || "$1" == "prod" ]]; then
                VERSION_CHANNEL="$1"
            else
                GIT_BRANCH="$1"
            fi
            shift
            ;;
    esac
done

if [ "$VERSION_CHANNEL" != "beta" ] && [ "$VERSION_CHANNEL" != "prod" ]; then
    echo "❌ 构建环境仅支持 beta 或 prod，当前为: $VERSION_CHANNEL"
    exit 1
fi

if [ -n "$BUILD_TARGET" ] && [ "$BUILD_TARGET" != "mac-arm64" ] && [ "$BUILD_TARGET" != "mac-x64" ] && [ "$BUILD_TARGET" != "win-x64" ]; then
    echo "❌ 目标平台仅支持 mac-arm64、mac-x64 或 win-x64，当前为: $BUILD_TARGET"
    exit 1
fi

echo "=========================================="
echo "💡 自动化全局参数解析成功："
echo "-> 1. Git 下载分支 (BRANCH)  : $GIT_BRANCH"
echo "-> 2. 应用版本号   (VERSION) : $VERSION_NUMBER"
echo "-> 3. 打包构建环境 (CHANNEL) : $VERSION_CHANNEL"
echo "-> 4. 目标平台     (TARGET)  : ${BUILD_TARGET:-自动识别}"
echo "=========================================="

# 5. 使用相对路径依次执行实际存在的子脚本
for script_name in "download_git_zip.sh" "extract.sh" "copy_packages.sh" "version.sh" "build_desktop.sh"; do
    script="$SCRIPT_DIR/$script_name"

    if [ ! -f "$script" ]; then
        echo "❌ 严重错误：必需脚本 [$script] 不存在，流程终止。"
        exit 1
    fi

    echo "⚡ 正在执行：$script"

    # 分流传参
    if [ "$script_name" = "download_git_zip.sh" ]; then
        echo "   [参数] 喂给 download_git_zip.sh 的 Git 分支: $GIT_BRANCH"
        bash "$script" "$GIT_BRANCH"

    elif [ "$script_name" = "version.sh" ]; then
        echo "   [参数] 喂给 version.sh 的版本号: $VERSION_NUMBER"
        bash "$script" "$VERSION_NUMBER"

    elif [ "$script_name" = "build_desktop.sh" ]; then
        echo "   [参数] 喂给 build_desktop.sh 的构建环境: $VERSION_CHANNEL，目标平台: ${BUILD_TARGET:-自动识别}"
        bash "$script" "$VERSION_CHANNEL" "$BUILD_TARGET"

    else
        bash "$script"
    fi

    RC=$?
    if [ $RC -ne 0 ]; then
        echo "❌ 严重错误：$script 执行失败，退出码为 $RC！整个流程被迫熔断中断。"
        exit 1
    fi
    echo "✅ $script 执行成功！"
    echo "------------------------------------------"
done

echo "🎉 所有脚本全流程执行完成！"

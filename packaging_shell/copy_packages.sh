#!/bin/bash

# copy_packages.sh - 纯粹的跨平台自适应同步脚本
# 覆盖策略：完美模拟 Mac 'Command + 拖拽合并'，冲突时替换，本地独有时保留

OS_TYPE=$(uname -s 2>/dev/null || echo "Windows_NT")

if [[ "$OS_TYPE" == "Darwin" ]]; then
    # ========================================================
    # 🍏 macOS 专属拖拽合并逻辑
    # ========================================================
    SOURCE_DIR="packaging_shell/packages"
    DEST_DIR="packages" 
    DIRTY_SUFFIX="packages-j60099994-jk"

    # 1. 检查源目录是否存在
    if [ ! -d "$SOURCE_DIR" ]; then
        echo "❌ 错误：源目录不存在：$SOURCE_DIR"
        echo "请先运行解压脚本，确保 $SOURCE_DIR 已经生成。"
        exit 1
    fi

    # 🧹 2. 清理那个特定的历史带后缀旧垃圾（不影响核心 packages）
    if [ -d "$DIRTY_SUFFIX" ]; then
        echo "🗑️  强制删除根目录残留旧文件夹：$DIRTY_SUFFIX"
        rm -rf "$DIRTY_SUFFIX"
    fi

    # 📂 确保目标 packages 目录存在
    mkdir -p "$DEST_DIR"

    echo "🚀 3. [Mac] 正在将最新内容增量合并到本地 packages (模拟 Command+拖拽合并)..."

    # 🧠 rsync 核心参数设计：
    # -a: 归档模式（保持权限、时间戳、递归）
    # -v: 打印同步细节
    # (注意：这里绝对不加 --delete，所以本地独有的文件会安全保留，只覆盖同名不同内容的文件)
    rsync -av "$SOURCE_DIR/" "$DEST_DIR/"

    RSYNC_STATUS=$?
    if [ $RSYNC_STATUS -ne 0 ]; then
        echo "❌ 错误：Mac 侧合并同步失败"
        exit 1
    fi

    echo "✅ [Mac] packages 目录合并覆盖完成！本地独有文件已安全保留。"

else
    # ========================================================
    # 🪟 Windows / Linux 专属拖拽合并逻辑
    # ========================================================
    SOURCE_DIR="packaging_shell/packages"
    DEST_DIR="packages"

    echo "🚀 [Win] 正在将最新内容增量合并到本地 packages..."

    # 📂 确保目标 packages 目录存在
    mkdir -p "$DEST_DIR"

    # 🧠 cp 核心参数设计：
    # -r: 递归复制
    # -f: 强行覆盖同名文件（如果遇到只读文件也会尝试覆盖）
    # 使用 /. 完美将源目录下的所有隐藏文件和普通文件直接“砸”进目标目录，实现同名覆盖、异名并存
    cp -rf "$SOURCE_DIR/." "$DEST_DIR/"

    echo "复制完成！"
fi

#!/bin/bash

# 1. 自动寻找 packaging_shell/zip/ 下的任意 zip 文件
ZIP_FILE=$(ls packaging_shell/zip/*.zip 2>/dev/null | head -n 1)

if [ -z "$ZIP_FILE" ]; then
    echo "❌ 错误: 在 packaging_shell/zip/ 目录下没有找到任何 .zip 文件！"
    exit 1
fi

echo "📦 发现压缩包: $ZIP_FILE"

# 如果 packaging_shell/packages 存在，先删除
if [ -d "packaging_shell/packages" ]; then
    echo "清理旧的 packages 文件夹..."
    rm -rf packaging_shell/packages
fi

# 创建临时目录
TEMP_DIR=$(mktemp -d)

# 2. 完整解压到临时目录
echo "正在解压..."
unzip -q "$ZIP_FILE" -d "$TEMP_DIR"

# 3. 🧠 动态获取解压出来的根目录名称（不管它叫 UXAI-dev 还是别的东西）
# ls "$TEMP_DIR" | head -n 1 会拿到解压出来的第一层文件夹名
EXTRACTED_ROOT=$(ls "$TEMP_DIR" | head -n 1)

if [ -z "$EXTRACTED_ROOT" ] || [ ! -d "$TEMP_DIR/$EXTRACTED_ROOT/packages" ]; then
    echo "❌ 错误: 解压产物中未找到 packages 文件夹，请检查压缩包结构！"
    rm -rf "$TEMP_DIR"
    exit 1
fi

# 4. 复制 packages 文件夹到 packaging_shell
echo "正在同步 packages 资源..."
mkdir -p packaging_shell/packages
cp -r "$TEMP_DIR/$EXTRACTED_ROOT/packages/"* packaging_shell/packages/

# 清理临时目录
rm -rf "$TEMP_DIR"

echo "✨ 解压并同步完成！"
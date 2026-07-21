
#!/bin/bash

# version.sh - 更新 desktop package.json 的版本号
# 增强：
# 1. 如果未传参数，保持原版本号不变，优雅退出
# 2. 传入参数时，进行严格的 SemVer 规范校验


DESKTOP_PACKAGE_JSON="packages/desktop/package.json"

if [ ! -f "$DESKTOP_PACKAGE_JSON" ]; then
    echo "❌ 错误：文件不存在：$DESKTOP_PACKAGE_JSON"
    exit 1
fi

# 🧠 1. 获取本地现有的版本号作为兜底
CURRENT_LOCAL_VERSION=$(grep '"version":' "$DESKTOP_PACKAGE_JSON" | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/')

VERSION="$1"

# 🧠 2.【核心改动】如果 version 参数为空，直接读取原版本号，保持不变，优雅跳过
if [ -z "$VERSION" ]; then
    echo "ℹ️  未检测到传入的 version 参数，保持原版本号 [ $CURRENT_LOCAL_VERSION ] 不变。"
    echo "✅ version.sh 执行完成（跳过修改）。"
    exit 0
fi

# 🧠 3. 核心防呆拦截：如果传了参数，就必须进行严格的语义化格式校验
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
    echo "❌ 严重错误：非法的版本号格式 -> \"$VERSION\""
    echo "💡 提示：electron-builder 要求 version 必须符合 SemVer 规范（例如：43.2.1 或 1.0.0）。"
    echo "⚠️  请检查是否误将构建环境（beta/prod）当做版本号传进来了！"
    exit 1
fi

echo "设置 version = $VERSION"

# 4. 用 Bun 原生修改 packages/desktop/package.json 的 version
bun -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('$DESKTOP_PACKAGE_JSON', 'utf8'));
  pkg.version = '$VERSION';
  fs.writeFileSync('$DESKTOP_PACKAGE_JSON', JSON.stringify(pkg, null, 2) + '\n');
"

echo "已将 $DESKTOP_PACKAGE_JSON 的 version 更新为 $VERSION"

# 5. 最终验证修改
NEW_VERSION=$(grep '"version":' "$DESKTOP_PACKAGE_JSON" | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/')
echo "当前 version 值：$NEW_VERSION"

if [ "$NEW_VERSION" = "$VERSION" ]; then
    echo "✅ version.sh 修改执行成功！"
else
    echo "❌ 错误：version 更新失败！"
    exit 1
fi


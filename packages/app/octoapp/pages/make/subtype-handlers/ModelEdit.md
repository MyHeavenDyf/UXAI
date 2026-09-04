## 配置示例

### 示例：默认配置

```ts
const modelEditConfig: ModelEditConfig = {
  saveCallback: ({ type, prev, current, dom, filePath }) => {
    const lines: string[] = []
    lines.push(`[文件路径: ${filePath}]`)
    lines.push('')
    lines.push('请修改以下元素:')
    lines.push(`标签: <${dom.tagName}>`)
    lines.push(`选择器: ${dom.selector}`)
    lines.push('')
    for (const key of Object.keys(current)) {
      const before = prev[key] ?? ''
      const after = current[key] ?? ''
      if (before !== after) {
        lines.push(`  ${key}: ${before || '(empty)'} → ${after || '(empty)'}`)
      }
    }
    return lines.join('\n')
  },
  deleteCallback: ({ type, dom, filePath }) => {
    return `请删除元素 <${dom.tagName}>（选择器: ${dom.selector}）\n文件: ${filePath}`
  },
}
```

---

## 特性开关

在 `subtype-config.ts` 中配置：

```ts
// _default 分支（启用）
_default: {
  features: {
    modelEdit: { enabled: true, editOnly: true },  // 仅预览模式可用
    // ...
  }
}

// 其他分支（禁用）
shadcn: { features: { modelEdit: false, ... } }
url: { features: { modelEdit: false, ... } }
prototype: { features: { modelEdit: false, ... } }
```
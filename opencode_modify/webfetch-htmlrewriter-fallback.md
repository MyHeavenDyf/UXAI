---
name: webfetch HTMLRewriter 降级修复
description: Node 运行时缺少 Bun 独有 HTMLRewriter 全局，format=text 时崩溃，添加回退逻辑
type: fix
---

# webfetch HTMLRewriter 降级修复

## 问题
`packages/opencode/src/tool/webfetch.ts` 的 `extractTextFromHTML` 函数使用 `HTMLRewriter`（Bun 独有全局 API）。
桌面端 sidecar 运行在 Electron utilityProcess（Node 运行时），Node 没有 `HTMLRewriter` 全局，
导致当模型调用 webfetch 时传 `format: "text"` 且目标返回 HTML 时抛出 `HTMLRewriter is not defined`。

## 修复
在 `extractTextFromHTML` 顶部检测 `typeof HTMLRewriter === "undefined"`，
不可用时回退到已有的 `convertHTMLToMarkdown`（TurndownService，纯 JS 库），
再剥离 markdown 格式标记（# */_~`[]等）得到纯文本。

## 改动文件
- `packages/opencode/src/tool/webfetch.ts:157-168`
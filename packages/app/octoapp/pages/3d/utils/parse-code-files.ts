/**
 * parseCodeFiles — 解析 codegen agent 的 Markdown 输出为 { path, content }[]。
 *
 * codegen agent 输出形如：
 *   ## file: src/3d/managers/component/handlers/heatmap/heatmap.ts
 *   ```ts
 *   <代码>
 *   ```
 *   ## file: public/live-data.json
 *   ```json
 *   { ... }
 *   ```
 *
 * host 把 codeFiles 经 onCodeVersionReady 写进 workspace（overlay 整文件覆盖，每轮须自包含），
 * 并从 public/live-data.json 提取分组 TreeScene 作 SCENE_UPDATE payload（iframe 不 fetch，只认 postMessage）。
 *
 * 鲁棒：缺 `## file:` 头 / fence 不配对 → 该块跳过，不抛（空数组时调用方 toast 提示，不崩）。
 */

import { extractJsonFromTruncated } from "./json-parser"

export type CodeFile = { path: string; content: string }

/** `## file: <path>` 行头（multiline，迭代取所有 header 的位置） */
const FILE_HEADER_RE = /^##\s+file:\s*(.+?)\s*$/gm
/** 首个 fenced 代码块（非 global，每段取第一个 fence 作 content） */
const FENCE_RE = /```[a-zA-Z0-9]*\s*\n([\s\S]*?)\n```/

/**
 * 清理 LLM 误加的 CJS shim 行（浏览器 vite 不兼容，会触发 "node:module externalized" 报错）。
 * LLM 偶尔在 index.ts/handler 加 `import __cjs_mod__ from 'node:module'` + `createRequire(...)` +
 * `import.meta.filename/dirname` + `// CommonJS Shims` 注释——这些是死代码（handler 根本不用
 * require/__filename），host 防御性删除，保证 overlay 进 workspace 的代码干净。
 */
function stripCjsShim(content: string): string {
  return content
    .split("\n")
    .filter((line) => {
      const t = line.trim()
      if (!t) return true // 保留空行
      if (/from\s+['"]node:module['"]/.test(t)) return false
      if (/createRequire\s*\(/.test(t)) return false
      if (/import\.meta\.(filename|dirname)/.test(t)) return false
      if (/^\/\/.*CommonJS\s+Shim/i.test(t)) return false
      return true
    })
    .join("\n")
}

/**
 * 解析 Markdown 代码块文本为文件列表。
 * 每个 `## file: <path>` 之后到下一个 header 之间，取首个 fenced 代码块作 content。
 * header 与 fence 之间允许空行；缺 fence 的 header 跳过。
 */
export function parseCodeFiles(text: string): CodeFile[] {
  const headers: { path: string; idx: number }[] = []
  let m: RegExpExecArray | null
  while ((m = FILE_HEADER_RE.exec(text)) !== null) {
    headers.push({ path: m[1].trim(), idx: FILE_HEADER_RE.lastIndex })
  }
  const files: CodeFile[] = []
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].idx
    const end = i + 1 < headers.length ? headers[i + 1].idx : text.length
    const fence = text.slice(start, end).match(FENCE_RE)
    if (fence && fence[1] !== undefined) {
      const raw = fence[1]
      // .ts 文件清理 LLM 误加的 CJS shim 行（浏览器 vite 不兼容，host 防御）
      const content = headers[i].path.endsWith(".ts") ? stripCjsShim(raw) : raw
      files.push({ path: headers[i].path, content })
    }
  }
  return files
}

/**
 * 从 codeFiles 提取 public/live-data.json 的分组 TreeScene（sceneData）。
 * host 把它塞进 pendingPreviewData 经 SCENE_UPDATE 推给 iframe。
 * 解析失败/缺失返回 null（调用方兜底 toast，预览可能空）。
 */
export function extractSceneData(files: CodeFile[]): Record<string, unknown> | null {
  const f = files.find((x) => x.path === "public/live-data.json" || x.path.endsWith("/live-data.json"))
  if (!f) return null
  try {
    return JSON.parse(f.content) as Record<string, unknown>
  } catch {
    // 截断抢救：复杂场景（如上海城市）LLM 输出撑满 max_tokens，live-data.json 截在中间。
    // extractJsonFromTruncated 逐字符扫描安全截断点 + 补齐未闭合括号，恢复可解析的部分。
    // 可能丢末尾几个 scene_objects（部分物体缺），但远好于整个场景失败。
    const recovered = extractJsonFromTruncated(f.content)
    if (recovered) {
      console.warn("[extractSceneData] live-data.json JSON.parse 失败，截断抢救成功（可能丢末尾部分物体）")
    }
    return recovered
  }
}

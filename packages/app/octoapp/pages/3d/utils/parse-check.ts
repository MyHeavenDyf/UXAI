/**
 * parse-check —— 物化前静态语法检查（零模型依赖，~115ms/7文件）
 *
 * codegen LLM 频出 TS 语法错（括号不配对、`wheel.rotation. = Math.PI/2` PARSE_ERROR），
 * 这类错到 vite transform 阶段才爆 → materialize→startDev→iframe 加载→门控兜底慢一圈。
 * 本模块在物化**之前**用 `ts.transpileModule` 抓语法 parse 错，立即拦截不进慢链，
 * 并把 `file:line:col:reason` 喂回 LLM 自愈。
 *
 * **只抓语法 parse 错（code 1xxx）**。语义错（continue outside loop code 1107）transpileModule
 * 不报（语法合法）→ 走 9a 门控 checkRuntime 兜底（物化后读 console buffer → 自愈）。
 * 曾尝试升级 createProgram 抓语义错，但 noLib 无标准库致 2xxx 假阳性（2339 .includes /
 * 2488 iterator）误报合法代码 → 回退 transpileModule。门控兜底够用（P0.10 后 settleMs 3s）。
 */
import ts from "typescript"
import type { CodeFile } from "./parse-code-files"

export interface SyntaxError {
  /** handler 文件路径（相对 codeDir，如 `vehicles/vehicles.ts`） */
  file: string
  /** 1-indexed 行号 */
  line: number
  /** 1-indexed 列号 */
  column: number
  /** TS diagnostic code（如 1003 Identifier expected） */
  code: number
  /** 人类可读原因 */
  message: string
}

/**
 * 对每个 .ts 文件跑 ts.transpileModule 抓 Error 级 diagnostic。
 * 返回所有语法错（空数组=全过）。非 .ts 文件（live-data.json 等）跳过。
 */
export function checkHandlerSyntax(files: CodeFile[]): SyntaxError[] {
  const errors: SyntaxError[] = []
  for (const f of files) {
    const path = f.path.replace(/\\/g, "/")
    if (!path.endsWith(".ts")) continue
    const result = ts.transpileModule(f.content, {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        isolatedModules: true,
      },
      fileName: path.split("/").pop() ?? path,
      reportDiagnostics: true,
    })
    if (!result.diagnostics) continue
    for (const d of result.diagnostics) {
      if (d.category !== ts.DiagnosticCategory.Error) continue
      const file = d.file
      const pos = file && typeof d.start === "number"
        ? file.getLineAndCharacterOfPosition(d.start)
        : { line: 0, character: 0 }
      errors.push({
        file: path.split("/").pop() ?? path,
        line: pos.line + 1,
        column: pos.character + 1,
        code: d.code,
        message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      })
    }
  }
  return errors
}

/**
 * 把语法错清单格式化成喂回 codegen 的 `## 上一轮代码错误清单` 段。
 * 每条 `file:line:col: reason (code N)`，让 LLM 照着定位修。
 */
export function formatSyntaxErrorsForCodegen(errors: SyntaxError[]): string {
  if (errors.length === 0) return ""
  const lines: string[] = [
    "## 上一轮代码错误清单",
    "上一轮生成的 handler .ts 存在语法错误（TS 编译器报错），请按下列 file:line:col 精确修复：",
    "",
  ]
  for (const e of errors) {
    lines.push(`- ${e.file}:${e.line}:${e.column}: ${e.message} (code ${e.code})`)
  }
  lines.push(
    "",
    "要求：逐一修复上述语法错误，确保每个 .ts 文件语法合法（能通过 TS 编译器转译）；本轮需重新输出的文件范围以「## 本轮输出范围」为准，无该节则重新输出全部文件。",
  )
  return lines.join("\n")
}

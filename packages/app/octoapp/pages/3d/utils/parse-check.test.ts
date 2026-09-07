import { describe, expect, test } from "bun:test"
import { checkHandlerSyntax, formatSyntaxErrorsForCodegen, type SyntaxError } from "./parse-check"
import type { CodeFile } from "./parse-code-files"

// ── checkHandlerSyntax：物化前 ts.transpileModule 抓语法 parse 错（code 1xxx）──
// 语义错（continue outside loop 1107）transpileModule 不报（语法合法）→ 走 9a 门控兜底。
describe("checkHandlerSyntax", () => {
  test("干净文件 → 空数组", () => {
    const files: CodeFile[] = [
      { path: "handlers/room/room.ts", content: "const x = 1\nexport default x" },
    ]
    expect(checkHandlerSyntax(files)).toEqual([])
  })

  test("括号不配对 → 检出（code 1xxx 语法错）", () => {
    const files: CodeFile[] = [
      { path: "handlers/room/room.ts", content: "const x = {" },
    ]
    const errs = checkHandlerSyntax(files)
    expect(errs.length).toBeGreaterThanOrEqual(1)
    // 错误码为 1xxx 语法 parse 错（具体码 1005'}' expected 等，不硬编码）
    expect(errs[0].code).toBeGreaterThanOrEqual(1000)
    expect(errs[0].code).toBeLessThan(2000)
    expect(errs[0].file).toBe("room.ts")
    expect(errs[0].line).toBeGreaterThanOrEqual(1)
    expect(errs[0].message).toBeTruthy()
  })

  test("`x. = ` 这类 PARSE_ERROR → 检出", () => {
    // codegen LLM 实际频出的 `wheel.rotation. = Math.PI/2`
    const files: CodeFile[] = [
      { path: "handlers/vehicles/vehicles.ts", content: "wheel.rotation. = Math.PI/2" },
    ]
    const errs = checkHandlerSyntax(files)
    expect(errs.length).toBeGreaterThanOrEqual(1)
    expect(errs[0].file).toBe("vehicles.ts")
  })

  test("多文件聚合", () => {
    const files: CodeFile[] = [
      { path: "handlers/room/room.ts", content: "const a = 1" },
      { path: "handlers/walls/walls.ts", content: "const b = {" },
      { path: "handlers/floor/floor.ts", content: "const c = 2" },
    ]
    const errs = checkHandlerSyntax(files)
    expect(errs).toHaveLength(1)
    expect(errs[0].file).toBe("walls.ts")
  })

  test("非 .ts 文件（live-data.json）跳过", () => {
    const files: CodeFile[] = [
      { path: "public/live-data.json", content: "{ invalid json" },
    ]
    expect(checkHandlerSyntax(files)).toEqual([])
  })

  test("Windows 反斜杠路径规范化为正斜杠后取 basename", () => {
    const files: CodeFile[] = [
      { path: "handlers\\room\\room.ts", content: "const x = {" },
    ]
    const errs = checkHandlerSyntax(files)
    expect(errs.length).toBeGreaterThanOrEqual(1)
    expect(errs[0].file).toBe("room.ts")
  })

  test("空文件列表 → 空数组", () => {
    expect(checkHandlerSyntax([])).toEqual([])
  })

  test("语义合法但 transpileModule 不报的代码 → 空数组（不假阳性）", () => {
    // continue outside loop（1107）是语义错，transpileModule 不抓
    const files: CodeFile[] = [
      { path: "handlers/x/x.ts", content: "if (true) { continue }" },
    ]
    expect(checkHandlerSyntax(files)).toEqual([])
  })
})

// ── formatSyntaxErrorsForCodegen：错误清单格式化喂回 LLM ──────────────
describe("formatSyntaxErrorsForCodegen", () => {
  test("空 → 空串", () => {
    expect(formatSyntaxErrorsForCodegen([])).toBe("")
  })

  test("非空 → `file:line:col: reason (code N)` 格式", () => {
    const errs: SyntaxError[] = [
      { file: "room.ts", line: 3, column: 5, code: 1003, message: "Identifier expected" },
    ]
    const out = formatSyntaxErrorsForCodegen(errs)
    expect(out).toContain("- room.ts:3:5: Identifier expected (code 1003)")
    expect(out).toContain("## 上一轮代码错误清单")
  })

  test("多条错误各占一行", () => {
    const errs: SyntaxError[] = [
      { file: "room.ts", line: 3, column: 5, code: 1003, message: "A" },
      { file: "walls.ts", line: 7, column: 1, code: 1005, message: "B" },
    ]
    const out = formatSyntaxErrorsForCodegen(errs)
    expect(out).toContain("- room.ts:3:5: A (code 1003)")
    expect(out).toContain("- walls.ts:7:1: B (code 1005)")
  })

  test("含修复指引段", () => {
    const out = formatSyntaxErrorsForCodegen([
      { file: "x.ts", line: 1, column: 1, code: 1, message: "x" },
    ])
    expect(out).toContain("逐一修复")
    expect(out).toContain("本轮输出范围")
  })
})

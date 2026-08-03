import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, dirname } from "node:path"

// SPEC-INS-026 §11.1 V8:table 类型退役后不留残留。
// 用例本身就是 spec 里那条 grep —— 写成测试是为了让它在 CI/本地每次都跑，
// 而不是靠人记得去 grep 一次。

const INSIGHT_DIR = dirname(import.meta.dir) // utils/ 的上一层 = pages/insight

/**
 * 剥掉注释后再匹配。注释里保留「table 为什么退役」的历史说明是有价值的
 * （下一个读到 csv 的人需要知道那条链路是死的），要拦的是**活代码**里的残留。
 */
function stripComments(line: string): string {
  const t = line.trim()
  if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return ""
  return line.split("//")[0]
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out)
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

describe("table 类型退役无残留(V8)", () => {
  test("已删除的模块不再存在", () => {
    const files = sourceFiles(INSIGHT_DIR)
    const gone = files.filter((f) => /table-renderer\.tsx$|markdown-table\.ts$/.test(f))
    expect(gone).toEqual([])
  })

  test("源码里没有 table 作为产物类型的字面量", () => {
    // 只匹配「类型位置的 "table"」：type: "table" / === "table" / 联合成员。
    // HTML 的 <table> 标签、table-layout / border-collapse 等 CSS 属于排版，不在此列。
    const offenders: string[] = []
    for (const file of sourceFiles(INSIGHT_DIR)) {
      // 本测试文件自身要写这些字面量，跳过
      if (file.endsWith("table-retired.test.ts")) continue
      const text = readFileSync(file, "utf-8")
      text.split("\n").forEach((raw, i) => {
        const line = stripComments(raw)
        if (/(?:type\s*[:=]\s*|===\s*|!==\s*|\|\s*)["']table["']/.test(line)) {
          offenders.push(`${file.replace(INSIGHT_DIR, "")}:${i + 1}: ${line.trim()}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  test("退役的工具函数不再被引用", () => {
    const offenders: string[] = []
    for (const file of sourceFiles(INSIGHT_DIR)) {
      if (file.endsWith("table-retired.test.ts")) continue
      const text = readFileSync(file, "utf-8")
      text.split("\n").forEach((raw, i) => {
        const line = stripComments(raw)
        if (/\b(TableRenderer|extractTableMarkdown|parseMarkdownTable|tableToCSV|tableToXlsx)\b/.test(line)) {
          offenders.push(`${file.replace(INSIGHT_DIR, "")}:${i + 1}: ${line.trim()}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})

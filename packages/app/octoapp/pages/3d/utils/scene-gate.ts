/**
 * scene-gate —— 9a 运行时门控（零模型依赖）
 *
 * codegen→物化→预览之后跑一类确定性检查：
 *   运行时：等 iframe 渲染 settle（固定延迟）后读 console buffer（SCENE_ERROR /
 *   SCENE_CONSOLE_ERROR）——「为什么渲染不出来 / 哪步崩了」
 * 失败汇总 GateResult.findings，由 host 写进 sessionErrors + saveProtoError → GenerationCard
 * 持久显示（**不走消失 toast**），并把 findings 喂回下一轮 codegen（priorGateFindings →
 * `## 上一轮门控失败清单`，让 codegen 照着修）。
 *
 * P0.10（2026-09-03）：删 awaitSceneSettled（SCENE_READY 握手 15s 超时）——握手与 resolver
 *   时序竞态致误报「场景未就绪」。改固定延迟 settleMs 等 console buffer 收集，失败靠
 *   SCENE_ERROR/SCENE_CONSOLE_ERROR 确定性事件判断。
 *
 * P0.4 回退（2026-09-03）：删 checkCompleteness——plan.types vs live-data 分组是冗余检查
 *   （warn 不挡、plan 与 live-data 同一 LLM 产少漏）。门控只留 checkRuntime（唯一能抓
 *   运行时错的层——语法检查 transpileModule 抓不到语义错如 continue outside loop，
 *   只有跑到 iframe 才暴露）。simple & accurate.
 */
import type { PlanResult } from "../agents/scene-plan"

/** 单条门控发现 */
export interface GateFinding {
  check: "runtime"
  level: "error" | "warn"
  code: string
  message: string
}

/** 运行时 console 条目（iframe 经 SCENE_CONSOLE_ERROR / SCENE_ERROR 转发） */
export interface ConsoleEntry {
  level: "error" | "warn"
  message: string
  stack?: string
  /** SCENE_ERROR（场景构建 fatal）标记 */
  fatal?: boolean
}

export interface GateResult {
  passed: boolean
  findings: GateFinding[]
}

export interface RunSceneGateInput {
  plan: PlanResult
  sceneData: Record<string, unknown> | null
  /** 等 iframe 渲染 + console buffer 收集的固定延迟（ms，默认 3000）。不靠 SCENE_READY 握手。 */
  settleMs?: number
  /** 读 gate 期间收集的 console buffer（host 侧 signal 快照） */
  readConsoleBuffer: () => ConsoleEntry[]
}

/** 运行时核对：console buffer → findings */
function checkRuntime(entries: ConsoleEntry[]): GateFinding[] {
  const findings: GateFinding[] = []
  for (const e of entries) {
    if (e.fatal) {
      findings.push({
        check: "runtime",
        level: "error",
        code: "scene-build-error",
        message: e.message,
      })
    } else if (e.level === "error") {
      findings.push({
        check: "runtime",
        level: "error",
        code: "runtime-error",
        message: e.message,
      })
    } else if (e.level === "warn") {
      findings.push({
        check: "runtime",
        level: "warn",
        code: "runtime-warn",
        message: e.message,
      })
    }
  }
  return findings
}

/**
 * 跑运行时检查。等 iframe 渲染 settle（固定延迟）+ 读 console buffer。
 *
 * 运行时错（SCENE_ERROR/SCENE_CONSOLE_ERROR）是确定性事件——有就是渲染崩了/哪步错了，
 * 喂回 codegen 自愈；没有就通过。
 */
export async function runSceneGate(input: RunSceneGateInput): Promise<GateResult> {
  const findings: GateFinding[] = []
  await new Promise((r) => setTimeout(r, input.settleMs ?? 3000))
  findings.push(...checkRuntime(input.readConsoleBuffer()))
  return { passed: !findings.some((f) => f.level === "error"), findings }
}

/** 把 findings 格式化成喂回 codegen 的 `## 上一轮门控失败清单` 段（仅 error 级 + warn 概要） */
export function formatGateFindingsForCodegen(findings: GateFinding[]): string {
  const errs = findings.filter((f) => f.level === "error")
  const warns = findings.filter((f) => f.level === "warn")
  if (errs.length === 0 && warns.length === 0) return ""
  const lines: string[] = ["## 上一轮门控失败清单", "上一轮生成的代码未通过运行时门控，请按下列问题修复：", ""]
  for (const f of errs) {
    lines.push(`- [${f.check}/${f.code}] ${f.message}`)
  }
  if (warns.length > 0) {
    lines.push("", "警告（建议修）：")
    for (const f of warns) {
      lines.push(`- [${f.check}/${f.code}] ${f.message}`)
    }
  }
  lines.push("", "要求：修完后确保 iframe 运行时无 console error。")
  return lines.join("\n")
}

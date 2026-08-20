/**
 * scene-gate —— 9a 确定性结构健全性门控（零模型依赖）
 *
 * codegen→物化→预览之后跑两类确定性检查（聚焦「渲染出来没有」）：
 *   1. 完整性：plan.types vs sceneData 的分组 key / 数量（纯函数，立即）——「少了哪类物体」
 *   2. 运行时：等 iframe SCENE_READY settle 后读 console buffer（SCENE_ERROR /
 *      SCENE_CONSOLE_ERROR）——「为什么渲染不出来 / 哪步崩了」
 * 失败汇总 GateResult.findings，由 host 写进 sessionErrors + saveProtoError → GenerationCard
 * 持久显示（**不走消失 toast**），并把 findings 喂回下一轮 codegen（priorGateFindings →
 * `## 上一轮门控失败清单`，让 codegen 照着修）。
 *
 * 不做：tsc 编译检查（类型不干净≠渲染阻断，LLM 高频踩 noUnusedLocals/noImplicitAny，
 *   噪音淹没真问题，已下线）、dump-graph / 结构核对（地下/重叠，需几何回传，本轮定不做）、
 *   自动循环（session 竞态风险，见 3d-first-create-blank-race，留后续）。
 */
import type { PlanResult } from "../agents/scene-plan"

/** 单条门控发现 */
export interface GateFinding {
  check: "completeness" | "runtime"
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
  /** 等 iframe SCENE_READY + settle；超时 reject。host 侧实现 */
  awaitSceneSettled: () => Promise<void>
  /** 读 gate 期间收集的 console buffer（host 侧 signal 快照） */
  readConsoleBuffer: () => ConsoleEntry[]
}

/** 与 codegen-scene.ts 一致的保留 key（不作为 type 分组） */
const RESERVED_TYPES = new Set(["version", "scene", "camera", "lights", "remove"])

/**
 * 完整性核对：plan.types vs sceneData 分组 key。
 * - sceneData null → no-live-data（error，等于没产物）
 * - plan 规划的 type 在 live-data 缺失 / 空数组 → warn（partial 仍可渲染，但提醒）
 */
export function checkCompleteness(
  plan: PlanResult,
  sceneData: Record<string, unknown> | null,
): GateFinding[] {
  if (!sceneData) {
    return [
      {
        check: "completeness",
        level: "error",
        code: "no-live-data",
        message: "LLM 未输出 live-data.json 或不可解析",
      },
    ]
  }
  const findings: GateFinding[] = []
  const plannedTypes: string[] = Array.isArray(plan.types)
    ? plan.types.map((t) => t.type).filter((t) => t)
    : []
  const present = Object.keys(sceneData).filter((k) => !RESERVED_TYPES.has(k))
  for (const t of plannedTypes) {
    if (!present.includes(t)) {
      findings.push({
        check: "completeness",
        level: "warn",
        code: "missing-type",
        message: `plan 规划的 type「${t}」在 live-data 中缺失`,
      })
      continue
    }
    const v = sceneData[t]
    if (!Array.isArray(v) || v.length === 0) {
      findings.push({
        check: "completeness",
        level: "warn",
        code: "empty-type",
        message: `type「${t}」在 live-data 中为空数组`,
      })
    }
  }
  return findings
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
 * 跑 9a 两检查。完整性立即；然后等 iframe SCENE_READY settle + 读 console buffer。
 *
 * settle 超时不直接报：先读 buffer——若 buffer 有 runtime error/fatal（渲染崩了），
 * 那就是根因（scene-not-ready 只是它的连锁，不重复报，让用户直接看到「为什么崩」）；
 * 若 buffer 干净才报 scene-not-ready（dev 未起 / iframe 空，真「没就绪」）。
 */
export async function runSceneGate(input: RunSceneGateInput): Promise<GateResult> {
  const findings: GateFinding[] = []

  // 1. 完整性（立即）
  findings.push(...checkCompleteness(input.plan, input.sceneData))

  // 2. 运行时：settle + 读 buffer
  const settleErr = await input
    .awaitSceneSettled()
    .then(() => null)
    .catch((e: unknown) => e)
  const runtimeFindings = checkRuntime(input.readConsoleBuffer())
  findings.push(...runtimeFindings)

  const hasRuntimeError = runtimeFindings.some((f) => f.level === "error")
  if (settleErr && !hasRuntimeError) {
    // buffer 干净却没就绪 → dev 未起 / iframe 空（非渲染崩，是没起来）
    findings.push({
      check: "runtime",
      level: "error",
      code: "scene-not-ready",
      message: `场景未就绪且无运行时报错（dev 可能未起 / iframe 空）：${
        settleErr instanceof Error ? settleErr.message : String(settleErr)
      }`,
    })
  }

  return { passed: !findings.some((f) => f.level === "error"), findings }
}

/** 把 findings 格式化成喂回 codegen 的 `## 上一轮门控失败清单` 段（仅 error 级 + warn 概要） */
export function formatGateFindingsForCodegen(findings: GateFinding[]): string {
  const errs = findings.filter((f) => f.level === "error")
  const warns = findings.filter((f) => f.level === "warn")
  if (errs.length === 0 && warns.length === 0) return ""
  const lines: string[] = ["## 上一轮门控失败清单", "上一轮生成的代码未通过确定性门控，请按下列问题修复：", ""]
  for (const f of errs) {
    lines.push(`- [${f.check}/${f.code}] ${f.message}`)
  }
  if (warns.length > 0) {
    lines.push("", "警告（建议修）：")
    for (const f of warns) {
      lines.push(`- [${f.check}/${f.code}] ${f.message}`)
    }
  }
  lines.push("", "要求：修完后确保 live-data 含全部 plan 规划的 type 且非空、iframe 运行时无 console error。")
  return lines.join("\n")
}

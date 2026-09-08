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
 *
 * direct 落地（2026-09-07）：plan agent 删除，plan 字段保留为透传对象（门控不再读它，
 * 仅供 host stash 场景元数据）。host 传 DirectPlan。
 */

/** 单条门控发现 */
export interface GateFinding {
  check: "runtime"
  level: "error" | "warn"
  code: string
  message: string
  /** 从 console message 正则提取的文件名（如 stadium.ts）；P7-2 修复入口定位用 */
  file?: string
  /** 从 console message 正则提取的行号；P7-2 修复入口定位用 */
  line?: number
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

/** 从 console message / stack 提取 `file.ts:line` 定位（P7-2 修复入口用）。
 *  匹配 ComponentManager 转发的 `handler "type" (node.id) create 抛错` 形式取 type 作 file hint，
 *  以及通用 `(\w+\.ts):(\d+)` 模式。提不到则 file/line 为 undefined（修复入口退化为纯 message）。 */
function extractFileLine(message: string, stack?: string): { file?: string; line?: number } {
  const text = `${message}\n${stack ?? ""}`
  // 通用 `path/file.ts:line` 模式（TS 报错 / vite 报错都含此形式）
  const m = text.match(/([\w./-]+\.ts):(\d+)/)
  if (m) {
    return { file: m[1].split("/").pop(), line: Number(m[2]) }
  }
  return {}
}

export interface RunSceneGateInput {
  /** 透传场景元数据（direct 落地后门控不再读 plan，仅供 host stash；host 传 DirectPlan） */
  plan: unknown
  sceneData: Record<string, unknown> | null
  /** 等 iframe 渲染 + console buffer 收集的基准延迟（ms，默认 3000）。无错延后判 PASS 的窗口。 */
  settleMs?: number
  /** 总轮询上限（ms，默认 12000）。慢加载场景报错落在 settleMs 外也能抓到。 */
  timeoutMs?: number
  /** 读 gate 期间收集的 console buffer（host 侧 signal 快照） */
  readConsoleBuffer: () => ConsoleEntry[]
}

/** 运行时核对：console buffer → findings */
function checkRuntime(entries: ConsoleEntry[]): GateFinding[] {
  const findings: GateFinding[] = []
  for (const e of entries) {
    const loc = extractFileLine(e.message, e.stack)
    if (e.fatal) {
      findings.push({
        check: "runtime",
        level: "error",
        code: "scene-build-error",
        message: e.message,
        ...loc,
      })
    } else if (e.level === "error") {
      findings.push({
        check: "runtime",
        level: "error",
        code: "runtime-error",
        message: e.message,
        ...loc,
      })
    } else if (e.level === "warn") {
      findings.push({
        check: "runtime",
        level: "warn",
        code: "runtime-warn",
        message: e.message,
        ...loc,
      })
    }
  }
  return findings
}

/**
 * 跑运行时检查。渐进读 console buffer：报错秒回 FAIL，无错 settleMs 内判 PASS，timeoutMs 兜底。
 *
 * P0.13（2026-09-07）：固定 3s 抓不到慢加载场景的运行时报错（vite 编译 + iframe 加载 +
 * ComponentManager 遍历常超 3s）。改渐进轮询：每 500ms 读一次 buffer，error 级立即判 FAIL；
 * settleMs 内仍无 error 级 entry → 判 PASS（不拖到 timeoutMs）；timeoutMs 内报错都抓到。
 *
 * 与 P7-1（物化前 tsc 类型检查）互补：tsc 抓 API 误用（TS2339 rect）/未定义变量（TS2304）在物化前拦截；
 * gate 兜 tsc 抓不到的运行时动态错（异步链、动态属性访问）。ComponentManager.create try/catch
 * 把 handler 抛错即时转发为 console.error → 即时进 buffer → 轮询秒捕，不必等满 settleMs。
 */
export async function runSceneGate(input: RunSceneGateInput): Promise<GateResult> {
  const settleMs = input.settleMs ?? 3000
  const timeoutMs = input.timeoutMs ?? 12000
  const start = Date.now()
  const POLL_MS = 500
  let lastFindings: GateFinding[] = []
  while (Date.now() - start < timeoutMs) {
    const findings = checkRuntime(input.readConsoleBuffer())
    lastFindings = findings
    if (findings.some((f) => f.level === "error")) {
      return { passed: false, findings }
    }
    if (Date.now() - start >= settleMs) {
      return { passed: true, findings }
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  return { passed: !lastFindings.some((f) => f.level === "error"), findings: lastFindings }
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

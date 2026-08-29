import { Effect } from "effect"
import type { Snapshot } from "@/snapshot"
import { SessionExtras } from "@/session/extras"

// 服务端打点上报(SPEC-INS-033 D3)——统一产物统计 artifact-output / artifact-output-outside 的
// 服务端发射器。设计论证在 octo-agent 文档仓 spec §6;此处只记实现要点:
//
//   - 为何在服务端:产物是**系统事实**(谁在哪个 turn 写了哪个文件),业界在产生它的进程上报。
//     前端 effect 版的三层补丁(baseline / showGenerating 守卫 / debounce)全部源于把触发器挂在
//     UI 组件生命周期上——切走会话即漏报;服务端在 summarize 之后发,组件在不在都照发。
//   - 协议:复刻前端 tracker(octoapp/utils/tracker.ts)的 /record/logger/interaction 契约,
//     端点无鉴权(裸 JSON POST),字段同构;browserName 固定 "server" 供分析侧区分来源。
//   - at-least-once:summarize 每个 finish-step 都跑,同一 turn 会发多轮;下游按
//     (name, messageId, file) 幂等去重取最新 status。本模块的已发 Set 只是省流量优化,
//     不承担正确性(进程重启即空,漏发由下一个 finish-step / 下一个 turn 的窗口补上)。
//   - base URL:OCTO_REPORT_BASE_URL(经 desktop createSidecarEnv 从 VITE_OCTO_REPORT_BASE_URL
//     桥接注入,同 OCTO_KB_BASE_URL 模式)。未配置(典型外网调试)→ mock 日志
//     [octo:tracker-server],外网验证流程与前端 tracker-mock 对齐。
//
// 只服务 octo_insight 会话(summary.ts 挂钩处按 agent 守卫),make / studio 不报。

const REPORT_PATH = "/record/logger/interaction"
const TIMEOUT_MS = 10_000

function env(name: string) {
  return process.env[name]
}

export function reportBaseUrl(): string | undefined {
  const value = env("OCTO_REPORT_BASE_URL")?.trim()
  return value && value.length > 0 ? value : undefined
}

// 平台字段映射:前端 tracker 从 navigator.userAgent 解析(1=Windows 2=macOS 3=Linux),
// 服务端没有浏览器,按 process.platform 取同值;browserName 固定 "server"。
function platformNumber(): number {
  if (process.platform === "win32") return 1
  if (process.platform === "darwin") return 2
  return 3
}

function platformName(): string {
  if (process.platform === "win32") return "Windows"
  if (process.platform === "darwin") return "macOS"
  return "Linux"
}

/** 合成 datas[].path:复刻前端路由 /insight/:id?(octo.tsx)的 URL 形态;extend 同带 sessionId,
 *  会话归属不依赖 path 解析。 */
export function synthPath(sessionID: string): string {
  return `http://localhost/insight/${sessionID}`
}

// payload 构造(纯函数,单测覆盖):与前端 tracker.ts 的 interaction 报文同构。
export function buildPayload(input: {
  account: string
  name: string
  extend: Record<string, unknown>
}): Record<string, unknown> {
  return {
    account: input.account,
    browserName: "server",
    browserVersion: "",
    os: platformName(),
    platform: platformNumber(),
    project: "octo-agent",
    userAgent: "octo-agent-server",
    module: "insight",
    datas: [
      {
        type: "interaction",
        subType: "click",
        name: input.name,
        path: synthPath(String(input.extend.sessionID ?? "")),
        extend: JSON.stringify(input.extend),
      },
    ],
  }
}

/** 单条事件发送(Effect,错误吞掉只留日志——打点不参与业务、不能反噬 turn)。 */
export function sendOne(input: { account: string; name: string; extend: Record<string, unknown> }): Effect.Effect<void> {
  const payload = buildPayload(input)
  const base = reportBaseUrl()
  if (!base) {
    console.log("[octo:tracker-server] mock", JSON.stringify(payload))
    return Effect.void
  }
  return Effect.promise(async () => {
    // 打点不参与业务:任何网络失败只留日志,绝不反噬 turn。
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      try {
        const res = await fetch(`${base.replace(/\/$/, "")}${REPORT_PATH}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        if (!res.ok) console.error("[octo:tracker-server] failed", { status: res.status, name: input.name })
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      console.error("[octo:tracker-server] error", { name: input.name, err: err instanceof Error ? err.message : String(err) })
    }
  })
}

/** diff 路径是否属于本会话产物区 `.octo/<sessionId>/`(SPEC-INS-014 §2)。镜像前端
 *  worktree-layout.ts isSessionArtifactPath(该判据的渲染端副本已随事件迁服务端删除):
 *  git diff 路径相对仓库根、projectDir 可能是仓库子目录,故按「最后一个 .octo 段的
 *  下一段是否等于本 sessionId」判,不能 startsWith(".octo/")。 */
export function isSessionArtifactPath(filePath: string, sessionId: string): boolean {
  const segs = filePath.split(/[\\/]/)
  const i = segs.lastIndexOf(".octo")
  return i !== -1 && segs[i + 1] === sessionId
}

// 已发键 `messageID:file`(省流量层,见文件头)。跨 turn 场景:同一文件在后续 turn 再被改,
// messageID 不同 → 键不同 → 照发,不受影响。
const sentKeys = new Set<string>()

/** summarize 挂钩入口:把一个 turn 的 FileDiff[] 分桶后 per-file 发送。
 *  - 会话目录内、非 deleted:每文件一条 artifact-output {sessionId, messageId, file, type, status}
 *  - 会话目录外:汇总一条 artifact-output-outside {sessionId, messageId, outside}(噪声桶,只计数)
 *  - account 取不到(登录态丢失 / 服务重启后 extra 空):整批跳过——发空 account 的行
 *    在分析侧无法归属用户,只会制造脏数据。
 *  - 类型判定 outputTypeOf 是 output-type 六值枚举的服务端镜像(markdown/html/json/code/file/image);
 *    .ts/.py/.txt 等一律归 code,与前端口径一致。 */
export function reportDiffs(input: {
  sessionID: string
  messageID: string
  diffs: Snapshot.FileDiff[]
}): Effect.Effect<void> {
  const account = SessionExtras.readExtraString(input.sessionID, "account")
  if (!account) {
    console.warn("[octo:tracker-server] account missing, skip artifact-output", {
      sessionID: input.sessionID,
      messageID: input.messageID,
    })
    return Effect.void
  }

  let outside = 0
  const effects: Effect.Effect<void>[] = []
  for (const d of input.diffs) {
    if (d.status === "deleted") continue
    const key = `${input.messageID}:${d.file}`
    if (sentKeys.has(key)) continue
    sentKeys.add(key)
    if (!isSessionArtifactPath(d.file, input.sessionID)) {
      outside++
      continue
    }
    effects.push(
      sendOne({
        account,
        name: "artifact-output",
        extend: {
          sessionID: input.sessionID,
          messageId: input.messageID,
          file: d.file,
          type: outputTypeOf(d.file),
          status: d.status ?? "modified",
        },
      }),
    )
  }
  if (outside > 0) {
    effects.push(
      sendOne({
        account,
        name: "artifact-output-outside",
        extend: { sessionID: input.sessionID, messageId: input.messageID, outside },
      }),
    )
  }
  return Effect.all(effects, { concurrency: 4 }).pipe(Effect.asVoid)
}

/** 文件类型判定(SPEC-INS-026 §4.2 六值枚举的服务端镜像)。与前端口径一致:
 *  扩展名优先、无扩展名 / 未知类型归 file;代码类扩展归 code;csv 归 file(与前端一致)。 */
export function outputTypeOf(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase()
  if (filename.lastIndexOf(".") === -1) return "file"
  if (["md", "markdown"].includes(ext)) return "markdown"
  if (ext === "html" || ext === "htm") return "html"
  if (ext === "json") return "json"
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) return "image"
  if (
    [
      "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "swift",
      "c", "h", "cpp", "hpp", "cs", "php", "sh", "bash", "ps1", "sql", "lua", "r", "txt", "log",
    ].includes(ext)
  ) {
    return "code"
  }
  return "file"
}

export * as Tracking from "./report"

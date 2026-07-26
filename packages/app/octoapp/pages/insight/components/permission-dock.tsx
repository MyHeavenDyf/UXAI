import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import type { PermissionRequest, Session } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/ui/dock-prompt"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { openFileLocally } from "../utils/local-file-ops"
import "./permission-dock.css"

// InsightPermissionDock —— insight 聊天面板的权限询问 UI(SPEC-INS-021 §2)。
//
// 背景:权限询问(如 external_directory 的 ask)在服务端阻塞等待答复,insight 页面此前没有
// 任何权限 UI,用户贴会话目录外的路径 → 模型调 read → ask 无人应答 → 界面永远停在「正在探索」
// (spec §0.2 的"贴路径卡死")。本组件参照 pages/session/composer/ 的 SessionPermissionDock +
// createSessionComposerState 权限部分,按 insight 页面自包含原则薄封装,不跨页面 import。
//
// 数据流:permission.asked 事件由全局 event-reducer 写入 sync.data.permission(按 sessionID
// 分桶);这里取当前会话(含 task 子代理的子会话——insight 保留 task,子会话的询问也要浮上来)
// 的第一条待答请求渲染;回答走 sdk.client.permission.respond(scoped client 自带 directory)。
// 桌面端 auto-accept 开启时 usePermission().autoResponds 会自动应答,此处过滤掉避免闪现。

/** 当前会话及其子会话(task 子代理)中第一条待答权限请求。
 *  树遍历逻辑与 pages/session/composer/session-request-tree.ts 同构(自包含复制,保持不跨页面依赖)。 */
function findPendingPermission(
  sessions: Session[],
  requests: Record<string, PermissionRequest[] | undefined>,
  sessionID: string | undefined,
  include: (item: PermissionRequest) => boolean,
): PermissionRequest | undefined {
  if (!sessionID) return undefined

  const children = new Map<string, string[]>()
  for (const item of sessions) {
    if (!item.parentID) continue
    const list = children.get(item.parentID)
    if (list) list.push(item.id)
    else children.set(item.parentID, [item.id])
  }

  const seen = new Set([sessionID])
  const ids = [sessionID]
  for (const id of ids) {
    for (const child of children.get(id) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      ids.push(child)
    }
  }

  for (const id of ids) {
    const hit = requests[id]?.find(include)
    if (hit) return hit
  }
  return undefined
}

// 生产可见文案(spec §2):external_directory 的通用描述("访问项目目录之外的文件")对研究员
// 用户是工程黑话,这里按人话覆盖;其余权限类型回落 i18n 现有键。
const PERMISSION_HINT_OVERRIDES: Record<string, string> = {
  external_directory: "AI 需要读取工作区以外的本地文件(路径见下方),经您允许后才会读取。",
}

export function InsightPermissionDock(props: { sessionID?: string }) {
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()
  const permission = usePermission()

  const request = createMemo((): PermissionRequest | undefined =>
    findPendingPermission(
      sync.data.session,
      sync.data.permission,
      props.sessionID,
      (item) => !permission.autoResponds(item, sdk.directory),
    ),
  )

  // 每条请求浮出时打一次(按 id 去重),供内网排查"卡在等权限"与用户反馈对上号
  createEffect(
    on(
      () => request()?.id,
      (id) => {
        const perm = request()
        if (!id || !perm) return
        console.log("[octo:permission] pending", {
          sessionID: perm.sessionID,
          permissionID: perm.id,
          permission: perm.permission,
          patterns: perm.patterns,
        })
      },
    ),
  )

  const [responding, setResponding] = createSignal<string | undefined>(undefined)

  const decide = (perm: PermissionRequest, response: "once" | "always" | "reject") => {
    if (responding() === perm.id) return
    setResponding(perm.id)
    console.log("[octo:permission] respond", { permissionID: perm.id, permission: perm.permission, response })
    sdk.client.permission
      .respond({ sessionID: perm.sessionID, permissionID: perm.id, response })
      .catch((err: unknown) => {
        const description = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description })
      })
      .finally(() => {
        setResponding((id) => (id === perm.id ? undefined : id))
      })
  }

  const hint = (perm: PermissionRequest) => {
    const override = PERMISSION_HINT_OVERRIDES[perm.permission]
    if (override) return override
    const key = `settings.permissions.tool.${perm.permission}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  // 点路径打开对应本地文件。external_directory 的 pattern 是「目录/*」glob,真正的文件在
  // metadata.filepath;优先开它,兜底把 pattern 末尾的 /* 去掉当目录开。
  // 打开复用 openFileLocally:shell.openPath 失败(文件被移走 / 无关联应用)是 resolve 一个错误串、
  // 不 reject —— openFileLocally 已按此约定判串并弹专业文案。若只 .catch 会把这类失败静默吞掉。
  const openPath = (perm: PermissionRequest, pattern: string) => {
    const meta = perm.metadata?.["filepath"]
    const target = typeof meta === "string" && meta ? meta : pattern.replace(/[\\/]\*$/, "")
    console.log("[octo:permission] open", { permissionID: perm.id, target })
    void openFileLocally(target)
  }

  return (
    <Show when={request()} keyed>
      {(perm) => (
        <PermissionDockView
          title={language.t("notification.permission.title")}
          hint={hint(perm)}
          patterns={perm.patterns}
          busy={responding() === perm.id}
          labels={{
            deny: language.t("ui.permission.deny"),
            always: language.t("ui.permission.allowAlways"),
            once: language.t("ui.permission.allowOnce"),
          }}
          onDecide={(response) => decide(perm, response)}
          onOpenPath={(pattern) => openPath(perm, pattern)}
        />
      )}
    </Show>
  )
}

// 纯展示层(无 context 依赖):把 DockPrompt 结构 + 三键从数据逻辑里剥出来,
// 供真实 InsightPermissionDock 与 __dev/permission-dock-preview 共用,预览所见即所得、
// 刷 UI 时样式不会与线上漂移。所有文案由调用方传入(i18n 解析留在数据层)。
export function PermissionDockView(props: {
  title: string
  hint?: string
  patterns: string[]
  busy?: boolean
  labels: { deny: string; always: string; once: string }
  onDecide: (response: "once" | "always" | "reject") => void
  /** 点击某条路径时触发(通常打开对应本地文件);缺省则路径不可点。 */
  onOpenPath?: (pattern: string) => void
}) {
  return (
    <div class="octo-perm-dock">
      <DockPrompt
        kind="permission"
        header={
          <div data-slot="permission-row" data-variant="header">
            <span data-slot="permission-icon">
              {/* 圆形充填黄 + 白色感叹号(样式见 permission-dock.css .octo-perm-badge) */}
              <span class="octo-perm-badge" aria-hidden="true">
                !
              </span>
            </span>
            <div data-slot="permission-header-title">{props.title}</div>
          </div>
        }
        footer={
          <>
            <div />
            <div data-slot="permission-footer-actions">
              <Button variant="ghost" size="normal" onClick={() => props.onDecide("reject")} disabled={props.busy}>
                {props.labels.deny}
              </Button>
              <Button variant="secondary" size="normal" onClick={() => props.onDecide("always")} disabled={props.busy}>
                {props.labels.always}
              </Button>
              <Button variant="primary" size="normal" onClick={() => props.onDecide("once")} disabled={props.busy}>
                {props.labels.once}
              </Button>
            </div>
          </>
        }
      >
        <Show when={props.hint}>
          <div data-slot="permission-row">
            <span data-slot="permission-spacer" aria-hidden="true" />
            <div data-slot="permission-hint">{props.hint}</div>
          </div>
        </Show>

        <Show when={props.patterns.length > 0}>
          <div data-slot="permission-row">
            <span data-slot="permission-spacer" aria-hidden="true" />
            <div data-slot="permission-patterns">
              <For each={props.patterns}>
                {(pattern) => (
                  <button type="button" class="octo-perm-path" onClick={() => props.onOpenPath?.(pattern)}>
                    {pattern}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
      </DockPrompt>
    </div>
  )
}

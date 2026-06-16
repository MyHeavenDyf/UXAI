import type { Session } from "@opencode-ai/sdk/v2/client"
import { createEffect, createMemo, createResource, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js"
import type { JSX } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { INSIGHT_AGENT } from "@/constants/agent"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useProjectDir } from "@/hooks/use-project-dir"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { sessionPermissionRequest } from "@/pages/session/composer/session-request-tree"
import { sessionTitle } from "@/utils/session-title"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"

/**
 * InsightSessionList —— Insight 会话段(SPEC-INS-010 §11.3 / D11)
 *
 * 与 UX AI 会话列表 1:1:新建行 + 状态点(工作中 Spinner / 待处理权限 / 错误 / 未读),
 * 由同源 opencode 子系统驱动(globalSync.child / notification / permission)——这些 context
 * API 两仓**同名同签**(核对见 §11.3),故无需 lib 适配层,真 1:1。
 *
 * 与 UX AI 的有意差异(经 spec 锁定):
 *  - 新建 = 懒创建跳空页(D4),不 eager session.create
 *
 * agent 过滤:strict `s.agent === "octo_insight"` —— 见 octo-agent `SPEC infra/session-agent-attribution`。
 * server 已把 agent 作为一等字段持久化(SessionTable.agent / Session.Info.agent / Session.CreateInput.agent),
 * 两仓 rsync 后行为一致;老数据 agent IS NULL 被天然过滤,即兜底机制。
 *
 * 自包含、对外零参数:globalSDK / globalSync / notification / permission 自取
 * (均在 AppBaseProviders 全局层,搬出后照样拿得到)。宿主 shell 仅 import 摆位。
 */


export function InsightSessionList(): JSX.Element {
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const navigate = useNavigate()
  const location = useLocation()
  const notification = useNotification()
  const permission = usePermission()
  const dialog = useDialog()
  const language = useLanguage()

  // 走全栈统一 useProjectDir():路由 :dir → server.projects.last() → globalSync.data.path.home 兜底,
  // 与 _shell/sidebar.tsx / make / studio 完全一致;避免"insight 自读 home 而其他模块走 selection"造成
  // 用户选了项目目录后 insight 仍查 home dir 而看不到自己历史对话的 directory 飘移 bug。
  const projectDir = useProjectDir()

  const [sessions, { refetch }] = createResource<Session[], string>(projectDir, async (dir, info) => {
    if (!dir) return [] as Session[]
    try {
      const result = await globalSDK.client.session.list({ directory: dir })
      // strict 过滤:server 已把 agent 作为一等字段持久化。
      const data = ((result.data ?? []) as Array<Session & { agent?: string }>).sort(
        (a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0),
      )
      return data.filter((s) => s.agent === INSIGHT_AGENT)
    } catch (err) {
      // session.list 失败(如 server 端某行 Session.Info schema 编码失败 → 400 空 body)绝不能把整页
      // 顶进 ErrorBoundary。降级为"列表保持上次内容、不刷新",而非整页崩 —— 用户仍可新建/继续对话。
      // 根因类问题(脏数据/枚举越界)由 server 读取侧修;这里是"任意单次列表失败都不致命"的兜底。
      console.error("[insight:session-list] list failed, keeping previous list", err)
      return info.value ?? []
    }
  })

  // reconcile(key=id):保持 <For> 行引用稳定,避免每次 refetch 重建每行的 globalSync.child
  // 订阅与状态点 memo(否则状态点会闪)。
  const [sessionList, setSessionList] = createStore<Session[]>([])
  createEffect(on(sessions, (data) => {
    if (data) setSessionList(reconcile(data, { key: "id" }))
  }, { defer: true }))

  let refetchTimer: ReturnType<typeof setTimeout> | undefined
  const unsub = globalSDK.event.listen((e) => {
    const t = e.details.type
    if (t === "session.created" || t === "session.updated" || t === "session.deleted") {
      clearTimeout(refetchTimer)
      refetchTimer = setTimeout(() => void refetch(), 1000)
    }
  })
  onCleanup(unsub)
  onCleanup(() => clearTimeout(refetchTimer))

  const activeSessionId = () => {
    const m = location.pathname.match(/^\/insight\/(.+)$/)
    return m?.[1]
  }

  // ── 右键改名/删除(我方在 1:1 之上的功能并集;UXAI 会话列表无此菜单)──────
  // 菜单视觉复用 @opencode-ai/ui 的 DropdownMenu(与对话区顶部 ConversationHeader 的三点
  // 菜单同源同样式),光标位置通过一个 0 尺寸的虚拟 Trigger 锚定,Kobalte 负责定位/Esc/外点关闭。
  const [contextMenu, setContextMenu] = createSignal<{ id: string; x: number; y: number } | null>(null)
  // 选「重命名」后延迟到菜单关闭动画结束(onCloseAutoFocus)再进编辑态,并在那里 preventDefault
  // 拦掉 Kobalte 把焦点抢回 Trigger 的默认行为,否则输入框刚 focus 就被夺走触发 onBlur,只闪一下。
  const [pendingRenameId, setPendingRenameId] = createSignal<string | null>(null)
  const [renamingId, setRenamingId] = createSignal<string | null>(null)
  const [renameDraft, setRenameDraft] = createSignal("")

  function closeContextMenu() {
    setContextMenu(null)
  }

  function openRename(sessionId: string) {
    closeContextMenu()
    const session = sessionList.find((s) => s.id === sessionId)
    const raw = session?.title ?? ""
    setRenameDraft(/^New session/.test(raw) ? "" : raw)
    setRenamingId(sessionId)
  }

  async function handleRenameConfirm(sessionId: string) {
    const next = renameDraft().trim()
    setRenamingId(null)
    if (!next) return
    try {
      await globalSDK.client.session.update({ sessionID: sessionId, title: next })
    } catch (err) {
      console.error("[insight:session-list] rename failed", err)
    }
  }

  async function handleDelete(sessionId: string) {
    try {
      await globalSDK.client.session.delete({ sessionID: sessionId })
      if (activeSessionId() === sessionId) navigate("/insight")
    } catch (err) {
      console.error("[insight:session-list] delete failed", err)
    }
  }

  // 删除确认:与 chat 侧栏(components/sidebar.tsx)一致——居中模态 Dialog,
  // 复用 .delete-dialog 样式与 session.delete.button / common.cancel 文案。
  function confirmDelete(sessionId: string) {
    const session = sessionList.find((s) => s.id === sessionId)
    closeContextMenu()
    dialog.show(() => (
      <Dialog title="删除会话" fit class="delete-dialog">
        <span class="text-[14px] leading-[22px]" style={{ color: "rgba(0,0,0,0.9)" }}>
          确定删除「{sessionTitle(session?.title) || language.t("command.session.new")}」？
        </span>
        <div class="flex justify-end gap-2" style={{ "margin-top": "12px" }}>
          <Button variant="ghost" size="large" class="delete-dialog-btn" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" class="delete-dialog-btn delete-dialog-btn-primary" onClick={() => { void handleDelete(sessionId).then(() => dialog.close()) }}>
            {language.t("session.delete.button")}
          </Button>
        </div>
      </Dialog>
    ))
  }

  return (
    <div class="flex flex-col">
      <Show
        when={!sessions.loading}
        fallback={
          <div class="px-[8px] py-[6px]">
            <div class="h-[10px] w-[80px] rounded-[3px] animate-pulse" style={{ background: "rgba(0,0,0,0.08)" }} />
          </div>
        }
      >
        <Show
          when={sessionList.length > 0}
          fallback={
            <div class="text-12-regular text-text-weak py-4 text-center">
              暂无对话
            </div>
          }
        >
          <For each={sessionList}>
            {(session) => {
              const isActive = () => activeSessionId() === session.id
              const [sessionStore] = globalSync.child(session.directory)
              const isWorking = createMemo(() => {
                const status = sessionStore.session_status[session.id]
                return status !== undefined && status.type !== "idle"
              })
              const unseenCount = createMemo(() => notification.session.unseenCount(session.id))
              const hasError = createMemo(() => notification.session.unseenHasError(session.id))
              const hasPermissions = createMemo(() =>
                !!sessionPermissionRequest(sessionStore.session, sessionStore.permission, session.id, (item) =>
                  !permission.autoResponds(item, session.directory),
                ),
              )
              return (
                <Show
                  when={renamingId() === session.id}
                  fallback={
                    <button
                      type="button"
                      onClick={() => {
                        notification.session.markViewed(session.id)
                        navigate(`/insight/${session.id}`)
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setContextMenu({ id: session.id, x: e.clientX, y: e.clientY })
                      }}
                      class="w-full text-left rounded-[8px] text-[12px] leading-[20px] transition-colors flex items-center relative"
                      style={{
                        height: "36px",
                        padding: "0 24px 0 44px",
                        color: isActive() ? "#0A59F7" : undefined,
                      }}
                      classList={{
                        "bg-[rgba(10,89,247,0.08)]": isActive(),
                        "hover:bg-surface-base-hover": !isActive(),
                      }}
                    >
                      <Show when={isActive()}>
                        <span
                          class="absolute right-[12px] top-1/2 rounded-full pointer-events-none"
                          style={{
                            height: "28px",
                            width: "4px",
                            background: "#0A59F7",
                            transform: "translateY(-50%)",
                          }}
                        />
                      </Show>
                      <Show when={isWorking() || hasPermissions() || hasError() || unseenCount() > 0}>
                        <div class="shrink-0 size-6 flex items-center justify-center absolute left-[12px]">
                          <Switch>
                            <Match when={isWorking()}>
                              <Spinner class="size-[15px]" />
                            </Match>
                            <Match when={hasPermissions()}>
                              <div class="size-1.5 rounded-full bg-surface-warning-strong" />
                            </Match>
                            <Match when={hasError()}>
                              <div class="size-1.5 rounded-full bg-text-diff-delete-base" />
                            </Match>
                            <Match when={unseenCount() > 0}>
                              <div class="size-1.5 rounded-full bg-text-interactive-base" />
                            </Match>
                          </Switch>
                        </div>
                      </Show>
                      <span class="flex-1 min-w-0 truncate">{sessionTitle(session.title) || "无标题"}</span>
                    </button>
                  }
                >
                  {/* 内联重命名输入框 */}
                  <div
                    class="w-full rounded-[8px] flex items-center"
                    style={{ height: "36px", padding: "0 12px 0 44px", background: "rgba(10,89,247,0.08)" }}
                  >
                    <input
                      type="text"
                      value={renameDraft()}
                      onInput={(e) => setRenameDraft(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === "Enter") { e.preventDefault(); void handleRenameConfirm(session.id) }
                        if (e.key === "Escape") { e.preventDefault(); setRenamingId(null) }
                      }}
                      onBlur={() => void handleRenameConfirm(session.id)}
                      ref={(el) => requestAnimationFrame(() => { el.focus(); el.select() })}
                      class="w-full bg-transparent text-[12px] outline-none"
                      style={{ color: "#0A59F7", "font-weight": "500", border: "none" }}
                    />
                  </div>
                </Show>
              )
            }}
          </For>
        </Show>
      </Show>

      {/* ── 右键上下文菜单(与 ConversationHeader 三点菜单同源同样式)───────── */}
      <DropdownMenu
        gutter={4}
        placement="bottom-start"
        open={!!contextMenu()}
        onOpenChange={(open) => { if (!open) closeContextMenu() }}
      >
        <DropdownMenu.Trigger
          aria-hidden="true"
          tabindex={-1}
          style={{
            position: "fixed",
            left: `${contextMenu()?.x ?? 0}px`,
            top: `${contextMenu()?.y ?? 0}px`,
            width: "0",
            height: "0",
            padding: "0",
            border: "none",
            background: "transparent",
            "pointer-events": "none",
            opacity: "0",
          }}
        />
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            style={{ "min-width": "104px" }}
            onCloseAutoFocus={(event) => {
              const id = pendingRenameId()
              if (id) {
                event.preventDefault()
                setPendingRenameId(null)
                openRename(id)
              }
            }}
          >
            <DropdownMenu.Item onSelect={() => { const m = contextMenu(); if (m) setPendingRenameId(m.id) }}>
              <DropdownMenu.ItemLabel>重命名</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={() => { const m = contextMenu(); if (m) confirmDelete(m.id) }}>
              <DropdownMenu.ItemLabel>删除</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}

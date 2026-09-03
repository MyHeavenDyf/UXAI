import { createMemo, createSignal, Show } from "solid-js"
import type { JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { INSIGHT_AGENT } from "@/constants/agent"
import { sessionTitle } from "@/utils/session-title"
import { tracker } from "@/utils/tracker"
import { pickNextSession, sessionErrorMessage, sortedActiveSessions } from "@/utils/session-delete"
import { useSessionDelete } from "@/hooks/use-session-delete"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { DialogDeleteSession } from "@/components/dialog-delete-session"
import { ContextUsageCircle } from "@/components/context-usage-circle"

/**
 * ConversationHeader —— Insight 对话面板顶部的会话标题栏
 *
 * 上游已实现:✓ —— 参照 opencode 原生 packages/app/src/pages/session/message-timeline.tsx
 * 的标题 header（showHeader / childTitle / 双击改名 / dot-grid 菜单 / DialogDeleteSession）。
 * Insight 是单层用研会话，无父子/subagent/share/archive，故精简为：
 *   标题 + busy spinner + 双击改名(session.update) + dot-grid 菜单(重命名 / 删除)。
 *
 * 数据层复用 sync（sync.session.get / sync.set）+ useSDK（带 directory 的 sdk.client）。
 * 视觉走 insight 的 --octo token，保持页面自包含。
 */

export function ConversationHeader(
  props: {
    sidebarToggle?: JSX.Element
    panelToggle?: JSX.Element
    context?: {
      tokens: number
      limit?: number
      usage: number
      blocked: boolean
      disabled: boolean
      onCompact: () => void
    }
  } = {},
) {
  const params = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const layout = useLayout()
  const language = useLanguage()
  const removeSession = useSessionDelete()

  const sessionID = () => params.id
  const info = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return sync.session.get(id)
  })
  const titleValue = createMemo(() => info()?.title)
  // 占位标题（"New session - <iso>"）尚未由 LLM 生成真标题，展示为「新会话」
  const realTitle = createMemo(() => {
    const v = titleValue()
    if (!v || /^New session/.test(v)) return ""
    return sessionTitle(v) ?? ""
  })
  const displayTitle = createMemo(() => realTitle() || "新会话")
  const busy = createMemo(() => {
    const id = sessionID()
    if (!id) return false
    return sync.data.session_status[id]?.type === "busy"
  })

  const [title, setTitle] = createStore({ draft: "", editing: false, menuOpen: false, pendingRename: false })
  const [pending, setPending] = createSignal(false)
  let titleRef: HTMLInputElement | undefined

  const openTitleEditor = () => {
    if (!sessionID()) return
    setTitle({ editing: true, draft: realTitle() })
    requestAnimationFrame(() => {
      titleRef?.focus()
      titleRef?.select()
    })
  }

  const closeTitleEditor = () => {
    if (pending()) return
    setTitle("editing", false)
  }

  const saveTitleEditor = async () => {
    const id = sessionID()
    if (!id || pending()) return

    const next = title.draft.trim()
    if (!next || next === realTitle()) {
      setTitle("editing", false)
      return
    }

    setPending(true)
    try {
      await sdk.client.session.update({ sessionID: id, title: next })
      tracker.interaction({ module: "insight", name: "session-rename", extend: JSON.stringify({ entry: "header" }) })
      sync.set(
        produce((draft) => {
          const index = draft.session.findIndex((s) => s.id === id)
          if (index !== -1) draft.session[index].title = next
        }),
      )
      setTitle("editing", false)
    } catch (err) {
      showToast({ title: "重命名失败", description: sessionErrorMessage(err, language.t("common.requestFailed")) })
    } finally {
      setPending(false)
    }
  }

  const deleteSession = async (id: string) => {
    const listResult = await sdk.client.session.list({ directory: sdk.directory })
    const sessions = sortedActiveSessions((listResult.data ?? []) as Session[], INSIGHT_AGENT)
    const nextSession = pickNextSession(sessions, id)

    const ok = await removeSession(sdk.client, id)
    if (!ok) return

    tracker.interaction({ module: "insight", name: "session-delete", extend: JSON.stringify({ entry: "header" }) })
    sync.set(
      produce((draft) => {
        const i = draft.session.findIndex((s) => s.id === id)
        if (i !== -1) draft.session.splice(i, 1)
      }),
    )
    if (layout.lastSessionPerTab.cowork()?.id === id) layout.lastSessionPerTab.clearCowork()
    if (params.id === id) navigate(nextSession ? `/insight/${nextSession.id}` : "/insight")
  }

  return (
    <Show when={sessionID()}>
      {(id) => (
        <div
          class="shrink-0 h-12 flex items-center justify-between gap-2 px-4"
          style={{ "border-bottom": "1px solid var(--octo-border-default, #E5E7EB)" }}
        >
          <div class="flex items-center gap-2 min-w-0 flex-1">
            {props.sidebarToggle}
            <Show when={busy()}>
              <Spinner class="size-4 shrink-0" style={{ color: "var(--octo-brand, #0067D1)" }} />
            </Show>
            <Show
              when={title.editing}
              fallback={
                <h1
                  class="text-[14px] font-bold truncate min-w-0 cursor-default"
                  style={{ color: "var(--octo-text-primary, #191919)" }}
                  title={displayTitle()}
                  onDblClick={openTitleEditor}
                >
                  {displayTitle()}
                </h1>
              }
            >
              <InlineInput
                ref={(el: HTMLInputElement) => {
                  titleRef = el
                }}
                value={title.draft}
                maxlength={1000}
                disabled={pending()}
                class="text-[14px] font-bold grow min-w-0 rounded-[6px] pl-1 -ml-1"
                onInput={(event) => setTitle("draft", event.currentTarget.value)}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void saveTitleEditor()
                    return
                  }
                  if (event.key === "Escape") {
                    event.preventDefault()
                    closeTitleEditor()
                  }
                }}
                onBlur={() => void saveTitleEditor()}
              />
            </Show>
            <Show when={!title.editing && props.context}>
              {(context) => (
                <Tooltip
                  placement="top"
                  gutter={8}
                  arrow
                  interactive
                  contentClass="insight-token-tooltip"
                  value={
                    <div class="insight-token-tooltip-copy">
                      <p>
                        当前对话 Session 上下文
                        {context().blocked
                          ? "已超过100%"
                          : context().usage >= 80
                            ? "已超过80%"
                            : `已使用${context().usage}%`}{" "}
                        (<span classList={{ "is-critical": context().usage >= 80 }}>{context().tokens.toLocaleString(language.intl())}</span>{" "}
                        / {context().limit?.toLocaleString(language.intl()) ?? "--"})，
                      </p>
                      <p>
                        建议点击“<button type="button" class="insight-token-tooltip-action" disabled={context().disabled} onClick={context().onCompact}>上下文压缩</button>”以继续对话。
                      </p>
                    </div>
                  }
                >
                  <button
                    type="button"
                    class="shrink-0 flex items-center justify-center"
                    classList={{ "cursor-pointer": !context().disabled, "cursor-not-allowed": context().disabled }}
                    style={{ background: "transparent", border: "none", padding: "0" }}
                    disabled={context().disabled}
                    onClick={context().onCompact}
                    aria-label={`上下文已使用 ${context().usage}%，点击压缩上下文`}
                  >
                    <ContextUsageCircle percentage={context().usage} />
                  </button>
                </Tooltip>
              )}
            </Show>
          </div>

          <DropdownMenu
            gutter={4}
            placement="bottom-end"
            open={title.menuOpen}
            onOpenChange={(open) => setTitle("menuOpen", open)}
          >
            <DropdownMenu.Trigger
              as={IconButton}
              icon="ellipsis"
              variant="ghost"
              class="size-6 rounded-md shrink-0 cursor-pointer data-[expanded]:bg-surface-base-active"
              aria-label="更多操作"
            />
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                style={{ "min-width": "104px" }}
                onCloseAutoFocus={(event) => {
                  // 菜单关闭动画结束后再进编辑态，避免焦点被菜单抢回（与原生一致）
                  if (title.pendingRename) {
                    event.preventDefault()
                    setTitle("pendingRename", false)
                    openTitleEditor()
                  }
                }}
              >
                <DropdownMenu.Item onSelect={() => setTitle({ pendingRename: true, menuOpen: false })}>
                  <DropdownMenu.ItemLabel>重命名</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={() => dialog.show(() => <DialogDeleteSession name={sessionTitle(info()?.title) ?? language.t("command.session.new")} onDelete={() => deleteSession(id())} />)}>
                  <DropdownMenu.ItemLabel>删除</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>

          {props.panelToggle}
        </div>
      )}
    </Show>
  )
}

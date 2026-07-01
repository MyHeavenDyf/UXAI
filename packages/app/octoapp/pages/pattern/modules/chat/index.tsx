import type { Message, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import { For, Index, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { sessionTitle } from "@/utils/session-title"
import { AttachmentBar, type Attachment } from "./attachment-bar"
import { InsightTurn } from "./insight-turn"
import { GenerationCard } from "./generation-card"
import { TurnDuration } from "./turn-duration"
import { ProtoIntroduction } from "./proto-introduction"
import { ChartInput, type ChartInputProps } from "./chart-input"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { ProtoTabSwitcher, type TabKey } from "./proto-tab-switcher"
import type { Round } from "../../utils/round-messages"
import "../../assets/style/chat/index.css"

type AutoScrollApi = ReturnType<typeof createAutoScroll>

function RoundCard(props: {
  roundIndex: number
  totalRounds: number
  pipelineBusy: boolean
  cancelled: boolean
  startTime: number
  endTime?: number
  error?: string
}): JSX.Element {
  const isLatest = () => props.roundIndex === props.totalRounds - 1
  const generating = () => isLatest() && props.pipelineBusy
  const done = () => !isLatest() || !props.pipelineBusy
  const cancelled = () => !props.error && done() && (props.cancelled || (isLatest() && props.endTime === undefined))
  return (
    <>
      <GenerationCard
        generating={generating()}
        canPreview={done() && !cancelled() && !props.error}
        cancelled={cancelled()}
        error={props.error}
      />
      <Show when={done() || generating()}>
        <TurnDuration startTime={props.startTime} endTime={props.endTime} active={generating()} />
      </Show>
    </>
  )
}

export function ChatPanel(props: {
  /** 是否有对话内容（控制空态/对话态切换） */
  hasContent: boolean
  /** 当前 session 消息是否已加载完成 */
  sessionMessagesLoaded: boolean
  /** 是否正在生成中 */
  isBusy: boolean
  /** 当前会话信息 */
  sessionInfo: Session | null
  /** 用户消息列表 */
  userMessages: Message[]
  /** 会话状态 */
  sessionStatus: SessionStatus
  /** 自动滚动控制器 */
  autoScroll: AutoScrollApi
  /** 聊天输入框属性 */
  inputProps: ChartInputProps
  /** 附件列表 */
  attachments: Attachment[]
  /** 移除附件回调 */
  onRemoveAttachment: (id: string) => void
  /** 是否正在拖拽文件 */
  isDragOver: boolean
  /** 拖拽进入回调 */
  onDragOver: (e: DragEvent) => void
  /** 拖拽离开回调 */
  onDragLeave: () => void
  /** 拖拽释放回调 */
  onDrop: (e: DragEvent) => void
  /** 主流程是否正在生成 */
  pipelineBusy: boolean
  /** 按轮分组的消息 */
  roundMessages: Round[]
  /** 删除会话回调 */
  onDeleteSession: (id: string) => Promise<void>
  /** 标题修改后通知父组件更新 */
  onTitleChanged: (title: string) => void
}) {
  const params = useParams<{ id?: string }>()
  const sdk = useSDK()
  const language = useLanguage()
  const dialog = useDialog()

  const [titleState, setTitleState] = createStore({
    editing: false,
    draft: "",
    menuOpen: false,
    pendingRename: false,
  })
  let titleRef: HTMLInputElement | undefined

  // 双击对话标题编辑修改
  function openTitleEditor() {
    setTitleState({ editing: true, draft: sessionTitle(props.sessionInfo?.title) ?? "" })
    requestAnimationFrame(() => titleRef?.focus())
  }

  // 保存问答标题
  async function saveTitleEditor() {
    const id = params.id
    if (!id) return
    const draft = titleState.draft.trim()
    if (!draft) { setTitleState("editing", false); return }
    try {
      await sdk.client.session.update({ sessionID: id, title: draft })
      props.onTitleChanged(draft)
    } catch (err) {
      showToast({ title: "重命名失败", description: err instanceof Error ? err.message : String(err) })
    }
    setTitleState("editing", false)
  }

  function handleDeleteSession() {
    const id = params.id
    if (!id) return
    dialog.show(() => (
      <PatternDialogDeleteSession
        sessionID={id}
        name={sessionTitle(props.sessionInfo?.title) ?? "Pattern"}
        onDelete={props.onDeleteSession}
      />
    ))
  }

  const [state, setState] = createStore<{ activeTab: TabKey }>({ activeTab: "fullpage" })

  // ── 会话进度条动画状态 ──
  const [timeoutDone, setTimeoutDone] = createSignal(true)
  const workingStatus = createMemo<"hidden" | "showing" | "hiding">((prev) => {
    if (props.pipelineBusy) return "showing"
    if (prev === "showing" || !timeoutDone()) return "hiding"
    return "hidden"
  })
  createEffect(() => {
    if (workingStatus() !== "hiding") return
    setTimeoutDone(false)
    const id = setTimeout(() => setTimeoutDone(true), 260)
    onCleanup(() => clearTimeout(id))
  })

  return (
    <div
      class="flex flex-col overflow-hidden"
      style={{
        background: props.isDragOver ? "var(--octo-brand-a3)" : "#fff",
        outline: props.isDragOver ? "inset 0 0 0 2px var(--octo-brand-a25)" : "none",
      }}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
    >
      <Show when={props.hasContent}>
        <div class="session-progress-wrap">
          <Show when={workingStatus() !== "hidden"}>
            <div
              data-component="session-progress"
              data-state={workingStatus()}
              aria-hidden="true"
            >
              <div data-component="session-progress-bar" />
            </div>
          </Show>
          <div
            class="shrink-0 flex items-center justify-between"
            style={{ padding: "12px 24px", background: "#fff" }}
          >
          <div class="flex items-center gap-2 min-w-0 flex-1 pr-3">
            <Show when={props.isBusy}>
              <div class="shrink-0">
                <Spinner class="size-4" />
              </div>
            </Show>
            <Show
              when={!titleState.editing}
              fallback={
                <InlineInput
                  ref={(el) => { titleRef = el }}
                  value={titleState.draft}
                  class="text-14-medium text-text-strong grow-1 min-w-0 rounded-[6px] pl-1 -ml-1"
                  onInput={(e) => setTitleState("draft", e.currentTarget.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === "Enter") { e.preventDefault(); void saveTitleEditor() }
                    if (e.key === "Escape") { e.preventDefault(); setTitleState("editing", false) }
                  }}
                  onBlur={() => void saveTitleEditor()}
                />
              }
            >
              <h1
                class="truncate min-w-0 title"
                onDblClick={openTitleEditor}
              >
                {sessionTitle(props.sessionInfo?.title) ?? "Pattern"}
              </h1>
            </Show>
          </div>
          <DropdownMenu
            gutter={4}
            placement="bottom-end"
            open={titleState.menuOpen}
            onOpenChange={(open) => setTitleState("menuOpen", open)}
          >
            <DropdownMenu.Trigger
              as={IconButton}
              icon="dot-grid"
              variant="ghost"
              class="size-6 rounded-md data-[expanded]:bg-surface-base-active"
              aria-label={language.t("common.moreOptions")}
            />
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                style={{ "min-width": "104px" }}
                onCloseAutoFocus={(event) => {
                  if (titleState.pendingRename) {
                    event.preventDefault()
                    setTitleState("pendingRename", false)
                    openTitleEditor()
                  }
                }}
              >
                <DropdownMenu.Item onSelect={() => setTitleState({ pendingRename: true, menuOpen: false })}>
                  <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={handleDeleteSession}>
                  <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
        </div>
        </div>
      </Show>

      <Show when={props.hasContent} fallback={
        <Show when={props.sessionMessagesLoaded} fallback={
          <div class="flex-1 flex items-center justify-center min-h-0">
            <div class="octo-spinner" />
          </div>
        }>
          <div class="flex-1 flex flex-col items-center justify-center min-h-0">
            <ProtoIntroduction />
            <div class="w-full max-w-[800px] px-8">
              <AttachmentBar attachments={props.attachments} onRemove={props.onRemoveAttachment} />
              <ChartInput {...props.inputProps} rows={undefined} />
            </div>
          </div>
        </Show>
      }>
        <ScrollView
          class="flex-1 min-h-0"
          style={{ background: "#fff" }}
          viewportRef={props.autoScroll.scrollRef}
          onScroll={props.autoScroll.handleScroll}
          onMouseUp={props.autoScroll.handleInteraction}
        >
          <Show when={params.id} keyed>
            {(sid) => (
              <div ref={props.autoScroll.contentRef} class="py-3 flex flex-col gap-0">
                <Show
                  when={props.roundMessages.length > 0}
                  fallback={
                    <For each={props.userMessages}>
                      {(msg) => (
                        <InsightTurn
                          sessionID={(msg as any)._sessionID ?? sid}
                          messageID={msg.id}
                          status={props.sessionStatus}
                          pipelineBusy={props.pipelineBusy}
                        />
                      )}
                    </For>
                  }
                >
                  <Index each={props.roundMessages}>
                    {(round, ri) => (
                      <>
                        <For each={round().items}>
                          {(item) => (
                            <InsightTurn
                              sessionID={item.sessionID}
                              messageID={item.messageID}
                              status={props.sessionStatus}
                              pipelineBusy={props.pipelineBusy}
                            />
                          )}
                        </For>
                        <RoundCard
                          roundIndex={ri}
                          totalRounds={props.roundMessages.length}
                          pipelineBusy={props.pipelineBusy}
                          cancelled={round().cancelled}
                          startTime={round().startTime}
                          endTime={round().endTime}
                          error={round().error}
                        />
                      </>
                    )}
                  </Index>
                </Show>
              </div>
            )}
          </Show>
        </ScrollView>

        <div class="shrink-0 chat-content">
          <AttachmentBar attachments={props.attachments} onRemove={props.onRemoveAttachment} />
          <ChartInput {...props.inputProps} rows={3} />
        </div>
      </Show>
    </div>
  )
}

function PatternDialogDeleteSession(props: { sessionID: string; name: string; onDelete: (id: string) => Promise<void> }): JSX.Element {
  const language = useLanguage()
  const dialog = useDialog()
  return (
    <Dialog title={language.t("session.delete.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <span class="text-14-regular text-text-strong">
          {language.t("session.delete.confirm", { name: props.name })}
        </span>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="large"
            onClick={() => void props.onDelete(props.sessionID).then(() => dialog.close())}
          >
            {language.t("session.delete.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

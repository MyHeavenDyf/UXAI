import type { Message, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import { For, Index, Show, type JSX } from "solid-js"
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
import { AttachmentBar, type Attachment } from "./attachment_bar"
import { InsightTurn, type OutputCard } from "./insight-turn"
import { UserInputCard } from "./user-input-card"
import { GenerationCard, type GenOutcome } from "./generation-card"
import { TurnDuration } from "./turn-duration"
import { ProtoIntroduction } from "./proto_introduction"
import { ChartInput, type ChartInputProps } from "./chart_input"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import "../../assets/style/chat/index.css"

type AutoScrollApi = ReturnType<typeof createAutoScroll>

function RoundCard(props: {
  generating: boolean
  outcome: GenOutcome
  /** 该轮对应的场景版本 id(完成可点击切回);null = 无场景(中止/失败) */
  versionId: string | null
  onSwitchScene: (versionId: string) => void
  isLatest: boolean
  genStartTime: number
  startTime: number
  endTime?: number
  /** 该轮 assistant 用的模型 ID,显示在用时上方 */
  modelID?: string
}): JSX.Element {
  return (
    <>
      <GenerationCard
        generating={props.generating}
        outcome={props.outcome}
        canSwitch={!!props.versionId}
        onSwitch={() => props.versionId && props.onSwitchScene(props.versionId)}
      />
      <TurnDuration
        startTime={props.isLatest && props.genStartTime > 0 ? props.genStartTime : props.startTime}
        endTime={props.endTime}
        active={props.generating}
        modelID={props.modelID}
      />
    </>
  )
}

export function ChatPanel(props: {
  /** 是否有对话内容（控制空态/对话态切换） */
  hasContent: boolean
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
  /** 点击消息中的结果卡片回调 */
  onOpenResult: (card: OutputCard) => void
  /** 当前生成开始时间(用于最新轮次的计时器,避免 sync 延迟导致叠加) */
  genStartTime: number
  /** 按轮分组的消息 */
  roundMessages: { startTime: number; endTime?: number; modelID?: string; items: { sessionID: string; messageID: string }[] }[]
  /** 每轮卡片状态(与 roundMessages 对齐):generating / outcome / versionId / prompt */
  roundCards: { generating: boolean; outcome: GenOutcome; versionId: string | null; prompt?: string }[]
  /** 点击某轮「生成完成」卡片 → 切换到该轮场景(同历史版本) */
  onSwitchScene: (versionId: string) => void
  /** 删除会话回调 */
  onDeleteSession: (id: string) => Promise<void>
  /** 标题修改后通知父组件刷新 */
  onTitleChanged: () => void
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
      props.onTitleChanged()
    } catch (err) {
      showToast({ title: "重命名失败", description: err instanceof Error ? err.message : String(err) })
    }
    setTitleState("editing", false)
  }

  function handleDeleteSession() {
    const id = params.id
    if (!id) return
    dialog.show(() => (
      <ThreeDDialogDeleteSession
        sessionID={id}
        name={sessionTitle(props.sessionInfo?.title) ?? "3D 场景"}
        onDelete={props.onDeleteSession}
      />
    ))
  }

  return (
    <div
      class="flex flex-col overflow-hidden min-h-0"
      style={{
        background: props.isDragOver ? "var(--octo-brand-a3)" : "#fff",
        outline: props.isDragOver ? "inset 0 0 0 2px var(--octo-brand-a25)" : "none",
      }}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
    >
      <Show when={props.hasContent}>
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
                {sessionTitle(props.sessionInfo?.title) ?? "3D 场景"}
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
              <DropdownMenu.Content style={{ "min-width": "104px" }}>
                <DropdownMenu.Item onSelect={() => { setTitleState("menuOpen", false); openTitleEditor() }}>
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
      </Show>

      <Show when={props.hasContent} fallback={
        <div class="flex-1 flex flex-col items-center justify-center min-h-0">
          <ProtoIntroduction />
          <div class="w-full max-w-[800px] px-8">
            <AttachmentBar attachments={props.attachments} onRemove={props.onRemoveAttachment} />
            <ChartInput {...props.inputProps} rows={undefined} />
          </div>
        </div>
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
                          onOpenResult={props.onOpenResult}
                        />
                      )}
                    </For>
                  }
                >
                  <Index each={props.roundMessages}>
                    {(round, ri) => (
                      <>
                        {/* 该轮没有任何消息落库(如:还没产出就中止)→ 用 generation.prompt 补一张用户输入,避免只剩用时 */}
                        <Show when={round().items.length === 0 && props.roundCards[ri]?.prompt}>
                          <UserInputCard text={props.roundCards[ri]?.prompt ?? ""} />
                        </Show>
                        <For each={round().items}>
                          {(item) => (
                            <InsightTurn
                              sessionID={item.sessionID}
                              messageID={item.messageID}
                              status={props.sessionStatus}
                              onOpenResult={props.onOpenResult}
                            />
                          )}
                        </For>
                        <RoundCard
                          generating={props.roundCards[ri]?.generating ?? false}
                          outcome={props.roundCards[ri]?.outcome ?? "completed"}
                          versionId={props.roundCards[ri]?.versionId ?? null}
                          onSwitchScene={props.onSwitchScene}
                          isLatest={ri === props.roundMessages.length - 1}
                          genStartTime={props.genStartTime}
                          startTime={round().startTime}
                          endTime={round().endTime}
                          modelID={round().modelID}
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

function ThreeDDialogDeleteSession(props: { sessionID: string; name: string; onDelete: (id: string) => Promise<void> }): JSX.Element {
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

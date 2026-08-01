import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { DesignSystemPicker } from "./design-system-picker"
import { useLocal } from "@/context/local"
import { createSignal, createEffect, Show, type JSX } from "solid-js"
import "../../assets/style/chat/chart_input.css"
import { tracker } from "@/utils/tracker"
import { ProseMirrorEditor } from "@/pages/make/components/prosemirror-editor"

export type Attachment = {
  id: string
  filename: string
  mime: string
  dataUrl: string
}

type ModelState = ReturnType<typeof useLocal>["model"]

export type ChartInputProps = {
  /** 文本框行数，undefined 时撑满（首页态），数字时固定行数（对话态） */
  rows: number | undefined
  /** 输入框当前值 */
  value: string
  /** 输入值变化回调 */
  onValueChange: (v: string) => void
  /** 键盘事件（Enter 发送） */
  onKeyDown: (e: KeyboardEvent) => void
  /** 是否禁用输入 */
  disabled: boolean
  /** 是否正在生成中 */
  busy: boolean
  /** 提交回调 */
  onSubmit: () => void
  /** 中止生成回调 */
  onHalt: () => void
  /** 当前附件列表 */
  attachments: Attachment[]
  /** 是否已达到附件数量上限 */
  maxAttachments: boolean
  /** 文件选择回调 */
  onFileChange: (e: Event) => void
  /** 当前选中的设计系统 */
  selectedDesignSystem: string
  /** 设计系统选择变化回调 */
  onSelectDesignSystem: (v: string) => void
  /** 首次发送对话后锁定设计系统选择 */
  designSystemLocked?: boolean
  /** 模型选择器状态（来自 useLocal().model） */
  model: ModelState
  /** 模型选择关闭回调 */
  onModelClose?: (cause: string) => void
}

export function ChartInput(props: ChartInputProps): JSX.Element {
  let fileInputRef!: HTMLInputElement
  const [mentionSelections, setMentionSelections] = createSignal<unknown[]>([])
  let editorRef: { clear: () => void } | undefined

  createEffect(() => {
    if (props.value === "" && editorRef) editorRef.clear()
  })

  const isHome = () => props.rows === undefined

  const composerStyle = (): JSX.CSSProperties => {
    const base: Record<string, string> = {
      border: "1px solid transparent",
      background: `
        linear-gradient(var(--octo-surface-page), var(--octo-surface-page)) padding-box,
        linear-gradient(135deg,
          rgba(246, 97, 23, 0.7) 1%,
          rgba(95, 45, 255, 0.7) 8%,
          rgba(61, 93, 255, 0.7) 22%,
          rgba(104, 138, 255, 0.7) 43%,
          rgba(28, 171, 111, 0.7) 54%,
          rgba(61, 93, 255, 0.7) 87%,
          rgba(206, 7, 232, 0.7) 92%) border-box`,
      "box-shadow": "0 0 5px rgba(0, 0, 0, 0.08), 0 0 10px rgba(74, 81, 255, 0.18), 0 0 20px rgba(89, 74, 255, 0.12)",
    }
    if (isHome()) base["min-height"] = "150px"
    return base
  }

  const editor = () => (
    <ProseMirrorEditor
      sessionId=""
      skillConfig={{}}
      artifactFiles={null}
      mentionSelections={mentionSelections() as never}
      setMentionSelections={setMentionSelections as never}
      disabled={props.disabled}
      placeholder="描述你想要的界面，按 Enter 生成页面原型"
      onContentChange={props.onValueChange}
      onSubmit={props.onSubmit}
      ref={(el: { clear: () => void }) => { editorRef = el }}
    />
  )

  return (
    <div
      class={`${isHome() ? "rounded-[24px]" : "rounded-[16px]"} flex flex-col transition-all duration-300 relative group`}
      style={composerStyle()}
    >
      {isHome() ? (
        <div class="flex-1 min-h-0 overflow-hidden rounded-[inherit]">{editor()}</div>
      ) : (
        editor()
      )}
      <div class="flex items-center justify-between px-4 pb-4 relative z-10 overflow-hidden">
        <div class="flex items-center gap-1 min-w-0">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            class="hidden"
            accept="*/*"
            onChange={props.onFileChange}
          />
          <Tooltip placement="top" value="添加附件">
            <Button
              type="button"
              variant="ghost"
              class="size-8 p-0"
              disabled={props.maxAttachments}
              onClick={() => { if (!props.maxAttachments) fileInputRef.click() }}
            >
              <Icon name="plus" class="size-5" />
            </Button>
          </Tooltip>
          <DesignSystemPicker
            selected={props.selectedDesignSystem}
            onSelect={props.onSelectDesignSystem}
            disabled={props.designSystemLocked}
          />
          <ModelSelectorPopover
            model={props.model}
            triggerAs="button"
            triggerProps={{
              class: "flex items-center gap-1.5 min-w-0 bg-[#f3f3f3] hover:bg-[#e8e8e8] active:bg-[#dedede] transition-colors px-3 py-1.5 rounded-full text-[13px] text-gray-800 font-medium group overflow-hidden focus-visible:outline-none",
              "data-action": "prompt-model",
            }}
            onClose={props.onModelClose}
          >
            <span class="truncate">
              {props.model.current()?.name ?? "选择模型"}
            </span>
            <Icon name="chevron-down" class="size-3.5 shrink-0 transition-transform duration-150 group-aria-[expanded=true]:-rotate-180" style="color: #000" />
          </ModelSelectorPopover>
        </div>
        <IconButton
          data-action="prompt-submit"
          type="submit"
          icon={props.busy ? "stop" : "arrow-up"}
          class="size-8 flex-shrink-0"
          onClick={props.busy ? props.onHalt : props.onSubmit}
          disabled={!props.busy && (!props.value.trim() || props.disabled)}
          aria-label={props.busy ? "停止生成" : undefined}
        />
      </div>
    </div>
  )
}

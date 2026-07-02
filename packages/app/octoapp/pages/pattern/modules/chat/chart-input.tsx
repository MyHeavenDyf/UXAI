import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { DesignSystemPicker } from "./design-system-picker"
import { useLocal } from "@/context/local"
import type { JSX } from "solid-js"
import "../../assets/style/chat/chart_input.css"

export type Attachment = {
  id: string
  filename: string
  mime: string
  dataUrl: string
}

type ModelState = ReturnType<typeof useLocal>["model"]

export type ChartInputProps = {
  /** 文本框行数，undefined 时撑满 150px（首页态），数字时固定行数（对话态） */
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
}

export function ChartInput(props: ChartInputProps): JSX.Element {
  let fileInputRef!: HTMLInputElement
  return (
    <div
      class="rounded-[24px]  flex flex-col transition-all duration-300 relative group chat-input-content"
      style={{
        "margin-top": props.attachments.length > 0 ? "6px" : "0",
        ...(props.rows === undefined ? { height: "150px" } : {}),
      }}
    >
      <textarea
        value={props.value}
        onInput={(e) => props.onValueChange(e.currentTarget.value)}
        onKeyDown={props.onKeyDown}
        placeholder="描述你想要的界面，按 Enter 生成页面原型"
        rows={props.rows}
        disabled={props.disabled}
        class="w-full flex-1 resize-none bg-transparent text-14-regular text-text-strong outline-none relative z-10 px-4 pt-3"
        style={{
          "font-family": "var(--octo-font)",
          ...(props.rows === undefined ? { flex: "1", "max-height": "none", "overflow-y": "auto" } : { "max-height": "120px", "overflow-y": "auto" }),
        }}
      />
      <div class="flex items-center justify-between px-4 pb-4 relative z-10 overflow-hidden">
        <div class="flex items-center gap-1 min-w-0">
          <DesignSystemPicker
            selected={props.selectedDesignSystem}
            onSelect={props.onSelectDesignSystem}
            disabled={props.designSystemLocked}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            class="hidden"
            accept="*/*"
            onChange={props.onFileChange}
          />
          {/* <button
            type="button"
            onClick={() => { if (!props.maxAttachments) fileInputRef.click() }}
            disabled={props.maxAttachments}
            class="flex flex-shrink-0 items-center justify-center size-8 rounded-full transition-colors hover:bg-black/5 active:bg-black/10 text-gray-800 hover:text-black disabled:text-gray-400"
            title={props.maxAttachments ? "最多 5 个文件" : "添加附件"}
          >
            <Icon name="plus" class="size-5" />
          </button> */}
          <ModelSelectorPopover
            model={props.model}
            triggerAs="button"
            triggerProps={{
              class: "flex items-center gap-1.5 min-w-0 bg-[#f3f3f3] hover:bg-[#e8e8e8] active:bg-[#dedede] transition-colors px-3 py-1.5 rounded-full text-[13px] text-gray-800 font-medium group overflow-hidden focus-visible:outline-none",
              "data-action": "prompt-model",
            }}
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

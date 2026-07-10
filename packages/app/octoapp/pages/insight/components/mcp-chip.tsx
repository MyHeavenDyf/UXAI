import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import type { JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import type { PresetPrompt } from "../store/preset-prompts"
import type { McpSelection } from "../store/mcp-trigger"

type Props = {
  functions: PresetPrompt[]
  selection: McpSelection | null
  onSelect: (sel: McpSelection) => void
  onClear: () => void
  /** 菜单展开埋点由父层处理 */
  onOpenMenu?: () => void
}

/**
 * MCP 显式入口「研究工具」chip(SPEC-INS-017 §1,视觉对齐设计稿,样式与模型选择器触发钮一致):
 * - 未选中:「研究工具 ˅」点开菜单选功能;菜单不设文件门槛(缺材料由模型在对话里向用户索取)
 * - 选中:替换为高亮胶囊「<功能> ×」;纯常驻——只有手动 × 才取消(范围限制语义,无自动副作用)
 * - 菜单经 Portal 挂 body + fixed 定位:chip 在输入卡片内,卡片 overflow-hidden 会裁掉就地渲染的菜单
 */
export function McpChip(props: Props): JSX.Element {
  const [open, setOpen] = createSignal(false)
  // 菜单 fixed 定位(打开时按触发钮 rect 计算,向上弹出)
  const [menuPos, setMenuPos] = createSignal({ left: 0, bottom: 0 })
  let triggerRef: HTMLButtonElement | undefined
  let menuRef: HTMLDivElement | undefined

  const close = () => setOpen(false)

  onMount(() => {
    const onDocPointerDown = (e: PointerEvent) => {
      if (!open()) return
      const t = e.target as Node
      if (triggerRef?.contains(t) || menuRef?.contains(t)) return
      close()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
    }
    document.addEventListener("pointerdown", onDocPointerDown)
    document.addEventListener("keydown", onKeyDown)
    onCleanup(() => {
      document.removeEventListener("pointerdown", onDocPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    })
  })

  function handleTriggerClick() {
    if (props.selection) {
      // 激活态点击 = 取消(与 GPT/Gemini 工具模式一致:不叉不消)
      props.onClear()
      close()
      return
    }
    const next = !open()
    if (next && triggerRef) {
      const rect = triggerRef.getBoundingClientRect()
      setMenuPos({ left: rect.left, bottom: window.innerHeight - rect.top + 6 })
    }
    setOpen(next)
    if (next) props.onOpenMenu?.()
  }

  function handleFnClick(fn: PresetPrompt) {
    props.onSelect({ preset: fn })
    close()
  }

  return (
    <>
      {/* 样式对齐模型选择器触发钮(同一底栏,同视觉族):灰底胶囊 + 13px + chevron-down */}
      <button
        type="button"
        ref={triggerRef}
        class="flex flex-shrink-0 items-center gap-1.5 transition-colors px-3 py-1.5 rounded-full text-[13px] font-medium group"
        classList={{
          "bg-[#f3f3f3] hover:bg-[#e8e8e8] active:bg-[#dedede] text-gray-800": !props.selection,
          "octo-mcp-chip--active": !!props.selection,
        }}
        onClick={handleTriggerClick}
        title={
          props.selection
            ? `解析模式:需要时将调用「${props.selection.preset.label}」,点击取消`
            : "研究工具:选择功能后转交内网 MCP 解析"
        }
      >
        <Show
          when={props.selection}
          fallback={
            <>
              <span class="truncate">研究工具</span>
              <Icon
                name="chevron-down"
                class="size-3.5 shrink-0 opacity-60 transition-transform duration-200"
                classList={{ "rotate-180": open() }}
              />
            </>
          }
        >
          {(sel) => (
            <>
              <span class="truncate">{sel().preset.label}</span>
              <span class="octo-mcp-chip-x" aria-hidden="true">×</span>
            </>
          )}
        </Show>
      </button>

      <Show when={open()}>
        <Portal>
          <div
            ref={menuRef}
            class="octo-mcp-menu"
            role="menu"
            style={{ left: `${menuPos().left}px`, bottom: `${menuPos().bottom}px` }}
          >
            <For each={props.functions}>
              {(fn) => (
                <button type="button" class="octo-mcp-menu-item" title={fn.text} onClick={() => handleFnClick(fn)}>
                  <span class="octo-mcp-menu-item-label">{fn.label}</span>
                </button>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </>
  )
}

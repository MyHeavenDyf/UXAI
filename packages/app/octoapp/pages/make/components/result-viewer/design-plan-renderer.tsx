import { Button } from "@opencode-ai/ui/button"
import { Show, createEffect, createSignal, on, onCleanup } from "solid-js"
import type { JSX } from "solid-js"
import { IconCardPlan } from "../../icons"
import { Markdown } from "@opencode-ai/ui/markdown"
import Vditor from "vditor"
import "vditor/dist/index.css"
import { useTheme } from "@opencode-ai/ui/theme/context"

// Vditor 资源本地化路径
const VDITOR_LOCAL_CDN = "/vendor/vditor"

/**
 * Renderer for `type="design-plan"` artifacts.
 *
 * Shows the plan as Markdown. Header buttons:
 *   preview mode: [编辑] [调整方案] [确认开始生成]
 *   edit mode:    [取消] [保存]
 *
 * 编辑使用 Vditor Markdown 编辑器。
 */
export function DesignPlanRenderer(props: {
  content: string
  title: string
  artifactIdentifier?: string
  confirmed: boolean
  onConfirm: () => void
  onAdjust: () => void
  onContentChange?: (content: string) => void
  onBackToStrategy?: () => void
}): JSX.Element {
  const theme = useTheme()
  const isDark = () => theme.mode() === "dark"

  const [isEditing, setIsEditing] = createSignal(false)
  // 使用 draft 作为显示内容，保存后立即更新 draft
  const [draft, setDraft] = createSignal(props.content)
  let editorRef: HTMLDivElement | undefined
  let vditorInstance: Vditor | undefined

  // content 更新时同步 draft（仅在非编辑模式）
  createEffect(on(() => props.content, (c) => {
    if (!isEditing()) setDraft(c)
  }))

  const initEditor = () => {
    if (!editorRef) return
    if (vditorInstance) return

    vditorInstance = new Vditor(editorRef, {
      mode: "sv",  // 分屏模式：左侧编辑、右侧预览
      value: draft(),
      theme: isDark() ? "dark" : "classic",
      cdn: VDITOR_LOCAL_CDN,
      cache: { enable: false },
      toolbar: [
        "emoji",
        "headings",
        "bold",
        "italic",
        "strike",
        "link",
        "|",
        "list",
        "ordered-list",
        "check",
        "outdent",
        "indent",
        "|",
        "quote",
        "line",
        "code",
        "inline-code",
        "insert-before",
        "insert-after",
        "|",
        "table",
        "|",
        "undo",
        "redo",
        "|",
        "edit-mode",
        "code-theme",
        "content-theme",
        "outline",
        "preview",
        "export",
      ],
      toolbarConfig: { pin: true },
      preview: {
        theme: { current: isDark() ? "dark" : "light", path: `${VDITOR_LOCAL_CDN}/dist/css/content-theme` },
        hljs: { style: isDark() ? "native" : "github" },
      },
      input: (val) => {
        setDraft(val)
      },
      after: () => {
        // 编辑器初始化完成
      },
    })
  }

  const destroyEditor = () => {
    if (vditorInstance) {
      vditorInstance.destroy()
      vditorInstance = undefined
    }
  }

  const handleSave = () => {
    const value = vditorInstance?.getValue() ?? draft()
    // 先更新本地 draft，确保预览立即显示新内容
    setDraft(value)
    props.onContentChange?.(value)
    setIsEditing(false)
    destroyEditor()
  }

  const handleCancel = () => {
    setDraft(props.content)
    setIsEditing(false)
    destroyEditor()
  }

  const handleEdit = () => {
    setIsEditing(true)
    requestAnimationFrame(() => {
      initEditor()
    })
  }

  // 主题切换
  createEffect(() => {
    const dark = isDark()
    if (!isEditing() || !vditorInstance) return
    vditorInstance.setTheme(dark ? "dark" : "classic", dark ? "dark" : "light", dark ? "native" : "github")
  })

  onCleanup(() => {
    destroyEditor()
  })

  return (
    <div class="flex flex-col h-full overflow-hidden" style={{ background: "var(--octo-surface-page)" }}>
      <div
        class="flex items-center justify-between shrink-0"
        style={{
          padding: "16px 24px",
          "border-bottom": "1px solid rgba(0,0,0,0.06)",
          background: "#fff",
        }}
      >
        <div class="flex items-center gap-2 min-w-0">
          <IconCardPlan size={18} class="shrink-0" />
          <div class="flex flex-col min-w-0">
            <span class="text-[15px] font-semibold truncate" style={{ color: "var(--octo-text-primary)" }}>
              {props.title}
            </span>
            <Show when={props.confirmed}>
              <span class="text-[11px]" style={{ color: "var(--octo-text-tertiary)" }}>
                已确认 · 正在生成 HTML
              </span>
            </Show>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <Show
            when={!isEditing()}
            fallback={
              <>
                <Button variant="ghost" size="small" onClick={handleCancel}>
                  取消
                </Button>
                <Button variant="primary" size="small" onClick={handleSave}>
                  保存
                </Button>
              </>
            }
          >
            <Button variant="ghost" size="small" onClick={handleEdit} disabled={props.confirmed}>
              编辑
            </Button>
            <Button
              variant="ghost"
              size="small"
              onClick={props.onBackToStrategy}
              disabled={props.confirmed}
            >
              上一步
            </Button>
            <Button
              variant="ghost"
              size="small"
              onClick={props.onAdjust}
              disabled={props.confirmed}
            >
              调整方案
            </Button>
            <Button
              variant="primary"
              size="small"
              onClick={props.onConfirm}
              disabled={props.confirmed}
            >
              {props.confirmed ? "已确认" : "确认开始生成"}
            </Button>
          </Show>
        </div>
      </div>
      <div class="flex-1 overflow-hidden" style={{ padding: isEditing() ? "0" : "24px" }}>
        <Show
          when={!isEditing()}
          fallback={
            <div
              ref={editorRef}
              class="w-full h-full"
              style={{
                "border-radius": "8px",
                overflow: "hidden",
              }}
            />
          }
        >
          <div class="overflow-y-auto h-full">
            <div
              class="prose prose-sm max-w-none"
              style={{ color: "var(--octo-text-primary)" }}
            >
              <Markdown text={draft() || "_方案生成中…_"} />
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}

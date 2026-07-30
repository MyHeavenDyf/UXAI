import { Show, createEffect, createSignal, on, onCleanup } from "solid-js"
import type { JSX } from "solid-js"
import { Markdown } from "@opencode-ai/ui/markdown"
import Vditor from "vditor"
import "vditor/dist/index.css"
import { useTheme } from "@opencode-ai/ui/theme/context"

const VDITOR_LOCAL_CDN = "/vendor/vditor"

export function DesignPlanRenderer(props: {
  content: string
  title: string
  artifactIdentifier?: string
  confirmed: boolean
  disabled?: boolean
  onConfirm: () => void
  onContentChange?: (content: string) => void
  onBackToStrategy?: () => void
  currentStep?: number
}): JSX.Element {
  const theme = useTheme()
  const isDark = () => theme.mode() === "dark"

  const [isEditing, setIsEditing] = createSignal(false)
  const [draft, setDraft] = createSignal(props.content)
  let editorRef: HTMLDivElement | undefined
  let vditorInstance: Vditor | undefined

  createEffect(on(() => props.content, (c) => {
    if (!isEditing()) setDraft(c)
  }))

  const autoSave = () => {
    if (vditorInstance) {
      const value = vditorInstance.getValue()
      setDraft(value)
      props.onContentChange?.(value)
    }
  }

  let injectedStyle: HTMLStyleElement | undefined

  const injectStyles = () => {
    if (injectedStyle) return
    injectedStyle = document.createElement("style")
    injectedStyle.id = "plan-editor-custom-styles"
    injectedStyle.textContent = `
      .vditor-sv { background: #f7f7f7 !important; padding: 24px !important; font-size: 14px !important; line-height: 22px !important; }
      .vditor-sv .vditor-reset { background: #f7f7f7 !important; padding: 24px !important; font-size: 14px !important; line-height: 22px !important; color: rgba(0,0,0,0.9) !important; }
      .vditor-sv .vditor-reset * { font-size: 14px !important; line-height: 22px !important; color: rgba(0,0,0,0.9) !important; }
      .vditor-preview { background: #fff !important; padding: 24px !important; }
      .vditor-toolbar.vditor-toolbar--pin { height: 56px !important; padding: 0 24px !important; margin-top: 24px !important; background: #fff !important; display: flex !important; align-items: center !important; gap: 8px !important; border-bottom: none !important; position: relative !important; z-index: 1 !important; }
      .vditor-toolbar__item { width: 32px !important; height: 32px !important; display: flex !important; align-items: center !important; justify-content: center !important; }
      .vditor-toolbar__item .vditor-tooltipped { padding: 0 !important; width: 20px !important; height: 20px !important; }
      .vditor-toolbar__item svg { width: 20px !important; height: 20px !important; color: rgba(0,0,0,0.9) !important; }
      .vditor-toolbar__divider { width: 1px !important; height: 16px !important; background: rgba(0,0,0,0.1) !important; margin: 0 4px !important; }
      .vditor-sv, .vditor-preview { border: none !important; }
    `
    document.head.appendChild(injectedStyle)
  }

  const removeStyles = () => {
    if (injectedStyle) {
      injectedStyle.remove()
      injectedStyle = undefined
    }
  }

  const initEditor = () => {
    if (!editorRef) return
    if (vditorInstance) return
    injectStyles()

    vditorInstance = new Vditor(editorRef, {
      mode: "sv",
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
    })
  }

  const destroyEditor = () => {
    if (vditorInstance) {
      vditorInstance.destroy()
      vditorInstance = undefined
    }
    removeStyles()
  }

  const handlePreview = () => {
    autoSave()
    setIsEditing(false)
    destroyEditor()
  }

  const handleEdit = () => {
    setIsEditing(true)
    requestAnimationFrame(() => {
      initEditor()
    })
  }

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
      {/* Header */}
      <div
        class="flex flex-col shrink-0"
        style={{
          padding: "24px",
          background: "#fff",
        }}
      >
        {/* Step indicator */}
        <div class="flex items-center" style={{ "margin-bottom": "24px" }}>
          <div class="flex items-center gap-[8px]">
            <div
              style={{
                width: "24px",
                height: "24px",
                "border-radius": "999px",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                "font-size": "14px",
                "line-height": "22px",
                background: (props.currentStep ?? 2) === 1 ? "#0a59f7" : "#fff",
                border: (props.currentStep ?? 2) === 1 ? "1px solid #0a59f7" : "1px solid rgba(0,0,0,0.2)",
                color: (props.currentStep ?? 2) === 1 ? "#fff" : "rgba(0,0,0,0.9)",
              }}
            >
              1
            </div>
            <span style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0,0,0,0.9)" }}>
              策略准备
            </span>
          </div>
          <div
            style={{
              width: "120px",
              height: "1px",
              "margin-left": "8px",
              "margin-right": "8px",
              background: "rgba(0,0,0,0.2)",
            }}
          />
          <div class="flex items-center gap-[8px]">
            <div
              style={{
                width: "24px",
                height: "24px",
                "border-radius": "999px",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                "font-size": "14px",
                "line-height": "22px",
                background: (props.currentStep ?? 2) === 2 ? "#0a59f7" : "#fff",
                border: (props.currentStep ?? 2) === 2 ? "1px solid #0a59f7" : "1px solid rgba(0,0,0,0.2)",
                color: (props.currentStep ?? 2) === 2 ? "#fff" : "rgba(0,0,0,0.9)",
              }}
            >
              2
            </div>
            <span style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0,0,0,0.9)" }}>
              策略生成
            </span>
          </div>
        </div>
        {/* Title + Tab */}
        <div class="flex items-center justify-between">
          <span style={{ "font-size": "24px", "line-height": "32px", "font-weight": "bold", color: "rgba(0,0,0,0.9)" }}>
            {props.title}
          </span>
          <div
            style={{
              display: "flex",
              height: "32px",
              padding: "2px",
              "border-radius": "999px",
              background: "rgba(0,0,0,0.05)",
              opacity: props.confirmed || props.disabled ? 0.5 : 1,
            }}
          >
            <button
              type="button"
              style={{
                height: "28px",
                padding: "0 16px",
                "border-radius": "999px",
                "font-size": "14px",
                "line-height": "22px",
                cursor: (props.confirmed || props.disabled) ? "not-allowed" : "pointer",
                border: "none",
                background: !isEditing() ? "#fff" : "transparent",
                color: !isEditing() ? "#0a59f7" : "rgba(0,0,0,0.6)",
                "box-shadow": !isEditing() ? "0 1px 6px 0 rgba(0,0,0,0.08)" : "none",
              }}
              onClick={() => { if (!props.confirmed && !props.disabled) handlePreview() }}
            >
              预览
            </button>
            <button
              type="button"
              style={{
                height: "28px",
                padding: "0 16px",
                "border-radius": "999px",
                "font-size": "14px",
                "line-height": "22px",
                cursor: (props.confirmed || props.disabled) ? "not-allowed" : "pointer",
                border: "none",
                background: isEditing() ? "#fff" : "transparent",
                color: isEditing() ? "#0a59f7" : "rgba(0,0,0,0.6)",
                "box-shadow": isEditing() ? "0 1px 6px 0 rgba(0,0,0,0.08)" : "none",
              }}
              onClick={() => { if (!props.confirmed && !props.disabled) handleEdit() }}
            >
              编辑
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div class="flex-1 overflow-y-auto" style={{ padding: isEditing() ? "0" : "24px" }}>
        <Show
          when={!isEditing()}
          fallback={
            <div
              ref={editorRef}
              id="plan-editor-container"
              class="w-full h-full"
            />
          }
        >
          <div>
            <div
              class="prose prose-sm max-w-none"
              style={{ color: "var(--octo-text-primary)" }}
            >
              <Markdown text={draft() || "_方案生成中…_"} />
            </div>
          </div>
        </Show>
      </div>

      {/* Bottom footer - always visible */}
      <div
        class="flex items-center justify-end shrink-0"
        style={{
          height: "56px",
          padding: "0 24px",
          gap: "8px",
          "border-top": "1px solid rgba(0,0,0,0.1)",
          background: "#fff",
        }}
      >
        <button
          type="button"
          class="text-[14px] rounded-[999px] transition-colors"
          style={{
            height: "32px",
            padding: "0 16px",
            "line-height": "22px",
            background: (props.confirmed || props.disabled) ? "#e0e0e0" : "#f3f3f3",
            color: (props.confirmed || props.disabled) ? "#aaa" : "#191919",
            border: "none",
            cursor: (props.confirmed || props.disabled) ? "not-allowed" : "pointer",
            "pointer-events": (props.confirmed || props.disabled) ? "none" : "auto",
          }}
          onClick={() => { autoSave(); props.onBackToStrategy?.() }}
          disabled={props.confirmed || props.disabled}
        >
          上一步
        </button>
        <button
          type="button"
          class="text-[14px] font-medium rounded-[999px] text-white transition-colors"
          style={{
            height: "32px",
            padding: "0 16px",
            "line-height": "22px",
            background: (props.confirmed || props.disabled) ? "#b0b0b0" : "#0a59f7",
            color: "white",
            border: "none",
            cursor: (props.confirmed || props.disabled) ? "not-allowed" : "pointer",
            "pointer-events": (props.confirmed || props.disabled) ? "none" : "auto",
          }}
          onClick={() => { autoSave(); props.onConfirm?.() }}
          disabled={props.confirmed || props.disabled}
        >
          {props.confirmed ? "已确认" : "策略执行"}
        </button>
      </div>
    </div>
  )
}

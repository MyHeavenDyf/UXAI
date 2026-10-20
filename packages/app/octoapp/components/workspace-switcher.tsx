import { createEffect, createMemo, createSignal, onCleanup, For, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { getFilename } from "@opencode-ai/core/util/path"
import { usePlatform } from "@/context/platform"
import { type WorkspaceKind } from "@/context/server"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { tracker } from "@/utils/tracker"

export function kindOf(project: { kind?: WorkspaceKind } | undefined): WorkspaceKind {
  return project?.kind ?? "normal"
}

interface WorkspaceSwitcherProps {
  value?: string
  onChange: (directory: string) => void
  error?: boolean
}

// 项目目录下拉选择器(内嵌于 DialogProjectOnboarding):
// 展示最近项目 + 原生文件夹选择;点击仅暂存目录(onChange),由外层"确定"按钮统一生效。
export function WorkspaceSwitcher(props: WorkspaceSwitcherProps) {
  const platform = usePlatform()
  const language = useLanguage()
  const layout = useLayout()
  const globalSync = useGlobalSync()

  const [open, setOpen] = createSignal(false)
  const [selecting, setSelecting] = createSignal(false)
  const [pos, setPos] = createSignal({ top: 0, left: 0 })
  let triggerRef: HTMLButtonElement | undefined

  const projects = createMemo(() => layout.projects.list())

  const displayPath = (dir: string) => {
    const home = globalSync.data.path.home
    if (home && dir.startsWith(home)) return "~" + dir.slice(home.length)
    return dir
  }

  function pick(dir: string) {
    setOpen(false)
    if (!dir || dir === props.value) return
    tracker.interaction({
      module: "workspace-switcher",
      name: "select",
      subType: "click",
      extend: JSON.stringify({ dir, from: props.value }),
    })
    props.onChange(dir)
  }

  async function chooseFolder() {
    setOpen(false)
    if (selecting()) return
    setSelecting(true)
    tracker.interaction({ module: "workspace-switcher", name: "choose-folder", subType: "click" })
    try {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: false,
        defaultPath: props.value || undefined,
      })
      if (typeof result === "string" && result) props.onChange(result)
    } finally {
      setSelecting(false)
    }
  }

  createEffect(() => {
    if (!open()) return
    const update = () => {
      if (!triggerRef) return
      const rect = triggerRef.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.left })
    }
    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    onCleanup(() => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
    })
  })

  createEffect(() => {
    if (!open()) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", handler)
    onCleanup(() => document.removeEventListener("keydown", handler))
  })

  return (
    <div class="relative w-full">
      <style>{`
        .octo-ws-menu {
          position: fixed; z-index: 99999;
          display: flex; flex-direction: column; gap: 2px;
          width: 280px; max-height: 340px; overflow-y: auto;
          padding: 4px; background: #ffffff;
          border: 1px solid #E5E7EB; border-radius: 8px;
          box-shadow: 0 4px 12px 0 rgba(0,0,0,0.16);
          animation: octo-ws-pop-in 120ms cubic-bezier(0.23,1,0.32,1);
        }
        @keyframes octo-ws-pop-in { from { opacity: 0; } to { opacity: 1; } }
        .octo-ws-item {
          display: flex; align-items: center; gap: 8px;
          width: 100%; padding: 6px 8px;
          background: transparent; border: none; border-radius: 6px;
          cursor: pointer; text-align: left;
          transition: background 100ms cubic-bezier(0.4,0,0.2,1);
        }
        .octo-ws-item:hover { background: rgba(0,0,0,0.05); }
        .octo-ws-item-active, .octo-ws-item-active:hover {
          background: var(--octo-brand-a8, rgba(10,89,247,0.08));
        }
        .octo-ws-item-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
        .octo-ws-item-name {
          font-size: 14px; line-height: 20px; color: rgba(0,0,0,0.9);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .octo-ws-item-path {
          font-size: 12px; line-height: 16px; color: rgba(0,0,0,0.45);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .octo-ws-check { flex-shrink: 0; color: var(--octo-brand, #0a59f7); }
        .octo-ws-divider { height: 1px; margin: 4px 8px; background: #E5E7EB; flex-shrink: 0; }
        .octo-ws-choose {
          display: flex; align-items: center; gap: 8px;
          padding: 8px; font-size: 14px; line-height: 20px;
          color: rgba(0,0,0,0.9);
        }
      `}</style>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open())}
        disabled={selecting()}
        aria-required="true"
        aria-invalid={props.error}
        aria-describedby="dir-error"
        class="w-full flex items-center gap-2 px-3"
        style={{
          height: "40px",
          border: `1px solid ${props.error ? "var(--octo-danger, #ef4444)" : "var(--octo-border-input, #D1D5DB)"}`,
          "border-radius": "6px",
          background: selecting() ? "var(--octo-surface-disabled, #F3F4F6)" : "transparent",
          cursor: selecting() ? "not-allowed" : "pointer",
          overflow: "hidden",
        }}
      >
        <Show when={props.value} fallback={<span class="text-text-weak text-[14px]">选择文件夹</span>}>
          <span
            class="text-[14px] font-mono text-text-base overflow-hidden truncate"
            style={{
              color: "#191919",
            }}
          >
            {displayPath(props.value ?? "")}
          </span>
        </Show>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10.0034 10"
          fill="none"
          style={{ "flex-shrink": "0", "margin-left": "auto", transform: open() ? "rotate(180deg)" : "none", transition: "transform 0.2s ease" }}
        >
          <path d="M4.64832 7.6045L0.148315 3.10462C-0.0494385 2.90662 -0.0494385 2.59547 0.148315 2.39747C0.346558 2.19953 0.657593 2.19953 0.855347 2.39753L5.00183 6.54383L9.14783 2.39753C9.34607 2.19953 9.6571 2.19953 9.85486 2.39747C10.0531 2.59547 10.0531 2.90662 9.85486 3.10462L5.35535 7.6045C5.25769 7.7021 5.13953 7.75092 5.00183 7.75092C4.86365 7.75092 4.74597 7.7021 4.64832 7.6045Z" fill="rgb(119,119,119)" fill-rule="evenodd" />
        </svg>
      </button>
      <Show when={open()}>
        <Portal>
          <div class="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div class="octo-ws-menu" style={{ top: `${pos().top}px`, left: `${pos().left}px` }}>
            <For each={projects()}>
              {(project) => (
                <button
                  type="button"
                  class="octo-ws-item"
                  classList={{ "octo-ws-item-active": project.worktree === props.value }}
                  onClick={() => pick(project.worktree)}
                >
                  <FileIcon node={{ path: project.worktree, type: "directory" }} plain class="shrink-0 size-4" />
                  <span class="octo-ws-item-text">
                    <span class="octo-ws-item-name">
                      {project.name || getFilename(project.worktree)}
                    </span>
                    <span class="octo-ws-item-path">{displayPath(project.worktree)}</span>
                  </span>
                  <Show when={project.worktree === props.value}>
                    <svg class="octo-ws-check" width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </Show>
                </button>
              )}
            </For>
            <div class="octo-ws-divider" />
            <button type="button" class="octo-ws-item octo-ws-choose" onClick={() => void chooseFolder()}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="shrink-0">
                <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
              <span class="octo-ws-item-name">选择文件夹</span>
            </button>
          </div>
        </Portal>
      </Show>
    </div>
  )
}

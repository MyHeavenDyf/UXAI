import { createEffect, createMemo, createSignal, onCleanup, For, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useLocation, useNavigate } from "@solidjs/router"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { getFilename } from "@opencode-ai/core/util/path"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { usePlatform } from "@/context/platform"
import { useServer, type WorkspaceKind } from "@/context/server"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useProjectDir } from "@/hooks/use-project-dir"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { tracker } from "@/utils/tracker"

export function kindOf(project: { kind?: WorkspaceKind } | undefined): WorkspaceKind {
  return project?.kind ?? "normal"
}

// 顶栏全局 workspace 切换器:insight/make/studio 三页共用。
// 切换动作只做 touch(全局 lastProject)+预热,页面侧由 <Show when={projectDir()} keyed> 重挂响应;
// studio 路由带 :dir 段,需显式跳转到新目录的 studio URL。
export function WorkspaceSwitcher() {
  const platform = usePlatform()
  const server = useServer()
  const language = useLanguage()
  const layout = useLayout()
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const navigate = useNavigate()
  const location = useLocation()
  const projectDir = useProjectDir({ mode: "project" })

  const [open, setOpen] = createSignal(false)
  const [pos, setPos] = createSignal({ top: 0, left: 0 })
  let triggerRef: HTMLButtonElement | undefined

  const projects = createMemo(() => layout.projects.list())
  const currentDir = createMemo(() => projectDir())

  const displayPath = (dir: string) => {
    const home = globalSync.data.path.home
    if (home && dir.startsWith(home)) return "~" + dir.slice(home.length)
    return dir
  }

  function switchWorkspace(dir: string) {
    setOpen(false)
    if (!dir) return
    const existing = projectByDir(dir)
    tracker.interaction({
      module: "workspace-switcher",
      name: "switch",
      subType: "click",
      extend: JSON.stringify({ dir, from: currentDir(), kind: existing ? kindOf(existing) : "code" }),
    })
    if (dir === currentDir() && existing) return
    layout.projects.open(dir)
    server.projects.touch(dir)
    // Ensure project is registered on the server (InstanceMiddleware -> InstanceStore.load)
    void globalSDK.createClient({ directory: dir }).session.list().catch(() => {})
    if (/^\/[^/]+\/studio/.test(location.pathname)) {
      navigate(`/${base64Encode(dir)}/studio`)
    }
  }

  function projectByDir(dir: string) {
    return projects().find((x) => x.worktree === dir)
  }

  async function chooseFolder() {
    setOpen(false)
    tracker.interaction({ module: "workspace-switcher", name: "choose-folder", subType: "click" })
    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog({
        title: language.t("titlebar.workspace.chooseFolder"),
        multiple: false,
        defaultPath: currentDir() || undefined,
      })
      if (typeof result === "string" && result) switchWorkspace(result)
      else if (Array.isArray(result) && result[0]) switchWorkspace(result[0])
      return
    }
    dialog.show(
      () => (
        <DialogSelectDirectory
          multiple={false}
          onSelect={(result) => {
            if (typeof result === "string" && result) switchWorkspace(result)
          }}
        />
      ),
      () => {},
    )
  }

  createEffect(() => {
    if (!open()) return
    const update = () => {
      if (!triggerRef) return
      const rect = triggerRef.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.right })
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
    <div class="relative shrink-0">
      <style>{`
        .octo-ws-trigger {
          display: inline-flex; align-items: center; gap: 6px;
          height: 28px; max-width: 200px; padding: 0 6px;
          background: transparent; border: none; border-radius: 6px;
          color: #191919; font-size: 14px; line-height: 22px;
          cursor: pointer;
          transition: background 100ms cubic-bezier(0.4,0,0.2,1);
        }
        .octo-ws-trigger:hover { background: rgba(0,0,0,0.05); }
        .octo-ws-trigger .octo-ws-label {
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .octo-ws-trigger > svg { flex-shrink: 0; }
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
        class={`octo-ws-trigger ${open() ? "octo-ws-trigger-open" : ""}`}
        onClick={() => setOpen(!open())}
      >
        <FileIcon node={{ path: currentDir() || "/", type: "directory" }} class="shrink-0 size-4" />
        <span class="octo-ws-label">
          {currentDir() ? getFilename(currentDir()) : language.t("titlebar.workspace.select")}
        </span>
        <svg width="12" height="12" viewBox="0 0 10 10" style={{ transform: open() ? "rotate(180deg)" : "none", transition: "transform 0.2s ease" }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <Show when={open()}>
        <Portal>
          <div class="fixed inset-0 z-[40]" onClick={() => setOpen(false)} />
          <div class="octo-ws-menu" style={{ top: `${pos().top}px`, left: `${pos().left}px`, transform: "translateX(-100%)" }}>
            <For each={projects()}>
              {(project) => (
                <button
                  type="button"
                  class="octo-ws-item"
                  classList={{ "octo-ws-item-active": project.worktree === currentDir() }}
                  onClick={() => switchWorkspace(project.worktree)}
                >
                  <FileIcon node={{ path: project.worktree, type: "directory" }} class="shrink-0 size-4" />
                  <span class="octo-ws-item-text">
                    <span class="octo-ws-item-name">
                      {project.name || getFilename(project.worktree)}
                    </span>
                    <span class="octo-ws-item-path">{displayPath(project.worktree)}</span>
                  </span>
                  <Show when={project.worktree === currentDir()}>
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
              <span class="octo-ws-item-name">{language.t("titlebar.workspace.chooseFolder")}</span>
            </button>
          </div>
        </Portal>
      </Show>
    </div>
  )
}

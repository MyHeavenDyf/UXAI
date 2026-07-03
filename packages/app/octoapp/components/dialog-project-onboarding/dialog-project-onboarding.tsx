import { Splash } from "@opencode-ai/ui/logo"
import { usePlatform } from "@/context/platform"
import { useGlobalSync } from "@/context/global-sync"
import { useServer } from "@/context/server"
import { useLanguage } from "@/context/language"
import { ProjectInfoDialogContent } from "./project-info-dialog-content"
import { createStore } from "solid-js/store"
import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { isValidUserPath } from "@/utils/path-valid"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLayout } from "@/context/layout"
import { tracker } from "@/utils/tracker"
import type { Domain, ProductLine, Product, Version } from "@/network/types"

interface DialogProjectOnboardingProps {
  onSelect: (data: { directory: string; domain?: Domain; productLine?: ProductLine; product?: Product; version?: Version }) => void
}

export function DialogProjectOnboarding(props: DialogProjectOnboardingProps) {
  const platform = usePlatform()
  const globalSync = useGlobalSync()
  const server = useServer()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const layout = useLayout()

  const initialDirectory = createMemo(() => {
    if (!server.ready()) return ""
    
    const last = server.projects.last()
    if (isValidUserPath(last)) return last
    
    const recent = globalSync.data.project
      .slice()
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
    const recentPath = recent[0]?.worktree
    if (isValidUserPath(recentPath)) return recentPath
    
    return ""
  })

  const lastSelection = server.projects.lastSelection()

  const [selections, setSelections] = createStore({
    domain: lastSelection?.domain,
    productLine: lastSelection?.productLine,
    product: lastSelection?.product,
    version: lastSelection?.version,
  })

  const [directory, setDirectory] = createSignal<string>("")
  const [selecting, setSelecting] = createSignal(false)

  createEffect(() => {
    const init = initialDirectory()
    if (init && !directory()) {
      setDirectory(init)
    }
  })

  const displayPath = createMemo(() => {
    const dir = directory()
    if (!dir) return ""
    const home = globalSync.data.path.home
    if (home && dir.startsWith(home)) {
      return "~" + dir.slice(home.length)
    }
    return dir
  })

  async function handlePickDirectory() {
    if (selecting()) return
    setSelecting(true)
    try {
      const home = globalSync.data.path.home
      const defaultPath = isValidUserPath(directory()) 
        ? directory() 
        : (isValidUserPath(home) ? home : undefined)
      
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: false,
        defaultPath,
      })
      if (typeof result === "string" && result) {
        setDirectory(result)
      }
    } finally {
      setSelecting(false)
    }
  }

  function handleConfirm() {
    const dir = directory()
    if (!dir) return
    tracker.interaction({
      module: "project-onboarding",
      name: "confirm",
      subType: "click",
      extend: JSON.stringify({
        domain: selections.domain,
        productLine: selections.productLine,
        product: selections.product,
        version: selections.version,
        dir
      }),
    })
    layout.projects.open(dir)
    server.projects.touch(dir)
    void globalSDK.createClient({ directory: dir }).session.list().catch(() => {})
    server.projects.saveSelection({
      domain: selections.domain,
      productLine: selections.productLine,
      product: selections.product,
      version: selections.version,
    })
    props.onSelect({
      directory: dir,
      domain: selections.domain,
      productLine: selections.productLine,
      product: selections.product,
      version: selections.version,
    })
  }

  const hasDirectory = createMemo(() => directory().length > 0)

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0, 0, 0, 0.5)" }}
    >
      <div
        class="flex flex-col items-center"
        style={{
          width: "400px",
          background: "white",
          "border-radius": "8px",
          padding: "40px 32px 32px 32px",
          "box-shadow": "0 4px 24px rgba(0, 0, 0, 0.15)",
          overflow: "visible",
        }}
      >
        <Splash class="w-[80px] h-[80px]" />
        <img src="/octo-agent.png" alt="Octo Agent" style={{ width: "212px", height: "42px", "margin-top": "20px" }} />
        <div style={{ "font-weight": 500, "font-size": "16px", "line-height": "24px", "letter-spacing": "2px", "text-align": "center", color: "rgba(110, 115, 122, 1)", "margin-top": "4px" }}>您的全能设计与调研专家</div>
        <div style={{ "font-weight": 500, "font-size": "16px", "line-height": "19px", "text-align": "left", "margin-top": "40px", width: "100%", color: "rgba(0,0,0,0.3)" }}>选择项目&版本</div>
        <div style={{ width: "100%", height: "40px", "margin-top": "4px" }}>
          <ProjectInfoDialogContent
            domain={selections.domain}
            productLine={selections.productLine}
            product={selections.product}
            version={selections.version}
            disabled
            onSelectionChange={(data) => {
              setSelections("domain", data.domain)
              setSelections("productLine", data.productLine)
              setSelections("product", data.product)
              setSelections("version", data.version)
            }}
          />
        </div>
        <div style={{ "font-weight": 500, "font-size": "16px", "line-height": "19px", "text-align": "left", "margin-top": "16px", width: "100%", color: "#191919" }}>关联本地文件夹</div>

        <button
          type="button"
          onClick={handlePickDirectory}
          disabled={selecting()}
          class="w-full mb-5 flex items-center gap-2 px-3"
          style={{
            height: "40px",
            "margin-top": "4px",
            border: "1px solid var(--octo-border-input, #D1D5DB)",
            "border-radius": "6px",
            background: selecting() ? "var(--octo-surface-disabled, #F3F4F6)" : "transparent",
            cursor: selecting() ? "not-allowed" : "pointer",
            overflow: "hidden",
          }}
        >
          <Show when={displayPath()} fallback={<span class="text-text-weak text-[14px]">选择文件夹</span>}>
            <span
              class="text-[14px] font-mono text-text-base overflow-hidden truncate"
              style={{
                color: "#191919"
              }}
            >
              {displayPath()}
            </span>
          </Show>
          <svg width="10" height="10" viewBox="0 0 10.0034 10" fill="none" style={{ "flex-shrink": "0", "margin-left": "auto" }}>
            <path d="M4.64832 7.6045L0.148315 3.10462C-0.0494385 2.90662 -0.0494385 2.59547 0.148315 2.39747C0.346558 2.19953 0.657593 2.19953 0.855347 2.39753L5.00183 6.54383L9.14783 2.39753C9.34607 2.19953 9.6571 2.19953 9.85486 2.39747C10.0531 2.59547 10.0531 2.90662 9.85486 3.10462L5.35535 7.6045C5.25769 7.7021 5.13953 7.75092 5.00183 7.75092C4.86365 7.75092 4.74597 7.7021 4.64832 7.6045Z" fill="rgb(119,119,119)" fill-rule="evenodd" />
          </svg>
        </button>

        <button
          type="button"
          onClick={handleConfirm}
          disabled={!hasDirectory()}
          class="w-full h-[40px] rounded-md text-[14px] font-medium text-white"
          style={{
            background: hasDirectory() ? "#0a59f7" : "var(--octo-surface-disabled, #D1D5DB)",
            cursor: hasDirectory() ? "pointer" : "not-allowed",
            color: "#fff",
          }}
        >
          确定
        </button>
      </div>
    </div>
  )
}
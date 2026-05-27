import { Splash } from "@opencode-ai/ui/logo"
import { usePlatform } from "@/context/platform"
import { useGlobalSync } from "@/context/global-sync"
import { useServer } from "@/context/server"
import { useLanguage } from "@/context/language"
import { createEffect, createMemo, createSignal, Show } from "solid-js"

interface DialogProjectOnboardingProps {
  onSelect: (directory: string) => void
}

export function DialogProjectOnboarding(props: DialogProjectOnboardingProps) {
  const platform = usePlatform()
  const globalSync = useGlobalSync()
  const server = useServer()
  const language = useLanguage()

  const initialDirectory = createMemo(() => {
    if (!server.ready()) return ""
    const last = server.projects.last()
    if (last && last !== "/" && !/^[A-Z]:\\?$/.test(last)) return last
    const recent = globalSync.data.project
      .slice()
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
    return recent[0]?.worktree ?? ""
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
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: false,
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
    props.onSelect(dir)
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
          height: "520px",
          background: "white",
          "border-radius": "8px",
          padding: "40px",
          "box-shadow": "0 4px 24px rgba(0, 0, 0, 0.15)",
        }}
      >
        <Splash class="w-[80px] h-[100px] mb-5" />

        <div class="text-center mb-5 text-[16px] font-medium text-text-strong">
          关联本地文件夹
        </div>

        <button
          type="button"
          onClick={handlePickDirectory}
          disabled={selecting()}
          class="w-full mb-5 flex items-center gap-2 px-3"
          style={{
            height: "36px",
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
            >
              {displayPath()}
            </span>
          </Show>
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
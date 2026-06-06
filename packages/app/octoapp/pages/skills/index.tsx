import { createSignal, createMemo, For, onMount, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useServer } from "@/context/server"
import { showToast } from "@opencode-ai/ui/toast"

type SkillConfigEntry = { description?: string; import?: boolean; type?: string }
type SkillsConfig = Record<string, SkillConfigEntry>

const AGENT_INFO: Record<string, { label: string; subtitle: string }> = {
  octo_insight: { label: "Octo Insight", subtitle: "用户研究" },
  octo_make: { label: "Octo Make", subtitle: "原型生成" },
  octo_design: { label: "Octo Design", subtitle: "UI 设计" },
  octo_studio: { label: "Octo Studio", subtitle: "图片创作" },
  common: { label: "公共技能", subtitle: "适用于所有 Agent" },
}

function Toggle(props: { checked: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      onClick={() => props.onChange(!props.checked)}
      class="relative inline-flex h-[24px] w-[44px] shrink-0 cursor-pointer rounded-full transition-colors"
      style={{
        background: props.checked ? "#0A59F7" : "rgba(0,0,0,0.05)",
      }}
    >
      <span
        class="absolute top-[2px] left-0 inline-block h-[20px] w-[20px] rounded-full bg-white transition-transform duration-200"
        style={{
          transform: props.checked ? "translateX(22px)" : "translateX(1px)",
          "background": "#fff",
          "box-shadow": "0 2px 4px rgba(0,0,0,0.2)",
        }}
      />
    </button>
  )
}

function SkillRow(props: {
  name: string
  description: string
  enabled: boolean
  onToggle: (v: boolean) => void
}): JSX.Element {
  return (
    <div
      class="flex items-center justify-between gap-3 px-4 py-3 rounded-lg transition-colors"
      style={{ background: "#fff" }}
    >
      <div class="flex flex-col gap-0.5 min-w-0 flex-1">
        <span class="text-sm font-medium" style={{ color: "var(--octo-text-primary)" }}>{props.name}</span>
        <span class="text-xs" style={{ color: "var(--octo-text-secondary)" }}>{props.description}</span>
      </div>
      <Toggle checked={props.enabled} onChange={props.onToggle} />
    </div>
  )
}

function ChevronIcon(props: { collapsed: boolean }): JSX.Element {
  return (
    <svg
      width="12" height="12" viewBox="0 0 12 12" fill="none"
      style={{
        transform: props.collapsed ? "rotate(0deg)" : "rotate(90deg)",
        transition: "transform 200ms cubic-bezier(0.4,0,0.2,1)",
        "flex-shrink": "0",
      }}
    >
      <path d="M4.5 2.5L7.5 6L4.5 9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

export default function SkillsPage(): JSX.Element {
  const server = useServer()
  const [config, setConfig] = createSignal<SkillsConfig>({})
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({})
  const [loaded, setLoaded] = createSignal(false)

  const groupedSkills = createMemo(() => {
    const cfg = config()
    const groups: Record<string, { skills: string[]; label: string; subtitle: string }> = {}

    for (const [name, entry] of Object.entries(cfg)) {
      const type = entry.type || "common"
      if (!groups[type]) {
        groups[type] = {
          skills: [],
          label: AGENT_INFO[type]?.label || type,
          subtitle: AGENT_INFO[type]?.subtitle || "",
        }
      }
      groups[type].skills.push(name)
    }

    return groups
  })

  async function loadConfig() {
    const api = (window as unknown as { api?: { getSkillsConfig?: () => Promise<SkillsConfig> } }).api
    if (api?.getSkillsConfig) {
      try {
        const data = await api.getSkillsConfig()
        setConfig(data)
      } catch (err) {
        console.error("[SkillsPage] getSkillsConfig failed", err)
      }
    }
    setLoaded(true)
  }

  // Reload config when page becomes visible (user returns from file explorer)
  function handleVisibilityChange() {
    if (document.visibilityState === "visible") {
      loadConfig()
    }
  }

  onMount(() => {
    loadConfig()
    document.addEventListener("visibilitychange", handleVisibilityChange)
  })

  onCleanup(() => {
    document.removeEventListener("visibilitychange", handleVisibilityChange)
  })

  function toggleSkill(skillName: string, value: boolean) {
    const updated = { ...config(), [skillName]: { ...config()[skillName], import: value } }
    setConfig(updated)
    const api = (window as unknown as { api?: { setSkillsConfig?: (c: SkillsConfig) => Promise<void> } }).api
    api?.setSkillsConfig?.(updated)?.then?.(() => {
      // Invalidate opencode skill cache so next session picks up the change
      const url = server.current?.http?.url
      if (url) fetch(`${url}/skill/refresh`, { method: "POST" }).catch(() => {})
    })?.catch?.((err: unknown) => {
      console.error("[SkillsPage] setSkillsConfig failed", err)
      setConfig(config())
    })
  }

  function toggleGroup(type: string) {
    setCollapsed((prev) => ({ ...prev, [type]: !prev[type] }))
  }

  function handleOpenFolder() {
    const api = (window as unknown as { api?: { openSkillFolder?: () => Promise<void> } }).api
    api?.openSkillFolder?.()
  }

  async function handleAddSkill() {
    const api = (window as unknown as {
      api?: {
        openDirectoryPicker?: (opts?: { title?: string }) => Promise<string | null>
        addSkill?: (sourcePath: string) => Promise<{ success: boolean; skillName?: string; error?: string }>
      }
    }).api
    const selected = await api?.openDirectoryPicker?.({ title: "选择技能文件夹（包含 SKILL.md）" })
    if (!selected) return
    const result = await api?.addSkill?.(selected)
    if (result?.success) {
      showToast({ variant: "success", icon: "circle-check", title: "添加成功", description: `已添加技能：${result.skillName ?? ""}` })
    } else if (result?.error) {
      showToast({ variant: "error", icon: "circle-x", title: "添加失败", description: result.error })
    }
    await loadConfig()
    const url = server.current?.http?.url
    if (url) await fetch(`${url}/skill/refresh`, { method: "POST" }).catch(() => {})
  }

  return (
    <div class="h-full overflow-y-auto" style={{ background: "var(--octo-shell-bg)" }}>
      <div class="max-w-[640px] mx-auto px-6 py-6 flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <div class="flex flex-col gap-1">
            <h1 class="text-lg font-semibold" style={{ color: "var(--octo-text-primary)" }}>技能库</h1>
            <p class="text-xs" style={{ color: "var(--octo-text-secondary)" }}>管理各 Agent 的技能</p>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenFolder}
              class="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
              style={{ background: "rgba(0,0,0,0.06)", color: "var(--octo-text-secondary)" }}
            >
              打开文件夹
            </button>
            <button
              type="button"
              onClick={handleAddSkill}
              class="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors hover:bg-blue-600"
              style={{ background: "#0A59F7", color: "#fff" }}
            >
              + 添加技能
            </button>
          </div>
        </div>

        <Show when={!loaded()}>
          <div class="flex flex-col gap-3">
            <div class="h-[60px] rounded-lg animate-pulse" style={{ background: "rgba(0,0,0,0.06)" }} />
            <div class="h-[60px] rounded-lg animate-pulse" style={{ background: "rgba(0,0,0,0.06)" }} />
            <div class="h-[60px] rounded-lg animate-pulse" style={{ background: "rgba(0,0,0,0.06)" }} />
            <div class="h-[60px] rounded-lg animate-pulse" style={{ background: "rgba(0,0,0,0.06)" }} />
          </div>
        </Show>

        <Show when={loaded()}>
          <Show when={Object.keys(groupedSkills()).length === 0}>
            <div class="flex flex-col items-center justify-center py-12 text-center">
              <p class="text-sm" style={{ color: "var(--octo-text-secondary)" }}>暂无已启用的技能</p>
              <p class="text-xs mt-2" style={{ color: "var(--octo-text-tertiary)" }}>点击"添加技能"打开技能文件夹，将包含 SKILL.md 的文件夹放入即可</p>
            </div>
          </Show>
          <For each={Object.entries(groupedSkills())}>
            {(entry) => {
              const type = entry[0]
              const group = entry[1]
              const isCollapsed = () => collapsed()[type] ?? false
              return (
                <div class="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => toggleGroup(type)}
                    class="flex items-center gap-2 px-2 py-1.5 text-left transition-colors rounded-md hover:bg-black/5"
                    style={{ color: "var(--octo-text-tertiary, #364153)" }}
                  >
                    <ChevronIcon collapsed={isCollapsed()} />
                    <span class="text-[13px] font-medium">{group.label}</span>
                    <span class="text-[12px]" style={{ color: "var(--octo-text-secondary)" }}>({group.subtitle})</span>
                  </button>
                  <Show when={!isCollapsed()}>
                    <div class="flex flex-col gap-1.5 pl-5">
                      <For each={group.skills}>
                        {(skillName) => (
                          <SkillRow
                            name={skillName}
                            description={config()[skillName]?.description ?? ""}
                            enabled={config()[skillName]?.import !== false}
                            onToggle={(v) => toggleSkill(skillName, v)}
                          />
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )
            }}
          </For>
        </Show>
      </div>
    </div>
  )
}
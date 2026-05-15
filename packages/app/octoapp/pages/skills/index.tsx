import { createSignal, For, onMount, Show } from "solid-js"
import type { JSX } from "solid-js"

type SkillConfigEntry = { description?: string; import?: boolean }
type SkillsConfig = Record<string, SkillConfigEntry>

const AGENT_GROUPS = [
  { agent: "octo_insight", label: "Octo Insight", subtitle: "用户研究", skills: ["interview-analysis"] },
  { agent: "octo_make", label: "Octo Make", subtitle: "原型生成", skills: ["html-prototype"] },
  { agent: "octo_design", label: "Octo Design", subtitle: "UI 设计", skills: ["design-basics"] },
  { agent: "octo_canva", label: "Octo Canva", subtitle: "创意生成", skills: ["creative-assets"] },
]

function Toggle(props: { checked: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      onClick={() => props.onChange(!props.checked)}
      class="relative inline-flex h-[20px] w-[36px] shrink-0 cursor-pointer rounded-full transition-colors"
      style={{
        background: props.checked ? "var(--octo-brand, #0067D1)" : "rgba(0,0,0,0.15)",
      }}
    >
      <span
        class="inline-block h-[16px] w-[16px] rounded-full bg-white transition-transform"
        style={{
          transform: props.checked ? "translateX(18px)" : "translateX(2px)",
          "margin-top": "2px",
          "box-shadow": "0 1px 3px rgba(0,0,0,0.2)",
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
      style={{ background: "var(--octo-surface-page)" }}
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
  const [config, setConfig] = createSignal<SkillsConfig>({})
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({})
  const [loaded, setLoaded] = createSignal(false)

  onMount(async () => {
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
  })

  function toggleSkill(skillName: string, value: boolean) {
    const updated = { ...config(), [skillName]: { ...config()[skillName], import: value } }
    setConfig(updated)
    const api = (window as unknown as { api?: { setSkillsConfig?: (c: SkillsConfig) => Promise<void> } }).api
    api?.setSkillsConfig?.(updated)?.catch?.((err: unknown) => {
      console.error("[SkillsPage] setSkillsConfig failed", err)
      setConfig(config()) // revert optimistic update
    })
  }

  function toggleGroup(agent: string) {
    setCollapsed((prev) => ({ ...prev, [agent]: !prev[agent] }))
  }

  return (
    <div class="h-full overflow-y-auto" style={{ background: "var(--octo-shell-bg)" }}>
      <div class="max-w-[640px] mx-auto px-6 py-6 flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <h1 class="text-lg font-semibold" style={{ color: "var(--octo-text-primary)" }}>技能库</h1>
          <p class="text-xs" style={{ color: "var(--octo-text-secondary)" }}>管理各 Agent 的内置技能</p>
        </div>

        <Show when={!loaded()}>
          <div class="flex flex-col gap-3">
            <For each={AGENT_GROUPS}>
              {() => (
                <div class="h-[60px] rounded-lg animate-pulse" style={{ background: "rgba(0,0,0,0.06)" }} />
              )}
            </For>
          </div>
        </Show>

        <Show when={loaded()}>
          <For each={AGENT_GROUPS}>
            {(group) => {
              const isCollapsed = () => collapsed()[group.agent] ?? false
              return (
                <div class="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.agent)}
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

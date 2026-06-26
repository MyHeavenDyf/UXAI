import type { JSX } from "solid-js"

export type TabKey = "fullpage" | "pattern"

export type ProtoTabSwitcherProps = {
  activeTab: TabKey
  onChange: (tab: TabKey) => void
}

const TAB_ITEMS: { key: TabKey; label: string }[] = [
  { key: "fullpage", label: "完整页面" },
  { key: "pattern", label: "Pattern" },
]

export function ProtoTabSwitcher(props: ProtoTabSwitcherProps): JSX.Element {
  return (
    <div class="flex items-center rounded-full bg-[rgba(0,0,0,0.05)] gap-1 p-[2px]" role="tablist">
      {TAB_ITEMS.map((item) => (
        <button
          role="tab"
          aria-selected={props.activeTab === item.key}
          classList={{
            "flex items-center justify-center gap-1 rounded-full transition-colors": true,
            "w-[106px] h-[28px]": true,
            "text-14-regular": true,
            "bg-[#FFFFFF] text-[rgba(10,89,247,1)]": props.activeTab === item.key,
            "text-text-weak hover:text-text-base cursor-pointer": props.activeTab !== item.key,
          }}
          onClick={() => props.onChange(item.key)}
        >
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}

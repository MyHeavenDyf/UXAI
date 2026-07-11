import { createSignal, Show } from "solid-js"
import type { JSX } from "solid-js"

function SearchIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="5" stroke="rgba(0,0,0,0.3)" stroke-width="1.5" />
      <path d="M11 11L14 14" stroke="rgba(0,0,0,0.3)" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}

function ClearIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M4 4L12 12M12 4L4 12" stroke="rgba(0,0,0,0.4)" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}

export function SearchBox(): JSX.Element {
  const [keyword, setKeyword] = createSignal("")

  return (
    <div class="relative" style={{ width: "200px" }}>
      <input
        type="text"
        value={keyword()}
        onInput={(e) => setKeyword(e.currentTarget.value)}
        placeholder="搜索资产"
        class="w-full text-sm rounded-[6px] outline-none"
        style={{
          height: "32px",
          padding: "0 32px 0 10px",
          background: "rgba(0,0,0,0.02)",
          border: "1px solid rgba(0,0,0,0.1)",
        }}
      />
      <Show
        when={keyword()}
        fallback={
          <span
            class="absolute"
            style={{ right: "8px", top: "50%", transform: "translateY(-50%)", "pointer-events": "none" }}
          >
            <SearchIcon />
          </span>
        }
      >
        <button
          type="button"
          onClick={() => setKeyword("")}
          class="absolute"
          style={{ right: "8px", top: "50%", transform: "translateY(-50%)", cursor: "pointer", background: "transparent", border: "none", padding: "0" }}
        >
          <ClearIcon />
        </button>
      </Show>
    </div>
  )
}

import { For, Show } from "solid-js"
import type { Component, JSX } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { decode64 } from "@/utils/base64"
import { useLayout } from "@/context/layout"
import { useProjectDir } from "@/hooks/use-project-dir"
import {
  OctoLogo, IconSearch,
} from "./icons"

type TabDef = {
  label: string
  href: string
  icon: string
}

const TABS: TabDef[] = [
  { label: "Chat", href: "/chat", icon: "/IconChat.svg" },
  { label: "Cowork", href: "/insight", icon: "/IconCowork.svg" },
  { label: "Make", href: "/make", icon: "/makeTab.svg" },
  { label: "Studio", href: "/studio", icon: "/IconStudio.svg" },
]

const TRAFFIC_LIGHT_INSET = 80

export function OctoTopbar(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const layout = useLayout()
  const projectDir = useProjectDir({ mode: "project" })

  const getConfigDirSlug = () => {
    const dir = projectDir()
    return dir ? base64Encode(dir) : undefined
  }

  const activeHref = () => {
    const p = location.pathname
    if (p === "/" || p.startsWith("/chat")) return "/chat"
    if (p.startsWith("/studio")) return "/studio"
    if (p.startsWith("/make")) return "/make"
    return "/insight"
  }

  const tabIndex = () => Math.max(0, TABS.findIndex((t) => t.href === activeHref()))

  return (
    <div
      class="h-[64px] shrink-0 flex items-center gap-[16px]"
      style={{
        background: "rgba(255, 255, 255, 0.72)",
        "backdrop-filter": "blur(20px)",
        "-webkit-backdrop-filter": "blur(20px)",
        "border-bottom": "1px solid var(--border-weak-base)",
        "-webkit-app-region": "drag",
        "padding-left": `${TRAFFIC_LIGHT_INSET}px`,
        "padding-right": "24px",
      }}
    >
      <div
        class="flex items-center gap-[8px] shrink-0"
        style={{ "min-width": "160px", "-webkit-app-region": "no-drag" }}
      >
        <img src="/OctoLogo.svg" alt="" style={{ width: "24px", height: "24px" }} />
        <span class="font-semibold text-[17px] text-[#191919] leading-none select-none">Octo AI</span>
      </div>

      <div
        class="flex-1 flex justify-center"
        style={{ "-webkit-app-region": "no-drag" }}
      >
        <div
          class="relative flex items-center rounded-[10px] p-[3px]"
          style={{ background: "rgba(0, 0, 0, 0.07)" }}
        >
          <div
            class="absolute top-[3px] bottom-[3px] rounded-[7px]"
            style={{
              background: "#ffffff",
              left: "3px",
              width: `calc((100% - 6px) / ${TABS.length})`,
              transform: `translateX(${tabIndex() * 100}%)`,
              "box-shadow": "0 1px 4px rgba(0,0,0,0.14)",
              transition: "transform 250ms cubic-bezier(0.34, 1.2, 0.64, 1)",
            }}
          />
          <For each={TABS}>
            {(tab) => {
              const isActive = () => activeHref() === tab.href
              return (
                <button
                  type="button"
                  onClick={() => {
                    if (tab.href === "/insight") {
                      const cowork = layout.lastSessionPerTab.cowork()
                      if (cowork?.id) {
                        navigate(`/insight/${cowork.id}`)
                      } else {
                        navigate("/insight")
                      }
                    } else if (tab.href === "/chat") {
                      const dir = getConfigDirSlug()
                      if (!dir) return
                      const decoded = decode64(dir)
                      const sessionId = decoded ? layout.lastSessionPerTab.chat(decoded) : undefined
                      if (sessionId) {
                        navigate(`/${dir}/chat/${sessionId}`)
                      } else {
                        navigate(`/${dir}/chat`)
                      }
                    } else if (tab.href === "/studio") {
                      const dir = getConfigDirSlug()
                      if (!dir) return
                      const decoded = decode64(dir)
                      const sessionId = decoded ? layout.lastSessionPerTab.studio(decoded) : undefined
                      if (sessionId) {
                        navigate(`/${dir}/studio/${sessionId}`)
                      } else {
                        navigate(`/${dir}/studio`)
                      }
                    }
                  }}
                  class="relative z-10 flex-1 px-[22px] py-[5px] text-[13px] font-medium leading-none select-none rounded-[7px] transition-colors flex items-center justify-center gap-[6px]"
                  style={{ color: isActive() ? "#0A59F7" : "#666" }}
                >
                  {tab.label}
                </button>
              )
            }}
          </For>
        </div>
      </div>

      <div
        class="flex items-center gap-[10px] shrink-0"
        style={{ "min-width": "200px", "justify-content": "flex-end", "-webkit-app-region": "no-drag" }}
      >
        <button
          type="button"
          aria-label="搜索对话和文件"
          class="flex items-center justify-center rounded-[6px] transition-colors hover:bg-black/[0.06] active:bg-black/[0.10]"
          style={{ width: "32px", height: "32px" }}
        >
          <IconSearch size={20} />
        </button>
        <img src="/AvatarUser.svg" alt="" style={{ width: "28px", height: "28px", "border-radius": "50%" }} />
      </div>
    </div>
  )
}

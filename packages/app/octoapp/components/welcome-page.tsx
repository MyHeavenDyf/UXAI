import { createSignal, For, onMount, Show } from "solid-js"
import { usePlatform } from "@/context/platform"

type FeatureCard = {
  title: string
  titleColor: string
  description: string
  tags: string[]
  previewImage: string
}

const features: FeatureCard[] = [
  {
    title: "Chat",
    titleColor: "#6135C5",
    description: "处理日常通用任务，快问快答\n灵感对话，skill生成",
    tags: ["灵感对话", "表格分析", "skill生成"],
    previewImage: "/welcomepage/chat.png",
  },
  {
    title: "Insight",
    titleColor: "#1856CC",
    description: "AI辅助UX用户洞察研究助手，\n用研活动效率提升",
    tags: ["访谈观点解析", "竞品分析", "观点聚类"],
    previewImage: "/welcomepage/insight.png",
  },
  {
    title: "Design",
    titleColor: "#8A4305",
    description: "AI辅助UX设计原型生成助手，\n基于规范&内部资产生成原型",
    tags: ["原型生成", "开发传递", "开发传递"],
    previewImage: "/welcomepage/design.png",
  },
    {
    title: "Prototype",
    titleColor: "#CB2578",
    description: "引用开发组件拼搭页面，可开\n发交付（当前仅支持ICT领域）",
    tags: ["代码原型生成"],
    previewImage: "/welcomepage/prototype.png",
  },
  {
    title: "Studio",
    titleColor: "#05743C",
    description: "AI辅助数字内容生成助手，多\n模态创作赋能设计",
    tags: ["图片生成", "视频生成", "智能重绘"],
    previewImage: "/welcomepage/studio.png",
  },
]

export function WelcomePage(props: { onComplete: () => void }) {
  const platform = usePlatform()
  const [isExiting, setIsExiting] = createSignal(false)
  const [shouldShow, setShouldShow] = createSignal(true)

  onMount(() => {
    try {
      const shown = localStorage.getItem("octo.welcome.shown") === "true"
      const savedVersion = localStorage.getItem("octo.welcome.version") ?? ""
      const currentVersion = platform.version ?? ""
      if (shown && savedVersion === currentVersion) {
        setShouldShow(false)
        props.onComplete()
      }
    } catch {}
  })

  function handleStart() {
    try {
      localStorage.setItem("octo.welcome.shown", "true")
      localStorage.setItem("octo.welcome.version", platform.version ?? "")
    } catch {}
    setIsExiting(true)
    setTimeout(() => {
      props.onComplete()
    }, 300)
  }

  return (
    <Show when={shouldShow()}>
    <div
      class="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: "rgba(0, 0, 0, 0.5)",
        opacity: isExiting() ? 0 : 1,
        transition: "opacity 0.3s ease-out",
      }}
    >
      <div
        class="flex flex-col items-center"
        style={{
          width: "1128px",
          height: "555px",
          background: "white url('/welcomepage/background.png') center/cover no-repeat",
          "border-radius": "12px",
          "box-shadow": "0 4px 24px rgba(0, 0, 0, 0.15)",
          overflow: "hidden",
        }}
      >
        {/* Title */}
        <h1
          class="text-center"
          style={{
            "font-size": "26px",
            "line-height": "35px",
            "font-weight": "bold",
            color: "rgba(0, 0, 0, 0.9)",
            "margin-top": "42px",
          }}
        >
          欢迎使用 Octo Agent
        </h1>

        {/* Subtitle */}
        <p
          class="text-center"
          style={{
            "font-size": "14px",
            "line-height": "22px",
            color: "#777",
            "margin-top": "8px",
            "margin-bottom": "42px",
          }}
        >
          AI辅助设计端到端交付平台
        </p>

        {/* Feature Cards */}
        <div
          class="flex"
          style={{
            "padding-left": "26px",
            "padding-right": "26px",
            gap: "16px",
            "align-items": "stretch",
          }}
        >
          <For each={features}>
            {(feature) => (
              <div
                class="flex flex-col"
                style={{
                  flex: "1",
                  "border-radius": "12px",
                  background: "white",
                  "box-shadow": "0 1px 3px rgba(0,0,0,0.08)",
                  "min-height": "270px",
                  overflow: "hidden",
                }}
              >
                {/* Card Content */}
                <div
                  style={{
                    padding: "18px 0px 0px 18px",
                  }}
                >
                  {/* Title */}
                  <div
                    style={{
                      "font-size": "18px",
                      "line-height": "24px",
                      color: feature.titleColor,
                      "font-weight": "600",
                      "margin-bottom": "12px",
                    }}
                  >
                    {feature.title}
                  </div>

                  {/* Description */}
                  <div
                    style={{
                      "font-size": "12px",
                      "line-height": "18px",
                      color: "#191919",
                      "white-space": "pre-line",
                      "margin-bottom": "8px",
                    }}
                  >
                    {feature.description}
                  </div>

                  {/* Tags */}
                  <div class="flex flex-wrap" style={{ gap: "4px" }}>
                    <For each={feature.tags}>
                      {(tag) => (
                        <span
                          class="flex items-center"
                          style={{
                            "font-size": "10px",
                            height: "18px",
                            padding: "0 4px",
                            "border-radius": "2px",
                            color: feature.titleColor,
                            background: `${feature.titleColor}0D`,
                            "white-space": "nowrap",
                          }}
                        >
                          {tag}
                        </span>
                      )}
                    </For>
                  </div>
                </div>

                {/* Preview Image */}
                <img
                  src={feature.previewImage}
                  alt={feature.title}
                  style={{
                    width: "100%",
                    "margin-top": "auto",
                    "object-fit": "contain",
                  }}
                />
              </div>
            )}
          </For>
        </div>

        {/* Start Button */}
        <button
          type="button"
          onClick={handleStart}
          class="flex items-center justify-center"
          style={{
            "margin-top": "48px",
            width: "200px",
            height: "40px",
            "border-radius": "4px",
            background: "#0A59F7",
            color: "white",
            "font-size": "16px",
            "font-weight": "500",
            border: "none",
            cursor: "pointer",
            transition: "opacity 0.2s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.9" }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "1" }}
        >
          立即体验
        </button>
      </div>
    </div>
    </Show>
  )
}

import { useNavigate } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useProjectDir } from "@/hooks/use-project-dir"
import type { Session } from "@opencode-ai/sdk/v2/client"
import IconHost from "@/pages/_shell/icons/IconHost.svg"

async function createSession(agent: string, dir: string, sdk: ReturnType<typeof useGlobalSDK>, navigate: ReturnType<typeof useNavigate>) {
  const client = sdk.createClient({ directory: dir })
  const result = await client.session.create({ directory: dir, agent })
  const session = result.data as Session | undefined
  if (session) {
    const path = agent === "octo_insight" ? "insight" : "make"
    navigate(`/${path}/${session.id}`)
  }
}

export default function CoworkPage() {
  const navigate = useNavigate()
  const globalSDK = useGlobalSDK()
  const projectDir = useProjectDir()

  function handleInsightClick() {
    const dir = projectDir()
    if (!dir) return
    void createSession("octo_insight", dir, globalSDK, navigate)
  }

  function handleMakeClick() {
    const dir = projectDir()
    if (!dir) return
    void createSession("octo_make", dir, globalSDK, navigate)
  }

  return (
    <div class="flex-1 min-h-0 flex flex-col items-center justify-center" style="background: #fff">
      <div class="w-full max-w-[848px]">
        <div class="flex flex-col items-center gap-4 text-center pb-8 px-6">
          <img src={IconHost} width={120} height={120} alt="" style={{ "flex-shrink": "0" }} />
          <div class="flex flex-col items-center gap-2">
            <div style={{ color: "#191919", "font-size": "24px", "font-weight": "600", "line-height": "36px" }}>
              Octo Cowork
            </div>
            <div style={{ color: "#6e737a", "font-size": "14px", "line-height": "20px" }}>
              您的全能设计与调研专家
            </div>
          </div>
        </div>
        <div class="flex gap-[24px] px-6 pb-8 justify-center">
          <div
            class="flex items-center flex-1 cursor-pointer transition-opacity hover:opacity-80"
            style={{
              padding: "20px 32px",
              "border-radius": "12px",
              background: "rgba(227, 236, 254, 0.4)",
              gap: "12px",
              "max-width": "300px",
              position: "relative",
              overflow: "hidden",
            }}
            onClick={handleInsightClick}
          >
            <div
              style={{
                width: "32px",
                height: "32px",
                "border-radius": "8px",
                background: "rgba(10, 89, 247, 0.1)",
                "background-image": "url(/insightIcon.svg)",
                "background-size": "24px 24px",
                "background-repeat": "no-repeat",
                "background-position": "center",
                "flex-shrink": "0",
              }}
            />
            <div class="flex flex-col" style={{ gap: "2px" }}>
              <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "font-weight": 600 }}>
                Octo Insight
              </div>
              <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.6)" }}>
                AI辅助用户洞察研究
              </div>
            </div>
            <div
              style={{
                position: "absolute",
                right: "16px",
                bottom: "16px",
                width: "60px",
                height: "60px",
                "background-image": "url(/insightIcon.svg)",
                "background-size": "contain",
                "background-repeat": "no-repeat",
                "background-position": "center",
                opacity: 0.03,
                "pointer-events": "none",
              }}
            />
          </div>
          <div
            class="flex items-center flex-1 cursor-pointer transition-opacity hover:opacity-80"
            style={{
              padding: "20px 32px",
              "border-radius": "12px",
              background: "rgba(237, 226, 253, 0.4)",
              gap: "12px",
              "max-width": "300px",
              position: "relative",
              overflow: "hidden",
            }}
            onClick={handleMakeClick}
          >
            <div
              style={{
                width: "32px",
                height: "32px",
                "border-radius": "8px",
                background: "rgba(108, 0, 255, 0.1)",
                "background-image": "url(/makeIcon.svg)",
                "background-size": "24px 24px",
                "background-repeat": "no-repeat",
                "background-position": "center",
                "flex-shrink": "0",
              }}
            />
            <div class="flex flex-col" style={{ gap: "2px" }}>
              <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "font-weight": 600 }}>
                Octo Make
              </div>
              <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.6)" }}>
                自然语言生成可交互设计原型
              </div>
            </div>
            <div
              style={{
                position: "absolute",
                right: "16px",
                bottom: "16px",
                width: "60px",
                height: "60px",
                "background-image": "url(/makeIcon.svg)",
                "background-size": "contain",
                "background-repeat": "no-repeat",
                "background-position": "center",
                "pointer-events": "none",
                opacity: 0.03,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

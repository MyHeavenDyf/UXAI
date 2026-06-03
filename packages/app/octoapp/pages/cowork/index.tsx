import { useNavigate } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useProjectDir } from "@/hooks/use-project-dir"
import type { Session } from "@opencode-ai/sdk/v2/client"
import IconHost from "@/pages/_shell/icons/IconHost.svg"

async function createSession(dir: string, sdk: ReturnType<typeof useGlobalSDK>, navigate: ReturnType<typeof useNavigate>) {
  const client = sdk.createClient({ directory: dir })
  const result = await client.session.create({ directory: dir, agent: "octo_insight" })
  const session = result.data as Session | undefined
  if (session) navigate(`/insight/${session.id}`)
}

export default function CoworkPage() {
  const navigate = useNavigate()
  const globalSDK = useGlobalSDK()
  const projectDir = useProjectDir()

  function handleClick() {
    const dir = projectDir()
    if (!dir) return
    void createSession(dir, globalSDK, navigate)
  }

  return (
    <div class="flex-1 min-h-0 flex flex-col items-center justify-center" style="background: #fff">
      <div class="w-full max-w-[600px]">
        <div class="flex flex-col items-center gap-4 text-center pb-8 px-6">
          <img src={IconHost} width={166} height={166} alt="" style={{ "flex-shrink": "0" }} />
          <div class="flex flex-col items-center gap-2">
            <div style={{ color: "#191919", "font-size": "24px", "font-weight": "600", "line-height": "36px" }}>
              Octo Insight
            </div>
            <div style={{ color: "#6e737a", "font-size": "14px", "line-height": "20px" }}>
              AI辅助用户洞察研究
            </div>
          </div>
        </div>
        <div class="flex px-6 pb-8 justify-center">
          <div
            class="flex items-center flex-1 cursor-pointer transition-opacity hover:opacity-80"
            style={{
              padding: "20px 32px",
              "border-radius": "12px",
              background: "rgba(227, 236, 254, 0.4)",
              gap: "12px",
              "max-width": "400px",
              position: "relative",
              overflow: "hidden",
            }}
            onClick={handleClick}
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
                开始新的洞察研究
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
        </div>
      </div>
    </div>
  )
}

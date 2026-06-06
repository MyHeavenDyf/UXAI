import IconHost from "@/pages/_shell/icons/IconHost.svg"

export function NewSessionView(_props: { worktree: string }) {
  return (
    <div class="flex flex-col items-center gap-4 text-center pb-8 px-6">
      <img src={IconHost} width={166} height={166} alt="" style={{ "flex-shrink": "0" }} />
      <div class="flex flex-col items-center gap-2">
        <div style={{ color: "#191919", "font-size": "24px", "font-weight": "600", "line-height": "36px" }}>Octo Chat</div>
        <div style={{ color: "#6e737a", "font-size": "14px", "line-height": "20px" }}>告诉我您的目标，我将为您深度调研并一键生成设计方案。</div>
      </div>
    </div>
  )
}

import IconHost from "@/pages/_shell/icons/IconHost.svg"

export function NewSessionView(_props: { worktree: string }) {
  return (
    <div class="flex flex-col items-center gap-6 text-center pb-20 px-6">
      <img src={IconHost} width={166} height={166} alt="" style={{ "flex-shrink": "0" }} />
      <div class="flex flex-col items-center gap-2">
        <div style={{ color: "rgba(0, 0, 0, 0.9)", "font-size": "36px", "font-weight": "600", "line-height": "42px" }}>Octo Chat</div>
        <div style={{ color: "rgba(0, 0, 0, 0.6)", "font-size": "16px", "line-height": "24px" }}>告诉我您的目标，我将为您深度调研并一键生成设计方案。</div>
      </div>
    </div>
  )
}

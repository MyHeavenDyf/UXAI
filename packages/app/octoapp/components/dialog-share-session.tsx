import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createSignal } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createShareSession, buildShareLink } from "@/network/pipelineRequest"
import { exportPortableSessionBlob } from "@/network/portable-session"
import { showShareNotice } from "@/components/share-notice"
import copyLinkPng from "@/pages/_shell/icons/ic_public_link.png"

export function DialogShareSession(props: {
  sessionID: string
  sessionName: string
  client: OpencodeClient
  directory: string
}) {
  const dialog = useDialog()
  const [loading, setLoading] = createSignal(false)

  const handleCopyLink = async () => {
    if (loading()) return
    setLoading(true)
    try {
      const name = props.sessionName.replace(/[<>:"/\\|?*]/g, "-").trim() || "session"
      const blob = await exportPortableSessionBlob(props.client, props.directory, props.sessionID)
      const content = await createShareSession(blob, `${name}.zip`, `分享会话: ${props.sessionName}`)
      const url = buildShareLink(content.uniqueId)
      await navigator.clipboard?.writeText(url)
      dialog.close()
      showShareNotice("链接已复制")
    } catch (err) {
      showShareNotice("生成分享链接失败")
      console.error("createShareSession error:", err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      title={`分享 ${props.sessionName}`}
      class="share-session-dialog"
      style={{
        width: "608px",
        height: "482px",
        "max-height": "482px",
        "border-radius": "12px",
        overflow: "hidden",
      }}
    >
      <style>{`
        [data-slot="dialog-container"]:has(.share-session-dialog) {
          width: 608px !important;
          height: 482px !important;
        }
        .share-session-dialog [data-slot="dialog-header"] {
          overflow: hidden;
        }
        .share-session-dialog [data-slot="dialog-title"] {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
      `}</style>
      <div class="flex flex-col" style={{ padding: "0 24px 20px", gap: "12px", flex: "1", "min-height": "0" }}>
        <p style={{ margin: "0", "font-size": "13px", "line-height": "20px", color: "rgba(0,0,0,0.55)" }}>
          分享后，你的姓名以及你添加的新消息不会显示在共享聊天中。
        </p>
        <div
          style={{
            width: "560px",
            height: "280px",
            border: "1px solid rgba(0,0,0,0.1)",
            "border-radius": "8px",
            "box-sizing": "border-box",
            "flex-shrink": "0",
          }}
        />
        <p style={{ margin: "0", "font-size": "13px", "line-height": "20px", color: "rgba(0,0,0,0.55)" }}>
          任何知道此链接的人都可以查看此聊天
        </p>
        <div class="flex justify-end" style={{ "margin-top": "auto" }}>
          <button
            type="button"
            onClick={handleCopyLink}
            style={{
              height: "32px",
              padding: "0 16px",
              border: "0",
              "border-radius": "16px",
              cursor: "pointer",
              "font-size": "14px",
              "font-weight": "400",
              "line-height": "22px",
              color: "#fff",
              background: "#0969ff",
              display: "inline-flex",
              "align-items": "center",
              gap: "6px",
            }}
          >
            <img src={copyLinkPng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
            {loading() ? "生成中..." : "复制链接"}
          </button>
        </div>
      </div>
    </Dialog>
  )
}

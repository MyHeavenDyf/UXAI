import "../octo-tokens.css"
import { createSignal, For, type JSX } from "solid-js"
import { A } from "@solidjs/router"
import folderBlueUrl from "../icons/IconFolderBlue.svg?url"

/**
 * Dev-only 样张:FileFallback 新 UI 布局预览。
 *
 * 复现设计稿「容器 30044 新的整体 ui.svg」的 FileFallback 样式:
 * 渐变氛围背景 + 大文件图标 + 文件名标题 + 副标题 + 分隔线 + 三按钮。
 *
 * 文件类型图标通过 fileTypeIconUrl() 按扩展名/mimeType 自动映射。
 * 不依赖 SDK / Sync / 文件上传,纯 mock 数据。
 *
 * 路由:/insight/__dev/file-fallback(见 routes.tsx)。
 *
 * 注:原 octo-agent 版「另存为」下载的是仓库内 docs/specs/agents/multi-agent.md(?raw),
 * UXAI 无此文件,这里改为内联示例文本,仅用于演示下载链路。
 */

// 「另存为」下载用的内联示例内容(替代原 multi-agent.md?raw 导入)。
const SAMPLE_DOWNLOAD_MD = [
  "# 示例下载文件",
  "",
  "这是 dev 预览页「另存为」按钮生成的示例 Markdown。",
  "仅用于验证浏览器下载链路,内容无实际意义。",
  "",
  "- 项目一",
  "- 项目二",
].join("\n")

// ── mock 场景:覆盖全部文件类型图标 ──────────────────────────────
const MOCK_FILES = [
  { label: "DOCX", fileName: "算子开发工具 访谈观点聚类报告.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { label: "XLSX", fileName: "用户满意度评分汇总.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  { label: "PPTX", fileName: "产品路线图规划.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  { label: "PDF",  fileName: "调研报告终稿.pdf", mimeType: "application/pdf" },
  { label: "HTML", fileName: "落地页交互原型.html", mimeType: "text/html" },
  { label: "MD",   fileName: "用户旅程地图分析.md", mimeType: "text/markdown" },
  { label: "MAP",  fileName: "需求优先级思维导图.json", mimeType: "application/json+mindmap" },
  { label: "MP4",  fileName: "访谈录屏回放.mp4", mimeType: "video/mp4" },
  { label: "PNG",  fileName: "用户画像图.png", mimeType: "image/png" },
  { label: "PY",   fileName: "数据清洗脚本.py", mimeType: "text/x-python" },
  { label: "其他", fileName: "原始录音文件.mp3", mimeType: "audio/mpeg" },
]

// ── 新版 FileFallback 组件 ────────────────────────────────────
function FileFallbackNew(props: {
  fileName: string
  mimeType: string
  openBusy?: boolean
  revealBusy?: boolean
  downloadBusy?: boolean
  onSaveAs?: () => Promise<void>
}): JSX.Element {
  // 类型胶囊文案:取扩展名大写 + " 文档"(如 算子...报告.docx → DOCX 文档)
  const typeLabel = () => {
    const ext = props.fileName.split(".").pop()?.toUpperCase() ?? ""
    return ext ? `${ext} 文档` : "文档"
  }

  return (
    <div
      class="relative flex flex-col items-center justify-center h-full overflow-hidden"
      style={{
        // ① 氛围渐变背景:一团蓝紫色晕,居中晕开铺满整框,向四周柔和淡出,整体很淡,叠在底色上
        background: [
          "radial-gradient(120% 100% at 50% 48%, rgba(10,89,247,0.02) 0%, rgba(10,89,247,0) 60%)",
          "radial-gradient(130% 110% at 50% 50%, rgba(75,127,255,0.016) 0%, rgba(75,127,255,0) 65%)",
          "radial-gradient(140% 120% at 50% 52%, rgba(123,97,255,0.018) 0%, rgba(123,97,255,0) 70%)",
          "var(--octo-surface-result)",
        ].join(", "),
      }}
    >
      {/* ② 中间的设计:白色卡片 + 层叠柔和阴影(轻黑投影 + 蓝/紫辉光) */}
      <div
        class="relative z-10 flex flex-col items-center"
        style={{
          width: "440px",
          "max-width": "calc(100% - 40px)",
          padding: "32px 40px 28px",
          "border-radius": "16px",
          background: "rgba(255,255,255,1)",
          "box-shadow": [
            "0 4px 12px rgba(0,0,0,0.07)",
            "0 16px 40px rgba(10,89,247,0.1)",
            "0 24px 56px rgba(123,97,255,0.08)",
          ].join(", "),
        }}
      >
        {/* 蓝色圆角徽标 + 白色文档图标(自带蓝色辉光) */}
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            width: "64px",
            height: "64px",
            "border-radius": "16px",
            background: "linear-gradient(135deg, rgba(91,139,255,1) 0%, rgba(43,110,246,1) 100%)",
            "box-shadow": "0 10px 24px rgba(10,89,247,0.2)",
            "margin-bottom": "14px",
          }}
        >
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" aria-hidden="true">
            <path d="M13.2 3H7A1.5 1.5 0 0 0 5.5 4.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8.3L13.2 3Z" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" />
            <path d="M13 3.3V8a1 1 0 0 0 1 1h4.4" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" />
            <path d="M9 13h6M9 16.3h4" stroke="#fff" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </div>

        {/* 文件类型胶囊 */}
        <div style={{ padding: "2px 10px", "border-radius": "6px", background: "rgba(10,89,247,0.08)", color: "rgba(10,89,247,1)", "font-size": "12px", "font-weight": 500, "margin-bottom": "10px" }}>
          {typeLabel()}
        </div>

        {/* 文件名标题 */}
        <div style={{ "font-size": "18px", "font-weight": 700, color: "rgba(0,0,0,0.81)", "line-height": 1.4, "text-align": "center", "word-break": "break-all", "margin-bottom": "8px", "max-width": "360px" }}>
          {props.fileName}
        </div>

        {/* 副标题 */}
        <div style={{ "font-size": "13px", color: "rgba(0,0,0,0.4)", "margin-bottom": "20px", "text-align": "center" }}>
          文档已生成完成，可选择以下方式查看
        </div>

        {/* 三按钮行 */}
        <div style={{ display: "flex", gap: "10px", "flex-wrap": "wrap", "justify-content": "center" }}>
          {/* 主按钮:本地打开 — 实心蓝 */}
          <button type="button" disabled={props.openBusy} style={{ height: "36px", padding: "0 16px", "border-radius": "8px", border: "none", background: "rgba(10,89,247,1)", color: "#fff", "font-size": "13px", "font-weight": 500, cursor: props.openBusy ? "not-allowed" : "pointer", opacity: props.openBusy ? 0.5 : 1, display: "flex", "align-items": "center", gap: "6px" }}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
              <rect x="1" y="2" width="14" height="10" rx="1.5" stroke="#fff" stroke-width="1.4"/>
              <path d="M5.5 14.5h5" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>
              <path d="M8 12v2.5" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
            {props.openBusy ? "打开中…" : "用本地应用打开"}
          </button>

          {/* 次按钮:文件夹打开 — 白底描边 */}
          <button type="button" disabled={props.revealBusy} style={{ height: "36px", padding: "0 14px", "border-radius": "8px", border: "1px solid rgba(0,0,0,0.1)", background: "#fff", color: "rgba(0,0,0,0.81)", "font-size": "13px", cursor: props.revealBusy ? "not-allowed" : "pointer", opacity: props.revealBusy ? 0.5 : 1, display: "flex", "align-items": "center", gap: "6px" }}>
            <img src={folderBlueUrl} width={14} height={12} alt="" aria-hidden="true" />
            {props.revealBusy ? "定位中…" : "在文件夹中打开"}
          </button>

          {/* 次按钮:另存为 — 白底描边 */}
          <button type="button" onClick={() => void props.onSaveAs?.()} disabled={props.downloadBusy} style={{ height: "36px", padding: "0 14px", "border-radius": "8px", border: "1px solid rgba(0,0,0,0.1)", background: "#fff", color: "rgba(0,0,0,0.81)", "font-size": "13px", cursor: props.downloadBusy ? "not-allowed" : "pointer", opacity: props.downloadBusy ? 0.5 : 1, display: "flex", "align-items": "center", gap: "6px" }}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
              <path d="M8 2v8M5 7.5l3 3 3-3" stroke="rgba(10,89,247,1)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M2.5 11.5v1A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5v-1" stroke="rgba(10,89,247,1)" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
            {props.downloadBusy ? "保存中…" : "另存为"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 预览页主体 ──────────────────────────────────────────────
export default function FileFallbackPreviewPage(): JSX.Element {
  const [selected, setSelected] = createSignal(0)
  const [openBusy, setOpenBusy] = createSignal(false)
  const [revealBusy, setRevealBusy] = createSignal(false)
  const [downloadBusy, setDownloadBusy] = createSignal(false)
  const file = () => MOCK_FILES[selected()]!

  function toggleBusy(setter: (v: boolean) => void) {
    setter(true)
    setTimeout(() => setter(false), 1500)
  }

  async function handleSaveAs() {
    if (downloadBusy()) return
    setDownloadBusy(true)
    try {
      const blob = new Blob([SAMPLE_DOWNLOAD_MD], { type: "text/markdown" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "sample-download.md"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      console.error("[dev:saveAs]", e)
    } finally {
      setDownloadBusy(false)
    }
  }

  return (
    <div class="size-full overflow-y-auto" style={{ background: "var(--octo-shell-bg, #f5f6f8)", "font-family": "var(--octo-font, system-ui)" }}>
      <div class="mx-auto" style={{ "max-width": "1080px", padding: "40px 24px 80px" }}>
        <A href="/insight/__dev" style={{ "font-size": "12px", color: "var(--octo-text-secondary)", "text-decoration": "none" }}>← Dev 预览索引</A>

        <div style={{ "margin-top": "12px", "margin-bottom": "4px", "font-size": "22px", "font-weight": 600, color: "var(--octo-text-strong)" }}>FileFallback 预览</div>
        <div style={{ "margin-bottom": "20px", "font-size": "13px", color: "var(--octo-text-secondary)" }}>
          设计稿新 UI（待落地 result-viewer/index.tsx FileFallback）
        </div>

        {/* 文件类型选择 */}
        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "8px", "margin-bottom": "14px", "align-items": "center" }}>
          <span style={{ "font-size": "12px", color: "var(--octo-text-secondary)", "align-self": "center" }}>文件类型：</span>
          <For each={MOCK_FILES}>
            {(f, i) => (
              <button type="button" onClick={() => setSelected(i())} style={{ "font-size": "12px", padding: "4px 10px", "border-radius": "6px", cursor: "pointer", border: "1px solid var(--octo-border-default, #ddd)", background: selected() === i() ? "var(--octo-brand, #6b4eff)" : "var(--octo-surface-page, #fff)", color: selected() === i() ? "#fff" : "var(--octo-text-primary)" }}>
                {f.label}
              </button>
            )}
          </For>
        </div>

        {/* busy 状态模拟 */}
        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "8px", "margin-bottom": "20px", "align-items": "center" }}>
          <span style={{ "font-size": "12px", color: "var(--octo-text-secondary)" }}>模拟 busy：</span>
          {[
            { label: "本地打开", setter: setOpenBusy },
            { label: "文件夹打开", setter: setRevealBusy },
            { label: "下载", setter: setDownloadBusy },
          ].map(({ label, setter }) => (
            <button type="button" onClick={() => toggleBusy(setter)} style={{ "font-size": "12px", padding: "3px 10px", "border-radius": "6px", cursor: "pointer", border: "1px solid var(--octo-border-default, #ddd)", background: "var(--octo-surface-page,#fff)", color: "var(--octo-text-primary)" }}>
              {label}
            </button>
          ))}
        </div>

        {/* 单栏画框:模拟 ResultViewer 右栏(白底大尺寸,内含氛围背景 + 浮起卡片) */}
        <div style={{ height: "560px", border: "1px solid var(--octo-border-divider, #eee)", "border-radius": "var(--octo-radius-md, 8px)", overflow: "hidden", "box-shadow": "0 1px 3px rgba(0,0,0,.06)", background: "var(--octo-surface-result, #fff)" }}>
          <FileFallbackNew
            fileName={file().fileName}
            mimeType={file().mimeType}
            openBusy={openBusy()}
            revealBusy={revealBusy()}
            downloadBusy={downloadBusy()}
            onSaveAs={handleSaveAs}
          />
        </div>

        <div style={{ "margin-top": "14px", "font-size": "12px", color: "var(--octo-text-disabled)", "line-height": 1.7 }}>
          画框模拟 ResultViewer 右栏（氛围渐变背景 + 浮起卡片）。确认后落地替换 <code>result-viewer/index.tsx FileFallback</code>。
        </div>
      </div>
    </div>
  )
}

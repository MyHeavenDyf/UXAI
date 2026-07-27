import "../octo-tokens.css"
import { createSignal, For, type JSX } from "solid-js"
import { A } from "@solidjs/router"
import { PermissionDockView } from "../components/permission-dock"

/**
 * Dev-only 样张:读取本地文件的权限弹窗(InsightPermissionDock)。
 *
 * 路由:/insight/__dev/permission-dock(见 routes.tsx)。
 *
 * 真机触发条件是「模型读工作区外的本地文件 → 服务端 external_directory 阻塞询问」,
 * 依赖 SDK / Sync / 模型,dev 环境难复现。这里直接渲染从 permission-dock.tsx 剥出的纯展示层
 * PermissionDockView(与线上同一组件、同一 message-part.css 样式),喂 mock 数据 —— 所见即所得,
 * 刷 UI 不会与线上漂移。文案 = i18n 里的真实中文(需要权限 / 拒绝 / 始终允许 / 允许一次)。
 *
 * 三个场景覆盖:单路径、多路径(patterns 区滚动)、超长中文路径(换行)。
 */

// 与真实注入方一致的按钮文案(取自 app i18n zh.ts / ui i18n zh.ts)
const LABELS = { deny: "拒绝", always: "始终允许", once: "允许一次" }
// 与生产 override 一致(permission-dock.tsx 的 PERMISSION_HINT_OVERRIDES.external_directory)
const HINT = "AI 需要读取工作区以外的本地文件(路径见下方),经您允许后才会读取。"

const SCENARIOS: { title: string; desc: string; patterns: string[] }[] = [
  {
    title: "单个文件路径",
    desc: "最常见:模型要读一个工作区外的文件",
    patterns: ["C:\\Users\\eka\\Documents\\2025年度经营分析.xlsx"],
  },
  {
    title: "多个路径(patterns 区可滚动)",
    desc: "同次询问命中多条 glob 时,列表纵向滚动、无滚动条",
    patterns: [
      "C:\\Users\\eka\\Documents\\访谈记录\\受访者A.docx",
      "C:\\Users\\eka\\Documents\\访谈记录\\受访者B.docx",
      "C:\\Users\\eka\\Downloads\\满意度原始数据.csv",
      "D:\\研究资料\\2024\\竞品调研汇总.pdf",
    ],
  },
  {
    title: "超长中文路径(换行)",
    desc: "验证 break-all 下超长路径不撑破容器",
    patterns: ["D:\\一级部门\\二级部门\\用户研究组\\2025Q2\\算子开发工具访谈观点聚类与满意度评分明细汇总表最终版.xlsx"],
  },
]

function Stage(props: { title: string; desc: string; children: JSX.Element }): JSX.Element {
  return (
    <div
      style={{
        background: "var(--octo-surface-page, #fff)",
        "border-radius": "var(--octo-radius-md, 8px)",
        border: "1px solid var(--octo-border-divider, #eee)",
        padding: "20px",
        "margin-bottom": "20px",
      }}
    >
      <div style={{ "font-size": "14px", "font-weight": 600, color: "var(--octo-text-strong)", "margin-bottom": "2px" }}>
        {props.title}
      </div>
      <div style={{ "font-size": "12px", color: "var(--octo-text-secondary)", "margin-bottom": "16px" }}>
        {props.desc}
      </div>
      {/* 复刻输入区宽度:真实 dock 挂在 max-width 800px 的居中输入区上方 */}
      <div style={{ "max-width": "800px" }}>{props.children}</div>
    </div>
  )
}

export default function PermissionDockDevPage(): JSX.Element {
  const [busy, setBusy] = createSignal(false)
  const [last, setLast] = createSignal("")

  return (
    <div
      class="size-full overflow-y-auto"
      style={{ background: "var(--octo-shell-bg, #f5f6f8)", "font-family": "var(--octo-font, system-ui)" }}
    >
      <div class="mx-auto" style={{ "max-width": "920px", padding: "40px 24px 96px" }}>
        <A href="/insight/__dev" style={{ "font-size": "12px", color: "var(--octo-text-secondary)", "text-decoration": "none" }}>
          ← 返回 Dev 预览索引
        </A>
        <div style={{ "margin-top": "10px", "margin-bottom": "6px", "font-size": "22px", "font-weight": 600, color: "var(--octo-text-strong)" }}>
          读取本地文件 · 权限弹窗
        </div>
        <div style={{ "margin-bottom": "20px", "font-size": "13px", color: "var(--octo-text-secondary)" }}>
          渲染真实 PermissionDockView(线上同组件同样式),mock 数据。点按钮不发请求,只回显选择;
          可勾选 busy 预览三键禁用态。
        </div>

        <label style={{ display: "inline-flex", "align-items": "center", gap: "8px", "margin-bottom": "24px", "font-size": "13px", color: "var(--octo-text-strong)", cursor: "pointer" }}>
          <input type="checkbox" checked={busy()} onChange={(e) => setBusy(e.currentTarget.checked)} />
          busy(应答中,三键禁用)
        </label>

        <div style={{ "min-height": "20px", "margin-bottom": "16px", "font-size": "13px", color: "var(--octo-accent, #2563eb)" }}>
          {last()}
        </div>

        <For each={SCENARIOS}>
          {(s) => (
            <Stage title={s.title} desc={s.desc}>
              <PermissionDockView
                title="需要权限"
                hint={HINT}
                patterns={s.patterns}
                busy={busy()}
                labels={LABELS}
                onDecide={(r) => setLast(`「${s.title}」选择:${r === "once" ? "允许一次" : r === "always" ? "始终允许" : "拒绝"}`)}
                onOpenPath={(p) => setLast(`打开文件(dev 仅回显,不实际打开):${p}`)}
              />
            </Stage>
          )}
        </For>
      </div>
    </div>
  )
}

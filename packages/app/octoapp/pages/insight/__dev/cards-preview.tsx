import "../octo-tokens.css"
import { For } from "solid-js"
import type { JSX } from "solid-js"
import { A } from "@solidjs/router"
import { TaskCardView } from "../components/task-card"
import { type TaskCardEntry, type TaskStatus } from "../utils/task-detect"
import type { OutputCard, OutputCardType } from "../components/insight-turn"
import { OutputEntryCard } from "../components/output-entry-card"
import { __devSeedMaterializeState } from "../utils/local-resource"

/**
 * Dev-only 预览页 — 展示所有任务卡片态(5)与文件结果卡片类型(6)。
 *
 * 路由:/insight/__dev/insight-cards(见 routes.tsx)。不连 SDK / Sync,纯静态 mock。
 * 目的:对照设计稿 review 现有 UI,决定改版方向。
 */
export default function CardsPreviewPage(): JSX.Element {
  return (
    <div
      class="size-full overflow-y-auto"
      style={{
        background: "var(--octo-shell-bg, #f5f6f8)",
        "font-family": "var(--octo-font, system-ui)",
      }}
    >
      <div class="mx-auto" style={{ "max-width": "880px", padding: "32px 24px 80px" }}>
        <Header />
        <Section title="任务卡片(5 态)" subtitle="TaskCardView · components/task-card/index.tsx">
          <For each={taskMocks()}>
            {(card) => (
              <Frame label={statusLabel(card.status)}>
                <TaskCardView
                  card={card}
                  busy={false}
                  onRefresh={(id) => console.log("[dev:preview] refresh", id)}
                  onStop={(id) => console.log("[dev:preview] stop", id)}
                  onOpenResult={(id) => console.log("[dev:preview] openResult", id)}
                />
              </Frame>
            )}
          </For>
        </Section>

        <Section title="文件结果卡片(6 类 · 统一紫色图标)" subtitle="OutputEntryCard · components/output-entry-card.tsx">
          <For each={outputMocks()}>
            {(card) => (
              <Frame label={`type: ${card.type}`}>
                <OutputEntryCard card={card} onClick={() => console.log("[dev:preview] open card", card.id)} />
              </Frame>
            )}
          </For>
        </Section>

        <Section
          title="产物落盘三态(uri 卡先出卡、后台下载)"
          subtitle="OutputEntryCard · 状态由 utils/local-resource.ts materializeStateOf 提供"
        >
          <For each={materializeStateMocks()}>
            {(item) => (
              <Frame label={item.label}>
                <OutputEntryCard
                  card={item.card}
                  onClick={() => console.log("[dev:preview] open card", item.card.id)}
                  onRetry={() => console.log("[dev:preview] retry materialize", item.card.id)}
                />
              </Frame>
            )}
          </For>
        </Section>
      </div>
    </div>
  )
}

function Header(): JSX.Element {
  return (
    <div style={{ "margin-bottom": "24px" }}>
      <A href="/insight/__dev" style={{ "font-size": "12px", color: "var(--octo-text-secondary)", "text-decoration": "none" }}>
        ← Dev 索引
      </A>
      <div
        style={{
          "font-size": "20px",
          "font-weight": 600,
          color: "var(--octo-text-strong)",
          "margin": "8px 0 4px",
        }}
      >
        Insight 卡片预览(dev only)
      </div>
      <div style={{ "font-size": "13px", color: "var(--octo-text-secondary)" }}>
        所有数据为 mock,不连 SDK / Sync。按钮点击只打 console.log,不发请求。
      </div>
    </div>
  )
}

function Section(props: { title: string; subtitle: string; children: JSX.Element }): JSX.Element {
  return (
    <div style={{ "margin-bottom": "40px" }}>
      <div
        style={{
          "font-size": "15px",
          "font-weight": 600,
          color: "var(--octo-text-strong)",
          "margin-bottom": "2px",
        }}
      >
        {props.title}
      </div>
      <div
        style={{
          "font-size": "11px",
          color: "var(--octo-text-disabled)",
          "font-family": "var(--octo-font-mono, ui-monospace, monospace)",
          "margin-bottom": "12px",
        }}
      >
        {props.subtitle}
      </div>
      {props.children}
    </div>
  )
}

function Frame(props: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <div style={{ "margin-bottom": "16px" }}>
      <div
        style={{
          "font-size": "12px",
          color: "var(--octo-text-secondary)",
          "margin-bottom": "6px",
        }}
      >
        {props.label}
      </div>
      <div
        style={{
          background: "var(--octo-surface-page, #fff)",
          "border-radius": "var(--octo-radius-md, 8px)",
          border: "1px solid var(--octo-border-divider, #eee)",
          padding: "12px 0",
        }}
      >
        {props.children}
      </div>
    </div>
  )
}

// ── Mocks ─────────────────────────────────────────────

function taskMocks(): TaskCardEntry[] {
  const submittedAt = new Date("2026-04-27T15:38:00")
  const lastUpdatedAt = new Date("2026-04-27T15:40:30")
  return (["pending", "processing", "completed", "failed", "stopped"] as TaskStatus[]).map(
    (status, idx) =>
      ({
        taskId: `demo-${status}-5a42e1c5d4d21`,
        status,
        message:
          status === "processing"
            ? "正在聚合用户痛点观点…"
            : status === "failed"
              ? "uxr-tool_run_guide_analysis Streamable HTTP error"
              : status === "pending"
                ? "任务已入库,排队中"
                : undefined,
        toolName: idx % 2 === 0 ? "key_findings" : "run_guide_analysis",
        anchorUserMessageID: `demo-anchor-${idx}`,
        submittedAt,
        lastUpdatedAt: status === "pending" ? submittedAt : lastUpdatedAt,
        resultText:
          status === "completed"
            ? "本次分析覆盖 12 份访谈,提取 23 条核心观点,Top 3 痛点集中在登录流程 / 算子配置 / 报表导出。"
            : undefined,
        resourceLinks:
          status === "completed"
            ? [
                {
                  uri: "https://example.com/result-1.docx",
                  name: "算子开发工具 访谈观点聚类报告.docx",
                  mimeType:
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                },
                {
                  uri: "https://example.com/result-2.docx",
                  name: "用户旅程分析.docx",
                  mimeType:
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                },
              ]
            : [],
      }) satisfies TaskCardEntry,
  )
}

function outputMocks(): OutputCard[] {
  const createdAt = new Date("2026-04-27T15:38:00")
  const types: OutputCardType[] = ["table", "mindmap", "json", "file", "markdown", "html", "code", "image"]
  const titles: Record<OutputCardType, string> = {
    table: "用户痛点频次分析表",
    mindmap: "访谈观点思维导图",
    json: "原始访谈数据 JSON",
    file: "算子开发工具 访谈观点聚类报告.docx",
    markdown: "可用性测试小结 Markdown",
    html: "可视化报告页面",
    code: "数据处理脚本 analyze.py",
    image: "访谈现场照片.png",
  }
  return types.map(
    (type) =>
      ({
        id: `demo-card-${type}`,
        title: titles[type],
        type,
        source: type === "file" ? "uri" : "inline",
        content: type === "file" ? undefined : `[mock content for ${type}]`,
        uri: type === "file" ? "https://example.com/demo.docx" : undefined,
        mimeType: type === "file" ? "application/msword" : undefined,
        fileName: type === "file" ? titles.file : undefined,
        description: type === "file" ? undefined : "示例描述文本",
        createdAt,
      }) satisfies OutputCard,
  )
}

// 落盘三态样例。状态不 mock 在组件 props 上,而是**种进真实的状态表**(__devSeedMaterializeState),
// 让预览页走的渲染路径与线上完全一致(同源原则,见文件头)。
function materializeStateMocks(): Array<{ label: string; card: OutputCard }> {
  const createdAt = new Date("2026-04-27T15:38:00")
  const make = (id: string, title: string): OutputCard => ({
    id,
    title,
    type: "mindmap",
    source: "uri",
    uri: `https://example.com/${id}.json`,
    mimeType: "application/json",
    fileName: `${title}.json`,
    createdAt,
  })

  const pending = make("demo-state-pending", "访谈观点思维导图")
  const ready = make("demo-state-ready", "访谈观点思维导图")
  const failed = make("demo-state-failed", "访谈观点思维导图")

  __devSeedMaterializeState(pending.id, { state: "pending" })
  __devSeedMaterializeState(ready.id, { state: "ready" })
  __devSeedMaterializeState(failed.id, { state: "failed", error: "下载失败: 连接超时" })

  return [
    { label: "pending — 准备中(后台下载,仍可点开)", card: pending },
    { label: "ready — 就绪(现状)", card: ready },
    { label: "failed — 获取失败(整卡点击 = 重试)", card: failed },
  ]
}

function statusLabel(s: TaskStatus): string {
  switch (s) {
    case "pending":
      return "pending — 排队中"
    case "processing":
      return "processing — 进行中"
    case "completed":
      return "completed — 已完成"
    case "failed":
      return "failed — 失败"
    case "stopped":
      return "stopped — 已终止"
  }
}

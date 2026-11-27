import { expect, test } from "bun:test"

const html = await Bun.file(new URL("../../public/design/agent/share/index.html", import.meta.url)).text()
const source = html.slice(html.indexOf("    function buildDivider("), html.indexOf("    const REPLY_COPY_ICON"))

const makeSpan = (_className: string, text: string) => {
  const span = document.createElement("span")
  span.textContent = text
  return span
}

const { buildErrorNotice, buildCompactionBlock, buildTurnErrorNotice } = new Function(
  "document",
  "makeSpan",
  `${source}; return { buildErrorNotice, buildCompactionBlock, buildTurnErrorNotice }`,
)(document, makeSpan)

// 错误提示卡内容区:children[0] 为标题 span,其后为文本行
function noticeLines(notice: Element) {
  const content = notice.children[1]
  return Array.from(content.children).slice(1)
}

function failedCompactionTurn(message?: string) {
  return {
    assistants: [
      message === undefined
        ? { info: { error: { name: "SummarizeError" } } }
        : { info: { error: { name: "SummarizeError", data: { message } } } },
    ],
  }
}

test("错误文本以整行渲染,不逐字符拆行", () => {
  const notice = buildErrorNotice("上下文压缩失败", "压缩服务超时")
  expect(noticeLines(notice)).toHaveLength(1)
  expect(noticeLines(notice)[0]?.textContent).toBe("压缩服务超时")
})

test("lines 缺省或非数组时安全降级,不抛错", () => {
  const empty = buildErrorNotice("上下文压缩失败")
  expect(noticeLines(empty)).toHaveLength(0)
  expect(empty.textContent).toContain("上下文压缩失败")

  const nonArray = buildErrorNotice("上下文压缩失败", null)
  expect(noticeLines(nonArray)).toHaveLength(0)
})

test("数组文本逐行渲染", () => {
  const notice = buildErrorNotice("上下文超出提示", ["系统的单次处理能力已满。", "请进行“上下文压缩”，或新建对话。"])
  expect(noticeLines(notice).map((el) => el.textContent)).toEqual(["系统的单次处理能力已满。", "请进行“上下文压缩”，或新建对话。"])
})

test("压缩轮失败展示完整错误信息,无错误描述也不抛错", () => {
  const notice = buildCompactionBlock(failedCompactionTurn("压缩中断"))
  expect(notice.textContent).toContain("上下文压缩失败")
  expect(notice.textContent).toContain("压缩中断")
  expect(noticeLines(notice)).toHaveLength(1)

  const noMessage = buildCompactionBlock(failedCompactionTurn())
  expect(noMessage.textContent).toContain("上下文压缩失败")
  expect(noticeLines(noMessage)).toHaveLength(0)
})

test("压缩轮成功展示分割线,未完成展示超时提示", () => {
  expect(buildCompactionBlock({ assistants: [{ info: { summary: true, finish: true } }] }).textContent).toBe("会话已压缩")
  expect(buildCompactionBlock({ assistants: [] }).textContent).toBe("上下文压缩未完成（可能已超时或中断）")
})

test("普通轮错误按错误名映射标题,中断错误不渲染", () => {
  const overflow = buildTurnErrorNotice({ assistants: [{ info: { error: { name: "ContextOverflowError" } } }] })
  expect(overflow?.textContent).toContain("上下文超出提示")
  expect(noticeLines(overflow!)).toHaveLength(2)

  const authError = buildTurnErrorNotice({ assistants: [{ info: { error: { name: "ProviderAuthError", message: "token 无效" } } }] })
  expect(authError?.textContent).toContain("认证失败")
  expect(authError?.textContent).toContain("token 无效")

  expect(buildTurnErrorNotice({ assistants: [{ info: { error: { name: "MessageAbortedError" } } }] })).toBeNull()
})

// ── insight 会话渲染(renderInsightTurn 结构回归)──
// 切片:公共 builder(buildDivider/buildErrorNotice 等)+ insight 渲染函数;
// 外部依赖以桩注入(renderMarkdown/markExpandable* 等与本文件断言无关)
const renderSource =
  html.slice(html.indexOf("    function buildDivider("), html.indexOf("    const REPLY_COPY_ICON")) +
  html.slice(html.indexOf("    function insightUserText("), html.indexOf("    function studioCapabilityLabel("))

const renderStubs = {
  // 渲染测试断言依赖 class,makeSpan 必须真正设置 className(上面的 builder 用例不依赖)
  makeSpan: (cls: string, text: string) => {
    const span = document.createElement("span")
    if (cls) span.className = cls
    span.textContent = text
    return span
  },
  loadBlobImage: async () => "",
  buildImageBlobMap: () => ({}),
  copyViaTextarea: () => {},
  markExpandableCodeBlocks: () => {},
  markExpandableUserBubbles: () => {},
  bindMarkdownCodeActions: () => {},
  showEmptyState: () => {},
  isHiddenCompactionTurnParts: () => false,
  FILE_ICON_BASE: "./icons/",
  buildBubbleExpandButton: () => document.createElement("button"),
  renderMarkdown: (t: string) => `<p>${t}</p>`,
}

const renderFns = new Function(
  "document",
  ...Object.keys(renderStubs),
  `${renderSource}; return { renderInsightTurn, buildInsightDiffs, insightUnwrapError, insightCtxItemInfo, buildInsightTaskCard }`,
)(document, ...Object.values(renderStubs))

test("ctx 组明细行 list/glob/grep 展示目录而非文件名", () => {
  const info = renderFns.insightCtxItemInfo({ tool: "list", state: { input: { path: "/a/b/c" } } })
  expect(info.subtitle).toBe("/a/b/")
})

test("错误文案按上游 unwrap 解包 JSON 包装", () => {
  expect(renderFns.insightUnwrapError('Error: {"error":{"type":"ProviderError","message":"boom"}}')).toBe("ProviderError: boom")
  expect(renderFns.insightUnwrapError('{"message":"plain"}')).toBe("plain")
  expect(renderFns.insightUnwrapError("raw failure")).toBe("raw failure")
})

test("文件变更组按文件去重保留最后一次快照", () => {
  const el = renderFns.buildInsightDiffs({ info: { summary: { diffs: [
    { file: "src/a.ts", additions: 3, deletions: 1 },
    { file: "src/a.ts", additions: 5, deletions: 2 },
    { file: "src/deep/b.ts", additions: 0, deletions: 4 },
  ] } } })
  expect(el!.querySelectorAll(".insight-diff-row")).toHaveLength(2)
  expect(el!.querySelector(".insight-diffs-label")!.textContent).toBe("2 Changed 个文件")
  expect(el!.querySelector(".insight-diff-row .insight-diff-name")!.textContent).toBe("a.ts")
  expect(el!.querySelector(".insight-diff-row .insight-diff-dir")!.textContent).toContain("src/")
  expect(el!.querySelector(".insight-diff-row .insight-diff-add")!.textContent).toBe("+5")
  expect(el!.querySelector(".insight-diff-row .insight-diff-del")!.textContent).toBe("-2")
  expect(renderFns.buildInsightDiffs({ info: { summary: { diffs: [] } } })).toBeNull()
  expect(renderFns.buildInsightDiffs(null)).toBeNull()
})

test("中断分割线位于用户消息与 assistant 内容之间,meta 走模型展示名", () => {
  const el = renderFns.renderInsightTurn({
    user: { info: { id: "u1", role: "user", time: { created: 1 }, agent: "octo_insight", model: { providerID: "p", modelID: "raw-model" } }, parts: [{ type: "text", text: "hi" }] },
    assistants: [{ info: { role: "assistant", time: { created: 1, completed: 2 }, error: { name: "MessageAbortedError" } }, parts: [{ type: "text", text: "partial answer" }] }],
  }, new Map(), new Map(), {}, "", { "p/raw-model": "Display Model" })
  const children = [...el.children].map((c) => c.className)
  const dividerIdx = children.findIndex((c) => c.includes("msg-divider"))
  const msgsIdx = children.findIndex((c) => c.includes("insight-msgs"))
  expect(dividerIdx).toBeGreaterThan(-1)
  expect(dividerIdx).toBeLessThan(msgsIdx)
  expect(el.querySelector(".msg-divider .label")!.textContent).toBe("已中断")
  const meta = el.querySelector(".insight-user-meta-head")!.textContent
  expect(meta).toContain("Octo_insight")
  expect(meta).toContain("Display Model")
  expect(meta).not.toContain("raw-model")
  expect(el.querySelector(".insight-user-meta .insight-copy-btn")).not.toBeNull()
  expect(el.querySelector(".insight-text-meta-row[data-interrupted]")).not.toBeNull()
})

test("错误轮:错误卡在 assistant 内容之后且文案解包,普通错误不出分割线", () => {
  const el = renderFns.renderInsightTurn({
    user: { info: { id: "u2", role: "user", time: { created: 1 }, model: { providerID: "p", modelID: "m" } }, parts: [{ type: "text", text: "go" }] },
    assistants: [{ info: { role: "assistant", error: { name: "ProviderAuthError", data: { message: 'Error: {"error":{"message":"token bad"}}' } } }, parts: [] }],
  }, new Map(), new Map(), {}, "", {})
  expect([...el.children].some((c) => c.className.includes("msg-divider"))).toBe(false)
  expect(el.querySelector(".insight-error-card")!.textContent).toBe("token bad")
  expect(el.querySelector(".insight-user-meta .insight-copy-btn")).not.toBeNull()
})

test("上下文超出提示走红卡,附件轮(无文字)不出用户 meta 行", () => {
  const overflowEl = renderFns.renderInsightTurn({
    user: { info: { id: "u3", role: "user", time: { created: 1 }, model: { providerID: "p", modelID: "m" } }, parts: [{ type: "text", text: "go" }] },
    assistants: [{ info: { role: "assistant", error: { name: "ContextOverflowError" } }, parts: [] }],
  }, new Map(), new Map(), {}, "", {})
  expect(overflowEl.querySelector(".error-notice .notice-title")!.textContent).toBe("上下文超出提示")

  const attOnly = renderFns.renderInsightTurn({
    user: { info: { id: "u4", role: "user", time: { created: 1 }, model: { providerID: "p", modelID: "m" } }, parts: [{ type: "file", filename: "a.png", mime: "image/png", url: "data:image/png;base64,x" }] },
    assistants: [],
  }, new Map(), new Map(), {}, "", {})
  expect(attOnly.querySelector(".insight-user-meta")).toBeNull()
})

test("任务卡完成/进行中文案与 insight 页一致", () => {
  const base = { taskId: "t1", submittedAt: 1700000000000, message: "", toolName: "key_findings", resultText: "", lastUpdatedAt: 1 }
  const withFiles = renderFns.buildInsightTaskCard({ ...base, status: "completed", resourceLinks: [{ name: "r.md", uri: "https://e/x" }] })
  expect(withFiles.querySelector(".insight-task-body")!.textContent).toBe("共生成一份文件,请点击查看")
  const noFiles = renderFns.buildInsightTaskCard({ ...base, status: "completed", resourceLinks: [] })
  expect(noFiles.querySelector(".insight-task-body")!.textContent).toBe("分析已完成,请点击查看")
  const processing = renderFns.buildInsightTaskCard({ ...base, status: "processing", resourceLinks: [], message: undefined })
  expect(processing.querySelector(".insight-task-body")!.textContent).toBe("请稍后点击刷新获取结果")
})

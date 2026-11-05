import { expect, test, beforeAll, afterAll } from "bun:test"

// 分享对话查看页的 studio / design 双形态:同一 index.html,按 manifest 根会话的
// agent(octo_studio → studio 会话区,其余 → design 会话区)切换内容与样式。
// studio mock 取自真实会话「生成一张图片」的导出数据,断言与 studio 页面会话区一致。
// mock 数据在 packages/app/mock(不在 octoapp tsconfig 工程内),按字面量提取后 JSON.parse。

// blob 缩略图加载会 fetch /tool/...:测试内无真实后端,stub 成 404 走回退分支
const originalFetch = globalThis.fetch
beforeAll(() => {
  globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 404 }))) as unknown as typeof fetch
})
afterAll(() => {
  globalThis.fetch = originalFetch
})
const html = await Bun.file(new URL("../../public/design/agent/share/index.html", import.meta.url)).text()
const script = html.slice(html.indexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"))
const mockSource = await Bun.file(new URL("../../mock/handlers/share/data.ts", import.meta.url)).text()

function extractJsonLiteral(name: string) {
  const start = mockSource.indexOf(`export const ${name} = `)
  if (start === -1) throw new Error(`mock literal not found: ${name}`)
  const open = mockSource.indexOf("{", start)
  let depth = 0
  let inString = false
  for (let cursor = open; cursor < mockSource.length; cursor++) {
    const char = mockSource[cursor]
    if (inString) {
      if (char === "\\") cursor++
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === "{") depth++
    else if (char === "}") {
      depth--
      if (depth === 0) return JSON.parse(mockSource.slice(open, cursor + 1))
    }
  }
  throw new Error(`unbalanced literal: ${name}`)
}

const MOCK_MANIFEST = extractJsonLiteral("MOCK_MANIFEST")
const MOCK_STUDIO_MANIFEST = extractJsonLiteral("MOCK_STUDIO_MANIFEST")

// 页面 body 结构:渲染依赖 #conversation-list;脚本顶层还会绑定 continue-btn 等事件
function setupPage() {
  // 走 index.html 路径:页面启动 IIFE 解析不到 uniqueId 会直接展示空态,不发请求
  location.href = "http://localhost/design/agent/share/index.html"
  document.body.innerHTML = `
    <header class="header">
      <div class="header-inner">
        <img class="header-logo" />
        <button type="button" class="header-btn" id="continue-btn"></button>
      </div>
      <div class="header-title-bar"><h1 class="header-title" id="session-title"></h1></div>
    </header>
    <dialog class="open-app-dialog" id="open-app-dialog">
      <button type="button" class="dialog-close" id="close-app-dialog">×</button>
      <h2 id="open-app-title"></h2>
      <p id="open-app-description"></p>
      <div class="dialog-action"><a id="open-app-link"></a></div>
      <p class="dialog-hint" id="open-app-hint"></p>
    </dialog>
    <main class="content">
      <div class="chat-scroll-view"><div class="chat-content"><div id="conversation-list"></div></div></div>
    </main>`
  delete document.body.dataset.module
  return document.getElementById("conversation-list")!
}

function render(manifest: unknown) {
  const list = setupPage()
  const page = new Function("document", `${script}\n;return { renderConversation }`)(document) as {
    renderConversation: (manifest: unknown, filePath: string, token: string, list: HTMLElement) => void
  }
  page.renderConversation(manifest, "/designAgentPreview/share-studio-mock", "", list)
  return list
}

test("studio 分享:按 octo_studio 根会话渲染 studio 会话区", () => {
  const list = render(MOCK_STUDIO_MANIFEST)
  expect(document.body.dataset.module).toBe("studio")
  expect(document.getElementById("session-title")!.textContent).toBe("生成一张图片")

  // 16 轮对话,其中 assistant guide 元数据 visible=false 的一轮整轮不展示 → 15 轮
  expect(list.querySelectorAll(".studio-conversation-turn")).toHaveLength(15)
  // studio 形态:不出现 design 会话区的任何元素
  expect(list.querySelector(".turn")).toBeNull()
  expect(list.querySelector(".bubble-user")).toBeNull()
  expect(list.querySelector(".tool-cards")).toBeNull()

  // guide 轮:用户气泡隐藏、助手文案 + 3 个静态快捷入口
  expect(list.textContent).toContain("你好～我可以帮你丰富提示词")
  expect(list.textContent).not.toContain("点击AI推荐")
  expect(list.querySelectorAll(".studio-recommendation-shortcut")).toHaveLength(3)
  expect(list.textContent).toContain("未来科技，英雄战斗，电影质感")

  // 扩写失败轮:助手文案直接展示(13 轮基础 8 条 + 追加 3 轮各 1 条)
  expect(list.querySelectorAll(".studio-assistant-copy")).toHaveLength(11)
  expect(list.textContent).toContain("扩写失败，请重试。")
  expect(list.textContent).toContain("好的，我会根据你的描述创作视频。")
  // 少女长提示词轮的用户气泡保留
  expect(list.textContent).toContain("古典写实风格")

  // 编辑入口轮 ×4(变清晰/抠图/扩图/智能重绘)
  expect(list.querySelectorAll(".studio-assistant-editor-link")).toHaveLength(4)
  expect(list.querySelectorAll(".studio-assistant-editor-link")[0].textContent).toContain("点击前往编辑区")

  // 结果卡:6 张完成 + 2 张创建失败
  const cards = list.querySelectorAll(".studio-result-card")
  expect(cards).toHaveLength(8)
  expect(list.querySelectorAll(".studio-result-card.complete")).toHaveLength(6)
  expect(list.querySelectorAll(".studio-result-card.failed")).toHaveLength(2)
  // 网格:3 组 multi-portrait(2 图)+ 视频 single-landscape + @引用 single-portrait + 4 图 multi-portrait
  const grids = list.querySelectorAll(".studio-result-grid")
  expect(grids).toHaveLength(6)
  expect(list.querySelectorAll(".studio-result-grid.multi-portrait")).toHaveLength(4)
  expect(list.querySelectorAll(".studio-result-grid.single-landscape")).toHaveLength(1)
  expect(list.querySelectorAll(".studio-result-grid.single-portrait")).toHaveLength(1)
  expect(list.querySelectorAll(".studio-result-thumb")).toHaveLength(12)
  // 全部缩略图:6(基础 2 图×3)+ 视频 1 + @引用 1 + 4 图,均为缩略图 img
  expect(list.querySelectorAll(".studio-result-thumb img")).toHaveLength(12)
  // 能力图标:6 张图片生成(基础类)+ 1 张视频生成(icon-2)
  expect(list.querySelectorAll(".studio-result-progress-icon:not([class*='icon-'])")).toHaveLength(7)
  expect(list.querySelectorAll(".studio-result-progress-icon-2")).toHaveLength(1)
  expect(list.textContent).toContain("生成完成")
  expect(list.textContent).toContain("视频生成")
  expect(list.textContent).toContain("创建时间：")
  // 失败卡:创建失败徽标 + 错误文案
  expect(list.textContent).toContain("创建失败")
  expect(list.textContent).toContain("任务创建失败，请检查网络或稍后再试")

  // 视频轮:缩略图容器 + 00:05 时长徽标
  expect(list.querySelectorAll(".studio-result-thumb-video")).toHaveLength(1)
  expect(list.querySelector(".studio-file-manager-media-video-badge-text")!.textContent).toBe("00:05")

  // @引用轮:气泡内 mention chip + data: 图片;参考图行(uploads blob 解析)
  const mentionChip = list.querySelector(".studio-user-bubble-mention")!
  expect(mentionChip.textContent).toContain("竹林国宝熊猫-1")
  expect(mentionChip.querySelector("img")!.src.startsWith("data:image/png;base64,")).toBe(true)
  expect(list.querySelectorAll(".studio-user-input-images")).toHaveLength(2)
  expect(list.querySelectorAll(".studio-user-input-image")).toHaveLength(2)

  // 用户气泡:15 轮中 guide 轮隐藏 → 14 个
  expect(list.querySelectorAll(".studio-user-bubble")).toHaveLength(14)
})

test("design 分享:非 octo_studio 根会话保持 design 会话区", () => {
  const list = render(MOCK_MANIFEST)
  expect(document.body.dataset.module ?? "").toBe("")
  expect(list.querySelector(".studio-conversation")).toBeNull()
  expect(list.querySelector(".turn")).toBeTruthy()
  expect(list.querySelector(".bubble-user")).toBeTruthy()
})

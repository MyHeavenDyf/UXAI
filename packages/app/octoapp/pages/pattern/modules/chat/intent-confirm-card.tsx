import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { showToast } from "@opencode-ai/ui/toast"
import type { IntentConfirmDimension, IntentConfirmResult } from "../../agents/proto-intent-confirm"
import { readPagePatternMd } from "../../utils/pattern-resource"
import type { BlockModuleItem } from "../../utils/pattern-resource"
import "../../assets/style/chat/intent-confirm-card.css"

export type IntentConfirmAnswers = Record<string, { selections: string[]; supplement: string }>

export function IntentConfirmCard(props: {
  result: IntentConfirmResult
  blockMatches: BlockModuleItem[]
  blockMatching: boolean
  blockMatchError?: boolean
  initialStep?: "patterns" | "blocks"
  onMatchPattern: (selectedItem: IntentConfirmDimension | null) => void
  onConfirm: (answers: IntentConfirmAnswers, enrichedInput: string, selectedBlocks: BlockModuleItem[]) => void
}): JSX.Element {
  // 匹配到的 page pattern 列表
  const hasResults = createMemo(() => props.result.results.length > 0)
  // 当前卡片步骤：patterns = page pattern 选择，blocks = block 模板选择
  const [step, setStep] = createSignal<"patterns" | "blocks">(props.initialStep ?? "patterns")
  // 切换 session 时 initialStep 会变，同步更新 step（用户手动点上一步/下一步不受影响，因为只依赖 initialStep）
  createEffect(() => {
    setStep(props.initialStep ?? "patterns")
  })
  // 用户选中的 page pattern id（单选）
  const [selectedPatternId, setSelectedPatternId] = createSignal<string | null>(null)
  // 用户选中的 block 模板：category → name（每个分类互斥，只能选一个）
  const [selectedBlocks, setSelectedBlocks] = createSignal<Record<string, string>>({})
  // 预览模态框的图片 URL（点击放大缩略图时设置，null 表示关闭）
  const [previewModalUrl, setPreviewModalUrl] = createSignal<string | null>(null)

  // page pattern 步骤点「下一步」/「跳过」：拉取选中 item 的 md 文档，放到 content 上再传给回调
  async function handleBlockPatterns() {
    const found = props.result.results.find(r => r.id === selectedPatternId()) ?? null
    let selected = found
    if (found?.file) {
      const mdResult = await readPagePatternMd(found.file)
      debugger
      if (mdResult.success && mdResult.content) {
        selected = { ...found, content: mdResult.content }
      } else {
        showToast({ title: "请求Pattern资源失败" })
        // 由于环境不通，所以先在此处通过mock的形式做：
        selected = { ...found, content: `# ManagementPageTable

## 1. 核心目标

生成**高密度、状态驱动、数据实时性强**的网络运维管理页面。  

---

## 2. 页面整体布局规范

### 2.1 画布结构（从上到下，从左到右）

| 区域名称 | 标识 | 是否必选 | 尺寸规范 |
| :--- | :--- | :--- | :--- |
| **顶部导航栏** | \`Top Navigation\` | **必选** | 高度固定 \`56px\`，背景深色（\`#001529\`） |
| **左侧导航栏** | \`Left Sidebar\` | **可选**（管理页默认开启） | 宽度 \`200px\`（收起态 \`64px\`），背景 \`#002140\` |
| **标题与操作区** | \`Title & Actions\` | **必选** | 高度 \`64px\`，包含返回/标题/主按钮 |
| **统计区** | \`Statistics\` | **可选**（仪表盘必选） | 高度自适应（建议 \`120px\`），内边距 \`16px\` |
| **内容区** | \`Content Area\` | **必选** | 占据剩余全部高度（含筛选栏 + 表格/列表） |

---

## 3. 页面模块原子库（Component Atoms）

AI 在生成代码时，必须优先从以下预置模块库中调用组件进行拼装：

### 3.1 顶部导航栏（Top Navigation）
- **左段**：Logo + 系统名称（"NetOps 管理平台"）。
- **中段**：全局命令搜索框（\`Cmd + K\` 呼起）。
- **右段**：环境标签（生产/测试/预发）、告警铃铛（带未读红点徽标）、全屏切换、用户头像下拉菜单（个人中心/退出）。

### 3.2 左侧导航栏（Left Sidebar）
- **结构**：支持多级树形菜单（父级可展开/收起）。
- **交互**：根据当前路由 \`$route.path\` 自动高亮当前菜单项及其父级。

### 3.3 统计区（Statistics Area）
- **原子组件**：\`Statistic Card\`。
- **包含元素**：标题、主数值、单位、环比趋势（上升/下降百分比）、微型趋势图（Sparkline）。
- **典型指标**：总资产数、在线率（%）、异常告警总数、今日工单量、平均延迟。

### 3.4 基础表格（Base Table）—— *默认首选*
- **组成结构**：筛选搜索栏（\`Search Bar\`） + 操作按钮组（\`Button Group\`：新建、批量删除、导出） + 数据表格（\`Data Table\`）。
- **列固定规范**：必须包含多选复选框、序号列、状态标签列（\`Status Tag\`）、"操作"列（固定在表格右侧，宽度不低于 \`220px\`）。

### 3.5 带标签的表格（Tabs Table）
- **场景**：需要按状态维度水平切分数据时。
- **规则**：Tab 切换时仅刷新表格数据（\`Table Data\`），不刷新统计区或标题区。

### 3.6 卡片模式（Card Mode）
- **场景**：展示设备拓扑摘要、机房缩略图或详情密度不高的数据。
- **布局**：响应式网格布局（\`Grid\`），每张卡片包含设备图标、名称、IP 地址、状态指示灯（在线/离线/告警）和最后更新时间。

### 3.7 列表模式（List Mode）
- **场景**：展示审计日志、操作历史、变更时间线。
- **布局**：垂直时间轴（\`Timeline\`）风格，左侧是时间点，右侧是操作内容和结果状态。
` }
      }
    }
    props.onMatchPattern(selected)
    setStep("blocks")
  }

  function toggleBlock(category: string, id: string) {
    setSelectedBlocks(prev => {
      const next = { ...prev }
      if (next[category] === id) {
        delete next[category]
      } else {
        next[category] = id
      }
      return next
    })
  }

  function handleConfirm() {
    
    const selectedIds = Object.values(selectedBlocks())
    const blocks = props.blockMatches.filter(m => selectedIds.includes(m.id))
    // 在这个阶段，文斌会写一个网络请求，获取zip，解压JSON，存储到block的content属性里面去
    
    debugger
    var test= "111"
    // props.onConfirm({}, "", blocks)
  }

  return (
    <div class="ic-card">
      <div class="ic-card-head">
        <span class="ic-card-icon">?</span>
        <div class="ic-card-titles">
          <div class="ic-card-title">{step() === "patterns" ? "典型页面匹配" : "模块模板匹配"}</div>
          <div class="ic-card-desc">
            {step() === "patterns" ? "请选择最合适的典型页面模板" : "请选择需要使用的模块模板"}
          </div>
        </div>
      </div>

      {/* 步骤 1：page pattern 选择 */}
      <Show when={step() === "patterns"}>
        <div class="ic-card-body">
          <Show when={hasResults()} fallback={
            <div class="ic-card-empty">未匹配到合适的页面模板</div>
          }>
            <div class="ic-card-block-grid">
              <For each={props.result.results}>
                {(item) => {
                  const checked = () => selectedPatternId() === item.id
                  return (
                    <div
                      class={`ic-card-block-card ${checked() ? "ic-card-block-card-on" : ""}`}
                      onClick={() => setSelectedPatternId(prev => prev === item.id ? null : item.id)}
                    >
                      <Show when={item.preview}>
                        <div class="ic-card-block-preview-wrap">
                          <img
                            class="ic-card-block-preview"
                            src={item.preview}
                            alt={item.name}
                          />
                          <button
                            class="ic-card-block-zoom"
                            onClick={(e) => { e.stopPropagation(); setPreviewModalUrl(item.preview!) }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>
                          </button>
                        </div>
                      </Show>
                      <span class="ic-card-block-name">{item.name}</span>
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>
        </div>

        <div class="ic-card-foot">
          <Show when={hasResults()}>
            <button class="ic-card-submit-btn" onClick={handleBlockPatterns} disabled={!selectedPatternId()}>
              下一步
            </button>
          </Show>
          <Show when={!hasResults()}>
            <button class="ic-card-submit-btn" onClick={handleBlockPatterns}>
              跳过
            </button>
          </Show>
        </div>
      </Show>

      {/* 步骤 2：block 模板选择 */}
      <Show when={step() === "blocks"}>
        <div class="ic-card-body">
          <Show when={!props.blockMatching} fallback={
            <div class="ic-card-loading">
              <span class="ic-card-spinner" />
              <span>正在匹配模块模板...</span>
            </div>
          }>
            <Show when={!props.blockMatchError} fallback={
              <div class="ic-card-error">匹配出错，请重试</div>
            }>
              <Show when={props.blockMatches.length > 0} fallback={
                <div class="ic-card-empty">未匹配到合适的模块模板</div>
              }>
              <For each={Object.entries(
                props.blockMatches.reduce((acc, m) => {
                  const cat = m.category ?? "其他"
                  if (!acc[cat]) acc[cat] = []
                  acc[cat].push(m)
                  return acc
                }, {} as Record<string, typeof props.blockMatches>)
              )}>
                {([category, matches]) => (
                  <div class="ic-card-block-group">
                    <div class="ic-card-block-category">{category}</div>
                    <div class="ic-card-block-grid">
                      <For each={matches}>
                        {(match) => {
                          const cat = category
                          const checked = () => selectedBlocks()[cat] === match.id
                          return (
                            <div
                              class={`ic-card-block-card ${checked() ? "ic-card-block-card-on" : ""}`}
                              onClick={() => toggleBlock(cat, match.id)}
                            >
                              <Show when={match.preview}>
                                <div class="ic-card-block-preview-wrap">
                                  <img
                                    class="ic-card-block-preview"
                                    src={match.preview!}
                                    alt={match.name}
                                  />
                                  <button
                                    class="ic-card-block-zoom"
                                    onClick={(e) => { e.stopPropagation(); setPreviewModalUrl(match.preview!) }}
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>
                                  </button>
                                </div>
                              </Show>
                              <span class="ic-card-block-name">{match.name}</span>
                            </div>
                          )
                        }}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </Show>
            </Show>
          </Show>
        </div>

        <div class="ic-card-foot">
          <button class="ic-card-next-btn" onClick={() => setStep("patterns")} disabled={props.blockMatching}>
            上一步
          </button>
          <button class="ic-card-next-btn" onClick={() => props.onMatchPattern(null)} disabled={props.blockMatching}>
            重试
          </button>
          <Show when={!props.blockMatching}>
            <button class="ic-card-submit-btn" onClick={handleConfirm}>
              {props.blockMatchError || props.blockMatches.length === 0 ? "跳过" : "下一步"}
            </button>
          </Show>
        </div>
      </Show>

      <Show when={previewModalUrl()}>
        <div class="ic-card-preview-modal" onClick={() => setPreviewModalUrl(null)}>
          <img class="ic-card-preview-modal-img" src={previewModalUrl()!} alt="preview" />
        </div>
      </Show>
    </div>
  )
}

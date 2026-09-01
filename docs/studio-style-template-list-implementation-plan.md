# Studio 风格模板菜单查询接口实现方案

## 1. 文档状态

- 当前阶段：需求分析完成，尚未进入代码实现。
- 文档用途：记录 `studio-style-template-menu` 中“创意广场 / 我的模板”的模板列表查询、分页加载、滚动触底触发、前后端接口链路和涉及文件。
- 最后更新：2026-09-01。
- 关联前置：
  - `docs/studio-image-template-implementation-plan.md`：风格模板入口和浮窗。
  - `docs/studio-template-submit-implementation-plan.md`：模板发布接口。
- 视觉参考：
  - Pixso 链接：`https://pixso.cn/app/design/27L8ZYe3wLXH3yaWPaAe8Q?item-id=1081:497678`
  - 已通过 Pixso MCP 读取节点 `1081:497678`（`容器 72114`）并完成截图核对。
  - 本文中的浮窗、Tab、卡片、标签、字体、间距和颜色规格均以该节点当前数据为准。
  - MCP 截图复核时，实际可见内容只有两个 Tab（“创意广场”“我的模板”）和 `+ 创建模板` 按钮；如果 DSL 中出现组件实例自带的隐藏“选项”或不可见箭头图层，本次实现忽略，不额外渲染。

## 2. 核心结论

模板列表查询接口沿用现有 Studio 内部接口设计，不在前端直连供应商 URL。

推荐调用链：

```text
StudioStyleTemplateMenu
  -> StudioComposer 透传 onListStyleTemplates
    -> studio-page.tsx 注入 user_id 并请求本地 GET /studio/template-list
      -> packages/opencode/src/server/routes/instance/studio.ts
      -> packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts
      -> packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts
        -> packages/opencode/src/studio/studio-service.ts
          -> packages/opencode/src/tool/internel_style_template.ts 调供应商查询接口
```

关键点：

- 查询接口是 `GET`。
- 入参通过 query string 传递。
- `user_id` 由 `studio-page.tsx` 使用 `uiplusUserAccount()` 注入，和发布接口的 `creator_user_id` 来源保持一致。
- `only_public` 根据菜单 tab 决定：
  - 创意广场：`1`
  - 我的模板：`0`
- 打开浮窗时立即请求第一页。
- 内容区域可滚动，滚到底时加载下一页。
- 成功后 `page + 1`。
- 使用接口返回的 `total` 判断是否还有下一页。
- 模板封面图取接口返回 item 的 `example_images[0]?.url`。
- 模板封面左下角展示模板类型标签：
  - 风格模板显示“风格”。
  - 灵感配方显示“配方”。
  - 两种类型复用同一个 `ic_public_photo_group` 图标，只切换标签文案。
  - 对应图标资源统一放在 `packages/app/public/studio`。
- Header 区域按截图可见样式实现：
  - 左侧只渲染“创意广场 / 我的模板”两个 Tab。
  - 右侧创建入口只渲染 `+ 创建模板`，不渲染下拉箭头。
  - DSL 中来自组件定义的隐藏占位项不参与 DOM 和样式实现。
- 列表严格按设计稿使用三列网格：卡片宽 `120px`，封面 `120px × 120px`，列间距和行间距均为 `8px`。
- 设计稿只展示封面、类型标签和单行标题，不展示模板简介。
- Hono route 和 Effect `httpapi` route 都要补，避免不同运行入口下出现 404。

## 3. 供应商接口

### 3.1 请求方式

```http
GET
```

### 3.2 请求参数

```ts
type StyleTemplateListRequest = {
  user_id: string
  only_public: 0 | 1
  page: number
  page_size: 20
}
```

query 示例：

```text
/studio/template-list?user_id=xxx&only_public=1&page=1&page_size=20
```

### 3.3 参数说明

| 参数 | 来源 | 规则 |
|---|---|---|
| `user_id` | `uiplusUserAccount()` | 和发布接口的 `creator_user_id` 来源一致 |
| `only_public` | 当前 tab | 创意广场传 `1`；我的模板传 `0` |
| `page` | 菜单分页状态 | 初始值为 `1`；接口成功后加 `1` |
| `page_size` | 固定值 | 固定传 `20` |

## 4. 供应商返回格式

后续风格模板相关普通接口统一使用：

```ts
type StyleTemplateBusinessResponse<T> = {
  resp_code: number
  resp_msg: string
  result: T
}
```

模板列表查询接口的 `result` 为：

```ts
type StyleTemplateListResult = {
  data: StyleTemplateListItem[]
  total: number
}
```

其中 `data` 是模板对象数组，数组项结构和发布接口入参相同，并额外多一个 `idx` 字段作为模板 id。

```ts
type StyleTemplateListItem = StudioTemplatePublishInput & {
  idx: string
}
```

接口成功条件：

```ts
resp_code === 200
```

否则按业务失败处理，错误信息优先取 `resp_msg`。

## 5. 前端列表类型

建议在 `packages/app/octoapp/pages/studio/studio-style-template-menu.tsx` 或共享类型文件中定义：

```ts
export type StudioStyleTemplateListInput = {
  only_public: 0 | 1
  page: number
  page_size: 20
}

export type StudioStyleTemplateListResult = {
  data: StudioStyleTemplateListItem[]
  total: number
}

export type StudioStyleTemplateListItem = StudioTemplatePublishInput & {
  idx: string
}
```

`user_id` 不建议由 `StudioStyleTemplateMenu` 传入，而是由 `studio-page.tsx` 注入。这样菜单组件不感知账号来源。

## 6. `StudioStyleTemplateMenu` 实现细节

文件：

`packages/app/octoapp/pages/studio/studio-style-template-menu.tsx`

### 6.1 新增 props

```ts
export function StudioStyleTemplateMenu(props: {
  onCreateTemplate: () => void
  onListTemplates?: (input: StudioStyleTemplateListInput) => Promise<StudioStyleTemplateListResult>
}): JSX.Element
```

### 6.2 状态设计

```ts
const [section, setSection] = createSignal<StyleTemplateSection>("creative-square")
const [items, setItems] = createSignal<StudioStyleTemplateListItem[]>([])
const [page, setPage] = createSignal(1)
const [total, setTotal] = createSignal<number>()
const [loading, setLoading] = createSignal(false)
const [error, setError] = createSignal("")
```

固定分页大小：

```ts
const STYLE_TEMPLATE_PAGE_SIZE = 20
```

是否还有下一页：

```ts
const hasMore = createMemo(() => items().length < (total() ?? Number.POSITIVE_INFINITY))
```

用 `undefined` 表示“尚未请求”，这样首次加载允许请求；接口明确返回 `total: 0` 后，`hasMore()` 会变为 `false`，不会因为空列表反复请求后续页。

### 6.3 tab 到 `only_public` 的映射

```ts
const onlyPublic = () => section() === "creative-square" ? 1 : 0
```

| tab | section | only_public |
|---|---|---|
| 创意广场 | `creative-square` | `1` |
| 我的模板 | `mine` | `0` |

### 6.4 首次打开请求

组件挂载时调用：

```ts
onMount(() => {
  void loadTemplates({ reset: true })
})
```

因为该浮窗组件只在打开时渲染，`onMount` 即可表示“刚打开调用一次”。

如果后续菜单改成不卸载、只隐藏，则需要额外根据打开状态触发重置请求。

### 6.5 切换 tab 请求

点击 tab 时：

```ts
function switchSection(next: StyleTemplateSection) {
  if (section() === next) return
  setSection(next)
  void loadTemplates({ reset: true, section: next })
}
```

`reset: true` 时：

- 清空列表。
- `page` 重置为 `1`。
- `total` 重置为 `undefined`。
- 清空错误信息。
- 请求第一页。

### 6.6 请求并发保护

需要避免：

- 滚动触底连续触发多次。
- 切 tab 后旧请求慢返回，覆盖新 tab 数据。

建议使用请求序号：

```ts
let requestSeq = 0
```

每次请求：

```ts
const seq = ++requestSeq
```

响应回来后判断：

```ts
if (seq !== requestSeq) return
```

### 6.7 加载函数

伪代码：

```ts
async function loadTemplates(input: { reset?: boolean; section?: StyleTemplateSection } = {}) {
  if (!props.onListTemplates) return
  if (!input.reset && (loading() || !hasMore())) return

  const seq = ++requestSeq
  const targetSection = input.section ?? section()
  const nextPage = input.reset ? 1 : page()

  setLoading(true)
  setError("")
  if (input.reset) {
    setItems([])
    setTotal(undefined)
    setPage(1)
  }

  try {
    const result = await props.onListTemplates({
      only_public: targetSection === "creative-square" ? 1 : 0,
      page: nextPage,
      page_size: STYLE_TEMPLATE_PAGE_SIZE,
    })
    if (seq !== requestSeq) return

    setItems((current) => input.reset ? result.data : [...current, ...result.data])
    setTotal(result.total)
    setPage(nextPage + 1)
  } catch (error) {
    if (seq !== requestSeq) return
    setError(error instanceof Error ? error.message : String(error))
  } finally {
    if (seq === requestSeq) setLoading(false)
  }
}
```

`reset: true` 的请求不能被 `loading()` 拦截，否则正在加载“创意广场”时切换到“我的模板”只会切换 Tab，不会发起新请求。重置请求通过递增 `requestSeq` 使旧请求自然失效；普通滚动加载仍由 `loading()` 防重入。

### 6.8 滚动触底加载

`.studio-style-template-content` 设置滚动，并绑定：

```tsx
<div
  class="studio-style-template-content"
  role="tabpanel"
  onScroll={handleScroll}
>
```

触底判断：

```ts
function handleScroll(event: Event) {
  const target = event.currentTarget as HTMLDivElement
  if (target.scrollTop + target.clientHeight < target.scrollHeight - 8) return
  void loadTemplates()
}
```

### 6.9 列表渲染

Pixso 节点 `1081:497678` 已确认使用三列卡片网格。每张卡片只展示封面、封面左下角类型标签和单行标题。

模板卡片展示内容：

| UI 内容 | 数据来源 | 规则 |
|---|---|---|
| 封面图 | `example_images[0]?.url` | 直接取接口返回结果第一张示例图的 `url` 展示 |
| 类型标签文案 | `template_type` | `extract_style` 显示“风格”；`preset_recipe` 显示“配方” |
| 类型标签图标 | `packages/app/public/studio` | 两种类型复用设计稿中的 `ic_public_photo_group` 图标 |
| 标题 | `title` | 单行展示，超出 `120px` 宽度时省略 |

设计稿未展示 `style_description`、`style_keywords` 或 `play_description`，本次列表卡片不要增加简介行。

封面图规则：

```tsx
<img src={item.example_images[0]?.url} alt="" />
```

如果 `example_images[0]?.url` 不存在：

- 不发额外请求。
- 使用占位背景或空封面样式。
- 仍展示标题和类型标签。

类型标签规则：

```ts
const templateTypeLabel = (item: StudioStyleTemplateListItem) =>
  item.template_type === "extract_style" ? "风格" : "配方"
```

类型图标资源：

- 资源目录：`packages/app/public/studio`
- 设计稿图层名：`ic_public_photo_group`。
- 风格和配方标签使用同一个 `14px × 14px` 白色图标，不要按类型维护两套资源。
- 当前资源目录中没有与设计稿一致的图标，应按现有命名风格新增 `studio_template_photo_group.svg`。
- 组件中通过固定静态路径引用：

```tsx
<img
  class="studio-style-template-card-type-icon"
  src="/studio/studio_template_photo_group.svg"
  alt=""
/>
```

每个卡片 key 使用：

```ts
item.idx
```

如果首屏为空：

```text
暂无模板
```

加载中：

```text
加载中...
```

加载失败：

显示错误信息，后续可加“重试”按钮。

### 6.10 Pixso 视觉规格

以下规格来自节点 `1081:497678` 及其子节点，并已与节点截图核对：

| 区域 | 规格 |
|---|---|
| 浮窗 | `408px × 388px`；白色背景；`12px` 圆角；阴影 `0 8px 24px rgba(0, 0, 0, 0.08)` |
| 浮窗内边距 | 水平 `16px`；顶部 `16px` |
| 顶部栏 | `376px × 28px`；左右两端对齐；垂直居中 |
| 顶部栏到列表 | `24px` |
| Tab 组 | `150px × 28px`；`2px` 内边距；选项间距 `2px`；`4px` 圆角；浅灰底 |
| Tab 选项 | 单项 `72px × 24px`；水平内边距 `12px`；`4px` 圆角 |
| Tab 文本 | `12px`，`HarmonyHeiTi`，字重 `400`，行高 `100%`；选中态 `#191919`，未选中态 `#777777` |
| 选中 Tab | 白色背景；未选中 Tab 透明背景 |
| 创建模板 | `12px` 加号 + `4px` 间距 + `48px` 文案，总内容宽 `64px`；文本 `12px/100%`、`#191919` |
| 创建模板可见内容 | 只显示 `+ 创建模板`；不显示 DSL 组件内可能存在但截图不可见的箭头 |
| 列表 | 三列网格，内容宽 `376px`；列间距 `8px`；行间距 `8px` |
| 卡片 | `120px × 140px` |
| 封面 | `120px × 120px`；`4px` 圆角；图片填充并裁切（`object-fit: cover`） |
| 封面到标题 | `8px` |
| 标题 | 宽 `120px`；高 `12px`；`12px`，`HarmonyHeiTi`，字重 `400`，行高 `100%`，颜色 `#191919`；单行省略 |
| 类型标签 | 位于封面左下角，距左、下各 `6px`；高 `24px`；`4px` 圆角；背景 `rgba(25, 25, 25, 0.8)` |
| 类型标签内容 | 水平内边距 `6px`；图标 `14px × 14px`；图文间距 `4px`；文案 `12px/100%`、白色 |

截图中的第二行长标题会被单行截断，因此标题必须设置：

```css
overflow: hidden;
text-overflow: ellipsis;
white-space: nowrap;
```

设计稿列宽是固定值。浮窗正常宽度下使用 `grid-template-columns: repeat(3, 120px)`；现有 `max-width: calc(100vw - 16px)` 生效导致空间不足时，可保留横向尺寸并让内容区滚动，不要缩放封面或改变设计稿卡片比例。

## 7. `StudioComposer` 透传

文件：

`packages/app/octoapp/pages/studio/studio-composer.tsx`

需要新增 props：

```ts
onListStyleTemplates?: (input: StudioStyleTemplateListInput) => Promise<StudioStyleTemplateListResult>
```

打开 `StudioStyleTemplateMenu` 时传入：

```tsx
<StudioStyleTemplateMenu
  onCreateTemplate={...}
  onListTemplates={props.onListStyleTemplates}
/>
```

## 8. `studio-page.tsx` 实现

文件：

`packages/app/octoapp/pages/studio-page.tsx`

### 8.1 新增本地请求函数

```ts
async function listStudioStyleTemplates(input: StudioStyleTemplateListInput): Promise<StudioStyleTemplateListResult> {
  const current = server.current
  if (!current) throw new Error("No active server.")

  const url = new URL("/studio/template-list", current.http.url)
  url.searchParams.set("user_id", uiplusUserAccount())
  url.searchParams.set("only_public", String(input.only_public))
  url.searchParams.set("page", String(input.page))
  url.searchParams.set("page_size", String(input.page_size))

  const headers: Record<string, string> = {
    ...directoryHeader(projectDir()),
  }

  if (current.http.password) {
    headers.Authorization = `Basic ${authTokenFromCredentials({
      username: current.http.username,
      password: current.http.password,
    })}`
  }

  const response = await fetch(url, {
    method: "GET",
    headers,
  })

  const bodyText = await response.text()
  if (!response.ok) throw new Error(formatStudioGenerationError(response, bodyText))

  return JSON.parse(bodyText) as StudioStyleTemplateListResult
}
```

### 8.2 传给 StudioComposer

两个 `StudioComposer` 调用点都需要传：

```tsx
onListStyleTemplates={listStudioStyleTemplates}
```

## 9. opencode tool 实现

文件：

`packages/opencode/src/tool/internel_style_template.ts`

### 9.1 Endpoint

在 `InternalStyleTemplateEndpointPreset` 中新增：

```ts
styleTemplateListUrl: string
```

新增 env override：

```ts
IMAGE_STYLE_TEMPLATE_LIST_URL
```

三环境 endpoint 都需要补字段，未配置时仍可暂用 `"xx"`。

### 9.2 请求类型

```ts
export type StyleTemplateListRequest = {
  user_id: string
  only_public: 0 | 1
  page: number
  page_size: number
}
```

### 9.3 返回类型

```ts
export type StyleTemplateListResult = {
  data: Array<StyleTemplatePublishRequest & { idx: string }>
  total: number
}
```

### 9.4 调用函数

```ts
export async function listInternalStyleTemplates(input: StyleTemplateListRequest): Promise<StyleTemplateListResult>
```

实现规则：

- 从 env 或环境 endpoint 取 URL。
- URL 未配置时报错。
- 用 `URLSearchParams` 追加 query。
- GET 请求。
- 使用内部鉴权 header。
- HTTP 非 2xx 抛错。
- 解析 `{ resp_code, resp_msg, result }`。
- `resp_code !== 200` 时抛业务错误。
- `resp_code === 200` 时返回 `result`。

需要校验 `result` 至少满足：

```ts
{
  data: Array.isArray(result.data),
  total: typeof result.total === "number"
}
```

## 10. opencode service 实现

文件：

`packages/opencode/src/studio/studio-service.ts`

新增：

```ts
export type StudioTemplateListRequest = StyleTemplateListRequest
export type StudioTemplateListResult = StyleTemplateListResult

export async function listTemplates(input: StudioTemplateListRequest): Promise<StudioTemplateListResult> {
  return listInternalStyleTemplates(input)
}
```

## 11. Hono route

文件：

`packages/opencode/src/server/routes/instance/studio.ts`

新增 query schema：

```ts
const StudioTemplateListQuery = z.object({
  user_id: z.string(),
  only_public: z.coerce.number().pipe(z.union([z.literal(0), z.literal(1)])),
  page: z.coerce.number().int().min(1),
  page_size: z.coerce.number().int().min(1).max(100),
})
```

新增 route：

```ts
.get(
  "/template-list",
  validator("query", StudioTemplateListQuery),
  async (c) => c.json(await listTemplates(c.req.valid("query"))),
)
```

## 12. Effect httpapi route

需要同步补，避免不同入口下 404。

### 12.1 groups/studio.ts

文件：

`packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`

新增 path：

```ts
templateList: `${root}/template-list`
```

新增 query schema：

```ts
export const StudioTemplateListQuery = Schema.Struct({
  user_id: Schema.String,
  only_public: Schema.Literal(0, 1),
  page: Schema.Int,
  page_size: Schema.Int,
})
```

新增 endpoint：

```ts
HttpApiEndpoint.get("listTemplates", StudioPaths.templateList, {
  query: StudioTemplateListQuery,
  success: described(Schema.Unknown, "Studio template list result"),
  error: [HttpApiError.BadRequest, ApiStudioGenerationError],
})
```

### 12.2 handlers/studio.ts

文件：

`packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts`

新增 handler：

```ts
const listTemplatesHandler = Effect.fn("StudioHttpApi.listTemplates")(function* (ctx: {
  query: typeof StudioTemplateListQuery.Type
}) {
  const instance = yield* InstanceState.context
  return yield* Effect.tryPromise({
    try: () => Instance.restore(instance, () => listTemplates(ctx.query)),
    catch: (error) =>
      new ApiStudioGenerationError({
        name: "StudioGenerationError",
        data: {
          message: error instanceof Error ? error.message : String(error),
        },
      }),
  })
})
```

并注册：

```ts
.handle("listTemplates", listTemplatesHandler)
```

## 13. 样式实现

文件：

`packages/app/octoapp/pages/studio/studio-08.css`

当前 CSS 中浮窗已经是 `408px × 388px`、`12px` 圆角，但顶部栏、Tab 和创建按钮的尺寸大于设计稿，需要按第 6.10 节收敛。内容区需要开启纵向滚动：

```css
.studio-style-template-content {
  min-height: 0;
  overflow-y: auto;
}
```

关键现状差异：

| 选择器 | 当前实现 | Pixso 目标 |
|---|---|---|
| `.studio-style-template-header` | 高 `64px`、水平 padding `20px` | 内容高 `28px`、顶部和水平留白 `16px` |
| `.studio-style-template-tabs` | 高 `36px`、padding `3px`、圆角 `8px` | `150px × 28px`、padding `2px`、圆角 `4px` |
| `.studio-style-template-tab` | 高 `30px`、字号 `14px`、圆角 `6px` | `72px × 24px`、字号 `12px`、圆角 `4px` |
| `.studio-style-template-create` | 高 `32px`、字号 `14px`、图标 `16px` | 内容高 `12px`、字号 `12px`、图标 `12px` |

实现时不要保留当前较大的 Header 控件尺寸，否则列表起始位置和可视卡片数量会与设计稿不一致。

Header 实现注意事项：

- 只按截图可见内容实现两个真实 Tab，不根据组件内部隐藏节点额外生成“选项”。
- “创建模板”按钮只包含加号图标和文案，不追加箭头图标。
- 加号可以优先复用当前已有公共资源；若尺寸或颜色不匹配，再按 `12px × 12px` 规格补资源。

可新增基础列表样式：

- `.studio-style-template-list`
- `.studio-style-template-card`
- `.studio-style-template-card-cover`
- `.studio-style-template-card-cover-image`
- `.studio-style-template-card-type`
- `.studio-style-template-card-type-icon`
- `.studio-style-template-card-title`
- `.studio-style-template-state`

模板封面建议样式职责：

- `.studio-style-template-list`：`display: grid`，三列 `120px`，行列间距均为 `8px`。
- `.studio-style-template-card`：宽 `120px`、高 `140px`，封面和标题间距 `8px`。
- `.studio-style-template-card-cover`：`120px × 120px`、`4px` 圆角、相对定位并裁切溢出内容。
- `.studio-style-template-card-cover-image`：铺满封面并使用 `object-fit: cover`。
- `.studio-style-template-card-type`：绝对定位 `left: 6px; bottom: 6px`，高 `24px`，水平 padding `6px`，图文间距 `4px`，背景 `rgba(25, 25, 25, 0.8)`，圆角 `4px`。
- `.studio-style-template-card-type-icon`：固定 `14px × 14px`，资源来自 `packages/app/public/studio/studio_template_photo_group.svg`。
- `.studio-style-template-card-title`：`12px/100%`、`#191919`，单行省略。

示意：

```tsx
<div class="studio-style-template-card-cover">
  <Show when={item.example_images[0]?.url}>
    {(cover) => (
      <img class="studio-style-template-card-cover-image" src={cover()} alt="" />
    )}
  </Show>
  <div class="studio-style-template-card-type">
    <img
      class="studio-style-template-card-type-icon"
      src="/studio/studio_template_photo_group.svg"
      alt=""
    />
    <span>{templateTypeLabel(item)}</span>
  </div>
</div>
```

注意：

- 图标资源只放在 `packages/app/public/studio`，不要放在组件目录。
- 只新增一个 `studio_template_photo_group.svg`；“风格”和“配方”复用该资源。
- `studio-style-template-content` 承担滚动，Header 不随列表滚动。
- 空状态、加载状态和错误状态在内容区居中显示，不改变 Header 尺寸。

## 14. 涉及修改文件清单

### 14.1 前端

1. `packages/app/octoapp/pages/studio/studio-style-template-menu.tsx`
   - 新增列表查询 props。
   - 新增分页状态。
   - 新增首次加载。
   - 新增 tab 切换重置加载。
   - 新增滚动触底加载。
   - Header 只渲染“创意广场 / 我的模板”两个 Tab 和 `+ 创建模板` 按钮。
   - 按 Pixso 设计稿渲染列表/空状态/加载状态/错误状态。
   - 模板封面取 `example_images[0]?.url`。
   - 模板类型标签显示“风格/配方”，并在文案左侧显示共用的 `ic_public_photo_group` 图标。
   - 卡片只渲染封面、类型标签和单行标题，不渲染简介。

2. `packages/app/octoapp/pages/studio/studio-composer.tsx`
   - 新增 `onListStyleTemplates` props。
   - 传给 `StudioStyleTemplateMenu`。

3. `packages/app/octoapp/pages/studio-page.tsx`
   - 新增 `listStudioStyleTemplates`。
   - 注入 `user_id: uiplusUserAccount()`。
   - 传给两个 `StudioComposer` 调用点。

4. `packages/app/octoapp/pages/studio/studio-08.css`
   - 补滚动样式。
   - 将现有 Header、Tab、创建按钮调整为 Pixso 尺寸。
   - 补三列网格和 `120px × 140px` 卡片样式。
   - 补 `120px × 120px` 封面、类型标签、共用类型图标、标题单行省略样式。

5. `packages/app/public/studio`
   - 新增设计稿 `ic_public_photo_group` 对应资源 `studio_template_photo_group.svg`。
   - 风格和配方标签复用同一个文件，不新增两套类型图标。

### 14.2 opencode

1. `packages/opencode/src/tool/internel_style_template.ts`
   - 新增列表 endpoint 配置。
   - 新增 `StyleTemplateListRequest`。
   - 新增 `StyleTemplateListResult`。
   - 新增 `listInternalStyleTemplates`。

2. `packages/opencode/src/studio/studio-service.ts`
   - 新增 `StudioTemplateListRequest`。
   - 新增 `StudioTemplateListResult`。
   - 新增 `listTemplates`。

3. `packages/opencode/src/server/routes/instance/studio.ts`
   - 新增 Hono `GET /studio/template-list`。

4. `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`
   - 新增 Effect httpapi path、query schema、endpoint。

5. `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts`
   - 新增 Effect httpapi handler。

## 15. 验证计划

实现后运行：

```bash
cd packages/opencode
bun typecheck
```

```bash
cd packages/app
bun typecheck
```

手动验证：

1. 打开 Studio。
2. 点击“风格模板”。
3. 浮窗打开后立即请求：
   - `GET /studio/template-list`
   - `only_public=1`
   - `page=1`
   - `page_size=20`
4. 请求成功后列表展示，并且内部 `page` 变为 `2`。
5. 滚动到底，再请求下一页。
6. 切换到“我的模板”：
   - 清空原列表。
   - 请求 `only_public=0&page=1&page_size=20`。
7. 快速切换 tab 时，旧请求结果不会覆盖当前 tab。
8. 当 `items.length >= total` 时，滚动到底不再请求。
9. 模板封面显示 `example_images[0].url`。
10. 正常宽度下列表为三列，每张卡片 `120px × 140px`，封面 `120px × 120px`。
11. 长标题保持单行并显示省略号，不挤压或拉高卡片。
12. 风格模板左下角标签显示共用图标和“风格”。
13. 灵感配方模板左下角标签显示同一个共用图标和“配方”。
14. 类型标签距封面左、下各 `6px`，背景、圆角和图文尺寸与第 6.10 节一致。
15. 列表卡片不展示简介字段。

## 16. 暂不实现内容

- 不实现模板卡片点击后的应用逻辑。
- 不实现模板编辑入口。
- 不实现模板删除。
- 不实现服务端持久缓存。
- 不实现复杂骨架屏，先使用简单 loading / empty / error 状态。

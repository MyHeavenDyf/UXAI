# Studio 创建模板：指定可见用户远程搜索多选实现方案

## 1. 背景

创建模板第二步「发布模板」中的「权限设置」目前在选择「仅指定用户」后展示普通文本输入框，用户需要手动输入工号或姓名并用逗号分隔。

本次计划将该输入框改造成一个可输入、带远程搜索能力的下拉多选框：

- 无输入内容时不触发搜索。
- 输入内容后 300ms 防抖搜索。
- 支持多选。
- 搜索结果最多展示 3 条。
- 最终发布模板时，选中用户的 `account` 用英文逗号拼接后传给发布接口的 `allowed_user_ids` 字段。

Pixso 参考节点：

- `1081:510018`
- 下拉项视觉：白色浮层、每项两行文本，上方为主 label，下方为部门，hover/选中态为浅灰背景。

## 2. 用户搜索供应商接口

供应商接口：

```txt
POST /users/search
```

请求参数：

```ts
{
  query: string
  size: number
}
```

本功能中：

- `query`：用户在搜索输入框中的内容。
- `size`：固定传 `3`。

响应结构：

```ts
{
  code: number
  data: Array<{
    user_id: string
    person_notes_cn?: string
    account: string
    dept1?: string
  }>
  message?: string
}
```

成功判断：

- `code === 200`。

字段使用规则：

- `user_id`：唯一 key，用于前端区分选项、去重，不作为最终发布值。
- `person_notes_cn || account`：选项第一行展示文案。
- `dept1`：选项第二行展示文案。
- `account`：选中后的实际 value，最终拼到发布入参里。

## 3. 后端代理设计

不建议让前端直接请求供应商接口，继续沿用现有 Studio 模块的后端代理模式。

同时需要修正模板相关数据结构中的指定可见用户字段名：正确字段一直为 `allowed_user_ids`，不是 `allowed_user_id`。本次实现应把发布入参、模板列表/详情数据类型、前端创建模板类型、使用模板相关类型引用中的旧字段统一改为 `allowed_user_ids`。

新增本地 Studio 路由：

```txt
POST /studio/template-user-search
```

前端请求该路由，opencode 后端再转发供应商 `/users/search`。

### 3.1 修改 `packages/opencode/src/tool/internel_style_template.ts`

先修正模板发布/列表/详情共用类型：

```ts
type StyleTemplatePublishBaseRequest = {
  allowed_user_ids: string | null
  // ...
}
```

需要同步删除/替换所有 `allowed_user_id` 引用，避免发布接口继续发送错误字段。

新增三环境 endpoint 配置，继续遵守当前文件 local / beta / prod 的判断方式。

建议在 `InternalStyleTemplateEndpointPreset` 中新增：

```ts
styleTemplateUserSearchUrl: string
```

三环境默认值：

```ts
const LOCAL_STYLE_TEMPLATE_ENDPOINTS = {
  // ...
  styleTemplateUserSearchUrl: "http://localhost:3000/users/search",
}

const BETA_STYLE_TEMPLATE_ENDPOINTS = {
  // ...
  styleTemplateUserSearchUrl: "https://.../users/search",
}

const PROD_STYLE_TEMPLATE_ENDPOINTS = {
  // ...
  styleTemplateUserSearchUrl: "https://.../users/search",
}
```

实际 beta/prod 地址以供应商环境地址为准。如果接口跟已有 `image_template` 服务同域但不同 path，则保持同域拼接 `/users/search`。

支持环境变量覆盖：

```ts
IMAGE_STYLE_TEMPLATE_USER_SEARCH_URL
```

新增类型：

```ts
export type StyleTemplateUserSearchRequest = {
  query: string
  size: 3
}

export type StyleTemplateUserSearchItem = {
  user_id: string
  person_notes_cn?: string
  account: string
  dept1?: string
}

type StyleTemplateUserSearchBusinessResponse = {
  code?: number
  data?: unknown
  message?: string
}
```

新增方法：

```ts
export async function searchInternalStyleTemplateUsers(
  input: StyleTemplateUserSearchRequest,
): Promise<StyleTemplateUserSearchItem[]>
```

实现要点：

- `method: "POST"`。
- headers 复用 `internalStyleTemplateHeaders()`。
- body 只传 `{ query: input.query, size: input.size }`。
- 空 query 不应由后端自动搜索；后端可直接返回空数组，也可交给前端保证。建议前后端都兜底：`query.trim()` 为空时直接返回 `[]`。
- 解析响应时单独处理 `{ code, data, message }`，不要复用模板发布/列表的 `{ resp_code, resp_msg, result }` 解析函数。
- `code !== 200` 时抛错，错误信息带上 `message` 和原始 body，方便排查。
- `data` 非数组时抛错。
- 过滤掉缺少 `user_id` 或 `account` 的异常项。

### 3.2 修改 `packages/opencode/src/studio/studio-service.ts`

从 `internel_style_template.ts` 导入：

```ts
searchInternalStyleTemplateUsers
type StyleTemplateUserSearchRequest
type StyleTemplateUserSearchItem
```

导出 Studio service 类型：

```ts
export type StudioTemplateUserSearchRequest = StyleTemplateUserSearchRequest
export type StudioTemplateUserSearchItem = StyleTemplateUserSearchItem
```

新增 service 方法：

```ts
export async function searchTemplateUsers(
  input: StudioTemplateUserSearchRequest,
): Promise<StudioTemplateUserSearchItem[]> {
  return searchInternalStyleTemplateUsers(input)
}
```

### 3.3 修改 `packages/opencode/src/server/routes/instance/studio.ts`

先将模板发布 zod schema 中的旧字段：

```ts
allowed_user_id: z.string().nullable()
```

修正为：

```ts
allowed_user_ids: z.string().nullable()
```

新增 zod schema：

```ts
const StudioTemplateUserSearchInput = z.object({
  query: z.string(),
  size: z.literal(3),
})
```

新增 route：

```ts
.post(
  "/template-user-search",
  describeRoute({
    summary: "Search Studio template visible users",
    description: "Searches users for Studio template permission settings.",
    operationId: "studio.template-user-search.create",
    responses: {
      200: {
        description: "Studio template user search result",
        content: { "application/json": { schema: resolver(z.unknown()) } },
      },
      ...errors(400, 502),
    },
  }),
  validator("json", StudioTemplateUserSearchInput),
  async (c) => c.json(await searchTemplateUsers(c.req.valid("json"))),
)
```

### 3.4 修改 Effect HttpApi

涉及文件：

- `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts`

先将 `StudioTemplatePublishBaseFields` 中的旧字段：

```ts
allowed_user_id: Schema.NullOr(Schema.String)
```

修正为：

```ts
allowed_user_ids: Schema.NullOr(Schema.String)
```

在 `StudioPaths` 新增：

```ts
templateUserSearch: `${root}/template-user-search`
```

新增 payload schema：

```ts
export const StudioTemplateUserSearchPayload = Schema.Struct({
  query: Schema.String,
  size: Schema.Literal(3),
})
```

新增 endpoint：

```ts
HttpApiEndpoint.post("searchTemplateUsers", StudioPaths.templateUserSearch, {
  payload: StudioTemplateUserSearchPayload,
  success: described(Schema.Unknown, "Studio template user search result"),
  error: [HttpApiError.BadRequest, ApiStudioGenerationError],
})
```

handler 中新增：

```ts
const searchUsers = Effect.fn("StudioHttpApi.searchTemplateUsers")(function* (ctx: {
  payload: typeof StudioTemplateUserSearchPayload.Type
}) {
  const instance = yield* InstanceState.context
  return yield* Effect.tryPromise({
    try: () => Instance.restore(instance, () => searchTemplateUsers(ctx.payload)),
    catch: ...
  })
})
```

并挂载：

```ts
.handle("searchTemplateUsers", searchUsers)
```

如果新增 HttpApi endpoint，需要重新生成 SDK：

```bash
./packages/sdk/js/script/build.ts
```

## 4. 前端调用设计

### 4.1 修改 `packages/app/octoapp/pages/studio-page.tsx`

新增前端 helper：

```ts
async function searchStudioTemplateUsers(input: {
  query: string
  size: 3
}): Promise<StudioTemplateVisibleUser[]> {
  const current = server.current
  if (!current) throw new Error("No active server.")

  const response = await fetch(new URL("/studio/template-user-search", current.http.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...directoryHeader(projectDir()),
      ...(current.http.password ? { Authorization: ... } : {}),
    },
    body: JSON.stringify(input),
  })

  const bodyText = await response.text()
  if (!response.ok) throw new Error(formatStudioGenerationError(response, bodyText))
  return JSON.parse(bodyText) as StudioTemplateVisibleUser[]
}
```

将方法传给 `StudioTemplateCreator`：

```tsx
<StudioTemplateCreator
  onGenerateStyleDescription={generateStyleDescription}
  onPublishTemplate={publishStudioTemplate}
  onSearchUsers={searchStudioTemplateUsers}
/>
```

## 5. 创建模板组件改造

主要文件：

- `packages/app/octoapp/pages/studio/studio-template-creator.tsx`

### 5.1 新增前端用户类型

```ts
export type StudioTemplateVisibleUser = {
  user_id: string
  person_notes_cn?: string
  account: string
  dept1?: string
}

export type StudioTemplateUserSearchInput = {
  query: string
  size: 3
}
```

`StudioTemplateCreator` props 新增：

```ts
onSearchUsers?: (
  input: StudioTemplateUserSearchInput,
) => Promise<StudioTemplateVisibleUser[]>
```

### 5.2 将 `specifiedUsers` 从字符串改为对象数组

当前：

```ts
const [specifiedUsers, setSpecifiedUsers] = createSignal("")
```

改为：

```ts
const [specifiedUsers, setSpecifiedUsers] = createSignal<StudioTemplateVisibleUser[]>([])
```

发布校验：

```ts
const canPublishNext = createMemo(() =>
  // ...
  Boolean(visibility()) &&
  (visibility() === "all_users" || specifiedUsers().length > 0),
)
```

发布入参：

```ts
const templatePublishBaseInput = (): StudioTemplatePublishBaseInput => ({
  allowed_user_ids: visibility() === "specified_users"
    ? specifiedUsers().map((item) => item.account).join(",")
    : null,
  // ...
})
```

说明：发布接口正确字段为 `allowed_user_ids`。本次编码时需要把现有旧字段 `allowed_user_id` 全部替换为 `allowed_user_ids`，包括前端 `StudioTemplatePublishInput`、后端 `StyleTemplatePublishBaseRequest`、zod schema、Effect schema，以及模板列表/详情返回项复用到的类型。

### 5.3 替换 `VisibilitySettingFields` 入参

当前：

```ts
specifiedUsers: string
onSpecifiedUsers: (value: string) => void
```

改为：

```ts
specifiedUsers: StudioTemplateVisibleUser[]
onSpecifiedUsers: (value: StudioTemplateVisibleUser[]) => void
onSearchUsers?: (input: StudioTemplateUserSearchInput) => Promise<StudioTemplateVisibleUser[]>
```

选择「所有用户」时是否清空已选用户：

- 建议不清空，方便用户切回「仅指定用户」时保留选择。
- 发布时如果当前为「所有用户」，仍传 `allowed_user_ids: null`。
- 如果产品期望切回后清空，则可在 `onVisibility("all_users")` 时 `setSpecifiedUsers([])`，但默认不建议，避免误删。

## 6. 新增多选搜索组件

建议在 `studio-template-creator.tsx` 内部新增局部组件，避免过早拆文件：

```tsx
function TemplateVisibleUserSelect(props: {
  value: StudioTemplateVisibleUser[]
  onChange: (value: StudioTemplateVisibleUser[]) => void
  onSearchUsers?: (input: StudioTemplateUserSearchInput) => Promise<StudioTemplateVisibleUser[]>
}): JSX.Element
```

### 6.1 组件状态

```ts
const [query, setQuery] = createSignal("")
const [options, setOptions] = createSignal<StudioTemplateVisibleUser[]>([])
const [loading, setLoading] = createSignal(false)
const [open, setOpen] = createSignal(false)
const [error, setError] = createSignal("")
let searchSeq = 0
let debounceTimer: ReturnType<typeof setTimeout> | undefined
```

### 6.2 防抖搜索规则

`query.trim()` 为空：

- 清空 options。
- 清空 error。
- 不触发接口。
- 下拉关闭或隐藏。

`query.trim()` 非空：

- 等待 300ms。
- 调用：

```ts
props.onSearchUsers?.({
  query: query.trim(),
  size: 3,
})
```

防乱序：

- 每次请求前 `const seq = ++searchSeq`。
- 返回后只有 `seq === searchSeq` 才更新 options。

组件卸载：

- `onCleanup(() => clearTimeout(debounceTimer))`。

### 6.3 多选规则

选中用户：

```ts
function selectUser(user: StudioTemplateVisibleUser) {
  if (props.value.some((item) => item.user_id === user.user_id)) return
  props.onChange([...props.value, user])
  setQuery("")
  setOptions([])
  setOpen(false)
}
```

删除用户：

```ts
function removeUser(userID: string) {
  props.onChange(props.value.filter((item) => item.user_id !== userID))
}
```

去重：

- 首选 `user_id` 去重。
- 如果某条异常数据缺 `user_id`，后端已过滤；前端不需要兼容。

### 6.4 展示规则

输入框区域：

- 已选用户展示为 tag，tag 文案建议用 `person_notes_cn || account`。
- tag 上有删除按钮。
- 后面接一个可输入 input。

下拉候选项：

```tsx
button.studio-template-creator-user-option
  div.studio-template-creator-user-option-title
    {person_notes_cn || account}
  div.studio-template-creator-user-option-subtitle
    {dept1}
```

已选用户：

- 搜索结果中可以过滤掉已选用户。
- 或展示但点击无效。建议直接过滤掉，体验更干净。

loading：

- 可在下拉中展示 `搜索中...`。

失败：

- 展示 `搜索失败，请重试`。
- 不影响已选用户。

无结果：

- 展示 `暂无匹配用户`。

## 7. CSS 样式

现有创建模板样式集中在：

- `packages/app/octoapp/pages/studio/studio-08.css`

因此本次继续在该文件新增样式，命名遵守现有 `studio-template-creator-*` 规则。

建议新增 class：

```css
.studio-template-creator-user-select
.studio-template-creator-user-select-control
.studio-template-creator-user-select-control:focus-within
.studio-template-creator-user-tag
.studio-template-creator-user-tag-remove
.studio-template-creator-user-search-input
.studio-template-creator-user-dropdown
.studio-template-creator-user-option
.studio-template-creator-user-option:hover
.studio-template-creator-user-option-title
.studio-template-creator-user-option-subtitle
.studio-template-creator-user-empty
```

视觉要点：

- 输入框高度至少与原输入框一致。
- control 背景沿用现有模板输入框浅灰底。
- 选中 tag 为浅灰/浅蓝底均可，但应与现有 Studio 风格一致。
- 下拉浮层白底，圆角建议 8px 或 10px，阴影参考 Pixso 截图。
- option hover/active 背景为浅灰。
- option 第一行字号约 14px，颜色黑色。
- option 第二行字号约 11-12px，颜色灰色。
- 下拉最大宽度与输入框一致。
- 结果最多 3 条，通常不需要滚动；如果未来 size 改大，可加 `max-height`。

## 8. 边界与校验

### 8.1 不触发搜索

以下情况不触发接口：

- 输入为空字符串。
- 输入 trim 后为空。
- `props.onSearchUsers` 未提供。

### 8.2 发布按钮校验

选择「仅指定用户」时：

- 至少选择 1 个用户。
- 只输入关键词但没有选择用户，不算有效。

### 8.3 发布入参

选择「所有用户」：

```ts
allowed_user_ids: null
permission_type: "all_users"
```

选择「仅指定用户」：

```ts
allowed_user_ids: "account1,account2,account3"
permission_type: "specified_users"
```

### 8.4 搜索失败

搜索失败只影响下拉结果：

- 不清空已选用户。
- 不阻断切换可见范围。
- 发布按钮仍按已选用户数量判断。

## 9. 涉及文件清单

后端：

- `packages/opencode/src/tool/internel_style_template.ts`
  - 新增用户搜索 endpoint、类型、调用方法、响应解析。
  - 将模板发布/列表/详情共用类型中的 `allowed_user_id` 修正为 `allowed_user_ids`。
- `packages/opencode/src/studio/studio-service.ts`
  - 新增 `searchTemplateUsers` service 导出。
- `packages/opencode/src/server/routes/instance/studio.ts`
  - 新增 `/studio/template-user-search` Hono route。
  - 将模板发布 schema 中的 `allowed_user_id` 修正为 `allowed_user_ids`。
- `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`
  - 新增 HttpApi path、payload、endpoint。
  - 将模板发布 Effect schema 中的 `allowed_user_id` 修正为 `allowed_user_ids`。
- `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts`
  - 新增 HttpApi handler。

前端：

- `packages/app/octoapp/pages/studio-page.tsx`
  - 新增 `searchStudioTemplateUsers`。
  - 传入 `StudioTemplateCreator`。
- `packages/app/octoapp/pages/studio/studio-template-creator.tsx`
  - 新增用户类型。
  - `specifiedUsers` 从字符串改为用户对象数组。
  - 新增 `TemplateVisibleUserSelect` 多选搜索组件。
  - 替换原普通输入框。
  - 修改发布校验和 `allowed_user_ids` 拼接。
  - 将 `StudioTemplatePublishBaseInput` 中的 `allowed_user_id` 修正为 `allowed_user_ids`。
- `packages/app/octoapp/pages/studio/studio-style-template-menu.tsx`
  - 如果模板列表项类型复用发布入参，需要同步确认字段为 `allowed_user_ids`。
- `packages/app/octoapp/pages/studio/studio-08.css`
  - 新增多选搜索下拉样式。

生成物：

- `packages/sdk/openapi.json`
- `packages/sdk/js/src/v2/gen/sdk.gen.ts`
- `packages/sdk/js/src/v2/gen/types.gen.ts`

是否更新这些文件取决于当前仓库生成脚本的输出结果；如果新增 Effect HttpApi endpoint，需要运行 SDK 生成脚本。

## 10. 验证计划

### 10.1 类型检查

```bash
cd packages/opencode
bun typecheck
```

```bash
cd packages/app
bun typecheck
```

### 10.2 SDK 生成

如果修改了 Effect HttpApi：

```bash
./packages/sdk/js/script/build.ts
```

### 10.3 手动验证

1. 打开 Studio。
2. 进入「风格模板」-「创建模板」。
3. 完成第一步后进入第二步「发布模板」。
4. 权限设置选择「仅指定用户」。
5. 输入框为空时确认不请求搜索接口。
6. 输入关键词后确认 300ms 左右触发搜索，请求参数为：

```json
{
  "query": "输入内容",
  "size": 3
}
```

7. 下拉最多展示 3 条候选。
8. 候选项第一行显示 `person_notes_cn || account`，第二行显示 `dept1`。
9. 点击候选项后加入已选 tag。
10. 多选后发布模板，确认 `allowed_user_ids` 为选中用户 account 的逗号拼接。
11. 切换为「所有用户」发布时确认 `allowed_user_ids` 为 `null`。

## 11. 注意事项

- `user_id` 只用于前端 key 和去重，不作为发布值。
- 最终发布值使用 `account`。
- 仅输入搜索词但没有选择用户，不应通过「下一步」校验。
- 搜索接口响应结构与模板接口不同，不能复用 `resp_code` 解析逻辑。
- 模板发布和模板列表/详情数据结构中的指定可见用户字段统一使用 `allowed_user_ids`。
- 编码时需要用 `rg "allowed_user_id"` 全局确认旧字段已清理；除兼容历史数据的只读兜底场景外，不应再新增 `allowed_user_id`。

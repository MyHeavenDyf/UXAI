# Studio 创建模板发布接口实现方案

## 1. 文档状态

- 当前阶段：需求分析完成，尚未进入代码实现。
- 文档用途：记录 Studio 创建模板第三步点击“发布”后的接口调用链路、提交参数结构、字段映射、校验规则、状态处理和涉及文件。
- 最后更新：2026-08-31。
- 关联前置：
  - `docs/studio-template-creator-content-implementation-plan.md`：第 1 步“制作模板”表单。
  - `docs/studio-template-publish-implementation-plan.md`：第 2 步“发布模板”表单。
  - `docs/studio-template-examples-implementation-plan.md`：第 3 步“添加示例”表单。
  - `docs/studio-template-style-description-generation-implementation-plan.md`：第 1 步“生成风格描述”流式接口。

## 2. 核心结论

模板发布接口沿用 Studio 现有内部接口设计，不在前端直接请求供应商 URL。

推荐调用链：

```text
StudioTemplateCreator 点击发布
  -> studio-page.tsx 组装 creator_user_id 并请求本地接口
    -> packages/opencode/src/server/routes/instance/studio.ts
    -> packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts
    -> packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts
      -> packages/opencode/src/studio/studio-service.ts
        -> packages/opencode/src/tool/internel_style_template.ts 调供应商发布接口
```

这样做的原因：

- 供应商接口地址、鉴权 header、环境区分继续留在 opencode 层。
- 前端只关心 Studio 本地接口，避免暴露供应商 endpoint。
- 需要同时补 Hono route 和 Effect `httpapi` route，避免不同运行入口下出现 404。
- 发布接口不是流式接口，普通 `POST + JSON` 即可。

## 3. 供应商接口

### 3.1 调用方式

- method：`POST`
- request body：JSON
- response：暂按 `unknown` 接收，前端只需要判断请求成功或失败。

### 3.2 Endpoint 配置

在 `packages/opencode/src/tool/internel_style_template.ts` 中新增发布接口 endpoint。

需要遵循该文件已有的三环境逻辑：

- local endpoint
- beta endpoint
- prod endpoint
- env override

建议新增 env：

```ts
IMAGE_STYLE_TEMPLATE_PUBLISH_URL
```

如果 env 未配置，且当前环境 endpoint 仍为临时值 `"xx"`，应抛出明确错误：

```text
style_template_publish url is not configured.
```

## 4. 发布接口入参

### 4.1 通用字段

所有模板类型都需要提交：

```ts
type StudioTemplatePublishBaseRequest = {
  allowed_user_id: string | null
  creator_user_id: string
  example_images: Array<{ url: string }>
  permission_type: "all_users" | "specified_users"
  prompt_setting: "required" | "optional" | "not_supported"
  reference_image_count: 0 | 1 | 2 | 3
  reference_image_setting: "fixed" | "optional" | "not_supported"
  template_type: "extract_style" | "preset_recipe"
  title: string
  usage_instructions: string
}
```

注意：字段为 `example_images`，不是 `examplate_images`。

### 4.2 通用字段映射

| 供应商字段 | 前端来源 | 规则 |
|---|---|---|
| `allowed_user_id` | `specifiedUsers()` | 当 `visibility() === "specified_users"` 时传 `specifiedUsers().trim()`；否则传 `null` |
| `creator_user_id` | `uiplusUserAccount()` | 由 `studio-page.tsx` 注入；后端可 fallback 到 `IMAGE_USER_IDX` |
| `example_images` | `exampleImages()` | 保持 `{ url }[]` 结构 |
| `permission_type` | `visibility()` | 当前值为 `all_users` / `specified_users` |
| `prompt_setting` | `promptSetting()` | 当前值为 `required` / `optional` / `not_supported` |
| `reference_image_setting` | `referenceMode()` | 当前值为 `fixed` / `optional` / `not_supported` |
| `reference_image_count` | `referenceCount()` | 当 `referenceMode() === "not_supported"` 时传 `0`；否则传当前张数 |
| `template_type` | `category()` | 当前值为 `extract_style` / `preset_recipe` |
| `title` | `title()` | 提交前 `trim()` |
| `usage_instructions` | `usageDescription()` | 提交前 `trim()` |

`allowed_user_id` 当前按字符串原样传。虽然 UI placeholder 支持多个工号/姓名全拼用中文逗号分隔，但供应商字段名是单数字符串语义，暂不在前端拆数组，除非供应商后续明确要求数组。

## 5. 风格模板额外入参

当：

```ts
template_type === "extract_style"
```

需要额外提交：

```ts
type StudioStyleTemplatePublishRequest = StudioTemplatePublishBaseRequest & {
  template_type: "extract_style"
  style_description: Partial<{
    overview: string
    tonal: string
    composition: string
    volume: string
    surface: string
    color: string
    linework: string
    shape_structure: string
    role_design: string
    lettering: string
    post_processing: string
  }> & { overview: string }
  style_images: Array<{ url: string }>
  style_keywords: string
}
```

字段映射：

| 供应商字段 | 前端来源 | 规则 |
|---|---|---|
| `style_description.overview` | `styleDescriptionOverview()` | 固定传，提交前 `trim()` |
| `style_description.tonal` | `styleDescriptionDetails().tonal` | 仅当 `selectedDimensions()` 包含 `tonal` 时添加 |
| `style_description.composition` | `styleDescriptionDetails().composition` | 仅当 `selectedDimensions()` 包含 `composition` 时添加 |
| `style_description.volume` | `styleDescriptionDetails().volume` | 仅当 `selectedDimensions()` 包含 `volume` 时添加 |
| `style_description.surface` | `styleDescriptionDetails().surface` | 仅当 `selectedDimensions()` 包含 `surface` 时添加 |
| `style_description.color` | `styleDescriptionDetails().color` | 仅当 `selectedDimensions()` 包含 `color` 时添加 |
| `style_description.linework` | `styleDescriptionDetails().linework` | 仅当 `selectedDimensions()` 包含 `linework` 时添加 |
| `style_description.shape_structure` | `styleDescriptionDetails().shape_structure` | 仅当 `selectedDimensions()` 包含 `shape_structure` 时添加 |
| `style_description.role_design` | `styleDescriptionDetails().role_design` | 仅当 `selectedDimensions()` 包含 `role_design` 时添加 |
| `style_description.lettering` | `styleDescriptionDetails().lettering` | 仅当 `selectedDimensions()` 包含 `lettering` 时添加 |
| `style_description.post_processing` | `styleDescriptionDetails().post_processing` | 仅当 `selectedDimensions()` 包含 `post_processing` 时添加 |
| `style_images` | `styleImages()` | 保持 `{ url }[]` 结构 |
| `style_keywords` | `styleKeywords()` | 可为空字符串，提交当前值 |

`style_description` 不传未选中的风格描述维度字段。也就是说：

- `overview` 固定传。
- `selectedDimensions()` 中存在的字段才添加到 `style_description`。
- 已选中但内容为空的字段可以传空字符串。
- 未选中的字段不要添加到 `style_description` 中。

构造示意：

```ts
const styleDescription = {
  overview: styleDescriptionOverview().trim(),
  ...Object.fromEntries(
    selectedDimensions().map((id) => [
      id,
      (styleDescriptionDetails()[id] ?? "").trim(),
    ]),
  ),
}
```

## 6. 灵感配方模板额外入参

当：

```ts
template_type === "preset_recipe"
```

需要额外提交：

```ts
type StudioRecipeTemplatePublishRequest = StudioTemplatePublishBaseRequest & {
  template_type: "preset_recipe"
  fixed_reference_images: Array<{ url: string }>
  play_description: string
}
```

字段映射：

| 供应商字段 | 前端来源 | 规则 |
|---|---|---|
| `fixed_reference_images` | `recipeImages()` | 保持 `{ url }[]` 结构 |
| `play_description` | `recipeDescription()` | 提交前 `trim()` |

## 7. 前端类型设计

在 `packages/app/octoapp/pages/studio/studio-template-creator.tsx` 中新增导出类型：

```ts
export type StudioTemplatePublishInput =
  | StudioStyleTemplatePublishInput
  | StudioRecipeTemplatePublishInput
```

其中：

- `StudioStyleTemplatePublishInput` 对应风格模板发布。
- `StudioRecipeTemplatePublishInput` 对应灵感配方模板发布。

`studio-page.tsx` 通过导入该类型约束本地请求函数：

```ts
async function publishStudioTemplate(input: StudioTemplatePublishInput) {
  // POST /studio/template-publish
}
```

## 8. 前端实现细节

### 8.1 `StudioTemplateCreator` 新增 props

在 `StudioTemplateCreator` props 中新增：

```ts
onPublishTemplate?: (input: StudioTemplatePublishInput) => Promise<void>
```

`StudioResultCanvas` 继续向下透传：

```tsx
<StudioTemplateCreator
  onGenerateStyleDescription={props.onGenerateStyleDescription}
  onPublishTemplate={props.onPublishTemplate}
/>
```

### 8.2 发布按钮行为

当前 footer 主按钮在第三步显示“发布”。需要调整 `goNext`：

```ts
const goNext = () => {
  if (!canNext()) return
  if (currentStep() === "make") {
    setCurrentStep("publish")
    return
  }
  if (currentStep() === "publish") {
    setCurrentStep("examples")
    return
  }
  void publishTemplate()
}
```

### 8.3 发布中状态

新增状态：

```ts
const [templatePublishing, setTemplatePublishing] = createSignal(false)
const [templatePublishMessage, setTemplatePublishMessage] = createSignal("")
```

发布中：

- 禁用“发布”按钮。
- 主按钮文案显示“发布中...”。
- 防止重复提交。

失败时：

- 展示错误信息。
- 恢复按钮可点击。

成功时：

- 展示“模板发布成功”。
- 可先保留在当前页面，不自动关闭 tab；如果后续产品希望关闭创建模板 tab，可在成功回调后再加。

### 8.4 发布前校验

发布前应同时校验：

```ts
canMakeNext() && canPublishNext() && canPublish()
```

避免用户在第三步期间回退修改导致数据不完整。

现有关键校验：

- 标题：5-10 字。
- 第一步风格模板：
  - 风格图集至少 3 张、最多 30 张。
  - 风格图集总大小不超过 30MB。
  - 风格描述 `overview` 必填。
  - 风格描述总字数不超过 700。
- 第一步灵感配方：
  - `play_description` 必填。
  - 固定参考图最多 3 张。
- 第二步：
  - 使用说明必填。
  - 仅指定用户时，指定用户输入必填。
- 第三步：
  - 示例图至少 1 张、最多 20 张。
  - 示例图总大小不超过 30MB。

## 9. `creator_user_id` 获取方案

前端 `studio-page.tsx` 已有 `uiplusUserAccount()`，现有图片生成在构造 `extra.userIdx` 时使用该值。

模板发布建议：

```ts
creator_user_id: uiplusUserAccount()
```

同时后端 `internel_style_template.ts` 做 fallback：

```ts
creator_user_id: input.creator_user_id || env("IMAGE_USER_IDX") || DEFAULT_USER_IDX
```

其中 `DEFAULT_USER_IDX` 可以在 `internel_style_template.ts` 中按 `internel_image_generate.ts` 的默认用户逻辑补齐，避免本地环境无用户态时无法调试。

## 10. opencode service 设计

在 `packages/opencode/src/studio/studio-service.ts` 中新增：

```ts
export async function publishTemplate(input: StudioTemplatePublishRequest): Promise<unknown> {
  return publishInternalStyleTemplate(input)
}
```

如果供应商返回结构后续稳定，可再定义精确 response type。目前先用 `unknown`，避免提前假设返回格式。

## 11. 本地 Hono route

修改：

`packages/opencode/src/server/routes/instance/studio.ts`

新增 zod schema：

```ts
const StudioTemplatePublishInput = z.discriminatedUnion("template_type", [
  StudioStyleTemplatePublishInput,
  StudioRecipeTemplatePublishInput,
])
```

新增 route：

```ts
.post(
  "/template-publish",
  validator("json", StudioTemplatePublishInput),
  async (c) => c.json(await publishTemplate(c.req.valid("json"))),
)
```

该 route 的主要作用是保持普通 Hono Studio routes 完整。

## 12. Effect httpapi route

为避免再次出现本地接口 404，需要同步修改：

### 12.1 `groups/studio.ts`

文件：

`packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`

新增 path：

```ts
templatePublish: `${root}/template-publish`
```

新增 payload schema：

```ts
export const StudioTemplatePublishPayload = Schema.Union(
  StudioStyleTemplatePublishPayload,
  StudioRecipeTemplatePublishPayload,
)
```

新增 endpoint：

```ts
HttpApiEndpoint.post("publishTemplate", StudioPaths.templatePublish, {
  payload: StudioTemplatePublishPayload,
  success: described(Schema.Unknown, "Studio template publish result"),
  error: [HttpApiError.BadRequest, ApiStudioGenerationError],
})
```

### 12.2 `handlers/studio.ts`

文件：

`packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts`

新增 handler：

```ts
const publishTemplateHandler = Effect.fn("StudioHttpApi.publishTemplate")(function* (ctx: {
  payload: typeof StudioTemplatePublishPayload.Type
}) {
  const instance = yield* InstanceState.context
  return yield* Effect.tryPromise({
    try: () => Instance.restore(instance, () => publishTemplate(ctx.payload)),
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
.handle("publishTemplate", publishTemplateHandler)
```

发布接口不是 SSE，不需要 `handleRaw`。

## 13. 前端本地请求

修改：

`packages/app/octoapp/pages/studio-page.tsx`

新增：

```ts
async function publishStudioTemplate(input: StudioTemplatePublishInput) {
  const current = server.current
  if (!current) throw new Error("No active server.")

  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...directoryHeader(projectDir()),
  }

  if (current.http.password) {
    headers.Authorization = `Basic ${authTokenFromCredentials({
      username: current.http.username,
      password: current.http.password,
    })}`
  }

  const response = await fetch(new URL("/studio/template-publish", current.http.url), {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...input,
      creator_user_id: input.creator_user_id || uiplusUserAccount(),
    }),
  })

  const bodyText = await response.text()
  if (!response.ok) throw new Error(formatStudioGenerationError(response, bodyText))
  return bodyText ? JSON.parse(bodyText) : undefined
}
```

然后传入：

```tsx
<StudioResultCanvas
  onPublishTemplate={publishStudioTemplate}
/>
```

## 14. 涉及修改文件清单

### 14.1 前端

1. `packages/app/octoapp/pages/studio/studio-template-creator.tsx`
   - 新增发布 payload 类型。
   - 新增 `onPublishTemplate` props。
   - 新增 `templatePublishing` 和 `templatePublishMessage` 状态。
   - 调整第三步“发布”按钮点击逻辑。
   - 组装风格模板/灵感配方模板发布入参。

2. `packages/app/octoapp/pages/studio/studio-conversation.tsx`
   - 在 `StudioResultCanvas` props 中新增 `onPublishTemplate`。
   - 透传给 `StudioTemplateCreator`。

3. `packages/app/octoapp/pages/studio-page.tsx`
   - 新增 `publishStudioTemplate`。
   - 注入 `creator_user_id: uiplusUserAccount()`。
   - 请求本地 `/studio/template-publish`。
   - 传给 `StudioResultCanvas`。

4. `packages/app/octoapp/pages/studio/studio-08.css`
   - 如需要展示发布状态/错误提示，新增对应样式。
   - 可复用现有 upload message 或 footer button disabled 样式，尽量少加新样式。

### 14.2 opencode

1. `packages/opencode/src/tool/internel_style_template.ts`
   - 新增发布接口 endpoint 配置。
   - 新增 `StyleTemplatePublishRequest` 类型。
   - 新增 `publishInternalStyleTemplate` 方法。
   - 沿用内部图片接口鉴权 header。
   - 支持 `IMAGE_STYLE_TEMPLATE_PUBLISH_URL`。

2. `packages/opencode/src/studio/studio-service.ts`
   - 新增 `StudioTemplatePublishRequest` 类型导出。
   - 新增 `publishTemplate` service 方法。

3. `packages/opencode/src/server/routes/instance/studio.ts`
   - 新增 zod payload schema。
   - 新增 `POST /studio/template-publish`。

4. `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`
   - 新增 path。
   - 新增 Effect schema。
   - 新增 `publishTemplate` endpoint。

5. `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts`
   - 新增 `publishTemplate` handler。
   - 调用 `studio-service.ts` 的发布方法。

## 15. 验证计划

实现后至少执行：

```bash
cd packages/opencode
bun typecheck
```

```bash
cd packages/app
bun typecheck
```

手动验证：

1. 风格模板完整填写后进入第三步。
2. 上传至少 1 张示例图。
3. 点击“发布”。
4. Network 中确认请求为：
   - `POST /studio/template-publish`
   - body 字段为 `example_images`。
   - `reference_image_count` 在不支持参考图时为 `0`。
5. 风格模板 payload 包含：
   - `style_description`
   - `style_images`
   - `style_keywords`
6. 灵感配方 payload 包含：
   - `fixed_reference_images`
   - `play_description`
7. 指定用户模式下：
   - `allowed_user_id` 为输入框内容。
8. 所有用户模式下：
   - `allowed_user_id` 为 `null`。

## 16. 暂不实现内容

- 不实现模板发布成功后的列表刷新。
- 不实现模板编辑回填。
- 不实现发布结果详情页。
- 不拆分 `allowed_user_id` 为数组，除非供应商接口后续明确要求。
- 不把 `example_images` 改成其他拼写。

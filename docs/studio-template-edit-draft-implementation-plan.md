# Studio 模板任务重新编辑实现方案

## 1. 文档状态

- 当前阶段：需求分析完成，尚未进入代码实现。
- 文档用途：记录选择了风格模板/配方模板的 Studio 生成任务，在点击“重新编辑”时如何恢复模板输入态。
- 关联文档：
  - `docs/studio-style-template-usage-implementation-plan.md`
  - `docs/studio-style-template-list-implementation-plan.md`
  - `docs/studio-template-submit-implementation-plan.md`

## 2. 需求目标

点击生成任务的“重新编辑”时：

- 未使用模板的生成任务：保持当前逻辑不变。
- 使用了模板的生成任务：
  - 从生成任务参数中读取 `template.id`。
  - 调用供应商模板详情接口获取最新模板完整数据。
  - 根据接口返回的当前模板数据，恢复 Composer 的“模板应用中”输入态。
  - 根据接口返回的当前模板配置决定是否恢复、如何恢复历史输入文本和参考图。
  - 生成任务保存的 `template.prompt` 与 `referenceImages` 只作为历史用户输入候选，不能作为最终规则来源。

供应商详情接口：

```text
GET /image_template/${template.id}
query: { user_id }
```

返回格式：

```ts
{
  resp_code: number
  resp_msg?: string
  result?: StudioStyleTemplateListItem
}
```

其中 `result` 的结构与模板列表接口 `result.data[]` 单项一致。

## 3. 当前代码现状

### 3.1 重新编辑入口

文件：

`packages/app/octoapp/pages/studio-page.tsx`

当前入口：

```ts
async function editGenerationDraft(result: StudioGenerationResult)
```

当前流程：

1. `restoreGenerationEditDraft(result)` 从生成任务中恢复普通输入参数。
2. `canEditGenerationDraft(draft)` 做视频权限、Seedream 权限校验。
3. 写入页面状态：
   - `capability`
   - `prompt`
   - `styleModel`
   - `aspectRatio`
   - `count`
   - `assets`
   - `videoFrames`
4. 提示“已经同步参数到左侧输入区”。

### 3.2 模板生成任务的保存位置

文件：

`packages/app/octoapp/pages/studio-page.tsx`

模板生成任务发送时，前端通过 `runStyleTemplateGeneration()` 写入：

```ts
extra: {
  skipPromptRefine: true,
  template: {
    id: template.idx,
    prompt: styleTemplatePromptPayload(template, templateInput),
  },
}
```

服务端保存后，重新编辑时可从：

```ts
result.request.input.extra.template
```

读取模板使用信息。

### 3.3 模板详情不能只依赖本地保存数据

生成任务里保存的 `extra.template` 只有：

```ts
{
  id: string | number
  prompt: Record<string, unknown>
}
```

它只适合作为历史用户输入候选，不适合恢复完整模板配置。重新编辑还需要模板详情接口返回：

- `template_type`
- `prompt_setting`
- `reference_image_setting`
- `reference_image_count`
- `play_description`
- `style_description`
- `style_images`
- `fixed_reference_images`
- 其他发布字段

因此需要按 `template.id` 拉取模板详情，并以详情接口返回的当前模板配置为准。

注意：后续存在模板编辑能力，同一个 `template.id` 当前版本可能已经和生成任务使用时的旧版本不同，例如：

- 模板类型从 `preset_recipe` 改为 `extract_style`，或反向修改。
- `prompt_setting` 从 `required` 改为 `not_supported`。
- `reference_image_setting` 从 `fixed` 改为 `not_supported`。
- `reference_image_count` 从 3 改为 1。
- `play_description` 或 `style_description` 被修改。

所以重新编辑只能复用历史任务中的用户输入内容，所有输入态、校验、参考图恢复数量、最终拼接逻辑都必须以当前模板详情为准。

## 4. 实现总链路

```text
点击生成任务「重新编辑」
  -> studio-page.tsx editGenerationDraft(result)
    -> 判断 result.request.input.extra.template 是否存在
      -> 不存在：走原普通重新编辑逻辑
      -> 存在：
        -> 读取 template.id
        -> GET /studio/template-detail/:templateID?user_id=当前用户
          -> opencode studio route
            -> studio-service getTemplateDetail
              -> internel_style_template.ts
                -> GET 供应商 /image_template/${template.id}?user_id=...
        -> 使用接口返回 result 作为 selectedStyleTemplate
        -> 按当前模板配置决定如何使用 extra.template.prompt 恢复输入内容
        -> 按当前模板配置决定是否/最多恢复 input.referenceImages
        -> 写入 Composer 状态并显示「模版应用中」
```

## 5. 涉及文件

### 5.1 新增/修改：供应商接口封装

文件：

`packages/opencode/src/tool/internel_style_template.ts`

新增内容：

1. endpoint preset 增加模板详情地址字段：

```ts
type InternalStyleTemplateEndpointPreset = {
  styleDescriptionGenUrl: string
  styleTemplatePublishUrl: string
  styleTemplateListUrl: string
  styleTemplateDetailUrl: string
}
```

三套环境都需要补充：

- local
- beta
- prod

建议默认与列表/发布接口同 base：

```ts
styleTemplateDetailUrl: "https://.../image_template"
```

实际请求时拼：

```ts
new URL(`${base.replace(/\/$/, "")}/${encodeURIComponent(template_id)}`)
```

2. 新增请求类型：

```ts
export type StyleTemplateDetailRequest = {
  template_id: string
  user_id: string
}
```

3. 新增 URL 构造函数：

```ts
function styleTemplateDetailUrl(input: StyleTemplateDetailRequest) {
  const endpoint = env("IMAGE_STYLE_TEMPLATE_DETAIL_URL") ?? DEFAULT_STYLE_TEMPLATE_DETAIL
  if (!endpoint || endpoint === "xx") throw new Error("style_template_detail url is not configured.")
  const url = new URL(`${endpoint.replace(/\/$/, "")}/${encodeURIComponent(input.template_id)}`)
  url.searchParams.set("user_id", input.user_id || env("IMAGE_USER_IDX") || DEFAULT_USER_IDX)
  return url
}
```

4. 新增解析函数：

```ts
function parseStyleTemplateDetailResult(response: StyleTemplateBusinessResponse): StyleTemplateListItem {
  const result = response.result
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("style_template_detail returned invalid result.")
  }
  return result as StyleTemplateListItem
}
```

5. 新增调用函数：

```ts
export async function getInternalStyleTemplate(input: StyleTemplateDetailRequest): Promise<StyleTemplateListItem>
```

调用方式：

- method: `GET`
- headers: 复用 `internalStyleTemplateHeaders()`
- 响应：复用 `parseBusinessResponse(text, "style_template_detail")`
- 业务失败：`resp_code !== 200` 时抛错。该场景可能代表模板被删除、无权限、模板不可用或其他业务错误，上层用户提示需要使用兼容文案。

### 5.2 修改：Studio service

文件：

`packages/opencode/src/studio/studio-service.ts`

新增 import：

```ts
import { getInternalStyleTemplate } from "@/tool/internel_style_template"
```

新增导出函数：

```ts
export async function getTemplateDetail(input: StyleTemplateDetailRequest) {
  return getInternalStyleTemplate(input)
}
```

如果已有类型集中从 `internel_style_template.ts` 引入，补充 `StyleTemplateDetailRequest` 类型。

### 5.3 修改：Hono 本地路由

文件：

`packages/opencode/src/server/routes/instance/studio.ts`

新增 import：

```ts
getTemplateDetail
```

新增 query schema：

```ts
const StudioTemplateDetailQuery = z.object({
  user_id: z.string().optional(),
})
```

新增路由：

```ts
.get(
  "/template-detail/:templateID",
  describeRoute({
    operationId: "studio.template-detail.get",
    responses: {
      200: {
        description: "Get Studio style template detail",
        content: {
          "application/json": {
            schema: resolver(z.unknown()),
          },
        },
      },
    },
  }),
  validator("query", StudioTemplateDetailQuery),
  async (c) => c.json(await getTemplateDetail({
    template_id: c.req.param("templateID"),
    user_id: c.req.valid("query").user_id ?? "",
  })),
)
```

本地接口建议命名为 `/studio/template-detail/:templateID`，不要让前端浏览器直接请求供应商 `/image_template/:id`。

### 5.4 修改：Effect HTTP API

如项目要求 Hono 与 Effect API 保持同步，则补以下文件：

- `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts`

建议新增：

```ts
templateDetail: `${root}/template-detail/:templateID`
```

以及 endpoint：

```ts
HttpApiEndpoint.get("getTemplateDetail", StudioPaths.templateDetail, ...)
```

handler 调用：

```ts
getTemplateDetail({
  template_id: ctx.path.templateID,
  user_id: ctx.urlParams.user_id ?? "",
})
```

如果当前前端只走 Hono fetch，本项不是功能阻塞点，但为了接口体系完整建议同步补齐。

### 5.5 修改：前端本地请求

文件：

`packages/app/octoapp/pages/studio-page.tsx`

新增函数：

```ts
async function getStudioStyleTemplate(templateID: string): Promise<StudioStyleTemplateListItem> {
  const current = server.current
  if (!current) throw new Error("No active server.")
  const headers: Record<string, string> = {
    ...directoryHeader(projectDir()),
  }
  if (current.http.password) {
    headers.Authorization = `Basic ${authTokenFromCredentials({
      username: current.http.username,
      password: current.http.password,
    })}`
  }
  const url = new URL(`/studio/template-detail/${encodeURIComponent(templateID)}`, current.http.url)
  url.searchParams.set("user_id", uiplusUserAccount())
  const response = await fetch(url, { method: "GET", headers })
  const bodyText = await response.text()
  if (!response.ok) throw new Error(formatStudioGenerationError(response, bodyText))
  return JSON.parse(bodyText) as StudioStyleTemplateListItem
}
```

说明：

- `user_id` 取值方式与 `listStudioStyleTemplates()` 一致，使用 `uiplusUserAccount()`。
- 不建议复用列表分页缓存，因为重新编辑可能命中未加载页或已更新模板。

## 6. 前端模板判断与解析

文件：

`packages/app/octoapp/pages/studio-page.tsx`

新增辅助函数：

```ts
function templateUsageRecord(result: StudioGenerationResult) {
  const template = recordValue(inputExtraRecord(result), "template")
  if (!template || typeof template !== "object" || Array.isArray(template)) return
  return template as Record<string, unknown>
}

function templateUsageID(result: StudioGenerationResult) {
  const template = templateUsageRecord(result)
  const id = recordValue(template, "id")
  if (typeof id === "string" && id.trim()) return id
  if (typeof id === "number" && Number.isFinite(id)) return String(id)
}

function templateUsagePrompt(result: StudioGenerationResult) {
  const prompt = recordValue(templateUsageRecord(result), "prompt")
  if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) return {}
  return prompt as Record<string, unknown>
}
```

这些函数只读生成任务参数，不改变状态。

## 7. 模板重新编辑流程

文件：

`packages/app/octoapp/pages/studio-page.tsx`

修改 `editGenerationDraft(result)`：

```ts
async function editGenerationDraft(result: StudioGenerationResult) {
  if (isActionBusy()) return
  if (result.capability !== "image.generate" && result.capability !== "video.generate") return

  const templateID = templateUsageID(result)
  if (templateID && result.capability === "image.generate") {
    await editTemplateGenerationDraft(result, templateID)
    return
  }

  // 原逻辑保持不变
}
```

新增：

```ts
async function editTemplateGenerationDraft(result: StudioGenerationResult, templateID: string) {
  const draft = restoreGenerationEditDraft(result)
  if (!canEditGenerationDraft(draft)) return

  const template = await getStudioStyleTemplate(templateID)
  const templatePrompt = templateUsagePrompt(result)
  const targetModel = styleTemplateTargetModel(canUseSeedream(), draft.styleModel ?? styleModel())
  const referenceLimit = template.reference_image_setting === "not_supported"
    ? 0
    : Math.min(referenceImageLimit(targetModel), template.reference_image_count)

  batch(() => {
    setOpenMenu(null)
    setMode("preview")
    setStudioWorkspaceOverlayOpen(false)
    setCapability("image.generate")
    setSelectedStyleTemplate(template)
    setAspectRatio(draft.aspectRatio)
    if (draft.count) setCount(draft.count)
    if (draft.width) setCustomWidth(draft.width)
    if (draft.height) setCustomHeight(draft.height)
    setIsCustomStore(Boolean(draft.width && draft.height))
    setStyleModel(targetModel)
  })

  if (template.prompt_setting === "not_supported") {
    batch(() => {
      setPrompt("")
      setRecipeMainPrompt("")
      setRecipeExtraPrompt("")
    })
  } else if (template.template_type === "preset_recipe") {
    batch(() => {
      setPrompt("")
      setRecipeMainPrompt(stringValue(templatePrompt, "mainPrompt") ?? "")
      setRecipeExtraPrompt(stringValue(templatePrompt, "extraPrompt") ?? "")
    })
  } else {
    batch(() => {
      setPrompt(stringValue(templatePrompt, "custom") ?? "")
      setRecipeMainPrompt("")
      setRecipeExtraPrompt("")
    })
  }

  setAssets(await restoredImageAssets(draft.referenceImages, referenceLimit))
  showEditDraftSyncedToast()
}
```

注意：

- 这里不应调用 `applyStyleTemplate(template)`，因为重新编辑还要恢复历史任务的画幅、张数、自定义尺寸、参考图和用户输入；`applyStyleTemplate` 更适合“从菜单新选择模板”的默认初始化。
- 可以抽出一个更底层的 `setStyleTemplateAppliedState(template, options)`，但第一版直接新增 `editTemplateGenerationDraft` 更直观。
- `templatePrompt` 只作为历史用户输入候选，是否回填由当前模板详情决定：
  - 当前模板 `prompt_setting=not_supported` 时，不回填任何 prompt 输入。
  - 当前模板 `template_type=extract_style` 时，只尝试回填 `custom` 到普通 prompt。
  - 当前模板 `template_type=preset_recipe` 时，只尝试回填 `mainPrompt` 和 `extraPrompt` 到配方两段式输入。

## 8. 输入内容恢复规则

### 8.1 风格模板

模板任务保存：

```ts
extra.template.prompt = {
  ...style_description,
  custom: 用户实际输入,
}
```

重新编辑时，如果当前详情接口返回的模板仍为 `extract_style`，且 `prompt_setting` 不是 `not_supported`：

```ts
setSelectedStyleTemplate(template)
setPrompt(stringValue(templatePrompt, "custom") ?? "")
setRecipeMainPrompt("")
setRecipeExtraPrompt("")
```

不要从最终 prompt 中反拆 `JSON.stringify(style_description)`。

如果当前模板已经被编辑为 `preset_recipe`：

- 不再按风格模板回填。
- 只尝试读取历史 `template.prompt.mainPrompt/extraPrompt`。
- 若历史任务中不存在这两个字段，则配方输入为空。

如果当前模板 `prompt_setting=not_supported`：

- 普通 prompt 与配方输入都清空。
- 输入区展示“不支持输入提示词”的禁用态。

### 8.2 配方模板

模板任务保存：

```ts
extra.template.prompt = {
  custom: mainPrompt + extraPrompt,
  mainPrompt,
  extraPrompt,
}
```

重新编辑时，如果当前详情接口返回的模板仍为 `preset_recipe`，且 `prompt_setting` 不是 `not_supported`：

```ts
setSelectedStyleTemplate(template)
setPrompt("")
setRecipeMainPrompt(stringValue(templatePrompt, "mainPrompt") ?? "")
setRecipeExtraPrompt(stringValue(templatePrompt, "extraPrompt") ?? "")
```

不要从最终 prompt 中反拆 `play_description`。

如果当前模板已经被编辑为 `extract_style`：

- 不再按配方模板回填。
- 只尝试读取历史 `template.prompt.custom`。
- 若历史任务中不存在 `custom`，普通 prompt 为空。

如果当前模板 `prompt_setting=not_supported`：

- 普通 prompt 与配方输入都清空。
- 输入区展示“不支持输入提示词”的禁用态。

## 9. 参考图恢复规则

参考图候选仍使用生成任务保存的：

```ts
result.request.input.referenceImages
```

但恢复规则必须以模板详情接口返回的当前配置为准：

| 模板 `reference_image_setting` | 恢复策略 |
|---|---|
| `not_supported` | 不恢复参考图，`assets=[]` |
| `fixed` | 最多恢复 `reference_image_count` 张 |
| `optional` | 最多恢复 `reference_image_count` 张 |

同时考虑模型限制：

```ts
Math.min(referenceImageLimit(targetModel), template.reference_image_count)
```

说明：

- 即使旧任务当时上传了 3 张参考图，如果当前模板改为 `not_supported`，重新编辑时也不能恢复参考图。
- 如果旧任务当时上传了 3 张参考图，但当前模板 `reference_image_count=1`，重新编辑时最多只恢复 1 张。
- 如果当前模板为 `fixed`，重新编辑只负责按上限恢复历史图；如果恢复后不足固定张数，则发送按钮仍按当前校验禁用，要求用户补齐。
- 不应根据旧任务里的参考图数量覆盖当前模板限制。

## 10. 模型恢复规则

模板只支持：

- `seedream-5-lite`
- `qwen`

重新编辑模板任务时：

1. 优先使用历史任务中的 `draft.styleModel`。
2. 如果历史模型是 `seedream-5-lite` 或 `qwen`，保持该模型。
3. 如果历史模型不是这两个：
   - 有 Seedream 权限：使用 `seedream-5-lite`
   - 无 Seedream 权限：使用 `qwen`

可复用：

```ts
styleTemplateTargetModel(canUseSeedream(), draft.styleModel ?? styleModel())
```

## 11. 错误处理

模板详情接口失败或 `resp_code !== 200` 时：

- 不要继续走普通重新编辑逻辑。
- 不要把最终 prompt 当作普通 prompt 回填。
- 保持当前输入区状态不变。
- 用户提示需要兼容模板被删除、无权限、模板不可用等场景，建议提示：

```ts
showFloatingNotice("error", "模板不存在或已不可用，无法重新编辑该模板任务。")
```

错误日志仍建议保留真实失败原因，便于排查网络错误、接口业务失败、模板删除等不同情况：

```ts
console.error("[StudioPage] restore style template draft failed", error)
```

原因：

- 模板生成任务的最终 prompt 可能是拼接后的不可逆文本。
- 特别是配方模板，无法可靠反推灰框输入和额外输入。

## 12. 埋点

当前普通重新编辑已有：

```ts
tracker.interaction({
  module: "studio",
  name: "edit-generation-draft",
  extend: JSON.stringify(...),
})
```

模板重新编辑可以继续复用同一个埋点，并额外补充：

```ts
templateID
templateType: template.template_type
```

是否新增独立埋点名称可后续再定。

## 13. 验证项

### 13.1 普通生成任务

- 点击“重新编辑”仍走原逻辑。
- prompt、参考图、模型、画幅、数量恢复不受影响。

### 13.2 风格模板任务

- 点击“重新编辑”后：
  - toolbar 显示“模版应用中”。
  - 普通输入区恢复 `template.prompt.custom`。
  - 当前模板为详情接口返回模板。
  - 参考图按历史任务恢复，并受模板张数限制。
  - 发送时仍带 `args.template`。

### 13.3 配方模板任务

- 点击“重新编辑”后：
  - toolbar 显示“模版应用中”。
  - 输入区为配方模板两段式输入态。
  - 灰色输入区恢复 `template.prompt.mainPrompt`。
  - 后置额外输入区恢复 `template.prompt.extraPrompt`。
  - 不展示 `play_description` 分割前后缀。
  - 发送时仍按详情接口返回的 `play_description` 重新拼最终 prompt。

### 13.4 模板详情失败

- 显示错误提示。
- 当前输入区不被覆盖。
- 不 fallback 到普通重新编辑。

## 14. 建议执行顺序

1. `internel_style_template.ts` 新增详情接口封装。
2. `studio-service.ts` 新增 `getTemplateDetail()`。
3. `routes/instance/studio.ts` 新增 `/studio/template-detail/:templateID`。
4. 如需同步，补 Effect HTTP API group/handler。
5. `studio-page.tsx` 新增前端请求函数和模板 usage 解析函数。
6. `editGenerationDraft()` 增加模板分支。
7. 补验证与类型检查：

```bash
cd packages/app && bun typecheck
cd packages/opencode && bun typecheck
```

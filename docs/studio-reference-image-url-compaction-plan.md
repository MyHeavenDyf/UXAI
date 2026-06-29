# Studio 参考图 URL 瘦身方案

## 背景

当前 Studio 在保存生成请求时，会把参考图以 `data:image/...` 的 base64 形式持久化到请求结构中。

这在功能上是可用的，但存在明显的存储膨胀风险：

- 图片参考图会被写入 `referenceImages`
- 视频首尾帧会被写入 `extra.firstFrame` / `extra.lastFrame`
- provider 最终请求体中，图片生成的 `args.ref_img_list`、视频生成的 `args.image` / `args.image_tail` 也可能包含大段 base64

随着时间推移，Studio 会话、generation record、tool metadata 中都可能积累大量 base64 图片数据，带来以下问题：

- 数据库存储体积持续膨胀
- 会话元数据变重，影响读取和展示性能
- regenerate / 历史查看时传输成本提高

为了解决这个问题，新增了 `DEFAULT_GET_HISTORY` 接口，用于在创建任务成功后查回该任务对应的历史参数，并从中获取已经落成 URL 的参考图字段。

本次目标是：

- 创建任务时继续按现有逻辑向下游发送 base64
- 创建成功后，用 history 接口查回同一 `task_id` 的 URL 版参考图
- 将原本准备持久化的 base64 请求体瘦身成 URL 版本
- 再次生成时，如果发现历史里保存的是 URL，则在发送前自动转回 base64

## 目标

- 降低 Studio 持久化请求中的大体积 base64 占用
- 不影响创建任务的现有行为
- 不影响 regenerate 的输入正确性
- 图片、视频、编辑能力对“URL 或 base64”两种输入都能兼容

## 新接口说明

在 `packages/opencode/src/tool/internel_image_generate.ts` 中已经新增 `DEFAULT_GET_HISTORY`。

### 请求

- 方法：`POST`
- Body：

```json
{
  "user": { "idx": "" },
  "page_idx": 1,
  "page_size": 10,
  "task_media_type": "all"
}
```

其中：

- `user.idx` 的取值与创建任务接口完全一致

### 成功返回

```json
{
  "resp_code": 200,
  "resp_msg": "success",
  "result": []
}
```

`result` 中每一项包含：

- `task_id`
- `task_type`
- `args`

其中 `args` 与创建任务时的 `args` 结构一致，但参考图相关字段已经被替换成了 URL。

## 参考图字段约定

### 图片生成

创建请求中参考图位于：

- `args.ref_img_list`

history 返回中，匹配到的 `args.ref_img_list` 也将是同字段，但里面的图片已经是 URL，而不再是 base64。

### 视频生成

创建请求中参考图位于：

- `args.image`
- `args.image_tail`

history 返回中，匹配到的 `args.image` / `args.image_tail` 也将是 URL。

## 总体方案

本次改造分成两段：

1. 创建成功后，对持久化 request 做“base64 -> URL”瘦身
2. 再次生成时，对历史 URL 做“URL -> base64”恢复

## 数据库瘦身是否会同步生效

会。

原因是当前 Studio 数据库存储的 generation request 并不是单独再组装一份，而是直接保存：

- `input`
- `task`

其中 `task` 就是 `createInternalGeneration()` 的返回结果。

也就是说：

- 创建接口真正发出去时，仍然使用原始 base64 `requestBody`
- 但如果在 `createInternalGeneration()` 返回前，已经把 `task.request` 中的图片字段替换成 URL
- 那么 Studio 后续落库保存的也是这份“已经瘦身后的 request”

因此，这次方案只要在 `createInternalGeneration()` 内完成 request 瘦身：

- 前端展示会拿到瘦身后的 request
- 数据库存储也会同步瘦身

不需要再额外增加一层“数据库专用瘦身逻辑”。

## 一、创建成功后的 request 瘦身

### 1. 新增 history 请求函数

在 `packages/opencode/src/tool/internel_image_generate.ts` 中新增：

- `getHistoryTasks(input: { userIdx: string })`

职责：

- 调用 `DEFAULT_GET_HISTORY` 或 `IMAGE_GET_HISTORY`
- 发送固定请求体
- 返回标准化后的 history 列表

建议标准化输出结构：

```ts
type HistoryTaskItem = {
  taskId: string
  taskType?: string
  args?: Record<string, unknown>
}
```

### 2. 新增 taskId 匹配函数

新增：

- `matchHistoryTaskById(history: HistoryTaskItem[], taskId: string)`

匹配规则：

- 一律将 `task_id` 和创建成功返回的 `taskId` 转成字符串后比较

原因：

- history 接口和 create 接口中 `task_id` 可能一边是 number，一边是 string

### 3. 新增 request 瘦身函数

新增：

- `replaceReferenceMediaWithUrls(requestBody, historyArgs, capability)`

职责：

- 只替换参考图相关字段
- 不修改非参考图字段
- history 缺字段时不清空原值

按能力区分：

#### 图片生成

读取：

- `historyArgs.ref_img_list`

替换：

- `requestBody.args.ref_img_list`

#### 视频生成

读取：

- `historyArgs.image`
- `historyArgs.image_tail`

替换：

- `requestBody.args.image`
- `requestBody.args.image_tail`

#### 编辑能力

除了图片生成和视频生成，编辑能力里的图片字段也要一并瘦身。

建议统一按 capability 定位字段：

##### `image.upscale`

读取：

- `historyArgs.image_base64`

替换：

- `requestBody.args.image_base64`

##### `image.cutout`

读取：

- `historyArgs.image_list`

替换：

- `requestBody.args.image_list[].image_base64`

这里需要注意：

- `image_list` 是数组
- 要按索引逐项覆盖 `image_base64`
- 仅在 history 返回对应位置存在 URL 时替换

##### `image.inpaint`

读取：

- `historyArgs.image_base64`

替换：

- `requestBody.args.image_base64`

##### `image.outpaint`

读取：

- `historyArgs.image_base64`

替换：

- `requestBody.args.image_base64`

因此，建议不要只做“参考图替换器”，而是做成更通用的：

- `replaceRequestMediaWithUrls(requestBody, historyArgs, capability)`

它的职责是：

- 根据 capability 找到 requestBody 中所有图片载荷字段
- 用 history 返回中的 URL 覆盖这些图片载荷字段
- 只替换图片相关字段，不改动其他业务参数

### 4. 在 createInternalGeneration() 中接入

当前大致流程：

1. `buildInternalRequestBody()`
2. `createTask()`
3. 返回 `{ taskId, request: requestBody }`

建议改造为：

1. 构造 `requestBody`
2. 调 `createTask()`
3. 取到 `taskId`
4. 使用同一个 `userIdx` 调 `getHistoryTasks()`
5. 在返回结果里匹配 `taskId`
6. 若匹配成功，则用 history 中 `args` 的 URL 替换 `requestBody` 中的参考图字段
7. 返回 `{ taskId, request: compactedRequestBody }`

这样：

- 真正发给下游的还是原始 base64 请求
- 但 Studio 最终持久化保存的是 URL 化后的 request

### 5. 异常处理策略

history 请求是“瘦身增强”，不是创建主链路的一部分。

所以：

- 若 history 接口失败，不应影响创建成功
- 若 history 中未查到当前 `taskId`，不应报错
- 若 history 返回里没有参考图字段，不应清空原值

建议策略：

- 记录日志
- 保留原始 base64 request
- 正常返回创建结果

## 二、再次生成时 URL 转回 base64

创建成功后持久化的是 URL 版本参考图，而 regenerate 时创建接口仍需要 base64。

所以 regenerate 必须支持：

- 如果历史里保存的是 data URL，直接复用
- 如果历史里保存的是 http/https URL，则先取回图片并转成 data URL/base64

## 三、图片生成的兼容方案

### 当前问题

图片生成最终构造 `args.ref_img_list` 时，当前逻辑更偏向直接消费 `data:image/...`。

在 URL 瘦身之后，如果 regenerate 带回的是 URL，则必须在真正构造 provider request 时统一转为 data URL。

### 方案

在 `internel_image_generate.ts` 的图片请求构造路径里，给 `referenceImages` 增加统一归一化步骤。

建议新增：

- `resolveReferenceImageDataUrls(referenceImages: string[])`

职责：

- 遍历 `referenceImages`
- 如果是 data URL，直接返回
- 如果是 URL，则 fetch 后转为 data URL

然后在 `buildTextToImageRequestBody()` 中：

- 不再只筛选 `data:image/...`
- 而是先统一 resolve，再生成 `ref_img_list`

### 结果

即使历史里保存的是 URL，最终再次生成图片时，真正发给 create 接口的仍是 base64。

## 四、视频生成的兼容方案

### 当前优势

视频链路已经有较好的兼容基础：

- `getVideoFrames()`
- `resolveImageInputDataUrl()`

它本身就支持：

- data URL
- http/https URL

### 方案

对视频 regenerate 来说，保持当前思路即可，只需确保：

- `extra.firstFrame`
- `extra.lastFrame`
- `referenceImages`

这些历史恢复字段都允许是 URL。

最终在 `buildVideoRequestBody()` 中：

- `getVideoFrames()` 会把 URL 转回 data URL
- 然后 `dataUrlToBase64()` 再生成创建接口所需的裸 base64

### 结果

历史持久化为 URL 不影响视频 regenerate。

## 五、编辑能力的兼容方案

虽然本次需求起点是“参考图”，但编辑能力的图片输入同样会以 base64 保存，因此也必须纳入 URL 瘦身范围。

当前已有：

- `getSourceImageDataUrl()`

它已经支持：

- data URL
- URL

因此编辑能力在本次改造后理论上可以天然兼容。

但需要把“持久化瘦身”和“发送前恢复”明确补齐：

### 持久化瘦身

编辑能力在创建成功后，也要把 `task.request.args` 里的图片字段从 base64 改成 URL。

需要覆盖的字段：

- `image.upscale` → `args.image_base64`
- `image.cutout` → `args.image_list[].image_base64`
- `image.inpaint` → `args.image_base64`
- `image.outpaint` → `args.image_base64`

### 再次发送恢复

后续如果这些能力再次发起请求，而持久化里保存的是 URL，则应通过已有的图片归一化函数，在真正创建任务前将其重新转成 data URL / base64。

因此，编辑能力不只是“天然兼容”，而是要正式纳入这次媒体 URL 化方案。

## 六、建议新增或调整的函数

### `internel_image_generate.ts`

建议新增：

- `getHistoryTasks(input: { userIdx: string })`
- `matchHistoryTaskById(history: HistoryTaskItem[], taskId: string)`
- `replaceRequestMediaWithUrls(requestBody, historyArgs, capability)`
- 可选：`compactRequestBodyWithHistory(input)`

建议调整：

- `createInternalGeneration()`
- `buildTextToImageRequestBody()`

### 职责划分建议

#### 创建链路

- `buildInternalRequestBody()`：负责创建下游请求体
- `createTask()`：负责真正创建任务
- `getHistoryTasks()`：负责查历史
- `replaceRequestMediaWithUrls()`：负责把待持久化 request 中的大块 base64 替换成 URL

#### regenerate 链路

- `resolveImageInputDataUrl()`：负责把 URL 转成 data URL
- 图片生成和视频生成最终都在 provider 构造层做归一化

## 七、数据保存策略

### 持久化层

尽量保存：

- URL

尽量不保存：

- 大块 base64

### 发送层

真正调用创建接口时：

- 统一将图片输入归一化成 data URL / base64

也就是说：

- 存储轻量化
- 发送时再做重建

## 八、边界情况

### 1. history 接口失败

处理：

- 不影响创建成功
- 保留原始 base64 request
- 仅记录 warning / debug 日志

### 2. history 接口查不到 task_id

处理：

- 不报错
- 不做瘦身
- 保留原 request

### 3. history 成功但未返回参考图字段

处理：

- 不覆盖原参考图字段
- 不清空原值

### 4. regenerate 时 URL 已失效

处理：

- 明确抛错
- 告知参考图地址不可用
- 不要静默降级成无参考图生成

### 5. 图片与视频字段不可混用

必须严格区分：

- 图片：`ref_img_list`
- 视频：`image` / `image_tail`

不能把前端 `referenceImages` 的概念直接拿来替换 provider `args` 字段。

### 6. 编辑能力字段结构差异

编辑能力的图片字段结构不统一：

- `image.upscale`：单字段
- `image.cutout`：数组嵌套字段
- `image.inpaint`：单字段
- `image.outpaint`：单字段

因此替换逻辑不能只靠一个固定字段名判断，必须按 capability 定位。

## 九、回归验证建议

### 图片生成

1. 上传参考图生成图片
2. 创建成功后检查持久化 `task.request.args.ref_img_list`
3. 应从 base64 变成 URL
4. 再次生成时，最终发往 create 接口的 `ref_img_list` 应重新转成 base64

### 视频单首帧

1. 上传首帧生成视频
2. 创建成功后检查持久化 `task.request.args.image`
3. 应从 base64 变成 URL
4. 再次生成时，最终发往 create 接口的 `image` 应重新转成 base64

### 视频首尾帧

1. 上传首帧和尾帧生成视频
2. 创建成功后检查 `image` 和 `image_tail` 都已变成 URL
3. 再次生成时，两者都能恢复成 base64

### 编辑能力

1. 对带 `sourceImage` 的能力进行生成
2. 创建成功后检查持久化 `task.request.args` 中的图片字段已由 base64 变为 URL
3. 再次调用时确认这些 URL 能被正确恢复成 base64

### history 失败兜底

1. 模拟 `DEFAULT_GET_HISTORY` 超时或返回空结果
2. 创建任务仍应成功
3. 只是 request 不发生瘦身

## 十、实施顺序建议

1. 先实现 `getHistoryTasks()` 和 `taskId` 匹配
2. 再实现创建后 request 瘦身
3. 再把图片生成的 `ref_img_list` 构造改成支持 URL -> data URL
4. 验证视频 regenerate 与编辑链路

## 结论

本次改造的核心不是改变创建接口的输入格式，而是把“持久化保存什么”和“最终发送什么”拆开：

- 创建时：仍然发 base64
- 保存时：尽量保存 URL
- 再次生成时：若保存的是 URL，再恢复成 base64

这样既能控制数据膨胀，又不会影响当前 Studio 的生成能力和再次生成功能。

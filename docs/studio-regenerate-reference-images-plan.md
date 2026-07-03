# Studio 再次生成携带参考图改造方案

## 背景

当前 Studio 的“再次生成”只会复用上一轮任务的 `capability` 和 `prompt`，不会把上一轮实际提交过的参考图、首尾帧、编辑底图、视频参数一起带回。

这会导致两类明显问题：

- 图片生成：上一轮如果上传了参考图，再次生成会退化为纯 prompt 重跑。
- 视频生成：上一轮如果是图生视频或首尾帧视频，再次生成会丢失首帧/尾帧，最终退化成文生视频，或者至少不再携带参考图。

现有链路里，参考图数据并没有丢失。服务端已经保存了：

- Studio 原始输入：`referenceImages`、`sourceImage`、`extra`
- provider 最终调用请求体：包含已经转换成 base64 的下游请求参数

所以这次改造的核心不是“补存储”，而是“让再次生成显式重放上一轮完整输入”。

## 改造目标

- 点击“再次生成”时，若上一轮使用了参考图，则将该参考图一并带出并再次提交。
- 区分图片生成和视频生成，两者恢复逻辑不同。
- 优先复用上一轮真实请求输入，而不是依赖当前 UI 内存状态。
- 不破坏普通新生成、编辑能力、异步轮询和历史展示逻辑。
- 若历史明确是图生视频但无法恢复首帧，应显式报错，不允许静默降级成文生视频。

## 当前现状

### 前端 regenerate 行为

`packages/app/octoapp/pages/studio-page.tsx`

- `regenerateCurrentResult()` 当前只传：
  - `capability`
  - `prompt`
- 没有传：
  - `referenceImages`
  - `sourceImage`
  - `extra.videoMode`
  - `extra.firstFrame`
  - `extra.lastFrame`
  - `extra.duration`
  - `extra.mode`

因此 regenerate 从入口上就丢失了历史参考图输入。

### 前端提交逻辑

`runGeneration()` 当前会根据“当前 UI 状态”构造请求：

- 图片生成只读 `assets()`
- 视频生成只读 `videoFrames`

而这两个状态在一次提交后会被清空：

- `setAssets([])`
- `clearVideoFrames()`

所以 regenerate 时即使 UI 上仍能看到历史结果，也无法从当前页面状态重新拿到上一次提交的参考图。

### 服务端已保存的数据

服务端 `packages/opencode/src/studio/studio-service.ts` 中：

- generation record 的 `request` 保存了 `{ input, task }`
- 其中 `input` 是 Studio 原始输入
- `task.request` 是 provider 最终请求体

这意味着：

- 原始 `referenceImages`、`sourceImage` 已保存
- 如果前端当时传的是 data URL，那么保存下来的也是带 base64 的完整内容
- 内部接口最终使用的 base64 请求体也已保存

## 根因

根因分两层：

1. regenerate 没有复用历史输入
2. 提交流程只会读取当前 UI 状态，而不会读取上一轮落库的请求快照

这也是为什么：

- 图片 regenerate 会丢参考图
- 视频 regenerate 会丢首尾帧并误走文生视频

## 设计原则

### 1. 历史输入恢复优先于 UI 状态

再次生成不应依赖 `assets()`、`videoFrames`、`workspaceImage()` 这类当前页面内存状态。

应优先从当前结果 `result().request` 中恢复上一轮真实输入。

### 2. 优先恢复 Studio 输入层，而不是 provider body

建议优先使用：

- `request.input.referenceImages`
- `request.input.sourceImage`
- `request.input.extra`

只有在 `request.input` 信息不完整时，才回退到：

- `request.task.request`
- `request.body`
- provider `args.*`

原因：

- Studio 输入层更贴近现有前端提交流程
- 更适合直接回填给 `runGeneration()`
- 可以避免前端直接依赖下游 provider 特有字段

### 3. 图片和视频分别恢复

图片和视频的“参考图语义”不同：

- 图片生成：参考图是 `referenceImages`
- 视频生成：参考图是首帧/尾帧和 `videoMode`

所以必须分别设计恢复逻辑，不能用一个“有 referenceImages 就全带回”的粗暴策略。

### 4. regenerate 必须与当前草稿态隔离

除了参考图丢失之外，还要防止另一个更隐蔽的问题：

- 图片模式残留的 `assets()` 不会污染视频生成，因为视频发送不读取 `assets()`
- 但当前输入区未发送的 `videoFrames` 草稿，可能污染历史视频任务的“再次生成”

根因是：

- 普通能力切换会走能力切换逻辑并清理不匹配的草稿状态
- `regenerateCurrentResult()` 则是直接调用提交链路
- 如果提交链路继续从当前页面的 `videoFrames` fallback 读取首尾帧，那么历史视频任务在再次生成时，就可能错误使用当前输入区尚未发送的草稿帧

因此，regenerate 必须满足一条额外原则：

- 历史任务重放时，只能使用历史任务快照恢复出的输入
- 不允许混入当前输入区尚未发送的草稿 `videoFrames`
- 同理，也不应混入当前输入区尚未发送的图片参考图草稿

## 建议的前端改造

### 一、新增历史输入恢复函数

建议在 `packages/app/octoapp/pages/studio-page.tsx` 或 `packages/app/octoapp/pages/studio/studio-shared.ts` 增加一个专门的恢复函数，例如：

```ts
function restoreGenerationInput(result: StudioGenerationResult): {
  capability: StudioCapability
  prompt: string
  referenceImages?: string[]
  sourceImage?: string
  extra?: Record<string, unknown>
  videoFrames?: { first?: string; last?: string }
}
```

职责：

- 从 `result.request` 中提取上一轮真实输入
- 根据 `result.capability` 生成适合再次提交的 override

### 二、恢复来源优先级

建议按以下顺序恢复：

1. `result.request.input`
2. `result.request.body`
3. `result.request.task.request`
4. `result.videoMode` / `result.duration` / `result.videoQualityMode`

其中：

- `request.input` 是首选
- `request.body` / `task.request` 主要作为兼容兜底

### 三、扩展 runGeneration 的 override 能力

当前 `runGeneration()` 的 override 只支持：

- `capability`
- `sourceImage`
- `prompt`
- `extra`

建议扩展为支持：

```ts
{
  capability?: StudioCapability
  prompt?: string
  sourceImage?: string
  referenceImages?: string[]
  extra?: Record<string, unknown>
  videoFrames?: {
    first?: string
    last?: string
  }
}
```

构造提交参数时优先级改为：

1. `overrides.referenceImages` / `overrides.videoFrames`
2. 当前 UI 状态 `assets()` / `videoFrames`
3. 空数组

这样 regenerate 和普通新生成可以共用同一套提交流程。

## 图片生成方案

### 适用范围

- `image.generate`

### 恢复字段

优先从 `result.request.input` 恢复：

- `referenceImages`
- `prompt`
- `capability`
- `styleModel`
- `aspectRatio`
- `count`
- 需要时也可恢复 `extra`

### 提交策略

再次生成时：

- 不依赖 `assets()`
- 直接将历史 `referenceImages` 通过 override 传给 `runGeneration()`

### 结果

重新调用 `/studio/generations` 时：

- `referenceImages` 会重新进入 Studio 请求体
- provider 侧仍按现有逻辑将其转换为下游参考图参数

### 注意点

- 若历史 `referenceImages` 为空，则图片 regenerate 保持现状，纯 prompt 重跑
- 若历史里同时有 `sourceImage`，要区分是否是编辑能力，不应错误混入 `image.generate`

## 视频生成方案

### 适用范围

- `video.generate`

### 视频要分两类

#### 1. 文生视频

判断标准：

- 历史 `videoMode === "text"`
- 或没有任何首帧/尾帧/参考图

恢复字段：

- `prompt`
- `duration`
- `mode`
- `videoMode: "text"`

再次生成时：

- 不附带首尾帧
- 不附带 `referenceImages`

#### 2. 图生视频

判断标准：

- 历史 `videoMode === "first_last_frame"`
- 或存在 `extra.firstFrame`
- 或存在 `referenceImages`

恢复字段：

- `prompt`
- `videoMode: "first_last_frame"`
- `duration`
- `mode`
- `firstFrame`
- `lastFrame`
- `referenceImages`

### 视频恢复来源优先级

建议按以下顺序恢复首尾帧：

1. `request.input.extra.firstFrame`
2. `request.input.extra.lastFrame`
3. `request.input.referenceImages`
4. `request.task.request.args.image`
5. `request.task.request.args.image_tail`

其中：

- 如果 `input.extra.firstFrame/lastFrame` 已存在，优先直接使用
- 如果只有 `referenceImages`，则按现有首帧/尾帧顺序还原
- 如果只剩 provider body 里的 base64 字段，也可以兜底恢复

### 提交策略

再次生成时：

- 不依赖当前 `videoFrames`
- 直接把历史恢复出的首尾帧通过 override 传给 `runGeneration()`
- `runGeneration()` 再把它们写回：
  - `referenceImages`
  - `extra.videoMode`
  - `extra.firstFrame`
  - `extra.lastFrame`
  - `extra.duration`
  - `extra.mode`

### 草稿隔离策略

为了避免当前输入区草稿污染历史视频任务的 regenerate，建议在 regenerate 场景中增加一个显式的“草稿隔离模式”：

1. `regenerateCurrentResult()` 调用 `runGeneration()` 时，标记这是一次历史任务重放
2. 一旦进入历史任务重放模式：
   - 视频相关参数只允许从 override 中读取
   - 禁止 fallback 到当前页面的 `videoFrames`
   - 图片相关参数同样禁止 fallback 到当前页面的 `assets()`
3. 历史文生视频应显式传空视频帧，并锁定 `videoMode: "text"`
4. 历史图生视频应只使用历史快照恢复出的首尾帧

建议在 `runGeneration()` 设计上体现为一个明确的控制位，例如概念上的：

```ts
{
  useRestoredInputs: true
}
```

只要该开关开启：

- `referenceImages` 只读 override
- `videoFrames` 只读 override
- 当前输入区的未发送草稿不参与本次 regenerate

这样可以把“历史重放”和“当前草稿编辑”彻底隔离开。

### 错误策略

若满足以下条件：

- 历史声明 `videoMode === "first_last_frame"`
- 但无法恢复出首帧

则应直接报错并中断 regenerate，不允许：

- 自动降级成文生视频
- 静默忽略历史参考图

### 原因

图生视频和文生视频在业务语义上完全不同，静默降级会造成用户感知错误。

## 编辑能力的处理建议

虽然本次主要目标是图片区分视频，但建议一并明确编辑能力的 regenerate 规则，避免后续再出现同类问题。

适用能力：

- `image.upscale`
- `image.cutout`
- `image.inpaint`
- `image.outpaint`

恢复字段：

- `sourceImage`
- `prompt`
- `extra`

提交时通过 override 直接重放 `sourceImage` 和编辑参数。

## 推荐的函数级拆分

### 1. 解析函数

新增：

- `restoreGenerationInput(result)`
- `restoreImageGenerationInput(result)`
- `restoreVideoGenerationInput(result)`
- `restoreEditorGenerationInput(result)`

职责：

- 根据 capability 分类恢复历史输入
- 屏蔽 `request` 结构细节

### 2. 提交函数

保留：

- `runGeneration()`

改造点：

- 支持 `referenceImages` override
- 支持 `videoFrames` override
- 在构造请求时优先使用 override
- 对 regenerate 场景增加草稿隔离模式，禁止 fallback 到当前 `assets()` 或 `videoFrames`

### 3. regenerate 入口

保留：

- `regenerateCurrentResult()`

改造方式：

- 从 `current` 调用 `restoreGenerationInput(current)`
- 将恢复结果完整传给 `runGeneration()`

## 是否需要后端改动

### 最小可行方案

只改前端即可。

原因：

- 服务端所需历史数据已保存
- `/studio/generations` 已支持 `referenceImages`、`sourceImage`、`extra`
- provider 现有逻辑已经能消费这些字段

### 推荐增强方案

后端可选增强 `StudioGenerationResult`，显式回传可复用字段，例如：

- `requestInput`
- `referenceImages`
- `sourceImage`
- `videoRequest`

好处：

- 前端不需要直接解析深层 `request.input` / `request.task.request`
- 结果结构更稳定，便于未来 regenerate、复制参数、再次编辑等功能复用

但这不是本次必须项。

## 字段级恢复建议

### 图片 regenerate

从历史恢复：

- `capability`
- `prompt`
- `referenceImages`
- `styleModel`
- `aspectRatio`
- `count`

再次提交写入：

- `capability`
- `prompt`
- `referenceImages`
- `styleModel`
- `aspectRatio`
- `count`

### 视频 regenerate

从历史恢复：

- `capability`
- `prompt`
- `referenceImages`
- `extra.videoMode`
- `extra.firstFrame`
- `extra.lastFrame`
- `extra.duration`
- `extra.mode`
- `aspectRatio`
- `count`

再次提交写入：

- `referenceImages`
- `extra.videoMode`
- `extra.firstFrame`
- `extra.lastFrame`
- `extra.duration`
- `extra.mode`

### 编辑 regenerate

从历史恢复：

- `sourceImage`
- `prompt`
- `extra`

再次提交写入：

- `sourceImage`
- `prompt`
- `extra`

## 回归验证点

### 图片

1. 上传参考图后生成图片
2. 点击“再次生成”
3. 检查 `/studio/generations` 请求中仍包含 `referenceImages`
4. 检查最终 provider 请求仍包含参考图参数

### 视频单首帧

1. 上传首帧生成视频
2. 点击“再次生成”
3. 检查请求中仍包含：
   - `referenceImages`
   - `extra.videoMode = first_last_frame`
   - `extra.firstFrame`
4. 检查最终 provider 请求仍走图生视频

### 视频首尾帧

1. 上传首帧和尾帧生成视频
2. 点击“再次生成”
3. 检查请求中仍包含：
   - `extra.firstFrame`
   - `extra.lastFrame`
4. 检查最终 provider 请求仍包含首尾帧

### 视频文生

1. 纯 prompt 生成视频
2. 点击“再次生成”
3. 检查不会错误带入历史参考图

### 视频 regenerate 与当前草稿隔离

1. 先在当前输入区上传一组首尾帧，但不要点击发送
2. 选择一条历史“文生视频”结果点击“再次生成”
3. 检查新请求中不应带入当前输入区未发送的首尾帧
4. 再选择一条历史“图生视频”结果点击“再次生成”
5. 检查新请求使用的是历史任务原始首尾帧，而不是当前输入区残留草稿

### 图片 regenerate 与当前草稿隔离

1. 当前输入区先上传一张新的图片参考图，但不要发送
2. 点击一条历史“带参考图图片生成”的“再次生成”
3. 检查新请求使用的是历史任务原始参考图，而不是当前输入区新草稿

### 编辑能力

1. 扩图 / 智能重绘 / 抠图 / 超清生成后点击“再次生成”
2. 检查 `sourceImage` 与编辑参数能被重放

### 异常场景

1. 历史声明为图生视频，但首帧恢复失败
2. 应明确报错
3. 不允许自动退回文生视频

## 实施顺序建议

1. 先做前端历史输入解析器
2. 再扩展 `runGeneration()` 的 override
3. 然后接入 `regenerateCurrentResult()`
4. 最后补视频图生错误兜底与回归测试

## 结论

这次改造的关键不是新增存储，而是让“再次生成”从“重放 prompt”升级为“重放完整输入”。

其中：

- 图片 regenerate 重点恢复 `referenceImages`
- 视频 regenerate 重点恢复 `firstFrame/lastFrame/videoMode`
- 编辑 regenerate 重点恢复 `sourceImage`

按照这个方案改造后，带参考图的历史任务在点击“再次生成”时，就能把参考图一起重新提交到最终接口。 

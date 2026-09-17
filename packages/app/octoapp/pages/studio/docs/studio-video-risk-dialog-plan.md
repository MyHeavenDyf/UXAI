# Studio 视频生成风险提示弹窗方案

## 目标

在 Studio 中增加视频生成风险提示弹窗，并满足以下约束：

- 仅在用户有视频生成权限时生效。
- 当前 Studio 页面挂载周期内，每个对话在首次切换到“视频生成”时展示。
- 未点击“已知悉”前，每次重新切换到“视频生成”都再次展示。
- 点击“已知悉”后，当前对话在本次 Studio 页面挂载周期内不再展示。
- 使用覆盖整个应用视口的遮罩。
- 点击遮罩不关闭弹窗。
- 按 `Escape` 不关闭弹窗。
- 只能通过右上角关闭按钮、“稍后再试”和“已知悉”关闭。
- 本阶段只输出实现方案，不修改业务代码。

## 参考实现

只参考：

`packages/app/octoapp/components/dialog-project-onboarding/dialog-project-onboarding.tsx`

需要复用的实现思路：

- 使用页面内条件渲染的独立组件，不使用全局 `dialog.show()`。
- 弹窗根节点使用 `position: fixed` 和 `inset: 0` 覆盖整个视口。
- 根节点直接提供半透明背景和居中布局。
- 遮罩节点不绑定关闭事件。

不复用 onboarding 弹窗的业务内容、尺寸、表单和项目选择逻辑。

同时不参照 onboarding 中以下样式写法：

- 不在 JSX 中使用 `class="fixed inset-0 z-50 flex items-center justify-center"` 这类原子化 CSS 简写。
- 不在标签上通过 `style={{ ... }}` 编写弹窗布局和视觉样式。
- 不混用原子 class、内联 style 和 Studio 语义 class。

本功能遵循 Studio 现有样式组织方式：JSX 只使用 `studio-*` 语义 class，所有布局、颜色、尺寸和响应式规则统一写入 Studio CSS 文件。

## 为什么不使用公共 Dialog

当前 `@opencode-ai/ui/context/dialog` 存在以下默认行为：

- `Kobalte.Overlay` 绑定了 `onClick={close}`。
- `onOpenChange(false)` 会关闭弹窗。
- `DialogProvider` 监听 `Escape` 并关闭弹窗。

这些行为与“只能通过弹窗内部三个入口关闭”的要求冲突。为了避免修改公共 Dialog 并影响其他页面，本功能应采用 Studio 页面内的独立受控弹窗。

## 组件设计

新增文件：

`packages/app/octoapp/pages/studio/studio-video-risk-dialog.tsx`

建议导出：

```ts
export function StudioVideoRiskDialog(props: {
  onCancel: () => void
  onConfirm: () => void
})
```

其中：

- 右上角 `x` 调用 `onCancel`。
- “稍后再试”调用 `onCancel`。
- “已知悉”调用 `onConfirm`。
- 遮罩不注册 `onClick`。
- 弹窗容器可注册 `onClick={(event) => event.stopPropagation()}` 作为防御，但不依赖事件冒泡关闭。
- 不注册 Escape 键盘监听。

弹窗根节点建议具备：

```tsx
<div
  role="presentation"
  class="studio-video-risk-overlay"
>
  <section
    role="dialog"
    aria-modal="true"
    aria-labelledby="studio-video-risk-title"
    class="studio-video-risk-dialog"
  >
    ...
  </section>
</div>
```

`z-index` 需要高于 Studio 菜单、拖拽层和普通浮层。具体值实现时结合现有页面层级确认，优先使用已有最高层级之上的局部值。

样式统一放入 Studio CSS：

```css
.studio-video-risk-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
}

.studio-video-risk-dialog {
  width: min(calc(100vw - 32px), 760px);
}
```

以上仅表达结构方向，实际实现时补齐颜色、圆角、阴影、间距和响应式规则，不在 JSX 中写内联样式。

## 视觉结构

弹窗按需求图拆分为三部分。

### 标题区

- 左侧使用临时圆形信息图标占位。
- 图标后显示标题“信息风险提示”。
- 右上角使用独立 `x` 按钮。
- `x` 按钮需要有明确的 `aria-label="关闭"`。

占位图标先使用 CSS 圆形背景加字母 `i`，后续替换真实图标时不改变标题布局。

### 内容区

文案：

```text
请遵守《业务生产与办公生成式人工智能管理指引》，按公司要求不能向外部网站上传内部文档、内部代码及内部信息；关于生成物版权请查看《Seedance服务专用条款》
```

其中两处协议名称使用蓝色链接样式。实际链接未提供时，首期可使用无跳转的按钮式文本或链接占位常量，避免写入无效业务地址。

内容区使用可换行的普通文本布局，不把整段文字写成单个不可拆分链接。

### 操作区

- “稍后再试”：浅灰背景、深色文字。
- “已知悉”：蓝色主按钮、白色文字。
- 两个按钮右对齐。
- 按钮样式由该弹窗组件自行定义，不复用公共 Dialog 的 footer。

建议弹窗宽度在 CSS 中使用响应式限制：

```css
width: min(calc(100vw - 32px), 760px);
```

小屏下保留左右安全间距，内容过长时允许弹窗内容区域滚动，但遮罩始终覆盖全屏。

## Studio 状态设计

在 `StudioPage` 增加三个页面内状态：

```ts
const [videoRiskDialogOpen, setVideoRiskDialogOpen] = createSignal(false)
const [videoRiskConfirmedSessionID, setVideoRiskConfirmedSessionID] =
  createSignal<string>()
const [draftVideoRiskConfirmed, setDraftVideoRiskConfirmed] =
  createSignal(false)
```

状态含义：

- `videoRiskConfirmedSessionID`：当前页面挂载周期中，已经点击“已知悉”的持久化对话 id。
- `draftVideoRiskConfirmed`：当前页面挂载周期中，无 session id 的新对话草稿是否已点击“已知悉”。
- 不写入 `localStorage`、session storage、服务端 session、消息记录或其他持久化位置。
- 离开 Studio 导致 `StudioPage` 卸载后状态自然丢失。
- 关闭软件重新进入后状态自然丢失。
- 因此重新进入 Studio 原对话，再切换到视频生成时仍会重新提示。

还需要保存打开弹窗前的能力：

```ts
const [capabilityBeforeVideoRisk, setCapabilityBeforeVideoRisk] =
  createSignal<StudioCapability>("image.generate")
```

虽然当前入口通常从图片生成切换到视频生成，但保留前值可以避免未来能力菜单扩展后写死回退目标。

## 首次切换流程

修改 `selectStudioCapability(value)` 的视频分支：

1. 如果 `value !== "video.generate"`，沿用现有逻辑。
2. 如果没有视频权限，继续直接返回，不展示弹窗。
3. 判断当前对话是否已经点击过“已知悉”：
   - 有 `params.id` 时，检查 `videoRiskConfirmedSessionID() === params.id`。
   - 无 `params.id` 时，检查 `draftVideoRiskConfirmed()`。
4. 如果当前对话已点击过“已知悉”，直接切换到视频生成。
5. 如果当前对话尚未点击“已知悉”：
   - 保存当前 capability。
   - 将 `videoRiskDialogOpen` 设为 `true`。
   - 暂不执行原有的视频能力切换逻辑。

这样可以保证弹窗打开期间 Composer 仍保持原能力，用户确认后才进入视频模式。

## 三个关闭入口

### 右上角关闭按钮

- 关闭弹窗。
- 保持或恢复到打开弹窗前的 capability。
- 不进入视频生成。
- 不记录已确认状态。
- 用户再次切换到视频生成时，重新显示弹窗。

### 稍后再试

- 行为与右上角关闭按钮一致。
- 关闭弹窗并保留原 capability。
- 不记录已确认状态。
- 用户再次切换到视频生成时，重新显示弹窗。

### 已知悉

- 关闭弹窗。
- 记录当前对话在本次 Studio 页面挂载周期中已经确认。
  - 有 `params.id` 时记录该 session id。
  - 无 `params.id` 时设置 `draftVideoRiskConfirmed(true)`。
- 调用提取后的实际能力切换函数进入 `video.generate`。
- 继续执行现有视频比例修正、图片资产清理和视频 Composer 切换逻辑。

建议把当前 `selectStudioCapability` 中真正执行切换的代码提取为同文件内函数：

```ts
function applyStudioCapability(value: StudioCapability) {
  // 当前 setCapability、比例修正、素材清理和编辑模式切换逻辑
}
```

`selectStudioCapability` 负责权限与风险提示判断，`applyStudioCapability` 负责执行切换，避免“已知悉”回调复制一份能力切换逻辑。

## 提示状态生命周期

提示状态只在当前 `StudioPage` 组件实例中有效。它不是“永久记住用户已知悉”，而是“本次进入 Studio 后，当前对话已知悉”。

建议沿用页面已有的 `pendingGenerationSessionID` 判定：

- 点击左侧“新对话”时：
  - 关闭风险弹窗。
  - 清空 `videoRiskConfirmedSessionID`。
  - 将 `draftVideoRiskConfirmed` 重置为 `false`。
  - 再执行现有新对话导航。
- 从一个已有 Studio session 切换到另一个历史 session 时：
  - 不需要为所有历史会话保存确认映射。
  - 将确认状态切换为未确认，目标会话首次切换视频时重新提示。
- 新对话首次生成导致 URL 从无 id 变为 `pendingGenerationSessionID` 时：
  - 如果草稿已点击“已知悉”，将确认状态从 `draftVideoRiskConfirmed` 转移到新 session id。
  - 转移后清空草稿确认状态。
  - 这是同一个对话从草稿态进入持久化 session，不应立即重复提示。
- 从 Studio 切换到其他模块：
  - `StudioPage` 卸载后不保存确认状态。
  - 返回 Studio 原对话后，再次切换视频生成时重新提示。
- 关闭软件再进入：
  - 不恢复确认状态。
  - 原对话再次切换视频生成时重新提示。

为保证状态入口唯一，建议将当前：

```tsx
onNewConversation={() => navigate(...)}
```

改为页面内 `startNewStudioConversation()`，由该函数先重置风险提示状态，再执行导航。

不使用 `Set<string>` 记录本次页面访问中多个历史对话的确认状态。切换到其他对话后再返回原对话，也应重新提示，更符合“当前对话、当前进入 Studio 周期”的严格提醒策略。

## 页面挂载位置

在 `StudioPage` 最外层 `.studio-page` 内、主要内容之后条件渲染：

```tsx
<Show when={videoRiskDialogOpen()}>
  <StudioVideoRiskDialog
    onCancel={cancelVideoRiskDialog}
    onConfirm={confirmVideoRiskDialog}
  />
</Show>
```

组件使用 `fixed` 定位，因此不受 Studio 三栏布局、滚动容器和宽度拖拽影响。

## 交互限制

弹窗打开时：

- 遮罩拦截鼠标操作，不能点击后方 Studio 内容。
- 点击遮罩不执行任何关闭逻辑。
- Escape 不关闭。
- 不提供遮罩双击关闭。
- 不提供浏览器级自动超时关闭。
- Tab 焦点应限制在右上角关闭按钮和底部两个按钮之间。
- 打开后默认聚焦“已知悉”或右上角关闭按钮，建议默认聚焦“已知悉”。
- 关闭后焦点返回视频生成能力按钮。

焦点限制可以使用组件内三个按钮的键盘循环实现，或使用 Kobalte 的 FocusScope，但不能重新引入会产生 outside dismiss 的 Dialog Root。

## 文件变更范围

计划新增：

- `packages/app/octoapp/pages/studio/studio-video-risk-dialog.tsx`

计划修改：

- `packages/app/octoapp/pages/studio-page.tsx`
- `packages/app/octoapp/pages/studio/studio.css`，或当前 Studio 已拆分的对应样式文件

不修改：

- `packages/ui/src/context/dialog.tsx`
- `packages/ui/src/components/dialog.tsx`
- onboarding 弹窗实现
- 视频权限接口和后端逻辑

## 验收场景

1. 无视频权限时，视频生成入口仍不显示，风险弹窗不会出现。
2. 有视频权限，新对话第一次点击视频生成时弹出风险提示。
3. 弹窗出现后，遮罩覆盖整个应用窗口。
4. 点击遮罩任意位置，弹窗保持打开。
5. 按 Escape，弹窗保持打开。
6. 点击右上角 `x`，弹窗关闭且保持原能力。
7. 点击右上角 `x` 后再次切换视频生成，弹窗再次显示。
8. 点击“稍后再试”，弹窗关闭且保持原能力。
9. 点击“稍后再试”后再次切换视频生成，弹窗再次显示。
10. 点击“已知悉”，弹窗关闭并进入视频生成。
11. 点击“已知悉”后，同一对话本次进入 Studio 期间再次切换视频生成，不再显示弹窗。
12. 新对话首次切换视频生成，重新显示弹窗。
13. 新对话生成第一条内容并获得 session id 后，同一对话不重复显示。
14. 从历史会话切换到另一个会话后，首次切换视频生成会显示一次。
15. 切换到其他模块再回到 Studio 原对话，切换视频生成时重新显示弹窗。
16. 关闭软件重新进入 Studio 原对话，切换视频生成时重新显示弹窗。
17. 弹窗打开时无法操作后方 Composer、历史列表和详情面板。
18. 小窗口下弹窗不溢出视口，内容可读，三个关闭入口可操作。
19. JSX 中不出现弹窗布局相关的原子 CSS 简写或内联 `style`，样式全部由 `studio-*` class 和 Studio CSS 管理。

## 验证方式

实现后执行：

```bash
cd packages/app
bun typecheck
```

并通过本地 Studio 页面手工验证上述交互场景，重点检查：

- 遮罩层级。
- 遮罩点击。
- Escape 行为。
- 新对话状态重置。
- 草稿对话创建 session 后是否重复提示。
- 关闭和“稍后再试”后是否仍会再次提示。
- 离开 Studio再返回时是否重新提示。
- 关闭软件重新进入后是否重新提示。
- 弹窗 JSX 是否只使用 Studio 语义 class。
- 权限接口失败时视频入口和弹窗是否仍保持隐藏。

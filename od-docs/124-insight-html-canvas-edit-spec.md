# 124｜Insight HTML 画布编辑复用 Spec

日期：2026-10-19

状态：已开放与 Design 相同的画布菜单，真实 Pixso 联调待完成

## 交互预览调整（2026-10-20）

按用户要求，Insight 先与当前 Design 对齐入口和菜单调用行为：局部适配器启用公共 `usePixsoTransport`，登录后可展示“导入到画板”“打开画布”“查看文件位置”。保留 HTML 预览、加载状态、会话校验、资源检查和回传保存。公共接口仍是占位实现，菜单动作不代表真实画布已打开，缺少回执仍记 `unconfirmed`。

本调整覆盖下文初版中“占位接口禁用”的约束及 A05 验收项：占位接口现在允许菜单预览和调用；真实画布端到端验收仍待完成。下方实施记录及浏览器验证结果保留为首次实现时的历史记录。

依据：当前仓库 Design（`pages/make`）与 Insight 实现。以下实施记录说明已完成的本地验证；真实画布依赖及发布条件仍按本文验收。

## 2026-10-20 实施记录

实现分支：`feat/124-insight-html-canvas-edit`，从本地 `dev` 的 `648039173` 创建。

- 普通结果与附件两套工具栏均已增加 HTML 专属入口，位于下载前。非 HTML 不显示；代码视图、加载中、空内容、已知读取失败、无会话及传输不可用时禁用并提供原因。
- 新增 `canvas-edit-menu.tsx`、`canvas-edit-session.ts`、`canvas-edit.ts`，分别负责 UI、操作生命周期和数据/文件适配。迟到初始化不回弹菜单，动作与回传固定原会话；实际结果面板接入 HTML 加载状态，刷新失败不会沿用旧缓存开放入口。
- `canvas-transport.ts` 是 Insight 的局部对接入口，复用公共 `usePixsoTransport` 签名。当前显式 `available=false`；真实实现交付后需在此声明能力、动作 ID 和可验证回执，不能仅切换开关就视为联调完成。
- C2D 打包器新增可选 `readFileBuffer`，让 Insight 传入严格检查后的读取快照，避免第二次磁盘读取失败后静默降级。原有生产调用方为 Design 的默认处理器及 components 处理器；均未传新参数，保持原桌面读取与容错行为，已验证默认调用回归。
- 资源检查覆盖现有解析器可识别的引用：拒绝目录外资源、缺失文件和无本地基准的相对引用；外部 URL 原样保留，不提示（与 Design 行为对齐）。不注入资源追踪桥，不更改预览沙箱。
- 回传 HTML/ZIP 保存到原会话 uploads，同名加后缀；检查文件及目录撞名、原始 ZIP 文件路径、大小写冲突及目标目录边界。同一渲染进程内回传串行保存。缺少 `writeFileBuffer/fileExists/dirExists` 时不提供回传回调；未更改 preload。
- 新增 5 个 Insight 事件名。动作缺少成功证据时记 `unconfirmed`，不计业务成功。命名与实现位置已同步 `tracking-plan.md`、`tracking.md`。

验证结果：

- 从 `packages/app` 运行 `bun typecheck` 通过。
- 5 个相关测试文件共 51 项通过，含 22 项新增测试；执行命令见下方。现有归档取消测试依赖 Solid 浏览器响应式实现，需使用 `--conditions=browser`。
- 生产构建通过。`bun run build` 在本机返回 `CouldntReadCurrentDirectory`，改为运行同一 Vite 构建入口 `node ./node_modules/vite/bin/vite.js build`，退出码为 0。构建输出 Node 20.18 低于 Vite 建议版本，以及资源路径、CSS、重复 sourcemap 和包体积提示；本次未改动这些无关配置。
- 独立 Chromium 检查使用真实组件、完整 ResultViewer 及生产 CSS，覆盖普通/附件入口、非 HTML 隔离、占位禁用、菜单实际调用 ZIP、Escape、文件切换、读盘失败/恢复、代码视图。仅项目上下文、桌面读盘及外部画布边界使用测试适配，不能代替真实 Pixso 联调；临时验证页面不作为产品路由交付。

```powershell
# 工作目录：packages/app
bun test --conditions=browser --config ./bunfig.toml ./octoapp/pages/insight/utils/canvas-edit.test.ts ./octoapp/pages/insight/utils/canvas-edit-session.test.ts ./octoapp/pages/insight/utils/interaction-tracking.test.ts ./octoapp/pages/insight/utils/interaction-tracking-handlers.test.ts ./octoapp/pages/insight/components/result-viewer/tab-store.test.ts
```

待完成：真实 Pixso 的 HTML 转换、打开、定位和导出回传端到端验收。当前正式能力保持不可用，不宣称已完成真实画布编辑流程。跨进程同时写入及用户在保存时从外部修改目录不提供原子防覆盖保证，现有桌面写盘 IPC 不支持独占创建。

## 1. 目标与结论

在 Insight 打开的 HTML 结果页中增加“画布编辑”，复用 Design 已有的 HTML 打包格式及公共 Pixso 对接接口，将页面交给设计画布继续编辑。

用户流程：打开 Insight 的 HTML → 点击“画布编辑” → 选择“导入到画板”或“打开画布” → 在设计工具中编辑；设计工具支持导出回传时，将结果保存为当前 Insight 会话的新文件。

采用 **Insight 局部适配 + 现有打包能力 + 公共传输接口**。不直接搬入 Design 的整个 HTML 渲染器、工具栏或 subtype handler，不改变 Design 既有行为。

当前 `usePixsoTransport` 是占位实现：三个菜单操作仅打印日志并返回占位结果。接入入口、生成菜单、成功返回 Promise 均不能证明真实画布已打开。正式启用依赖真实传输实现及联调验收。

## 2. 当前实现与可复用边界

以下路径均相对于仓库根目录。

| 模块 | 现有实现 | 本次使用方式 |
| --- | --- | --- |
| Design 画布入口 | `packages/app/octoapp/pages/make/components/result-viewer/action-bar.tsx` 中的 `CanvasEditDropdown` | 参考菜单、加载态和调用顺序；组件未导出且绑定 Design 数据，不直接跨页调用 |
| Design HTML 处理 | `packages/app/octoapp/pages/make/subtype-handlers/default.ts` 中的 `handleCanvasEdit` | 参考登录检查、配置和回传流程；不复用整个 handler |
| C2D 打包 | `packages/app/octoapp/pages/make/utils/canvas-to-design.ts` 中的 `createC2DZip` | 复用既有 ZIP 协议及实现；Insight 在调用前完成自己的内容和资源检查 |
| 公共画布对接 | `packages/app/octoapp/utils/useZipTransport.ts` | 复用 `UploadZipOptions`、`PixsoAction`、`usePixsoTransport`；真实实现为发布依赖 |
| Insight 工具栏 | `packages/app/octoapp/pages/insight/components/result-viewer/action-bar.tsx` | HTML 类型增加局部入口，覆盖普通结果和会话附件两套工具栏 |
| Insight HTML 预览 | `packages/app/octoapp/pages/insight/components/result-viewer/html-renderer.tsx` | 保持现有 Blob URL 与 `sandbox="allow-scripts"`，不注入 Design 编辑桥脚本 |
| Insight tab | `packages/app/octoapp/pages/insight/components/result-viewer/tab-store.ts` | 适配 `inline / uri / path` 来源，通过 `tabLocalPath` 解析已落盘路径 |
| Insight 文件刷新 | `packages/app/octoapp/pages/insight/index.tsx` 中的 `filesRefreshKey` | 回传保存成功后复用原有刷新链路，不增加全局广播机制 |

## 3. 本期范围

### 3.1 纳入

- Insight HTML 预览工具栏中的“画布编辑”入口与菜单。
- HTML 内容、文件路径、标题、会话信息到画布接口的适配。
- HTML 及可解析本地资源的 C2D 打包。
- 登录、内容加载、运行环境和传输可用性检查。
- 导入、打开和定位操作的加载态、错误反馈与重复点击控制。
- 真实接口触发 `downloadHtml` 时，保存回传 HTML 或 ZIP 并刷新原会话文件列表。
- Insight 专属操作埋点及 Design 回归验证。

### 3.2 不纳入

- 在 Insight iframe 内新增拖拽、缩放、属性编辑、框选或模型编辑能力。
- 替换 Insight HTML 渲染器或降低 iframe 沙箱隔离。
- 非 HTML 类型的画布编辑；React 工程及 Design 其他 subtype 的迁移。
- 实现新的 Pixso 编辑器、重新设计登录体系或扩展公共画布协议。
- 自动覆盖原 HTML、自动归档、自动发送消息或自动注册为模型产物。
- 父级目录资源重排、任意动态资源抓取、外部网站完整离线镜像。

## 4. 入口与交互

### 4.1 入口位置

仅 `tab.type === "html"` 时显示“画布编辑”。普通 HTML 结果和会话附件打开的 HTML 均支持。入口放在操作区“下载”之前，沿用所在工具栏的样式；非 HTML 页保持原样。

普通结果在预览视图可用；代码视图保留入口但禁用，提示“请切换到预览视图后再使用画布编辑”。会话附件按现有预览方式使用，不为此增加新的视图切换功能。

### 4.2 可用条件

| 条件 | 行为 |
| --- | --- |
| HTML 内容尚未读取 | 禁用，提示“HTML 内容加载中” |
| 内容读取失败 | 禁用，沿用结果区现有重试入口 |
| 去除代码围栏后内容为空 | 禁用，提示“HTML 内容为空” |
| 未登录 | 点击提示“请先登录”，不调用传输接口、不生成 ZIP |
| 缺少当前会话 ID | 禁用，提示“请进入会话后再使用画布编辑” |
| 无真实画布传输实现，或环境不支持 | 禁用，提示“当前环境暂不支持画布编辑” |
| 正在准备或执行操作 | 显示加载态并禁用当前入口，避免重复提交 |

登录态判断沿用当前产品账号来源，不另建缓存或仅为 Insight 修改公共登录逻辑。运行环境是否可用必须来自集成配置或适配层的明确能力声明，不能以函数存在、菜单非空或返回 `success: true` 作为判断依据。

### 4.3 操作流程

1. 点击入口时检查条件，固定本次操作所属的 tab、会话、项目目录和 HTML 来源。
2. 准备 `UploadZipOptions`，调用 `usePixsoTransport(options)` 获取动作。
3. 展示接口返回的动作，保留其顺序和文案；不在 Insight 中伪造固定的可用动作。当前预期包括“导入到画板”“打开画布”“查看文件位置”。
4. 点击动作后关闭菜单，执行 `action.fn(options)`。`getZip` 按传输实现实际需要惰性调用，不能假定打开菜单就一定已上传。
5. 打包或请求异常显示可重试的错误反馈；无可用动作时提示“当前没有可用的画布操作”。操作结束恢复入口。
6. 点击外部、按 Escape、切 tab、切会话或组件卸载时关闭菜单。迟到结果不得在新 tab 上重新弹出菜单。

传输初始化可能包含上传等副作用，不将其视为纯菜单查询。同一次入口操作使用同一份 options；tab、内容或来源发生变化后应重新准备，不能继续复用旧菜单的数据。

## 5. 数据与打包规则

### 5.1 HTML 来源

| 来源 | HTML 取值 | 本地资源基准 |
| --- | --- | --- |
| `path` | 执行时重新读取本地 HTML；读盘失败明确报错，不能静默使用旧缓存 | 本地 HTML 所在目录 |
| `uri` 且已落盘 | 通过 `tabLocalPath(tab)` 获取本地路径，执行时读本地副本 | 本地 HTML 所在目录 |
| `uri` 且未落盘 | 使用现有加载链路已读到的 HTML；相对资源未解析时按下述限制处理 | 不伪造本地路径 |
| `inline` | 使用当前 tab 内容并沿用 Insight 的 `stripCodeFence` | 无本地目录，仅自包含或绝对 URL 资源可直接使用 |

原始源码用于打包，不从 iframe DOM 序列化，不加入预览桥脚本。URI 文件已落盘时优先本地副本，不额外下载覆盖用户的本地文件。

现有 `createC2DZip` 内部的读盘帮助函数在失败时会退回传入 HTML，因此 Insight 必须增加来源检查，不能把其默认降级行为描述为“读取了最新磁盘版本”。本期不修改 Design 的默认降级策略。

每次操作固定来源及归属；同次操作只构建一份成功的 ZIP 供重复请求复用。磁盘在准备期间发生修改时，不承诺跨文件的原子快照；要打包修改后的版本，应重新发起操作。

### 5.2 C2D ZIP 格式

保持与 Design 一致：

```text
canvas-package.zip
├─ octo-c2d.json
└─ data/
   └─ html.zip
      ├─ index.html
      └─ HTML 所引用且可读取的目录内资源
```

`octo-c2d.json`：

```json
{
  "name": "octo-c2d",
  "version": "1.0.0",
  "frames": [
    { "name": "当前 HTML 标题", "filePath": "./data/html.zip" }
  ]
}
```

不使用归档 ZIP 替代 C2D ZIP；两者协议与用途不同。

### 5.3 资源边界

- 本地 HTML 同目录及子目录内，使用现有资源解析能力收集图片、CSS、JS 等引用，保持目录结构。
- 现有 C2D 实现会过滤 HTML 目录之外的文件；静态检查发现 `../` 等引用解析到父级目录时，本期阻止导入，提示“页面引用了所在目录之外的资源，请整理到同一目录后重试”。不宣称这些资源已被打包。
- 已识别的必要本地引用缺失或不可读时，提示“部分本地资源无法读取，请检查后重试”，不静默丢弃后报完整成功。检查范围以现有解析器能识别的引用为限。
- 引用了另一份根目录 `index.html` 且与 C2D 入口命名冲突时阻止导入，提示调整资源名；不静默丢弃该文件。
- 无本地目录、又包含无法确定基准的相对资源时，阻止导入并提示“请先将 HTML 及其资源保存到本地目录”。现有落盘完成后可重新发起。
- 绝对 HTTP(S) URL 保留原引用，不额外下载；画布端能否访问受其网络和鉴权限制。与 Design 对齐，不弹出联网提示。
- Insight 当前没有 Design 的资源加载追踪桥，本期不为此引入桥脚本；`observedUrls` 使用空数组。不能承诺识别运行时拼接 URL 或完整还原所有网页交互。

资源检查仅覆盖 Insight 调用链，不改变 Design 公共打包器的现有过滤和容错行为。

## 6. 接口与实现划分

### 6.1 Insight 适配器

建议新增以下局部模块，命名可按实现细节微调：

- `pages/insight/components/result-viewer/canvas-edit-menu.tsx`：入口、菜单、状态及生命周期。
- `pages/insight/utils/canvas-edit.ts`：来源检查、资源检查、options 组装和回传落盘。

适配器接收当前 tab、原会话 ID、项目目录、传输可用性及文件刷新回调，不依赖 Design 的 `ResultTab` 或 `SubtypeHandlerContext`。

`UploadZipOptions` 字段对应关系：

| 字段 | Insight 值及约束 |
| --- | --- |
| `getZip` | 返回本次 HTML 的 C2D `Blob`；拒绝时向上传递具体失败原因 |
| `config.designName` | 发起时的 tab 标题，空值兜底文件名，再兜底 `Insight HTML` |
| `config.sessionId` | 发起时的 Insight 会话 ID，不能借用 Design 会话 |
| `downloadHtml` | 保存回传文件的异步回调，成功必须以实际落盘为依据；失败 reject |

### 6.2 复用策略

第一选择是直接调用现有 `createC2DZip` 和公共 `usePixsoTransport`，Insight 自己适配前后条件。`createC2DZip` 目前仍通过 make 的桌面 API helper 读盘，接入时必须验证其在 Insight 环境下使用的是同一套可用 `window.api`。

若实际联调证明必须注入文件读取能力，允许给打包器增加可选参数并保留旧默认行为；变更前审查所有调用方，并补 Design 原流程回归。不要为本需求搬迁整套公共工具、修改 Design subtype 或扩大 CSS 选择器作用域。

真实 Pixso 传输由公共对接方提供。接入前需确认：能力声明方式、动作初始化是否上传、动作完成证据、错误与取消语义、回传回调的有效期和数据格式。保留现有对外签名；若签名不足以表达结果，先记录接口差异，不由 Insight 单方面变更公共协议。

### 6.3 状态隔离

- 加载态以当前操作实例维护，不锁住其他文件的复制、下载、归档或预览。
- 切换 tab/会话后清除旧菜单状态；不将旧操作结果绑定到新的活动文件。
- 请求无法取消时，可继续完成原请求，但不能误操作当前页面。回传仍使用发起时固定的项目及会话，不重新读取当前路由决定保存目录。
- 同一 tab 执行中重复点击不新增请求。失败后显式重试视为新的操作。

## 7. 画布结果回传

此能力仅在真实传输实现调用 `downloadHtml({ filename, base64 })` 时生效，不假设画布每次编辑都会自动回传。

1. 目标目录为发起操作时的 `<projectDir>/.octo/<sessionId>/uploads/`，沿用 Design 的回传分类。保留原 HTML，不覆盖、不自动切换现有 tab。
2. 单个 HTML 作为新文件保存；ZIP 解压到新建的独立目录，保留内部相对路径。其他格式本期拒绝并提示“不支持的画布回传格式”。
3. 文件或目录撞名时加 ` (1)`、` (2)` 等后缀。文件名及 ZIP 路径必须规范化，拒绝绝对路径、盘符和越过目标目录的路径；写入前确认最终绝对路径仍在目标目录内。
4. 缺少项目目录、会话或写盘能力时明确失败，不回退到当前其他会话目录，不显示“已保存”。只有具备回传落盘能力时才向对接层提供该回调；导入和打开本身是否可用由其各自能力决定。
5. Base64 解码、ZIP 解析或任何文件写入失败均返回失败。部分文件已经写入时说明结果不完整，不自动递归删除目录；重试使用新目标目录。
6. 所有文件写入成功后提示“已保存到会话文件”，触发原会话文件列表刷新。刷新失败与保存失败分别提示，不将已成功保存改报为写入失败。
7. 若用户已经切到其他会话，只更新原会话相关数据，不把回传文件插入当前会话列表。页面已卸载后的回传不保证可处理；不承诺退出应用后仍可回传。
8. 手动回传不生成 `artifact-file-write / artifact-file-edit / artifact-mcp-return`；沿用现有模型产物事实与用户操作的区分。

## 8. 错误与反馈

| 场景 | 用户反馈 | 后续行为 |
| --- | --- | --- |
| 占位或不支持的传输实现 | 当前环境暂不支持画布编辑 | 不调用占位动作、不显示成功 |
| HTML 读盘失败 | 无法读取 HTML，请刷新后重试 | 不用旧缓存冒充最新文件 |
| 本地资源缺失或超出范围 | 使用第 5.3 节对应提示 | 不发起有缺失的导入 |
| ZIP 生成失败 | HTML 打包失败，请重试 | 恢复入口，保留原预览 |
| 传输初始化失败 | 画布服务连接失败，请重试 | 不展开旧菜单 |
| 动作返回明确失败或抛错 | 无法完成画布操作，请重试 | 恢复入口，不报成功 |
| 用户取消，且接口能识别 | 关闭加载态 | 不按失败提示或记成功 |
| 回传保存失败 | 画布文件保存失败，请重试 | 不覆盖原件，保留原会话归属 |

错误日志可保留必要诊断；用户提示不直接展示完整 Base64、令牌或内部调用栈。

## 9. 操作统计

复用 Insight 的 `tracker` 与 `beginInsightOperation`，均为 `module=insight`。以下为待实现事件，不代表已写入现有打点清单。

| 事件 | 触发时机 | 主要字段 |
| --- | --- | --- |
| `canvas-edit-open` | 有效入口点击，通过前置检查后 | tabType=html、source、fromAttachment、viewMode |
| `canvas-edit-start / canvas-edit-result` | 初始化动作或执行所选动作 | operationId、sessionId、action=prepare/import/open/reveal/other、status、durationMs、失败 reason |
| `canvas-return-save-start / canvas-return-save-result` | 回传进入保存流程及实际写入结束 | operationId、原 sessionId、format=html/zip、status、durationMs、失败 reason |

`prepare` 成功只表示动作准备完成；导入、打开、定位的成功需真实接口提供对应证据。仅 Promise resolve、返回 URL 或占位 `success: true` 不证明画布已加载或导入完成；证据不足时只记录请求已发起，结果不虚构为成功。实现时与真实对接方确定可观测的结果阶段，再同步事件字段。

一次执行最多一个终态结果；可识别取消记 `cancelled`，新重试生成新的 operationId。不记录 HTML 正文、文件名、绝对路径、资源 URL、Base64 或账号令牌。动作通过语义映射为有限枚举，不能依赖中文文案作为长期统计标识；接口无稳定动作 ID 时由适配层维护映射。

## 10. 改动清单与影响范围

| 文件/目录 | 计划改动 |
| --- | --- |
| Insight `result-viewer/action-bar.tsx` | 两套工具栏仅对 HTML 增加入口 |
| Insight `result-viewer/canvas-edit-menu.tsx`（新增） | 菜单、异步状态及关闭行为 |
| Insight `utils/canvas-edit.ts`（新增） | 数据适配、检查、打包调用、回传保存 |
| Insight ResultViewer / 页面传参链 | 按需传递原会话归属及文件刷新回调 |
| Insight `lib/electron-api.ts` | 仅在回传必须时补充现有 preload 已提供的最小类型；不虚构运行时能力 |
| Insight `docs/tracking.md` | 实现完成后登记新增事件及其证据口径 |
| 对应局部测试 | 来源、打包内容、回传隔离及交互的必要验证 |

默认不修改 Design 页面、其他结果类型、公共 CSS、后端模型流程或桌面 preload。公共传输真实实现属于外部交付依赖；若需在本仓库改动，应列出所有调用方、明确兼容策略并验证，不能作为 Insight 局部改动隐含带入。

## 11. 验收标准

### 11.1 本地可验证

| 编号 | 场景 | 通过标准 |
| --- | --- | --- |
| A01 | 打开普通 HTML 结果 | 预览工具栏出现“画布编辑”，位置和样式符合第 4 节 |
| A02 | 会话附件 HTML | 附件工具栏出现同等能力；刷新、下载、全屏保留原行为 |
| A03 | Markdown、图片、JSON、Office 等 | 不出现画布入口，原操作无行为变化 |
| A04 | 未加载、空内容、代码视图、未登录、无会话 | 按第 4 节反馈；不发生传输或打包副作用 |
| A05 | 仅有占位传输实现 | 禁用并明确说明不可用，不以菜单出现作为功能成功 |
| A06 | `inline / uri / path` | 使用正确 HTML；URI 已落盘使用本地副本；本地读盘失败不静默导入旧内容 |
| A07 | 同目录 CSS、图片等 | 解开真实生成的两层 ZIP，验证 manifest、HTML 和引用文件内容及相对路径 |
| A08 | 父级目录引用、缺失资源、无基准相对路径 | 按第 5.3 节阻止并提示，不悄悄导入残缺资源 |
| A09 | 外部 URL 和动态加载资源 | 保留 URL 原样、不提示；不声称已离线打包或完整追踪 |
| A10 | 重复点击、切 tab、切会话、卸载 | 同次操作不重复执行；旧菜单不回弹、回传不串会话 |
| A11 | 回传 HTML / ZIP | 保存到原会话 uploads，同名不覆盖，列表可刷新并打开新文件 |
| A12 | 非法回传路径、损坏 Base64/ZIP、部分写盘失败 | 拒绝越界，不误报保存成功，错误可见 |
| A13 | 回传完成但列表刷新失败 | 文件保存成功与刷新失败分别反馈，不重复保存或误报写入失败 |
| A14 | 埋点 | 模块、原会话、动作与结果证据准确，无敏感正文、路径或资源 URL |
| A15 | Design 回归 | 原 HTML 画布入口、打包结果、其他编辑模式及其他调用方行为保持原样 |

优先用真实文件和 JSZip 读取实际产物验证；不在测试里复制生产打包逻辑。局部接口桩仅用于验证宿主交互，不充当真实 Pixso 联调证据。

涉及代码实现时，从 `packages/app` 运行对应目录的 Bun 测试及 `bun typecheck`，不从仓库根目录运行测试，不直接执行 `tsc`。本次仅编写文档，无需运行代码测试。

### 11.2 真实环境联调

- “导入到画板”使实际画板出现对应 HTML 转换结果；核对文本、布局和受支持的图片、样式资源。
- “打开画布”实际到达正确文件；“查看文件位置”实际定位正确文件。若接口只支持其中部分动作，只显示真实可用项。
- 接口认证失败、网络失败、用户取消均能得到正确反馈，无占位成功提示。
- 从真实画布导出回传 HTML 和 ZIP，确认原 Insight 会话中产生可用新文件，原 HTML 不被覆盖。
- 联调记录注明环境、真实传输版本、可观测成功阶段及资源还原限制；不能只凭前端控制台无报错完成验收。

## 12. 交付顺序与发布条件

1. **确认依赖**：对接方给出真实 `usePixsoTransport`、能力声明及第 6.2 节的接口行为；确定哪些动作和回传可用。
2. **完成局部接入**：实现 Insight 入口、数据适配、资源检查、回传和必要测试；缺少真实能力时保持入口不可用。
3. **完成联调和回归**：通过第 11 节对应验收，记录未支持的资源与动作。

允许先交付本地接入代码，但只有在真实传输可用且对应联调通过后，才能将功能标记为“可用”并在正式环境启用。回传若尚无真实实现，应明确记录为未交付，不宣称已形成完整编辑回传流程。

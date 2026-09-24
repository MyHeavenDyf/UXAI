# 115｜基于 PR 918 的 Insight 加号与 MCP 接入方案

日期：2026-09-23。依据本地已合入的 PR #918（合并提交 `07d58b415`，实现提交 `12d44461d`）及当前 Insight 代码评审。本次仅形成接入方案，未改业务代码、未做运行时验证。

## 2026-09-24 实施记录

下文保留原评审方案。实现分支：`codex/insight-addon-menu-mcp`，基于 `upstream/dev` 的 `36b429c7e`。

- Insight 初始页、会话页使用同一个 `InsightAddonMenu` 包装器，直接组合 PR 918 的四项内置能力和 MCP slot。
- MCP 选择列表进入加号，已选模式胶囊留在内容区；原发送模板、工具 gate、队列快照保持原流程。
- 资产选择先保留在包装器状态中，成功后才批量插入有效文件引用；没有将未下载的资产 ID 写入编辑器。未完成项阻止发送并可重试/移除。
- ZIP 保留目录结构，展开为文件引用；引用名称带导入批次短标识以避免 MCP 同名材料混淆。草稿资产首次发送时整目录迁移。
- 为控制影响范围，下载与迁移适配先留在 Insight 工具模块；不搬动 Design 原下载器。公共菜单仅增加可选配置和插槽状态协调，README 已补充说明。
- 已验证：`bun typecheck`、80 项相关测试、生产构建。构建提示当前 Node 版本低于 Vite 建议版本，以及资源/大包警告，但构建退出码为 0。
- 待运行环境验收：本机 `localhost:4444` 无服务，未完成真实页面交互和产品资产接口端到端验证。失败/取消导入可能留下未注册临时目录；不自动删除本地文件。

## 1. 结论

直接使用 PR 918 的 `AddonMenu`，通过 `items` 选择四个内置项，通过 `slots` 增加“研究工具”MCP 入口。新增 Insight 局部包装器，供初始页和会话页共用。本轮不重新搬迁整个公共组件，不实施上一版方案的全部架构改造。

目标菜单：

```text
+
├─ 技能库       > 平台技能 / 自定义技能
├─ 产品资产库   → 现有资产弹窗
├─ 设计文件     > Insight 当前会话的生成/上传文件
├─ 添加附件     → Insight 原有文件选择与上传流程
└─ 研究工具     > 观点解析 / 按提纲聚类 / 思维导图 / 可用性问题分析
```

按本次需求保留“设计文件”文案，数据使用 Insight 文件，不读取 Design 会话。若后续改称“会话文件”，新增可选文案覆盖即可，默认值保持 Design 原样。

## 2. PR 918 已具备的接口

组件当前路径：`packages/app/octoapp/pages/make/components/addon-menu/index.tsx`。

| 接口 | 本次使用方式 |
|---|---|
| `items` | 显式配置四个内置 key 和一个 MCP 插槽 key，确保不显示 URL |
| `slots` | 注入 Insight 的研究工具入口，不给公共组件增加 MCP 业务知识 |
| `skillConfig` / `onSkillsOpen` | 适配 Insight 已有技能数据与惰性加载函数 |
| `artifactFiles` | 将 Insight 文件结构转为组件要求的结构 |
| `selections` / `onSelect` / `onDeselect` | 连接 Insight 编辑器文档 |
| `productId` / 下载回调 / 路径回填 | 接产品上下文及 Insight 文件导入 |
| `onAddAttachment` / `maxAttachments` | 接原文件 input；仅附件项达到上限时禁用 |
| `trackerModule` | 传 `insight`；资产弹窗内部另需透传，见下文 |

现有 API 的使用骨架（其中 adapt/handle 函数为待实现的 Insight 适配函数）：

```tsx
import { AddonMenu } from "@/pages/make/components/addon-menu"

<AddonMenu
  items={["skills", "productAssets", "designFiles", "addAttachment", "insightMcp"]}
  slots={insightSlots}
  skillConfig={{
    panel: {
      octo_make: insightSkills().platform,
      common: insightSkills().custom,
    },
  }}
  onSkillsOpen={loadInsightSkills}
  artifactFiles={adaptInsightFiles()}
  selections={addonSelections()}
  onSelect={handleAddonSelect}
  onDeselect={handleAddonDeselect}
  productId={projectSelection()?.product?.id}
  onDownloadProductAsset={downloadInsightProductAsset}
  onUpdateMentionPath={handleAssetPathReady}
  onAddAttachment={() => {
    if (!maxAttachments()) fileInputRef.click()
  }}
  maxAttachments={maxAttachments()}
  trackerModule="insight"
/>
```

`octo_make` 在这里仅是当前组件的兼容字段名，数据明确来自 `loadSkillsFromPanel("octo_insight")`，不能调用 Design 技能加载器。这种转换集中在包装器内，避免散落两处 JSX。若后续多宿主确有需要，再增加通用技能列表 props，并保留旧字段回退。

## 3. 四个内置功能的接入工作

### 3.1 技能库

- 复用 `insightSkills()`、`loadInsightSkills()`，继续读取 `octo_insight` 与 `common`。
- 与现有 `@` 技能使用同一份数据和选中状态，不额外维护另一套技能选择。
- `onSkillsOpen` 当前实际上在打开整个加号时调用，现有加载函数有去重，可直接复用。
- 现有公共菜单缺少 Insight 已有的 loading 展示；建议增加可选技能/文件加载态 props，默认值保持旧行为，避免首次打开时短暂显示“暂无”。

### 3.2 设计文件

- 复用 `mentionFiles()`：`outputs → generated`，`uploads → uploaded`，沿用其递归查询和目录过滤。
- 映射 `InsightFileEntry → ArtifactFile`，补齐 `sessionId`、`kind`、`mime`；kind 通过 Insight 现有 `fileKind` 转换，例如 word/ppt/excel → document、json → code、other → binary，不用类型断言掩盖差异。
- 公共预览当前使用 `local:///`。桌面环境核验可正常访问 Insight 路径；若要支持非桌面，需增加可选预览地址解析器，不能把网络预览能力视为现成支持。
- 当前菜单文件勾选是“本次打开的局部状态”，不是文档选中状态；包装器的插入必须按路径幂等，避免重开后重复插入。若要求勾选与 `@` 完全一致，增加显式受控选择模式，Insight 启用，Design 默认行为暂不改变。

### 3.3 编辑器连接：前两项和资产库共同依赖

当前 `InsightEditorRef` 没有 `insertMention/removeMention/updateMentionPath`，不能只改菜单 JSX。

新增外部插入、按稳定 ID 删除、按 ID 条件回填接口，处理当前存活编辑器。加号插入不消费 `@query`，`@` 面板继续走原有触发位置逻辑。插入后聚焦当前输入框。

特别注意：当前同步和初始文档恢复都把 mention 的 `id` 丢弃，只返回 filename/path。资产库恰好依赖 `id` 识别已选、取消和回填，因此这两条映射链都要保留可选 ID；发送用的 `splitMentions` 仍输出原协议的数据。

普通文件以路径区分，技能以名称区分；资产下载前后保持资产身份，不用文件名匹配。删除、撤销/重做、初始恢复、排队回填都要验证，不重写整个编辑器。

### 3.4 产品资产库

这是接入量最大的功能，PR 918 仅提供选择/进度 UI 和回调，下载器仍在 make 页面内部，Insight 不能直接调用这个闭包。

1. 使用现有 `useProjectSelection()` 获取产品，核验其产品与 Insight 所用项目目录一致；无产品或不支持落盘时显示原因，不静默跳过。
2. 将下载的纯流程提取为参数化服务，接受固定目标目录、文件系统接口和取消信号；Design 使用兼容包装器继续返回路径，原 `@`/模型编辑调用方保持接口不变。
3. Insight 包装器负责本页临时目录、会话 uploads、草稿转会话时迁移、文件列表刷新及引用更新；不能复用 `.octo/tmps/make`。
4. 下载前引用处于待导入状态。所有提交入口在待导入或失败时拦截，不允许 `asset-xxx` 占位 ID 进入 `[引用文件]`。
5. ZIP 导入返回实际目录结果；Insight 当前只有 skill/file 引用，默认把目录中的可用文件转换成批量 file 引用，并保留资源到引用的映射，便于重开选中和取消。格式/数量超过能力时明确提示，不能把目录伪装普通文件或静默截断。
6. 下载中切会话或删除胶囊后，迟到结果不能插回当前编辑器；失败需可见并能重试/移除。导入结果进入既有文件去重、普通发送和队列流程。
7. MCP 模式下新引用必须进入现有 `[引用文件]` 清单；核验同名不同路径资源在文件名到上传地址映射中的消歧，不能只验证“胶囊出现了”。

建议服务内部使用结构化文件/目录结果，旧 `Promise<string>` 接口由包装器兼容。Insight 适配器在返回路径前保存对应结果，回填回调按资产 ID 消费并展开引用，不要求公共菜单了解 Insight 消息协议。

### 3.5 添加附件

公共组件内部已经调用 `useUploadRiskGate`。因此 `onAddAttachment` 应直接检查数量后打开 Insight 的原 file input，不能再传已有的 `requestAttachmentUpload`，否则外网模型下会重复提示。

原 `handleFileInputChange`、附件栏、上传、拖拽、粘贴保持原流程。`maxAttachments` 只控制附件项，不禁用技能、文件、资产和研究工具。

## 4. MCP 如何嵌入

### 4.1 推荐交互

“研究工具”作为第五个一级菜单项，点击展开二级单选列表，内容复用 `PRESET_PROMPTS` 四项。

- 未选择：显示四个工具，不设必须先上传文件的门槛。
- 选择工具：调用原 `handleMcpSelect({ preset })`，关闭整个菜单，回焦输入框；不立即发送、不执行 MCP。
- 已选择：菜单项显示当前工具，二级列表标记选中项；可直接换选，也提供“退出研究工具模式”。
- 输入框内保留已激活状态胶囊与取消按钮，例如 `研究工具：观点解析 ×`，放在内容区的状态行；底栏原独立“研究工具”入口移除。
- 未激活时不显示状态胶囊。关闭加号不清除选择；发送后持续有效，直到用户取消或按原页面生命周期清理。

保留状态胶囊是必要的：当前 MCP 会影响后续多轮允许调用的工具。仅把入口移入菜单、同时隐藏激活状态，会让用户难以察觉自己仍处于研究工具模式。

### 4.2 为什么不把完整 McpChip 塞进 slot

现有 `McpChip` 同时包含触发按钮、独立 Portal 菜单、激活胶囊和点击取消语义。直接嵌套会产生：

- 菜单中出现底栏胶囊样式，不符合统一菜单外观。
- AddonMenu 用 mousedown 判断外部点击，而 MCP Portal 在菜单 DOM 外，点击工具可能先关闭并卸载父菜单。
- 已激活后点击原 McpChip 会直接取消，无法自然打开列表换选。

应拆出 Insight 局部 `McpToolPicker` 和 `McpModeBadge`：前者只负责列表及选择，后者只显示状态及取消。继续使用父页面已有 `mcpSelection`，不新增第二份选择状态。

### 4.3 slots 的最小扩展

现有 `slots.render` 只提供 `closeMenu`，足够加一级按钮，但缺少与内置技能/文件二级面板互斥的能力。

推荐给 slot 上下文增补（提议接口，PR 918 尚不存在）：

```ts
type SlotContext = {
  closeMenu: () => void
  active: () => boolean
  togglePanel: () => void
}
```

这些操作绑定到当前 slot key。AddonMenu 统一拥有活动面板状态；打开 MCP 关闭技能/文件，反之亦然。关闭主菜单清空活动面板。保留原 `closeMenu`，现有 Design 模式插槽不需要改调用方式。

MCP 二级内容放在同一菜单 DOM 内，复用/提取通用的边界定位能力，不引入第二套 Portal 外部点击监听。现有定位代码只识别 skills/files，不能只放宽 activeSecondary 字符串类型就认为支持了自定义子菜单。

插槽接入示意（基于上述新增上下文）：

```tsx
slots={[
  {
    key: "insightMcp",
    render: (ctx) => (
      <McpToolMenuItem
        active={ctx.active()}
        onToggle={ctx.togglePanel}
        functions={PRESET_PROMPTS}
        selection={mcpSelection()}
        onSelect={(selection) => {
          ctx.closeMenu()
          handleMcpSelect(selection)
        }}
        onClear={() => {
          ctx.closeMenu()
          handleMcpClear()
          focusComposer()
        }}
      />
    ),
  },
]}
```

研究工具打开埋点在二级面板从关闭变为打开时触发一次。`mcp-chip-select/clear` 继续由原页面回调负责，不在新组件重复上报。

若本轮完全不允许改公共 slots API，可退为：插槽按钮关闭加号，再打开挂在 Insight 包装器中的独立研究工具选择弹层。这可以只用现有 `closeMenu` 完成，但交互与内置二级菜单不一致，不作为首选。

### 4.4 MCP 业务保持原实现

复用 `handleMcpSelect`、`handleMcpClear`、输入框 placeholder、`buildChipTemplate`、`buildChipDeclaration`、`buildToolGate` 及队列中的 chip 快照。

MCP 是持续的工具模式，不是技能引用或普通文件 mention，不能塞进 `MenuSelection`。选择仅改变模式，实际调用仍由现有发送流程处理；切换模式不能改写已经入队的任务。

## 5. PR 918 接入前应补齐的局部问题

| 问题 | 当前证据 | 本轮处理 |
|---|---|---|
| 资产埋点仍记到 Design | `asset-dialog.tsx` 两处 `module: "design"` | 增加可选 trackerModule 并由菜单传入，默认仍为 design |
| Props 文档导出不一致 | README 从入口导入 AddonMenuProps，index 未导出该类型 | 补类型导出，或接入先从 types 导入 |
| disabled 仅声明未应用 | types 有 disabled，触发按钮未绑定 | 不依赖其保护导入；若接入确需整体禁用，再补绑定并回归 Design |
| 回调缺失静默跳过 | 产品资产回调为可选，循环可无结果结束 | Insight 包装器保证配置完整；不可用时给出明确提示 |
| 失败吞掉、占位仍可能保留 | 批量下载 catch 只 console.warn | 增加可见错误/重试或移除入口；Insight 提交前校验待导入引用 |
| 跨页面选择状态不能直接对接 | Insight 同步映射丢 ID，文件按名字生成 ID | 补稳定 ID 保留与外部引用操作，兼容旧文档 |

以上属于接入必须识别的事实，不代表 PR 918 已实现了此前完整组件化方案。

## 6. 修改范围与顺序

1. 新增 `pages/insight/components/insight-addon-menu.tsx` 与局部数据适配文件，两处输入区域使用同一包装器。
2. 补 Insight 编辑器引用接口及 ID 同步，接入技能、设计文件、附件。
3. 拆分 MCP 列表/状态胶囊，扩展 slots 面板协调，移除两处底栏独立入口。
4. 提取参数化下载流程，完成 Insight 产品资产落盘、引用回填、草稿迁移、发送/队列校验。
5. 补公共组件可选加载态、必要的受控文件选择及资产埋点透传；所有新参数缺省保持 Design 现有行为。

公共目录整体迁移、统一两个编辑器、改 MCP 后端协议、重写上传/文件管理不在本轮范围。

## 7. 验收

- 初始页/会话页都是四个指定内置项 + 研究工具，URL/设计策略/Pattern 不出现。
- 技能来自 Insight；文件来自当前 Insight 会话；加号与 `@` 引用、删除、撤销、恢复一致。
- 外网添加附件只提示一次；附件满时其他菜单仍可操作。
- 产品资产普通文件与 ZIP 均能完成选择、落盘、引用、发送；失败不发送占位路径，切会话不串数据。
- MCP 四项可选择/切换/取消；已选状态可见；无文件仍可选择；选择不发送；发送后模式保留。
- MCP 模板、声明、工具开关及入队快照与原行为一致；资产作为 MCP 材料可被正确引用。
- 技能、文件、研究工具子面板互斥；工具点击不被外部关闭吞掉；Escape/回焦/窄窗口正常。
- Design 两处加号、模式插槽、产品资产、原 `@` 和模型编辑资产功能通过回归。

实施后从 `packages/app` 执行 `bun typecheck`，显式运行新增 octoapp 适配测试及现有 `mcp-trigger.test.ts`、Insight 文件/发送相关测试；默认 src 单测扫描不能替代这些验证。

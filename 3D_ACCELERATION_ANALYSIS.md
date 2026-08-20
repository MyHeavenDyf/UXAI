# 3D 生成加速分析：make vs 3D agent 对话逻辑

> 探查 make 页面 vs 3D 页面的 agent 对话逻辑，定位 3D 生成慢（18 分钟）的瓶颈，给加速方案。
> 配套 `3D_CODEGEN_DESIGN.md` Step 8（生成加速）。Step 8 落地后参考本文档「九」再评估能否继续优化。

## 一、背景

3D 页面（Step 7 已运行时验证通过）生成一个 5-type 场景（sportsField/buildings/trees/paths/grass）耗时 ~18 分钟。探查 make 页面的 agent 架构对比 3D，找加速点。

3D 18 分钟瓶颈（按估算）：
1. **plan 多轮工具调用**（list + N×get_doc）：~2-5min
2. **codegen 64000 token 串行输出**：~3-5min（reasoning 浪费可能更多——console 证实 codegen 在 reasoning 里逐个分析 5 type 建法）
3. **triage 串行 + 3 子 session 开销**：~1-2min

## 二、make 页面 agent 架构

**位置**：`packages/app/octoapp/pages/make/index.tsx`（149KB 主页面）+ `pages/make/use-make-commands.tsx`（slash 命令注册）。

**架构：单 agent + 可选规划子 session（非串行多 agent）**

make 用两个 agent（`packages/opencode/src/agent/agent.ts:287-332`）：
- **`octo_make`**（主 agent，`agent.ts:287-313`）：single agent，直接产出 HTML artifact。带 skill `html-prototype` + MCP `prototype-dev` + websearch/write/edit/question/read 权限。
- **`octo_make_plan`**（规划子 session，`agent.ts:314-332`）：native、hidden，仅 websearch + read。用户**主动**点「进入」才创建，是 human-in-the-loop 的设计规划阶段，**非串行流水线**。

**调用方式**：`sdk.client.session.prompt`（流式 SDK 单调用，`make/index.tsx:1834-1839`、`1362-1371`）。每条用户消息 = 1 次 `session.prompt`，SDK 内部处理流式。**不使用** `runChildSession` / `promptAsync`+轮询。

**产物**：单个 HTML artifact（`<artifact type="text/html">`，`octo_make.txt:168-176`）。可选 `text/design-plan` 方案 artifact + `text/strategy-field` 表单字段。**无 JSON 中间产物**。

**轮数**（典型「直接执行」路径，`octo_make.txt:44-90`）：
1. 用户发需求 → agent 回 `[design-plan-intent]` sentinel（1 轮，`octo_make.txt:52-57`）
2. 用户点「直接执行」→ `[skip-plan]` → agent 直接产出 HTML artifact（1 轮，`octo_make.txt:87`）

即 **2 轮 LLM** 完成生成。若走「进入」规划：sentinel → strategy-field 填表（多轮对话）→ `[strategy-complete]` → design-plan artifact → `[confirm-plan]` → HTML，共 4+ 轮，但每轮都是用户驱动，非 agent 串接。

**make 的优化手段**：
- **预注入 + 缓存上下文**：设计系统 + craft 文档在发 prompt 前拼到前缀（`make/index.tsx:1711-1766`），`craft-loader.ts:6` 有 `cache = new Map()`，`design-system-loader.ts:28` 有 `indexCache`。**不运行时 browse 组件库**。
- skill + MCP 预加载（`agent.ts:311-312`），agent 不调工具查文档。
- 单 session 复用（`make/index.tsx:1836`），不每轮建子 session。

## 三、3D 页面架构（对比基线）

**位置**：`packages/app/octoapp/pages/3d/workflow/codegen-scene.ts`，3 agent 串行：

```
triage → plan → codegen   （每步 = 1 runChildSession）
```

- **调用方式**：`runChildSession`（`3d/agents/run-child-session.ts:25-91`）= 建子 session（`session.create`，line 60-66）→ `sync.session.sync`（line 124）→ `client.session.promptAsync`（line 130）→ 轮询 `sync.data.message` 取结果（`getResultFromMessagesLoose`，line 145）。**非流式消费**，等同同步请求-响应。
- **triage**（`scene-triage/index.ts`，1 轮，无工具，`agent.ts:610-619` permission `*:deny`）：输出 routing+types JSON。
- **plan**（`scene-plan/index.ts`，多轮，`agent.ts:621-636` 允许 `list_3d_components`+`get_3d_component_doc`+read）：调工具浏览组件库选型。这是**慢点**。
- **codegen**（`scene-codegen/index.ts`，1 轮，无工具，`agent.ts:637-649` `*:deny`）：产出 ~64000 token 代码（`OUTPUT_TOKEN_MAX=64000`，`provider/transform.ts:67`）。

## 四、make vs 3D 关键差异

| 维度 | make（octo_make） | 3D（triage→plan→codegen） |
|---|---|---|
| agent 数 | 1 主 + 1 可选规划子（用户触发） | 3 串行子 session |
| 调用 | `session.prompt`（流式，单调用） | `runChildSession`→`promptAsync`+轮询（同步式） |
| 中间产物 | 无（直接 HTML） | triage JSON + plan JSON + codegen 代码 |
| 工具调用 | 无运行时 browse（skill/MCP + 预注入） | plan 调 `list_3d_components` + N×`get_3d_component_doc` |
| 上下文加载 | 设计系统/craft 预注入 prompt 前缀 + Map 缓存 | 每轮 get_3d_component_doc 返回全量 markdown doc 进 context |
| 典型轮数 | 2 轮（sentinel + 生成） | triage 1 + plan 3-7 + codegen 1 = 5-9 轮 |
| session 复用 | 单 session 全程复用 | 每个建新子 session + sync |

**3D 多出来的开销**：
1. **plan 的多轮工具调用**（3-7 轮）：`scene_3d_plan.txt:6-10` 要求先 `list_3d_components` 再对候选组件逐个 `get_3d_component_doc`。每次 `get_3d_component_doc` 返回完整 markdown（构造+options+dataTypes+properties+methods+examples+notes，`3d_components_docs.ts:99-158`），context 膨胀，后续每轮 LLM 重新处理累积上下文。
2. **triage 串行前置**：1 轮无工具但独立建 session + promptAsync + 等待，纯路由判断本可并入 plan。
3. **3 个独立子 session**：每个 runChildSession 建 session + sync + onSessionCreated 回调（`run-child-session.ts:60-66,124-125`），无复用。

## 五、3D 可借鉴的加速点（按省时排序）

### 加速点 1：砍掉 plan 的运行时工具调用，改静态注入（最大收益）
- **现状**：`agent.ts:626-631` plan 允许 `list_3d_components`+`get_3d_component_doc`；`scene_3d_plan.txt:6-10` 明确要求「先用 list 浏览，再对候选组件调 get 看构造签名」。5-type 场景 ≈ 1 list + 2-6 get = 3-7 轮 LLM，每轮含工具结果往返 + context 重处理。
- **make 对照**：`make/index.tsx:1711-1766` 把设计系统/craft 拼进 prompt 前缀，`craft-loader.ts:6`/`design-system-loader.ts:28` 缓存；agent 零运行时工具。
- **现成基础设施**：`3d_components_docs.ts:58-67` 已从单一 JSON（`@a3d/a3d-components/docs`）加载并 `docCache` 缓存；`proto/index.ts:30-35` 已有静态注入模板（`SCENE_CONFIG_SCHEMA`/`MESH_GEOMETRY_CATALOG`/`HANDLER_CONTRACT` 经 `formatPrompt` 插值）。codegen prompt 已用静态 `{REGISTRATION_PATTERN}`/`{TREE_SCENE_FORMAT}`（`scene_3d_codegen.txt:27-28`）。
- **改法**：把组件目录 + 高频组件 doc 预烘成静态 `COMPONENT_CATALOG.txt`（同 `MESH_GEOMETRY_CATALOG` 模式），经 `formatPrompt` 注入 plan prompt，删 plan 的工具权限。
- **预估省时**：3-6 轮 × 30-60s/轮 ≈ **2-5 分钟**（18 分钟里最大一块）。

### 加速点 2：合并 triage + plan 为单 agent（省 1 整轮 + session 开销）
- **现状**：`codegen-scene.ts:51-91` triage 串行→plan。triage（`scene-triage/index.ts`）只判 create/modify/chat + type 清单，无工具 1 轮，但独占一次 runChildSession（建 session + sync + promptAsync + 等待）。
- **make 对照**：`octo_make.txt:44-90` 单 agent 内做意图判断（sentinel）+ 生成，无独立 triage agent。
- **改法**：把 triage 的 routing+types 判定并入 plan 第一步（plan 本来就拿 types 清单，`scene-plan/index.ts:86-99`）。routing=chat 时早退。
- **预估省时**：1 轮 LLM + 1 次 session.create/sync 往返 ≈ **30-60 秒**。

### 加速点 3：runChildSession 改流式消费，避免子 session 全程等待
- **现状**：`run-child-session.ts:130-145` 用 `promptAsync` 后 `getResultFromMessagesLoose` 轮询 sync 取完整结果，agent 间串行阻塞。3 个 agent = 3 段串行 wait。
- **make 对照**：`make/index.tsx:1834` 用 `session.prompt`（SDK 流式），UI 边出边渲染。
- **改法**：plan 多轮工具调用时本就只能串行；但 triage+plan 若合并后，至少少 1 次「等整段完成再启动下一个」的阻塞。对 codegen（64000 token 单轮）改流式不省总时间（token 发射速率固定），但能让用户早看到文件。
- **预估省时**：结构上省 1-2 次 session 建连 + sync 往返 ≈ **10-30 秒**（体感更大）。

### 加速点 4：codegen 按类型并行（砍 64000 token 串行）
- **现状**：`scene_3d_codegen.txt:4,34` 强制「一次输出全部 type 的代码块」，单轮 64000 token（`transform.ts:67`）。5-type 场景 ≈ 5 份 handler + index + live-data，串行发射 ≈ 3-5 分钟纯生成。
- **make 对照**：make 也单轮直出（`octo_make.txt:209-216`），但只产 1 个 HTML，量小。3D 量大且天然可分。
- **改法**：plan 已列全 type（`scene-plan/index.ts:69-77`），handler 互相独立。可对每个 type 并行起子 session 生成 handler（`Promise.all`），index.ts + live-data.json 由 plan 直出或轻量汇编。需重构 `parseCodeFiles`（`codegen-scene.ts:122`）与 index 装配。
- **预估省时**：64000 token 串行 ~4 分钟 → 5 路 ~13000 token 并行 ~1 分钟，省 **2-3 分钟**。代价是 5 倍并发请求 + 结果汇编复杂度。

### 加速点 5：codegen 输出上限拉满已生效，但可减量
- **现状**：`transform.ts:67` `OUTPUT_TOKEN_MAX=64000`；`scene_3d_codegen.txt:4` 要求「第一个字符必须是 ##，禁止任何思考/引入语」。codegen 无 reasoning 浪费，但全量 index.ts + live-data.json 每轮重写。
- **make 对照**：`octo_make.txt:209-216` 同样单 artifact 直出，但 make 的 edit 工具可增量改（`octo_make.txt:194-205`），3D modify 路径已读 `currentHandlers` 注入（`codegen-scene.ts:95-97,164-197`），create 路径无法减。
- **改法**：create 时 index.ts 模板部分（5 项固定模板，`scene_3d_codegen.txt:27`）可静态生成，只让 LLM 产 type handler + live-data。减 ~15-20% 输出。
- **预估省时**：~**40-80 秒**。

## 六、为什么不能全照抄 make（单 agent 直出的限制）

make 加速模式拆 4 点，3D 能否照抄：

| make 加速模式 | 3D 能否照抄 | 原因 |
|---|---|---|
| ① 零运行时工具 + 预注入缓存 | ✅ 能（加速点 1） | 基础设施已有 |
| ② 流式调用（session.prompt） | ✅ 能（加速点 3） | runChildSession 可改流式 |
| ③ 单 session 复用 | ⚠️ 部分 | 3D agent 间有数据传递（types/PlanJSON），复用要重设计 |
| ④ **单 agent 直出产物** | ❌ 短期不能 | 见下 |

**本质：HTML 容错，TS + Three.js 不容错。**

- **make 产物 = 单个 HTML**：浏览器极度宽容，LLM 写的 HTML 有瑕疵（标签没闭合、属性错）照样渲染。make 单 agent 出错 = 页面有瑕疵但能看。
- **3D 产物 = 5 个 .ts handler + index.ts + live-data.json**：要符合框架契约——`ComponentHandler` 签名（create 返回 Object3D）、import 路径（`../../../../components`，层数错 vite 报错）、registration pattern（index.ts 注册行）。**TS 要 tsc 过，Three.js 运行时严格**。单 agent 出错 = tsc 崩 / 运行时崩 / 空场景，用户看到空白不知道为啥。

**3D 独有复杂度 make 没有**：
1. **选型 + 代码分离**：3D 要先选实现路线（native/component/model）+ 选组件 + 选资源，再写代码。make HTML 自包含不选组件库。单 agent 同时选型 + 写代码互相干扰易选错/写错。分 plan（选型）+ codegen（照抄 build_detail）两步职责单一出错率低。
2. **triage 路由**：3D 有 create/modify/chat 三路（modify 要读当前 handler 注入）。make 都是生成无分支。

**单 agent 直出何时能照抄**：等 Step 9 门控（tsc + 运行时）+ refine 循环做完，能 caught 契约出错并重写修正，替代「分两步降低出错」的保险。有门控兜底后，激进合并成单 agent 可评估。

## 七、保守路线三方案（Step 8）

照抄 make ①②③，不照抄④单 agent。保留 plan→codegen 两步分离。

1. **方案 ①（加速点 1）**：plan 工具调用改静态注入。把组件目录（名+用途）+ 高频组件 doc 预烘成静态 txt（同 `MESH_GEOMETRY_CATALOG` 模式），formatPrompt 注入 plan prompt，删 plan 的 list/get_doc 工具权限。省 2-5min（最大头）。低风险——codegen 走 createComponentObject 黑盒不按 doc 写，plan 查 doc 价值有限。
2. **方案 ②（加速点 2）**：合并 triage+plan。routing+types 判定并入 plan 第一步，routing=chat 早退。省 30-60s。
3. **方案 ③（加速点 3）**：runChildSession 改流式消费。照抄 make session.prompt（SDK 流式），替代 promptAsync+轮询同步式，首屏体感快。省 10-30s。

**完成标志**：18min → ~12min、plan 零工具调用、triage+plan 合并、流式消费。

## 八、推荐路径 + Step 映射

| 顺序 | Step | 内容 | 依赖 |
|---|---|---|---|
| 1 | Step 8（保守加速） | 方案 ①②③ | 无（低风险，基础设施已有） |
| 2 | Step 9a（确定性门控） | tsc + 运行时门控（不加 VLM/refine） | 可与 Step 8 并行 |
| 3 | Step 9b（VLM + refine 循环） | 截图 + VLM 打分 + refine-code | 依赖 Step 8 加速（否则 18min×refine 不可用） |
| 4 | Step 10（导出） | dataSchema/mock + export-project | 最后 |

## 九、完成 Step 8 后再评估的方向

Step 8 保守路线落地后（预期 ~12min），参考本分析再评估能否继续优化：

1. **激进合并单 agent**（照抄 make ④）：triage+plan+codegen 全合并，需 Step 9 门控兜底契约出错。省 6-10min，风险高。
2. **codegen 并行分 type**（加速点 4）：5 type 各 1 并行子 session，重构 parseCodeFiles + index 装配。省 2-3min，风险高。
3. **codegen 换非 reasoning 模型**：build_detail 已定建法，非 reasoning 直接产代码省 reasoning token + 2-3x 速度。省 5-7min，需 llm.ts 改读 agent model 覆盖。
4. **codegen 减量**（加速点 5）：index.ts 模板部分静态生成，只让 LLM 产 handler + live-data。省 40-80s。

**评估依据**：Step 8 后实测各 agent 耗时（console `----- ... 耗时：Xs -----`），定位新主瓶颈再决定下一刀。

## 关键文件行号索引

- 3D 编排：`packages/app/octoapp/pages/3d/workflow/codegen-scene.ts:43-143`
- runChildSession（同步式）：`packages/app/octoapp/pages/3d/agents/run-child-session.ts:60-66,124-145`
- plan 工具权限：`packages/opencode/src/agent/agent.ts:626-631`；plan prompt 工具段：`packages/opencode/src/agent/proto/prompt/scene_3d/scene_3d_plan.txt:6-10`
- 工具实现（已缓存单一 JSON 源）：`packages/opencode/src/tool/proto_tool/3d_components_docs.ts:56-67,99-158`
- 静态注入模板（可复用）：`packages/opencode/src/agent/proto/index.ts:29-35,71-74`
- codegen 输出约束：`packages/opencode/src/agent/proto/prompt/scene_3d/scene_3d_codegen.txt:4,34`；`packages/opencode/src/provider/transform.ts:67`
- make 单 agent 调用：`packages/app/octoapp/pages/make/index.tsx:1834-1839`；预注入+缓存：`make/index.tsx:1711-1766`、`make/utils/craft-loader.ts:6`、`make/utils/design-system-loader.ts:28`
- make agent 定义：`packages/opencode/src/agent/agent.ts:287-332`
- 参考分支（旧多 agent JSON 流水线，已被 make 取代）：`dev_merge_pattern` 的 `packages/app/octoapp/pages/pattern/index.tsx`

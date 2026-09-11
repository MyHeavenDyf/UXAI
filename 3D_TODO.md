# 3D 待办清单（活跃版）

> **唯一权威清单**：只列**还没做**的项，每项自带「是什么 + 测试用例」，看这一个文件就够。
> **新问题/新需求进来**：反馈给 Claude → 取证/评估 → 自动写入本清单（自评优先级，允许插队），同样自带说明+用例。完成一项打勾。
> 优先级判据：堵主流程/丢数据=🔴｜体感痛点=🟠｜低频遗留=🟡｜结构/功能补全=🟢｜大工程/外部依赖=⚪
>
> 完整全流程回归用例（开发完成后**交付测试团队**用）：[3D_E2E_TESTCASES.md](3D_E2E_TESTCASES.md)
> 已修项的根因取证归档：[3D_CODEGEN_DESIGN.md §十四](3D_CODEGEN_DESIGN.md)
> 最后更新：2026-09-11（**第 8 项 Phase R 代码结构重构 ✅**：四 commit 8e3c330/c769470/902b463/f5ad8a3 全落地 3d-templete，用户 e2e 全过——生成全链路/M-3①矩阵/编辑态/大纲/切历史/导出）。下一步：参数清单扩展（Phase L/S，按用户提供的 THREE.JS 可配置参数清单）或 Spline 化 Phase 2-5。

---

## ✅ 已完成 — direct codegen 落地 + 三仓提交

### ⚡ P8 direct codegen 单次直出 ✅
**是什么**：砍掉 plan agent + pertype/full + 自愈循环，改为 triage → direct codegen 单次 API 调用（LLM 自己想坐标/尺寸/结构，输出 handler+group+scene-config.json），host 确定性合并 index/live-data。目标 30-60s 出场景（vs 现在 32-50min）。modify 也走 direct（吃 currentHandlers 照抄布局，不需要 plan 的 build_detail）。patch/edit_code/编辑器链路完全不动。
**落地状态**：已落代码 + e2e 验证通过 + 三仓已提交。codebase 现为纯 direct 模式——`scene_3d_codegen_direct.txt` prompt + `parseDirectResult`（复用 `parseFullResult` 作内部辅助解析 handler/group，再额外解析 scene-config.json）；plan/pertype/full prompt + scene-plan 目录 + CODEGEN_MODE 常量 + 自愈循环均已删。idle 误杀（180s→420s）已修。

### 1. 三仓 commit ✅
**是什么**：dev_cyc1 堆着 P8 direct + 之前 P1.5+全清+P0.4~P0.10 约 40+ 文件未提交，e2e 绿后一次提交。
**落地状态**：三仓均已提交。

### 2. 打包 exe 内 3D 全链路 ✅
**是什么**：`release.ts --win --channel dev` 打 exe，验 3D 全链路。exe 是最终分发形态，这条不绿都是 dev 自嗨。
**落地状态**：e2e ✅ 通过（2026-09-10）。产物 `octo-desktop-win-x64.exe` 246MB：resources/3d/template（源码+node_modules 155 包）+ 3d-components + bin/bun.exe 94MB 全进包。打包前置踩点：staging 防呆拦「dist 比 src 旧」→ 3d-components `npm run build` 重出 fresh dist 后过（dts 阶段报错非零退出属正常，JS 产物已 fresh）。本地签名分叉生效（主 exe 默认图标，NSIS 安装包图标正常）。
**测试用例**：✅ exe 里新会话生成场景 → 渲染 → modify 一版 → patch 一版 → 切历史 → 导出工程 zip，全链路与 dev 环境一致（用户实测通过）。

## 🟠 第二梯队 — 报错体验（direct 失败后用户要能定位+修一行）

### P0.13 门控漏判运行时报错（handler 报错仍显示「生成完成」）✅
**是什么**：direct 生成的 handler 在 iframe 运行时报错，但左侧仍显示「生成完成」。门控 `settleMs: 3000`（固定 3s 一次读快照）太短。
**落地状态**：① `ComponentManager.create` 加 try/catch——handler 抛错即时 `console.error` 转发（带 type + node.id），通过现有 SCENE_CONSOLE_ERROR wrapper 即时进 buffer，不等 3s 窗口；② `scene-gate.ts runSceneGate` 改渐进读 buffer——每 500ms 轮询，error 级秒回 FAIL，无错 settleMs 内判 PASS（不拖到 timeoutMs），timeoutMs 12s 兜底；③ `index.tsx` 传 `timeoutMs: 12000`。`scene-gate.test.ts` 新增 6 个测试用例（无错快 PASS / 秒回 FAIL / settleMs 内报错抓到 / fatal / warn 不挡 / 早报错不等满 settleMs）。tsgo+oxlint 0，3d-templete eslint 0 + vue-tsc 无新错（ComponentManager 不在既有双 @types/three 边界错内）。
**设计权衡**：settleMs 3s 快通过（用户定调）——慢加载（vite 冷启动 5-8s 才跑 createScene3D）的 handler 报错若落在 3s 外会漏判。但 handler 同步抛错（API 误用如 rect / 未定义变量）在 createScene3D 链路里即时进 buffer，settleMs 内能抓到；异步错漏判靠 ComponentManager try/catch 补（即时进 buffer 不等窗口）。漏判面收窄到「vite 编译期 + 异步链 settleMs 外」的窄窗口。
**测试用例**：✅ 单测覆盖；e2e ✅ 通过（2026-09-09，shanghai-seg 场景：正常生成 3s 内判 PASS 不拖到 12s）。

### 4. P7-2 改 bug 闭环（报错 → 用户一句话修那一行）✅
**是什么**：把门控报错**结构化到 UI**（`xxx.ts:302 continue outside loop（TS1107）` + 回复修复入口）。用户输「修这个 continue」→ triage → patch → 复用已有 **edit_code（search→replace）** 精准改那一行 → 重跑门控验证修复。优于现在「直接报错让用户重试」（同模型同 prompt 重试无效）。
**落地状态**：
- **3a 报错结构化**：`ProtoError` 加 `findings?: ErrorFinding[]`（file/line/code/message）；`GateFinding` 加可选 `file?/line?`（`extractFileLine` 从 console message 正则提取 `(\w+\.ts):(\d+)`）；`persistGateOutcome` 透传 findings 到 sessionErrors + saveProtoError。
- **3b 失败卡片「修复」按钮**：`generation-card.tsx` 失败卡片「重试」旁加「修复」按钮（描边次级样式），点击 → `onFix` 把结构化报错预填进输入框（`修这个报错：\nfile:line: message (code N)`）。`chat/index.tsx` RoundCard + ChatPanel 透传 errorFindings/onFix。`index.tsx` persistGateOutcome + 两个 codegen error 分支（retryCodegen/handleSubmit）都传 findings。
- **3c triage 注入报错上下文**：`scene-triage/index.ts` 加 `priorErrors?` + `buildHumanMessage` 注入 `[上一轮报错清单]` + `[修复约束]`（优先 routing=patch + edit_code）。`scene_3d_triage.txt` 加输入文档说明 + 修复路由约束。`codegen-scene.ts` 加 `priorErrors?` 透传给两个 triage 调用；`index.tsx` 两个 codegen_scene 调用传 `priorErrors: sessionErrors()[sid]?.findings`。
- **3d patch 短路后跑门控验证（修复闭环）**：`codegen-scene.ts` 主 patch + 兜底 patch 短路成功后，若 `priorErrors` 非空且 `gateRunner` 提供 → 跑门控验证修复（PASS 清错 / FAIL 落失败卡片供再修复，不自动重试保留 direct 单次哲学）。`index.tsx` 两个 patch 分支检查 `gatePassed !== undefined` → 走 persistGateOutcome 落结果，普通 patch 仍 toast。
- **跳过有界自动循环**：计划里的 MAX_FIX_ROUNDS=3 自动循环跳过——human-in-the-loop（用户点「修复」→ 发 → 看结果）天然有界，尊重 direct 单次直出哲学。
**测试用例**：tsgo+oxlint 0 error；bun test 12 pass（parse-check syntax + formatSyntax）。e2e ✅ 通过（2026-09-09，shanghai-seg 场景：正常生成路径门控 PASS + 失败卡片「修复」按钮可见）。
**依赖**：P0.13 ✅（门控抓运行时错作 priorErrors 来源）。

## 🟡 第三梯队 — 编辑可靠性（Phase 1：单对象 CRUD 可靠，Spline 化基础）

### P0.14 modify 加实例漏加（LLM 照抄 CURRENT_GROUPS 不加新节点）✅
**是什么**：modify 时「加一辆 forklift」请求，LLM 收到 `[CURRENT_GROUPS]`（含 forklift-1）后，倾向原样照抄现有 group 节点，不主动加新实例。实测三次：child3 漏加（输入1→输出1）、child5 漏加（输入2→输出2，没加第3辆），仅 child4 加对（输入1→输出2）。概率性失败 >50%，同 prompt 不稳定。
**根因**：prompt Constraint 6「逐字照抄布局参数，根节点 id 照抄勿换」**强化了照抄行为**，没明确要求「在现有节点基础上新增节点」。LLM 理解成原样保留现有节点即完成任务。这是 modify 加实例的保真问题，属 [[3d-modify-crud-not-regen]] / M-4 范畴的轻量分支。
**修法（编辑态复制按钮）**：绕开 LLM add_instance（概率性失败），改走**编辑态「复制」按钮**——用户选中现有 group 根实例 → 点复制 → host 确定性克隆 live-data node + 新 id（max+1）追加 merged[type]，零 LLM 介入。
**落地状态**：`handleDuplicateObject`（preview/index.tsx）实现 group 根复制——resolveTypeId 反查 type → max+1 新 id → 克隆 srcNode params + position 偏移 x+2 → SCENE_UPDATE 即时渲染 → editDelta.added → commitEdits step 3.5 追加 merged[type]。子部件（`forklift-1-canopy`）复制提示「子部件复制待 Phase 4」（SUB_ADD 路径复杂，推迟）。tsgo+oxlint 0 error。e2e ✅ 通过（forklift-1 复制 → forklift-2 出现 → 提交落盘 → 切走切回保留；子部件选 canopy 提示待 Phase 4）。
**测试用例**：✅ 场景已有1辆forklift → 编辑态选中整体 → 点「复制」→ 场景出现2辆（forklift-2，position 偏移）；连测不漏加。

### P0.15 删顶层节点误走 SUB_SKIP（buildings-4 删不掉）✅
**是什么**：编辑态选中一栋独立建筑（如 buildings-4）点删除提交，报「无可落盘改动（全部 __id 反查失败或 handler 不合契约，详见 skipped）」。实测 ses_f84cd1393：mergedSceneConfig 里 buildings 是 **8 个独立顶层节点**（buildings-1..8，各自一个 node，id 直接就是 `buildings-N`，**非循环子实例**）。buildings handler 正确地无 SUB_SKIP 骨架（SUB_SKIP 本就只为循环创建点设计），但 commit-edits 删除分支无差别对所有 `entry.deleted` 走 `hasSkipSkeleton` 检查 → 顶层节点根 id 删除掉进死路。
**根因**：[commit-edits.ts:120-127](packages/app/octoapp/pages/3d/workflow/commit-edits.ts#L120-L127) 删除分支缺「group 根（`__id === node.id`）走 live-data 删 node」分流。
**落地状态**：删除分支前加 group 根分流——`__id === node.id` 时从 `merged[type]` 数组过滤掉该 node（live-data 删 node，onCodeVersionReady 落盘 + reload handler 读新 live-data 自然不创建该 node）；循环子实例（`__id.startsWith(node.id + "-")`）才走 SUB_SKIP。对称于 transform 根分支（P0.1-4）。tsgo+oxlint 0，e2e ✅ 通过（删 buildings-4 消失、其余不动、切走切回保留；删 trees-N 同理；循环子实例 rack-0 仍走 SUB_SKIP 不受影响）。

### P0.17 part-N 兜底 id 删除失败（roof_truss-1-part-1 删不掉）✅
**是什么**：编辑态选中 `roof_truss-1-part-1`（roofDeckB，被 `stampMissingIds` 兜底盖的 part-N id）删除提交，applyDeletion 走 ② patchHandlerDeleteCreation 找 stamp 调用 → 源码无 stamp 注册（handler 第 27/35 行 roofDeckA/B 无 `userData.__id` 赋值）→ 匹配失败 → fallback ③ SUB_SKIP → 但 roofDeckA/B 不在 for 循环里、不检查 SUB_SKIP → 静默 no-op。
**根因**：`patchHandlerDeleteCreation` 只认 stamp 注册的语义 cid，不认 `stampMissingIds` 兜底盖的 part-N id。part-N 对应的 mesh 在源码里无语义创建点，按顺序匹配才行。
**落地状态**：`patchHandlerDeleteCreation` 扩展 part-N fallback——stamp 匹配失败时，按 `group.add(var)` 出现顺序枚举无 `userData.__id` 赋值的创建块（即被 stampMissingIds 兜底盖的），取第 N 个删整块（const 声明→group.add(var)）。traverse 顺序与源码顺序一致（声明在前 add 在后）。`deletePartByIndex` 新增。tsgo+oxlint 0 error。
**测试用例**：编辑态选 roof_truss-1-part-1 → 删除提交 → roofDeckB 消失、其余不动、切走切回保留。e2e ✅ 通过（2026-09-09，shanghai-seg 场景）。

### 5. P0-12 墙色提交回退（M-1a）✅
**是什么**：编辑态改墙色提交后回退（roof 生效 / lights part-43 不生效）。A+B 修法已落地。
**落地状态**：e2e ✅ 通过（编辑态选 walls-1-front-right 改色提交 → 变色生效不回退、切走切回保留）。
**测试用例**：
1. ✅ 编辑态点墙（单 material）改蓝提交 → 墙蓝不回退
2. 重生场景选灯罩（part-N 子部件）改色提交 → **单灯罩变、不串色、不全变**

### 6. P0-10 GLB 改色 ✅
**是什么**：GLB 内部子 mesh 改色走 edit_code 插 paint(traverse) 函数，修法已落从未明确测（用户未报问题）。
**测试用例**：编辑态选叉车（GLB）改色提交 → 变色生效、布局/其他物体不动。

### 7. 存量未跑用例补测 ✅
**是什么**：老回归一直没跑过：场景级切走切回 / 改名删物 / 不重建门控 / 双会话互踩防护。
**落地状态**：e2e ✅ 通过（2026-09-09，shanghai-seg 场景全测）。
**测试用例**：
1. ✅ 场景级改一版（灯/背景/相机）→ 切走切回 → 改动保留
2. ✅ 改名一个物体、删一个物体 → 无重复根、无残留
3. ✅ 发一条纯聊天（「你好」）→ 不触发重建
4. ✅ 双会话同时生成 → 后者接管 workspace，前者出横幅可一键恢复

---

### P0.18 codegen handler 同类型子部件 id 重复（terrain-1-pond x2）✅
**是什么**：shanghai-seg 场景 terrain handler `makePond` 调用两次（terrain.ts:62-63），两次都用 `${node.id}-pond` 作 `__id`（即 `terrain-1-pond`），导致大纲显示两条同 id 项。`__id` 不唯一破坏 `findByUserId`（只返回第一个命中）+ editDelta 落盘 key 碰撞（改一个误改两个）+ 大纲重复。
**根因**：codegen prompt 未约束「同一 handler 内同类型子部件 `__id` 必须唯一」。LLM 用固定后缀（`-pond`）而非序号（`-pond-0` / `-pond-1`）。
**落地状态**：`HANDLER_CONTRACT.txt` 规则 3 加「__id 全局唯一」约束——工厂函数多次调用生成同类型子物时后缀必须带序号区分（`${cid}-pond-0` / `${cid}-pond-1`），严禁两次都用 `${cid}-pond`。纯 prompt 约束，代码零改动。
**取证**：`ses_f7b1982c9ffeRA3sfltCMr6Y30/v1788937421993/code/src/3d/managers/component/handlers/terrain/terrain.ts:38` `const wid = \`${cid}-pond\``，line 62-63 两次调用 `makePond(group, node.id, ...)` cid 相同。
**测试用例**：生成含 terrain（多 pond）的场景 → 大纲无重复 id 项 → 编辑态选单个 pond 改色只改一个不串。

## 🔴 Phase 0.5 — 操作层统一（NL=Edit 单代码路径）

> **硬约束**：所有可编辑功能 NL 触发和编辑态触发必须走**同一个函数**。代码只有一套，禁止分叉两套逻辑。
> 分叉是 bug 根源——非循环子部件删除只在 commit-edits 修了、patch-scene 没修导致 NL「不要天花板」silent no-op。
> 这就是 Spline 化 Phase 2 的 L2 操作纯函数层——提前铺地基。

### P0.16 操作层统一（抽 scene-ops.ts，6 个分叉操作合一）⬜
**是什么**：当前 commit-edits.ts（编辑态）和 patch-scene.ts（NL）是两套独立编排逻辑，碰巧共享底层 patchHandler* 函数，但上层决策树完全不同。审计 8 个操作中 **6 个分叉**：

| 操作 | NL (patch-scene) | Edit (commit-edits) | 状态 |
|---|---|---|---|
| 删 group 根 | ❌ 无此 op | ✅ merged.filter | **分叉** |
| 删非循环子部件 | ❌ 只试 SUB_SKIP | ✅ patchHandlerDeleteCreation | **分叉（当前 bug）** |
| 改色 (语义 cid) | ✅ patchHandlerOverride + ensureApplyOverride | ✅ patchHandlerOverride（无 ensure） | **半共享** |
| 改色 (part-N 兜底) | ❌ NL 无此路径 | ✅ patchHandlerMaterialColor | **分叉** |
| transform group 根 | ✅ applyTypeTransform → mergedClone + liveData | ✅ 直接改 merged.params | **分叉（两套代码）** |
| 加实例 | ✅ patchHandlerAdd | ❌ edit 没有（P0.14） | 待做 |

**方案**：抽 `scene-ops.ts`，每个操作一个纯函数（签名统一 `(source, target, state) => OpResult`），commit-edits 和 patch-scene 都调它。
- 两条入口变成薄壳：NL 把 PatchOp[] 归一化→applyOps；Edit 把 editDelta Map 归一化→applyOps
- 唯一允许差异：target/params 来源（triage 解析 vs 用户选中+UI），在调 applyOps 之前消解
- 持久化层已统一（两路都走 materializePatch），不改

**落地步骤**：
1. ✅ 抽 `applyDeletion` 共享函数 → commit-edits + patch-scene skip_instance 都调它（三层分流：group 根→merged.filter / 非循环→patchHandlerDeleteCreation / 循环→SUB_SKIP）；e2e ✅ 验证通过
2. ✅ 抽 `applyMaterialChange` 共享函数（合并 ensureApplyOverride + patchHandlerOverride + part-N patchHandlerMaterialColor 三路为一）；e2e ✅ 验证通过
3. ✅ 抽 `applyTypeTransform` 共享函数（合并 NL liveData + Edit merged.params 两路为一）；e2e ✅ 验证通过
4. ✅ P0.14 复制按钮（group 根复制：克隆 live-data node + max+1 id 追加 merged[type]，零 LLM）；子部件复制待 Phase 4；tsgo+oxlint 0，e2e 待跑
5. ✅ 薄壳化审计：6 个分叉操作全部已通过共享函数统一（commit-edits + patch-scene 均调 applyDeletion/applyMaterialChange/applyTypeTransform），两入口已是薄壳。完整 `scene-ops.ts` applyOps 抽取推迟 Phase R——输入形状本质不同（Map<id,EditDeltaEntry> vs PatchOp[] 多 op），强行抽无 e2e 反馈是过早抽象
6. ✅ e2e 验证：NL 和 Edit 确认走同一 applyDeletion/applyMaterialChange/applyTypeTransform（console 双来源日志 [NL]/[Edit] 同函数名，删除/改色/transform 三条全过）。批量改色（edit_code）是 NL 独有路径非分叉（编辑态批量待 Phase 2 多选）。日志已删。

**测试用例**：
1. NL「不要天花板」→ 删除生效（不再 silent no-op）→ 切走切回保留
2. 编辑态选中天花板删除 → 同一函数、同一结果
3. NL 改墙色 → 生效（ensureApplyOverride 自愈也生效）
4. 编辑态改墙色 → 同一函数、同一结果
5. NL「整体前移」和编辑态拖动提交 → 同一 transform 函数
6. 回归：改色/删除/transform 各走一轮 NL+Edit 不回归

**注意**：属 Spline 化 Phase 2 L2 操作纯函数层地基，提前做。Phase 0.5 后 Phase 2 只加 L1 选择模型 + L3 UI，L2 已就位。

## 🟠 第四梯队 — Spline 化（Phase R + Phase 2-5）

> Spline 化目标：编辑确定性 + 实时拖拽 + 操作可持久化。当前架构（确定性 editObject + commitEdits 落盘）支持扩展，不需推翻重写。

### 8. P2 Phase R 代码结构重构（R1-R9 + core/edit-bridge 分层隔离）✅
**是什么**：拆 7 个 app 级单例 Manager（renderer/scene/environment/camera/light/controls/renderLoop）+ App3D 瘦身 + **3d-templete 内部 core/edit-bridge 物理隔离**。纯结构，**行为零变化**是验收标准。为 Spline 化 Phase 2-5 铺路（SelectionManager / LayoutEngine / MaterialLayerSystem 要加 Manager）。
**落地状态**：四 commit 全落地（2026-09-11），用户 e2e 全过（生成全链路 + M-3① 矩阵 + 编辑态改色/拖动提交 + 大纲 + 切历史 + 导出工程）：
- **C1（8e3c330）**：`src/3d/managers/app/` 7 Manager（Renderer/Scene/Environment/Camera/Light/Controls/RenderLoop）；App3D 316→175 行组合根 + facade getter 全保留（消费方零改动）；_orthoHalfH 正交 resize 基准原子落 CameraManager；ControlsManager 由 createScene3D 创建（偏离①：controls 选项在 Scene3DOptions）
- **C2（c769470）**：environment.ts 278→85 行纯 dispatcher（EnvUpdate 签名冻结）；背景/雾两处重复合一进 SceneManager.applyBackgroundFog
- **C3（902b463）**：createScene3D 602 行拆三：入口（类型+编排）/ sceneSetup.ts / sceneHandle.ts
- **C4（f5ad8a3）**：`src/3d/editBridge/` 物理隔离——git mv postMessageHost/SelectionService/SelectionVisuals（100% rename 历史保留）+ sceneEdit.ts（6 编辑 helper）+ editHandle.ts（`attachEditBridge(core): EditSceneHandle`）+ barrel；core Scene3DHandle 删 selection+7 编辑方法、加 interactiveManager；Embed.vue 改 `attachEditBridge(await createScene3D(...))`；core→editBridge 零 import（grep 实证）
- **三个已批准偏离**：ControlsManager 由 createScene3D 创建 / debug+CameraRig 留 core（RenderLoop 每帧驱动 HUD；shared.ts sacred import）/ camelCase 目录名 editBridge 非 edit-bridge
- **后续扩展接缝**：LightManager（Phase L 加 point/spot/rectarea）、EnvironmentManager（Phase S 环境可换）、ControlsManager（Phase S set_controls op）、CameraManager/SceneManager（相机/背景参数扩展）——参数清单扩展直接往对应 Manager 塞方法
**为什么现在做**：Phase 2-5（选择模型/布局/材质/动画）要加 Manager 级新模块，不先拆 App3D 会堆进已经臃肿的 App3D 里更乱。Phase R 是 Phase 2-5 的前提。
**core/edit-bridge 分层隔离**（3d-templete 导出给二次开发，内部要分层）：
- **core（预览/二次开发核心）**：`createScene3D` 入口 + `App3D` 渲染循环/相机/灯光 + `scene/`（loader/objects/environment/presets）+ `managers/component/`（ComponentManager+handler 注册+override）+ `managers/card/` + `controls/OrbitControls` + `resources/`（材质/模型注册）+ `components/`（Primitive/Model/Text 基础组件+builders）+ `assets/` + `utils/`。二次开发用户直接用，须纯净不带 UXAI 编辑概念。
- **edit-bridge（UXAI 编辑对接层）**：`bridge/postMessageHost`（SCENE_ 全协议收发）+ `interaction/SelectionService`（点击拾取+粒度整体/部件）+ `interaction/SelectionVisuals`（高亮包围盒）+ `interaction/CameraRig`（flyTo 相机编排）+ `createScene3D` 里的 `editObject`/`removeObject`/`applyLiveDataToApp`（直改运行时 Object3D）+ `debug/`。UXAI 编辑态驱动的能力，实现落 3d-templete（改运行时 Object3D），但隔离成独立模块（如 `src/3d/edit-bridge/` 目录），core 代码不 import edit-bridge。
- **判据**：二次开发用户单用 3d-templete 时这个能力是基础渲染/交互，还是 UXAI 编辑态专属？基础→core，编辑专属→edit-bridge（隔离但不移出 3d-templete，因为运行时 Object3D 操作必须在 iframe 执行）。调灯光/调材质/整体部件选中 这些实现落 edit-bridge，UXAI 侧编排（commit/editDelta/UI）调它。
- **现状**：edit-bridge 散落在 core 目录里（`bridge/` `interaction/` 混在 `scene/` `managers/` 旁边），`createScene3D.ts` 更是 core 入口和 edit-bridge 方法混在一个文件。Phase R 物理隔离（抽 `edit-bridge/` 目录 + createScene3D 拆 core 入口 vs edit-bridge 方法）。新功能（大纲面板的 SCENE_QUERY_TREE/SCENE_SELECT）暂落现有 `interaction/` `bridge/`，Phase R 统一搬。
**测试用例**：重构后跑核心子集回归——生成全链路 + 灯/背景/相机场景级改动（不闪不丢）+ 编辑态改色/拖动提交 + 切历史立即生效，行为与重构前一致。

---

### Phase 1.5 — 场景大纲面板（Spline 大纲，一次性做 Phase B 完整树）✅
**是什么**：Spline 左侧「场景大纲」——显示场景里所有元素/对象的树形大纲，可展开折叠、点击选中、看场景里有什么。一次性做 Phase B（完整子部件树，不只根节点列表）。
**为什么一次性做 Phase B**：Phase A（只根节点列表）价值有限，Spline 的大纲核心价值是完整树（可展开看子部件、直接点选难选的子部件）。两阶段做反而多一次 iframe 协议迭代。

**架构（core/edit-bridge 分层，遵循隔离原则）**：

| 层 | 归属 | 内容 | 判据 |
|---|---|---|---|
| core | 3d-templete | 无新增（复用现有 createScene3D/scene.traverse） | — |
| edit-bridge | 3d-templete | `SCENE_QUERY_TREE`（查场景树）+ `SCENE_SELECT`（按 id 高亮） | 二次开发也要查树/选中，通用能力但落 edit-bridge（隔离） |
| edit | UXAI | 大纲面板 UI + 树渲染 + 点击同步 + 删除/复制按钮 | 编辑态专属 |

**4 步落地（递进，Step 1 是卡点）**：

**Step 1（3d-templete edit-bridge）SCENE_QUERY_TREE 协议**
- `postMessageHost.ts` 加 `SCENE_QUERY_TREE` 收发
- `createScene3D.ts` 加 `queryTree` 方法：`app.scene.traverse()` 收集 `userData.__id` 非空的节点 → `{ id, name, type(__componentType), parentId, isLogicalRoot }` 树结构 → post 回宿主
- 只收 `__id` 非空节点（根+语义子部件+兜底 part-N），跳过无 `__id` 的纯几何 leaf mesh，控树规模
- 暂落 `bridge/` `createScene3D.ts`（现有 edit-bridge 位置），Phase R 统一搬 `edit-bridge/` 目录

**Step 2（3d-templete edit-bridge）SCENE_SELECT 协议**
- `postMessageHost.ts` 加 `SCENE_SELECT`
- `createScene3D.ts` 加 `selectObject(id)`：`findByUserId(__id)` + `visuals.highlight(obj)`（复用现有 SelectionVisuals）
- 现有 `SCENE_FLY_TO` 只聚焦相机不高亮，大纲点击需独立高亮协议

**Step 3（UXAI edit）outline-panel.tsx 组件**
- 新建 `modules/preview/outline-panel/outline-panel.tsx`
- 收 `SCENE_QUERY_TREE` 回传 → signal 存树
- 按逻辑根（`isLogicalRoot`）分组 + 子部件可展开折叠（类似 Spline）
- 每项：icon + id + type + hover/选中高亮
- 项点击 → post `SCENE_SELECT` + `SCENE_FLY_TO` + `setPickedObj`

**Step 4（UXAI edit）双向同步 + 集成 preview/index.tsx**
- canvas 点选 → `SCENE_PICK` 回传 → 大纲对应项高亮 + 自动展开父节点 + 滚动可见
- 大纲点击 → canvas 高亮（Step 2 协议）+ 相机聚焦
- 选中项的删除/复制按钮 → 复用现有 `handleRemoveObject`/`handleDuplicateObject`
- 大纲放预览区 flex 左侧栏（可折叠，编辑态展开），不修改页面 Grid（`ChatPanel | divider | PreviewArea` 不变）：
  ```
  PreviewArea (flex-row)
  ├── 大纲侧栏 (w-220px, 可折叠→0)
  ├── iframe (flex-1)
  └── 现有浮层 (属性弹窗/场景面板/横幅)
  ```

**测试用例**：
1. ✅ 生成场景 → 大纲显示完整树（根+子部件可展开折叠）
2. ✅ 大纲点子部件 → canvas 高亮 + 相机聚焦 + 属性弹窗弹出
3. ✅ canvas 点选物体 → 大纲对应项高亮 + 自动展开祖先链（auto-expand effect 修复：原只展一层→改为沿 parentId 链整条祖先展开）
4. ✅ 展开折叠箭头按钮点击生效（SolidJS 响应式修复：原 const isExpanded 捕获布尔值丢失响应式→改为 JSX 内即时求值 `expandedIds().has(id)`）
5. ✅ 删除/复制通过属性弹窗按钮验证（大纲 onRemove/onDuplicate 已接线，大纲内行内按钮待 Spline 化 4 项）
6. e2e ✅ 通过（2026-09-09，shanghai-seg 场景）

**风险**：`app.scene.traverse()` 对大场景（1000+ mesh）可能慢。只收 `__id` 非空节点已大幅缩减；若仍慢 → 加节流（场景变化后延迟查询）或增量更新。

---

### Phase 1.5+ — Spline 化大纲 4 项（可见性 / 右键菜单 / 重命名 / 锁定）✅ 全过（TC-OUTLINE-1~18，2026-09-10）
**是什么**：对标 Spline Hierarchy 面板，大纲补 4 项交互：眼睛图标切可见性、右键上下文菜单、双击重命名、锁图标防误选。运行时态（不持久化，重生成恢复默认）。
**架构**：3d-templete edit-bridge 加 3 协议（SCENE_SET_VISIBLE / SCENE_RENAME / SCENE_SET_LOCKED）+ SelectionService 加 isLocked 检查；UXAI 侧 outline-panel.tsx UI + preview/index.tsx 编排。

**修复记录（2026-09-09 第 3 轮修复，4 个 SolidJS 响应式根因）**：
- **根因 1（子节点 eye/lock 不 toggle）**：`renderNode` 顶部 `const children = tree().childrenMap.get(node.id)` 捕获了 `children` 数组引用，`treeNodes` 更新后父节点的 `renderNode` 不会被重调（根 ref 不变），子节点 `<For>` 看不到新的子节点引用 → 子节点的 `visible`/`locked` 永远是初始值。修：所有 `tree()` 读取改为 JSX 内 inline 求值（`tree().childrenMap.get(node.id)` 在 `Show when=` / `<For each=` 里直接调）。
- **根因 2（滚动不在中间）**：`scrollIntoView({ block: "nearest" })` 只滚到刚好可见。修：改 `block: "center"` + 引入 `scrollRequest` prop（`{ id, nonce }` nonce 递增驱动 effect），仅 canvas 点选触发（大纲点击不滚避免 dblclick 冲突），两帧后滚动（第一帧展开 DOM 渲染，第二帧定位）。
- **根因 3（双击改名不生效）**：`const isRenaming = renamingId() === node.id` 捕获布尔值丢失响应式，`renamingId()` 变化时 `Show` 不重评估 → input 永远不出现。修：`Show when={renamingId() === node.id}` inline 求值 + `onDblClick` 加 `preventDefault` + `ref` 用 `requestAnimationFrame` 延迟 focus（SolidJS ref 在 DOM 挂载前执行）。
- **根因 4（子节点删不掉）**：`handleRemoveObject` 本地过滤 `treeNodes` 可能漏子部件（`__id` 漂移致 `collectDescendants` 不全）。修：删除后 500ms 延迟 `sendQueryTree()` 从运行时重建权威树（双重保险：本地即时过滤 + 运行时刷新）。

**修复记录（2026-09-10 第 4 轮收尾，2 项）**：
- **根因 5（切走切回删除物体复活）**：删除子节点（如 `lujiazui_skyline-1-pearl-upper-sphere`）后切走切回，物体又出现。根因 = `pendingData` effect 无条件 `setEditDelta(new Map())` 在 SCENE_READY editDelta 重放之前清空了重放缓存（切走→pendingData=null→切回→pendingData=cfg→effect 清 editDelta→SCENE_READY 重放读空 Map→被删物体从原始数据复活）。修：改 JSON 比对 `lastDataJson`，仅 `pendingData` 真正变化时才清 editDelta（切走=null 切回=同 cfg 不算变化）；SCENE_READY 加 editDelta 重放（1s 延迟 `sendRemoveObject`/`sendEditObject` + 500ms `sendQueryTree` 刷树）。
- **清理（TYPE_LABELS/typeIcon 硬编码标签+图标表）**：删 `TYPE_LABELS: Record<string,string>`（forklift→叉车…）+ `typeIcon` 函数（按 type 字符串匹配 emoji）+ renderNode 两处引用（`outline-icon` span / `outline-type-tag` span）+ 对应 CSS。场景类型是 LLM 生成无穷的，硬编码几个标签覆盖不全又显得特殊化，改用通用图标。

**修复记录（2026-09-10 第 5 轮，1 项）**：
- **根因 6（第 4 轮 JSON 比对的 null 哨兵缺陷）**：第 4 轮的 `lastDataJson` 比对有缺陷——切走时 `pendingData=null`→`json="null"`→`lastDataJson="null"`；切回时 `pendingData=cfg`→`json="sameCfg"`→`dataChanged=(sameCfg≠"null")=true`→**误清 editDelta**。null 是切走哨兵不携带场景数据，不该参与"场景是否变化"判定。修：null 不更新 `lastDataJson`、不触发 `dataChanged`（`const json = data === null ? null : JSON.stringify(data)` / `const dataChanged = json !== null && json !== lastDataJson` / `if (json !== null) lastDataJson = json`）。效果：切走(null)→保持；切回(同cfg)→`json===lastDataJson`→不清→SCENE_READY 重放删除生效；新生成(不同cfg)→清；切不同会话(null→cfgB)→清。e2e 待跑（验证：删 `lujiazui_skyline-1-pearl-upper-sphere`→不提交→切走切回→物体不再复活）。

**修复记录（2026-09-10 第 6 轮，1 项）**：
- **根因 7（addPart 创建模式删除缺口）**：删 `lujiazui_skyline-1-pearl-lower-sphere` 提交后切走切回仍复活。日志铁证：`lower-sphere` 是 `addPart(g, sphere1, cid, 'lower-sphere')` 创建（非 stamp），提交删除走 ② `patchHandlerDeleteCreation` 只认 `stamp()` 不认 `addPart()` → failed → 落 ③ `patchHandlerSkip` 加 cid 进 SUB_SKIP → 但 **addPart 创建点无 `SUB_SKIP.includes(cid)` 检查**（只有 midrise/lamp/tree 循环里有）→ cid 已在 SUB_SKIP 里（幂等跳过）→ source 零变化，commitEdits 仍报 committedCount=1（误报成功）→ 物化重载 handler 照常 addPart 创建 → 物体复活。修：`patchHandlerDeleteCreation` 加第二条匹配分支——stamp 失败后遍历 `addPart(_, var, _, 'name')` 调用，cidSuffix 尾部匹配 name（`__id=${cid}-${name}`，`-${name}` 是 cidSuffix 后缀），删从 `const var =` 声明到 `addPart(..., var, ..., 'name');` 整块。重建时该子部件不创建 → 确定性删除。跟 roof_truss-1-part-1 **不是同类**（part-N=兜底 id 缺口 vs addPart=语义 cid 创建模式缺口）。e2e ✅ 通过（2026-09-10，删 `lower-sphere` 提交→切走切回不复活）。

**大而全测试用例（TC-OUTLINE-1 ~ 16）**：

| # | 用例 | 操作 | 预期 | 状态 |
|---|------|------|------|------|
| TC-OUTLINE-1 | 根节点眼睛 toggle | hover 根节点 → 点眼睛图标 → 再点 | canvas 物体消失/恢复；大纲根节点灰显/恢复；子节点同步灰显/恢复 | ✅ |
| TC-OUTLINE-2 | 子节点眼睛 toggle | 展开根 → hover 子节点 → 点眼睛 → 再点 | canvas 子部件消失/恢复；大纲子节点灰显/恢复（图标变闭眼/睁眼） | ✅ |
| TC-OUTLINE-3 | 根节点锁 toggle | hover 根 → 点锁图标 → 再点 | 图标变闭锁/开锁；锁定后 canvas 点不到该物体（picker 跳过）；子节点同步锁态 | ✅（新增：锁定项缺视觉标识，见 TC-OUTLINE-17） |
| TC-OUTLINE-4 | 子节点锁 toggle | 展开根 → hover 子节点 → 点锁 → 再点 | 图标变闭锁/开锁；锁定后 canvas 点不到子部件 | ✅ |
| TC-OUTLINE-5 | 锁定后 picker 穿透 | 锁定某物体 → canvas 点击该物体位置 | picker 跳过锁定物，选中其下方未锁定物体（不卡死不报错） | ✅ |
| TC-OUTLINE-6 | 双击重命名（Enter） | 双击大纲项名称 → input 出现 → 输入新名 → Enter | 大纲名称更新（Object3D.name 在大纲显示；canvas 无文字标签，预期原表述误导已修） | ✅ |
| TC-OUTLINE-7 | 双击重命名（失焦） | 双击名称 → 输入 → 点击别处（blur） | 同 TC-OUTLINE-6（onBlur 提交） | ✅ |
| TC-OUTLINE-8 | 重命名取消（Esc） | 双击名称 → 按 Esc | input 关闭，名称不变 | ✅ |
| TC-OUTLINE-9 | 重命名空值 | 双击名称 → 清空 → Enter | 不提交（空值守卫），input 关闭名称不变 | ✅ |
| TC-OUTLINE-10 | 右键菜单弹出 | 右键大纲任意项 | 菜单在鼠标位置弹出（选中/聚焦/切换可见/切换锁定/复制/删除） | ✅ |
| TC-OUTLINE-11 | 右键菜单-选中 | 右键 → 点「选中」 | 等同左键点击：canvas 高亮 + 聚焦 + 属性弹窗 | ✅ |
| TC-OUTLINE-12 | 右键菜单-删除 | 右键子节点 → 点「删除」 | 物体从 canvas 消失 + 大纲立即移除（本地过滤） + 500ms 后树刷新确认 | ✅ |
| TC-OUTLINE-13 | 右键菜单-复制 | 右键根节点 → 点「复制」 | 新物体出现在 canvas + 大纲（提交后落盘） | ⚠️ 功能过但复制体与原物重叠（偏移 x+2 对大场景太小看不出，见 TC-OUTLINE-18） |
| TC-OUTLINE-14 | 右键菜单-切换可见/锁 | 右键 → 点「切换可见」/「切换锁定」 | 等同行内眼睛/锁按钮效果 | ✅ |
| TC-OUTLINE-15 | canvas 点选滚动定位 | 展开长大纲 → canvas 点击底部物体 | 大纲自动展开祖先链 + 滚动到该项居中（block: center） | ✅ |
| TC-OUTLINE-16 | 重生成恢复默认 | 做完以上操作 → 提交 → 重生成 | 可见性/锁定/重命名全部恢复默认（运行时态不持久化验证） | ✅（删除切走切回保留） |

**验证 session**：`ses_f7ae41228ffenrL1ma9Yc1sfas`（lujiazui_skyline 场景）。**2026-09-10 全量 16 条跑完：✅ 14 / ⚠️ 1（复制重叠）/ 新增 2 项（17 锁定视觉标识、18 复制偏移量）**。

**新增待办（第 1~16 条跑出的 2 个问题）**：
- **TC-OUTLINE-17 隐藏/锁定项状态图标常显** ✅ e2e 通过（2026-09-10）：**哪个状态激活就常显哪个图标**——隐藏项常显闭眼、锁定项常显闭锁（琥珀色 `outline-action-btn-active`），正常项 hover 才显示；隐藏/锁定灰显一致（opacity 0.45）。实现踩坑两轮：① CSS 定义顺序（persistent 规则在 `display:none` 之前被覆盖）② **父容器 `display:none` 下子元素 `display:block` 无效**（盒子生成问题）→ 终版方案：容器永远 `display:flex` + 默认 `opacity:0/pointer-events:none`，`:has(persistent)` 检测常显按钮时容器转显，按钮级 `visibility` 控制单个图标可见性。
- **TC-OUTLINE-18 复制偏移量太小** ✅ e2e 通过（2026-09-10）：偏移量从固定 `x+2` 改为场景尺度比例——取 pendingData 全部顶层节点 position 的 X/Z spread，偏移 = max(spread × 20%, 2)（保底 2 兜小场景）。零协议改动纯 host 算法，复制体肉眼明显错开原物。

---

### Phase 2 — 选择模型 + 布局算法 ⬜
**是什么**：Spline 编辑交互基础。选择模型扩展（单选已有 → 多选/框选）+ 布局纯函数（排列/对齐/分布/贴合）+ 批量操作。
**架构**：三层——Layer 1 选择模型（SelectionSet）/ Layer 2 操作纯函数 `(selection, state) => Patch`（可测可 undo）/ Layer 3 执行持久化（editObject 即时改 + commitEdits 落盘，批量=循环现有单对象路径）。

| 项 | 内容 |
|---|---|
| 多选 | SelectionSet + Ctrl/Shift 累积 |
| 框选 | Raycaster + 屏幕矩形（Three.js SelectionBox example） |
| 排列算法 | Grid / 五角星 / 蜂窝 / 圆形 / 螺旋（纯数学 → 批量 transform） |
| 对齐/分布 | 底/顶/左/右/中 X/Y/Z + 等距（bbox 数学 → 批量 transform） |
| 贴合地面 | bbox.min.y 平移 |
| 批量改色/transform | 循环现有单对象路径 |
| 布局工具栏 UI | 多选时显示对齐/分布/排列/批改色 |
| 不依赖 M-4 | 批量=循环现有单对象路径，纯扩展 |

**测试用例**：
1. 框选 5 个 rack → 点「底对齐」→ 5 个 rack 底部齐同一 Y
2. 框选 3 个 forklift → 点「等距分布」→ 沿 X 轴等距排列
3. 框选 6 个 box → 点「蜂窝排列」→ 六边形布局
4. 多选 3 个物体改色 → 3 个全变、其他不动
5. 多选 + 单选切换不串（单选弹保持现有 property-editor-popup）

---

### Phase 3 — 材质系统（贴图替换）⬜
**是什么**：Spline Image Layer 对应能力。导入 GLB 后换贴图、投影方式、贴图调节。与 M-1a 改色同链路扩展（paint 函数加 TextureLoader）。

| 项 | 内容 |
|---|---|
| 图片贴图替换 | TextureLoader + paint 函数扩展 + 材质编辑器 Image Layer UI |
| 投影方式 | UV / Planar / Spherical / Cylindrical / Triplanar |
| 贴图调节 | Wrapping（Clamp/Repeat/Mirror）+ Scale / Offset / Rotation / Crop |
| 贴图资源管理 | 上传图片存 workspace assets + 复用 |
| 批量改色/材质 | 多选时批量（依赖 Phase 2） |
| 程序化纹理 | Noise / Pattern / Gradient Layer |
| 多图层叠加 | Material 多 layer 混合（后期） |
| Bump/Roughness map | 图片当粗糙度/凹凸通道 |

**测试用例**：
1. 导入 GLB 叉车 → 选材质编辑器 → 上传图片贴图 → 贴图覆盖叉车表面
2. 切投影方式 Triplanar → 贴图三方向混合无接缝
3. 调贴图 Scale/Offset → 位置/大小调对
4. 多选 3 个 box 批量换贴图 → 3 个全变
5. 贴图配置落盘 → 切走切回保留

---

### Phase 4 — 复制粘贴 + 基础建模 ⬜
**是什么**：补全 CRUD（复制/粘贴/原地复制）+ 基础建模操作（Extrude/Lathe/Pivot/Array）。

| 项 | 内容 |
|---|---|
| 复制粘贴 | 克隆 live-data node + 新 id（max+1）追加 group 数组 |
| 原地复制 | copy + paste with offset |
| Extrude 2D→3D | THREE.Shape + ExtrudeGeometry |
| Lathe | THREE.LatheGeometry |
| Pivot 移动 | geometry.translate |
| Array（线性/径向） | 批量复制 + 布局算法组合 |
| Boolean（Union/Subtract） | CSG 三角剖分（后期，难） |

**测试用例**：
1. 选 forklift-1 → 点「复制」→ 出现 forklift-2（新 id）→ paste with offset 不重叠
2. 画一个 2D 矩形 → Extrude → 拉伸成 3D 立方体
3. 选 3 个 box → 径向 Array → 圆形排列 3 个
4. 复制粘贴落盘 → 切走切回保留

---

### Phase 5 — 场景级补全（灯/相机/环境，原 9/10/10.5 合并）⬜
**是什么**：原 todo 第 9（Phase L 灯增删）+ 第 10（Phase S 数据驱动 + remove_type）+ 10.5（场景级编辑面板）合并。分两批：
- **第一批（快，纯 UI）**：scene（背景/雾）、camera（fov/位置/注视/正交切）、lights（现有 ambient/hemisphere/directional 列表增删 + 颜色/强度/位置/阴影）——这三块 live-data + 运行时 mutate 已通（environment.ts updateEnvironment / EnvUpdate），只差面板 + title-bar「场景」入口 + 转发 SCENE_PATCH_ENV。
- **第二批（慢，补后端）**：renderer（阴影/toneMapping/曝光/pixelRatio）、controls（min/maxDistance/maxPolarAngle/damping/target）、environment 换 HDR（applyPMREM 固定 RoomEnvironment）；灯类型扩 point/spot/area（原 Phase L L1-L4）；remove_type（原 Phase S D1）。

| 项 | 内容 |
|---|---|
| 场景面板 UI | 10.5 第一批（scene/camera/lights） |
| 灯类型扩展 | point/spot/area + 渲染分支 + set_light add/remove + triage few-shot（原 9 Phase L） |
| HDR 环境 | RoomEnvironment → 可换 HDR |
| 后处理 | EffectComposer（bloom/exposure/tonemapping） |
| renderer/controls | 进 live-data + set_renderer/set_controls op（原 10 Phase S） |
| remove_type | 分组消失、index.ts 注销（原 10 Phase S D1） |
| 灯阴影细控 | 扩 |

**测试用例**：
1. 生成场景 → 工具栏点「场景」→ 面板改背景色/雾/相机 fov/灯光强度 → 立刻生效、不重建物体树、切走切回保留
2. 面板改「阴影开关/色调映射/曝光」→ 渲染立刻变化、切走切回保留
3. 面板加一盏 point light/删一盏灯 → 灯增删生效
4. 「把所有树删掉」→ remove_type → 树分组消失、index.ts 注销、无残留空 Group
5. 编辑态选中物体弹窗与场景设置面板并存不串

## ⚪ 第五梯队 — 长期/外部依赖

### 11. M-4 数据驱动 handler（重定位为「贯穿 Phase 2-5 的渐进重构」）⬜
**是什么**：原「大工程根治」重定位为渐进重构——在 Phase 2-5 做选择模型/布局/材质/复制粘贴/场景级时，逐步把 handler 硬编码 params（position/rotation/scale/count）挪到 live-data，让相关操作走纯 data patch 零 edit_code。**不是独立大工程，不阻塞 Phase 2-5**。
**测试用例**：「货架从 3 排加到 5 排」→ 只改 live-data params，handler 源码不变、无场景级漂移、无物体丢失。

### 12. 混元真实密钥验证 ⬜（等密钥）
**是什么**：.env.local 配真实密钥验 Step5 GLB 生成；顺带定 adm-zip 去留（返回 zip 还是 GLB）。
**测试用例**：生成含「用混元生成一个风机模型」的场景 → GLB 真实下载渲染成功。

### 14. 9b VLM 审美评审 ⬜
**是什么**：生成后截图送 VLM 评布局/配色，低分喂回重试一轮；不阻塞物化（建议性）。
**测试用例**：构造一个明显配色失衡的场景 → VLM 低分 → 触发一轮重试 → 产物改善或至少不劣化。

### Phase 6 — 交互动画系统（Spline 核心竞争力，长期架构预留）⬜
**是什么**：Spline 真正护城河。States + Events + Actions + Timeline + Physics + Variables。本项完全空白，工程量最大，需独立大阶段。
**架构预留**：Phase 2-5 的 Operation 抽象（纯函数 `(selection, state) => Patch`）天然支持 State 快照（一个 State = 一组 Patch），Phase 6 基于此扩展不推翻。

| 项 | 内容 | 难度 |
|---|---|---|
| State 抽象 | 场景快照 + diff + 命名状态 | 巨大 |
| Event 总线 | Mouse/Key/Scroll/Collision/Timer | 大 |
| Action 引擎 | Transition/Animation/Variable/URL/Code | 大 |
| Timeline | Keyframe + 插值 + 缓动 + Loop | 大 |
| 变量系统 | 数值/字符串/布尔/颜色 + 绑定属性 | 大 |
| Play Mode | 预览模式 | 中 |
| 物理模拟 | 刚体/碰撞/力场（接 cannon-es / rapier） | 巨大 |
| 粒子系统 | 粒子发射器 | 大 |
| 发布嵌入 | spline-viewer 式 Web 嵌入 | 中 |

---

## 建议节奏

P8 + 三仓 commit ✅ 已完成。P0.13（门控渐进读 buffer）+ P7-2（改 bug 闭环）✅ 全落地。

**Spline 化路线**：
1. **Phase 1 编辑可靠性**（P0.15 删顶层 / P0.14 复制按钮 / P0-12 墙色验证）— contained，马上做
2. **Phase 0.5 操作层统一**（P0.16 抽 scene-ops.ts，NL=Edit 单代码路径）— 修当前分叉 bug + 防 未来分叉，Phase 1 后紧接做
3. **Phase 1.5 场景大纲面板**（Phase B 完整树 + core/edit-bridge 分层）— 编辑态核心交互，4 步递进（SCENE_QUERY_TREE→SCENE_SELECT→outline-panel→双向同步）
4. **Phase R 代码结构重构**（R1-R9 + core/edit-bridge 物理隔离）— 为 Phase 2-5 铺路，新功能暂落现有 edit-bridge 位置，Phase R 统一搬 `edit-bridge/` 目录
5. **Phase 2 选择+布局**（多选/框选/排列/对齐）— Spline 编辑交互基础（L2 操作层 Phase 0.5 已铺）
6. **Phase 3 材质贴图**（Image Layer / 投影 / 贴图调节）— 用户明确要求
7. **Phase 4 复制粘贴+建模**（CRUD 补全 + Extrude/Lathe/Array）— Spline CRUD 闭环
8. **Phase 5 场景级补全**（原 9/10/10.5 合并）— 灯类型/HDR/后处理
9. **Phase 6 交互动画**（States/Events/Actions/Timeline/Physics）— 长期，架构预留
- **M-4 渐进重构**：不阻塞，贯穿 Phase 2-5 逐步把 handler params 挪到 live-data
- **第 2 项 exe 打包**：独立穿插，不阻塞 Spline 化
- **core/edit-bridge 隔离原则**：3d-templete 导出给二次开发，内部 core（渲染/通用交互）与 edit-bridge（UXAI 编辑对接层）须隔离；新功能暂落现有位置，Phase R 物理隔离（抽 `edit-bridge/` 目录，core 不 import edit-bridge）；UXAI 侧放编排（commit/editDelta/triage/UI）

### 已删除项（2026-09-07 direct 落地，冗余清理）

- ~~P7-0（17）单 agent vs 并行 A/B 对照~~：single/pertype 都删了，A/B 无意义。
- ~~P7-3（20）骨架预置~~：direct 已验证不截断（finish=stop），该项确认不需要。
- ~~P7-4（21）渐进物化~~：direct 单次调用无「每路完成」概念。
- ~~P7-5（22）拆细 type~~：direct 单次调用，type 数不影响墙钟（只影响 output 量）。
- ~~P6-1（4）并行 per-type 拆分~~：pertype 删了，该项作废。
- ~~P6-4（13）triage→plan 合并~~ / ~~P6-5（12）plan→codegen 流式衔接~~：plan 删了，无合并/衔接对象。
- ~~⚡ plan JSON 截断抢救~~：plan 删了，无 plan JSON 截断问题。

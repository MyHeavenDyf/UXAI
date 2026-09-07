# 3D 待办清单（活跃版）

> **唯一权威清单**：只列**还没做**的项，每项自带「是什么 + 测试用例」，看这一个文件就够。
> **新问题/新需求进来**：反馈给 Claude → 取证/评估 → 自动写入本清单（自评优先级，允许插队），同样自带说明+用例。完成一项打勾。
> 优先级判据：堵主流程/丢数据=🔴｜体感痛点=🟠｜低频遗留=🟡｜结构/功能补全=🟢｜大工程/外部依赖=⚪
>
> 完整全流程回归用例（开发完成后**交付测试团队**用）：[3D_E2E_TESTCASES.md](3D_E2E_TESTCASES.md)
> 已修项的根因取证归档：[3D_CODEGEN_DESIGN.md §十四](3D_CODEGEN_DESIGN.md)
> 最后更新：2026-09-07（P8 direct codegen 落地 + idle 误杀修 180s→420s；新增 P0.13 门控漏判运行时报错[handler 报错仍显生成完成] + P0.14 modify 加实例漏加[LLM 照抄 CURRENT_GROUPS]）。

---

## 🔴 第一梯队 — P8 direct codegen 落地（现在就验证）

### ⚡ P8 direct codegen 单次直出 ⬜
**是什么**：砍掉 plan agent + pertype/full + 自愈循环，改为 triage → direct codegen 单次 API 调用（LLM 自己想坐标/尺寸/结构，输出 handler+group+scene-config.json），host 确定性合并 index/live-data。目标 30-60s 出场景（vs 现在 32-50min）。modify 也走 direct（吃 currentHandlers 照抄布局，不需要 plan 的 build_detail）。patch/edit_code/编辑器链路完全不动。
**为什么改**：用户实测 Claude 单轮对话写 shanghai-city.html ~30s/52.5K tokens；同仓库 make 页（octo_make）也是单 agent 单 prompt 直出。pipeline 为「物体级编辑器/数据驱动 modify」设计的 plan+handler 拆分+自愈，在首次生成付出 80-100 倍时间成本。plan(19min)+自愈重跑(8min)+并行脑补 reasoning 放大是慢主因。
**改动**（已落代码，待 e2e）：新 prompt `scene_3d_codegen_direct.txt`（吃 `[TYPE_LIST]`+`[USER_REQUEST]`+`[ASSET_CATALOG]`+`[CURRENT_HANDLERS]`[modify]，输出 handler+group+scene-config.json）；proto/index.ts+agent.ts 注册 `scene_3d_codegen_direct`；scene-codegen/index.ts 加 direct 函数；codegen-scene.ts 重写——删 CODEGEN_MODE/plan step/自愈循环/parseFullResult/parsePerTypeResult+6 辅助函数，加 direct 流程+parseDirectResult+synthetic DirectPlan；删 plan agent 目录+pertype/full prompt。
**首要验证点**：GLM-5.2 单次输出 13 handler 是否截断（finish=length）。input 从 31K 降到 ~2K，但 output 量（13 handler ≈ 2.5 万 token）不变。若截断 → fallback P7-3 骨架预置（重启该项）。
**测试用例**：
1. 重启 opencode → tsgo+oxlint 双包 0 error
2. 跑上海地图（13-type）首次生成 → 墙钟 30-60s（vs 32-50min）｜finish=stop（不截断）｜场景渲染完整 13 type 全出｜tokens 50-80K（vs 400K+）
3. modify 不回退：「加几台显示器」→ 走 direct codegen 吃 currentHandlers 照抄布局只重写受影响 type，其他 type 不丢
4. patch 不回退：「墙改蓝」→ edit_code 改一行
5. 切历史/导出 zip 正常

### 1. 三仓 commit ⬜（P8 验证绿后）
**是什么**：dev_cyc1 堆着 P8 direct + 之前 P1.5+全清+P0.4~P0.10 约 40+ 文件未提交，e2e 绿后一次提交。
**测试用例**：无（git 层操作；提交前跑 tsgo/oxlint 双包 0 error）。

### 2. 打包 exe 内 3D 全链路 ⬜
**是什么**：`release.ts --win --channel dev` 打 exe，验 3D 全链路。exe 是最终分发形态，这条不绿都是 dev 自嗨。
**测试用例**：exe 里新会话生成场景 → 渲染 → modify 一版 → patch 一版 → 切历史 → 导出工程 zip，全链路与 dev 环境一致。白屏查 extraResources .3d-dist 是否进包。

## 🟠 第二梯队 — 报错体验（direct 失败后用户要能定位+修一行）

### P0.13 门控漏判运行时报错（handler 报错仍显示「生成完成」）⬜
**是什么**：direct 生成的 handler 在 iframe 运行时报错（如 `inner.rect is not a function`——THREE.Path 无 rect 方法，LLM 误用 API），但左侧仍显示「生成完成」。门控 `settleMs: 3000`（固定 3s）太短：vite 首次加载模块 + iframe 初始化 + ComponentManager 遍历调 handler.create 这套链路常超 3s，报错落在窗口外，门控已判 PASS。
**根因**：固定延迟 settleMs 抓不到慢加载场景的运行时报错（P0.10 删了 SCENE_READY 握手改固定延迟，握手有竞态但固定延迟有覆盖盲区）。
**修法方向**：① 延长 settleMs（如 8-10s，但拖慢通过态）；② 等一个确定性「渲染就绪」事件（createScene3D 完成信号，非 SCENE_READY 握手）再读 buffer；③ ComponentManager.create 加 try/catch，handler 抛错即时发 SCENE_ERROR（不等 buffer 窗口）；④ 延长窗口 + 渐进读 buffer（报错秒回、无错延后判 PASS）。
**测试用例**：造一个 handler 调 `THREE.Path().rect()` 报错 → 门控判 FAIL → 左侧显示「场景渲染失败: inner.rect is not a function」+ 回复修复入口（依赖 P7-1/P7-2）。

### 3. P7-1 报错定位层（5 类 bug → file:line）⬜
**是什么**：direct 无自愈，handler 报错时用户需能定位。补三层定位：③ 类型/语义 → 物化后在**真实 3d-templete 工程**跑 `tsc --noEmit` 抓 TS2304/2339/2322/2554/2307 精确 line:col（真 tsconfig+@types/three+components，**无 noLib 假阳性**）；② 结构约束 continue/break/return 在循环外/函数外 → 新增**轻量 AST visitor**（`ts.createSourceFile` + 循环/函数深度计数器，物化前、毫秒级、零误报）；④ 运行时异常 sourcemap（可最后做）。
**测试用例**：故意写 continue outside loop + 未定义变量 + 属性拼错，各拿到精确 file:line:col。
**关键边界**：第 5 类「不报错但视觉错」零信号，定位层救不了，靠 modify/patch 修。

### 4. P7-2 改 bug 闭环（报错 → 用户一句话修那一行）⬜
**是什么**：把门控报错**结构化到 UI**（`xxx.ts:302 continue outside loop（TS1107）` + 回复修复入口）。用户输「修这个 continue」→ triage → patch → 复用已有 **edit_code（search→replace）** 精准改那一行 → 重跑 tsc/runtime 验证。优于现在「直接报错让用户重试」（同模型同 prompt 重试无效）。
**测试用例**：造一个 continue 错 → 用户一句话 → edit_code 改那一行生效，整个 handler 不重生成；修复带出新错只做 2-3 次有界循环。
**依赖**：3（定位层）。

## 🟡 第三梯队 — 遗留 bug（低频，只差验证/收尾）

### P0.14 modify 加实例漏加（LLM 照抄 CURRENT_GROUPS 不加新节点）⬜
**是什么**：modify 时「加一辆 forklift」请求，LLM 收到 `[CURRENT_GROUPS]`（含 forklift-1）后，倾向原样照抄现有 group 节点，不主动加新实例。实测三次：child3 漏加（输入1→输出1）、child5 漏加（输入2→输出2，没加第3辆），仅 child4 加对（输入1→输出2）。概率性失败 >50%，同 prompt 不稳定。
**根因**：prompt Constraint 6「逐字照抄布局参数，根节点 id 照抄勿换」**强化了照抄行为**，没明确要求「在现有节点基础上新增节点」。LLM 理解成原样保留现有节点即完成任务。这是 modify 加实例的保真问题，属 [[3d-modify-crud-not-regen]] / M-4 范畴的轻量分支。
**修法方向**：① prompt 加固——modify 加实例时显式约束「输出必须包含现有全部节点 + 至少一个新节点，新节点 id = `<type>-<现有最大序号+1>`」（降低发生率，不根治）；② add_instance 走数据 patch——triage 识别「加一个完整实例」时，往 group 数组追加一个节点（host 确定性，不重写 handler/group），根治但需 triage 分流 + handler 支持纯数据驱动建实例（M-4 大工程子集）。
**测试用例**：场景已有1辆forklift → 「加一辆forklift」→ 场景出现2辆（forklift-2）；已有2辆 → 「再加一辆」→ 出现3辆（forklift-3）。连测5次不漏加。
**注意**：方向①快但概率性；方向②根治但属 M-4 数据驱动 handler 的子集，和第 11 项关联。

### 5. P0-12 墙色提交回退（M-1a）⬜
**是什么**：编辑态改墙色提交后回退（roof 生效 / lights part-43 不生效）。A+B 修法已落地，差 e2e 确认。
**测试用例**：
1. 编辑态点墙（单 material）改蓝提交 → 墙蓝不回退
2. 重生场景选灯罩（part-N 子部件）改色提交 → **单灯罩变、不串色、不全变**

### 6. P0-10 GLB 改色 ✅
**是什么**：GLB 内部子 mesh 改色走 edit_code 插 paint(traverse) 函数，修法已落从未明确测（用户未报问题）。
**测试用例**：编辑态选叉车（GLB）改色提交 → 变色生效、布局/其他物体不动。

### 7. 存量未跑用例补测 ⬜
**是什么**：老回归一直没跑过：场景级切走切回 / 改名删物 / 不重建门控 / 双会话互踩防护。
**测试用例**：
1. 场景级改一版（灯/背景/相机）→ 切走切回 → 改动保留
2. 改名一个物体、删一个物体 → 无重复根、无残留
3. 发一条纯聊天（「你好」）→ 不触发重建
4. 双会话同时生成 → 后者接管 workspace，前者出横幅可一键恢复

## 🟢 第四梯队 — 功能补全（第 8 项是 9/10 的前提）

### 8. P2 Phase R 代码结构重构（R1-R9）⬜
**是什么**：拆 7 个 app 级单例 Manager（renderer/scene/environment/camera/light/controls/renderLoop）+ App3D 瘦身。纯结构，**行为零变化**是验收标准，为 L/S 铺路。
**测试用例**：重构后跑核心子集回归——生成全链路 + 灯/背景/相机场景级改动（不闪不丢）+ 编辑态改色/拖动提交 + 切历史立即生效，行为与重构前一致。

### 9. P3 Phase L 灯增删（L1-L4）⬜
**是什么**：灯类型扩 point/spot/rectarea + 渲染分支 + set_light add/remove 语义 + triage few-shot。
**测试用例**：
1. 「加一盏暖色射灯在门口」→ 新灯出现，增量 mutate 不闪不丢编辑态
2. 「删掉那排吊灯」→ 灯消失，其余不动
3. 「环境光换成点光源」→ 类型正确渲染（点光源衰减/射灯锥角）

### 10. P4 Phase S 数据驱动 + remove_type（S1-S6+D1）⬜
**是什么**：renderer/controls 进 live-data + set_renderer/set_controls op + remove_type op。
**测试用例**：
1. 「把渲染器阴影关了」→ 阴影消失，切走切回保留
2. 「鼠标改成左键旋转」→ 控制映射生效，切走切回保留
3. 「把所有树删掉」→ 树分组消失、index.ts 注销、无残留空 Group

### 10.5 场景级编辑面板（renderer/scene/environment/camera/light/controls 六块 UI 化）⬜
**是什么**：现在场景级只有「选中物体 → property-editor-popup」的物体级编辑 +「NL 一句话改灯/相机/背景」的后端 mutate（M-3，无 UI）。缺可视化「场景设置面板」改六块全局配置。拆两批：
- **第一批（快，纯 UI）**：scene（背景/雾）、camera（fov/位置/注视/正交切）、lights（现有 ambient/hemisphere/directional 的列表增删 + 颜色/强度/位置/阴影）——这三块 live-data + 运行时 mutate 已通（environment.ts `updateEnvironment` / `EnvUpdate`），只差面板 + title-bar「场景」入口 + 转发 SCENE_PATCH_ENV。
- **第二批（慢，补后端）**：renderer（阴影/toneMapping/曝光/pixelRatio；antialias 构造期只读）、controls（min/maxDistance/maxPolarAngle/damping/target）、environment 换 HDR（applyPMREM 固定 RoomEnvironment，`preset` 字段死值）——这三块 live-data 无键、无协议、参数硬编码，要补 loader.ts `TreeScene.renderer/controls` 键 + `App3D.applyRenderer` + `handle.applyControls` + SCENE_PATCH_RENDERER/CONTROLS + assembleScene 落盘。
**测试用例**：
1. 生成场景 → 工具栏点「场景」→ 面板改背景色/雾/相机 fov/灯光强度 → 立刻生效、不重建物体树、切走切回保留
2. 面板改「阴影开关/色调映射/曝光」→ 渲染立刻变化、切走切回保留
3. 面板改「相机 min/maxDistance/maxPolarAngle」→ 拖拽受新限位约束
4. 面板加一盏灯/删一盏灯 → 灯增删生效（point/spot 类型属 P3，本项先只编现有三型）
5. 编辑态选中物体弹窗与场景设置面板并存不串

## ⚪ 第五梯队 — 大工程/外部依赖（推后）

### 11. M-4 数据驱动 handler ⬜
**是什么**：数量/尺寸进 params、handler 不重写——**根治** modify 保真 G1/G2 + 加删实例丢物体。大工程。
**测试用例**：「货架从 3 排加到 5 排」「集装箱数量翻倍」→ 只改 live-data params，handler 源码不变、无场景级漂移、无物体丢失。

### 12. 混元真实密钥验证 ⬜（等密钥）
**是什么**：.env.local 配真实密钥验 Step5 GLB 生成；顺带定 adm-zip 去留（返回 zip 还是 GLB）。
**测试用例**：生成含「用混元生成一个风机模型」的场景 → GLB 真实下载渲染成功。

### 13. P1.6 静默 typo 评估 ⬜（可选，大概率不做）
**是什么**：观察生成 handler 静默 typo（拼错属性不报错）发生率，低则不落地 tsgo 检查。
**测试用例**：统计近 10 次生成 handler 中 typo 出现次数；≥2 次才考虑落地检查。

### 14. 9b VLM 审美评审 ⬜
**是什么**：生成后截图送 VLM 评布局/配色，低分喂回重试一轮；不阻塞物化（建议性）。
**测试用例**：构造一个明显配色失衡的场景 → VLM 低分 → 触发一轮重试 → 产物改善或至少不劣化。

---

## 建议节奏

跑 **P8**（direct codegen e2e）→ 绿了 **1**（commit）→ **3/4**（报错定位+修一行闭环，direct 失败时用户能自救）→ **2**（exe）打包验全链路。5/6/7 顺手穿插。

### 已删除项（2026-09-07 direct 落地，冗余清理）

- ~~P7-0（17）单 agent vs 并行 A/B 对照~~：single/pertype 都删了，A/B 无意义。
- ~~P7-3（20）骨架预置~~：direct 若不截断就不需要；若截断再重启该项。
- ~~P7-4（21）渐进物化~~：direct 单次调用无「每路完成」概念。
- ~~P7-5（22）拆细 type~~：direct 单次调用，type 数不影响墙钟（只影响 output 量）。
- ~~P6-1（4）并行 per-type 拆分~~：pertype 删了，该项作废。
- ~~P6-4（13）triage→plan 合并~~ / ~~P6-5（12）plan→codegen 流式衔接~~：plan 删了，无合并/衔接对象。
- ~~⚡ plan JSON 截断抢救~~：plan 删了，无 plan JSON 截断问题。

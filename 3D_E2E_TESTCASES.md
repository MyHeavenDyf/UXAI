# 3D 页面端到端测试用例（线性流程版）

> **与 3D_CODEGEN_DESIGN.md §十五（矩阵分组版）互补，不删除。**
> 区别：§十五 按 op 类型分组、用例可独立跑；本份是**线性叙事**——一条从建会话到收尾的完整测试链，每步承接上一步的场景状态，前后逻辑对得上。
> 执行前置：三仓 dev 跑着（octoapp + 3d-templete workspace dev + opencode dev）；opencode 改过 prompt 已重启。
>
> **贯穿状态快照**（每步后场景应处的状态，是下一步"起始状态"的依据，也是 G2 验证锚点）：

| 步 | 后置状态（场景累计应有） |
|---|---|
| TC-01 | 仓库 v1：地面+四面墙+天花板+2排货架+货物+叉车(GLB)+吊灯；默认灯/默认背景/默认相机 |
| TC-02 | + 灯调亮 |
| TC-03 | + 背景灰 |
| TC-04 | + 镜头拉近 |
| TC-05 | 同 TC-04（验落盘，切走切回不丢） |
| TC-06 | − 天花板（其余全在，含灯亮/背景灰） |
| TC-07 | 墙→红（其余不变） |
| TC-08 | 第3货架→红（其余货架不变） |
| TC-09 | + 一列货架（原有不丢，含第3红货架） |
| TC-10 | 货架整体前移2米（不丢） |
| TC-11 | + 小车；**灯亮/背景灰/镜头近/墙红/第3货架红/多列货架 全保留**（G2 锚点） |
| TC-12 | 墙→蓝（提交不回退） |
| TC-13 | 叉车→变色（GLB paint，布局不丢） |
| TC-14 | 叉车位移（transform 落盘） |

> **2026-08-31 实证校准**（session ses_fa99ddcf3ffe04dScVEH4uqakO，drift 表见 `3D_CODEGEN_DESIGN.md` §十四 P0.1）：M-3① 场景级增量（TC-02~04）已验证增量 mutate、不 reload、不丢物体（forklift 全程 `[5,0,0]·1.57·1.2`）；edit_code/add_instance/set_type_transform（TC-06/07/09/10）场景级纹丝不动。**G2 锚点 TC-11 实证失败**（加小车后灯/背景/镜头全漂移，未修符合预期，待 G2 修复后重跑）。**编辑态寻址矩阵**（见 §十五）决定 TC-12~14 预期：单 material handler（墙）edit_code count=1 应过；多同色 handler（roof/lights）改色须语义 cid→SUB_OVERRIDES，part-N→edit_code count>1→failed（lights part-43 实证 ❌ P0.1-5）；forklift transform 单实例活项 ✅ / 整体 group 根死项 ❌（P0.1-4）。

---

## Phase 1 — 生成（冷启动基线）

### TC-01 生成仓库
- **起始状态**：空白新会话，无 3D 内容。
- **指令**：「一个带地面标线、四面墙体（大门+窗户）、钢结构屋顶、两排重型货架与货物箱、叉车和工业吊灯照明的室内仓库」（历史首版 v1 意图）。
- **预期**：右侧预览渲染完整仓库——地面标线 / 四面墙（含大门窗）/ 钢结构屋顶 / 两排重型货架 / 货物箱 / 叉车 / 工业吊灯全在；版本菜单出现 v1。
- **验证点**：基线存在性。
- **失败排查**：
  - 只显背景/空场景 → [[3d-first-create-blank-race]]（SCENE_UPDATE 双发，Embed lastRenderedJson 去重）。
  - 卡「执行中」超 240s → [[3d-commit-hang-startdev]]（startDev 端口探测兜底）。
  - 卡 stage=codegen 永不返回 → [[3d-codegen-stall-timeout]]（3min idle 兜底）。
  - 切走切回丢 → [[3d-scene-not-persisted]]（appendSceneVersion 兜底）。
  - 卡 stage=codegen 22min + 停止按钮毫无反应 → [[3d-codegen-stall-timeout]] P0.2（abort 检测被 isComplete 门控 + idle 只抓零增长；已修 `abortWait` 强制 reject）。

### TC-01b 生成中点停止（P0.2，stop 响应性）✅ 2026-08-31 验证通过（5s 内停、spinner 清、输入恢复）
- **起始状态**：空白新会话。
- **【提示词·复制输入】**：
```
一个带地面标线、四面墙、钢结构屋顶、两排重型货架与货物箱、叉车和工业吊灯的室内仓库
```
- **【UI 操作】**：提交后等控制台出现 `[scene_3d_codegen] ③ codegen 生成代码中…`（或 spinner 转起），**立即点工具栏「停止生成」按钮**。
- **预期**：≤5s spinner 停 + 输入框恢复可用 + 无 22min 挂起；控制台不再持续吐 `[scene_3d_codegen] 📝/💭` part。若仍转 / 按钮无反应 → P0.2 修法未生效，查 `abortWait` 是否被 `halt()` 调到。
- **验证点**：stop 能打断在途 codegen（不依赖 provider 是否真停流）。

---

## Phase 2 — 场景级增量（M-3 ①，set_light/set_camera/set_scene，**不 reload 不闪**）

> 本组关键：走 `onEnvMaterialize` 运行时 mutate，**不走 modify 全量重建**。判定核心是「物体不闪/不丢/编辑态不丢」，且每步叠加在上步状态上。

### TC-02 灯调亮 → set_light
- **起始状态**：TC-01 仓库（默认灯）。
- **指令**：「把灯调亮」。
- **预期**：灯光明显变亮；地面/墙/货架/叉车等所有物体**原位不变、不闪不重载**。
- **验证点**：P0-1；物体数量/位置不变（区别 modify 全量重建）。
- **失败排查**：
  - 右侧疯狂闪 → [[3d-preview-flash-reload]]（500ms→2000ms 止血；set_light 不该走 materializePatch）。
  - 灯没变（静默 no-op）→ triage 是否路由到 set_light？查 `parsePatchOps` 三 op 解析。

### TC-03 背景换灰 → set_scene
- **起始状态**：TC-02（灯已亮，仓库）。
- **指令**：「背景换成灰色」。
- **预期**：背景变灰；**灯仍亮**（TC-02 叠加保留）；物体不变。
- **验证点**：P0-2；场景级叠加生效（灯亮+背景灰共存）。

### TC-04 镜头拉近 → set_camera
- **起始状态**：TC-03（灯亮+背景灰）。
- **指令**：「把镜头拉近」。
- **预期**：视角拉近；**灯仍亮+背景仍灰**（TC-02/03 保留）；物体不变；OrbitControls target 同步。
- **验证点**：P0-3。

### TC-05 场景级落盘（切走切回）
- **起始状态**：TC-04（灯亮+背景灰+镜头近）。
- **操作**：切到别的会话/页面，再切回本 3D 会话。
- **预期**：灯亮 + 背景灰 + 镜头近**全部保留**；版本菜单 v 增 1（每次场景级 op 落盘）。
- **验证点**：P0-4；防 [[3d-scene-not-persisted]]。

---

### TC-05b 切历史生效性（P0.1-2）✅ 2026-08-31 验证通过（重启 desktop 后多切历史版本来回切，每次立即生效无需手刷）
- **起始状态**：已有 ≥3 个版本的会话（如 TC-01 生成 + TC-02/03 各改一步）。
- **【UI 操作】**：打开历史版本菜单 → 逐个点击 v1 / v2 / v3 → 每次等预览加载完再点下一个；**全程不手动刷新**。
- **预期**：每次点击后预览**立即变为所选版本**（切版本本身慢几秒属正常——switchVersion 要 materialize+startDev），无需手动刷新。时序 bug 是概率性的，多切几个来回。
- **验证点**：`startDev` 端口预检（waitForPortFree+killPortOccupant）关掉 probe 假 ready→stale bundle 窗口。
- **前置**：**重启 desktop app**（改的是主进程 ipc.ts，页面刷新不够）。

---

## Phase 3 — patch CRUD（§13，edit_code 主线 + set_instance/add_instance/set_type_transform）

> 本组走 `materializePatch`（overlay 改动 handler + vite reload）。每次改后验「只改变动处，其余原封不动」。

### TC-06 删天花板 → edit_code（删 group.add 行）
- **起始状态**：TC-05（灯亮+背景灰+镜头近+有天花板）。
- **指令**：「不要天花板」。
- **预期**：天花板消失；地面/墙/货架/叉车/吊灯**全在**；**灯亮+背景灰+镜头近保留**（TC-02~04 不受影响）。
- **验证点**：P0-6。
- **失败排查**：
  - 删不掉（静默 no-op）→ [[3d-patch-silent-noop]]：删单部件须走 edit_code 删 group.add 行（skip_instance 删单部件=无 SUB_SKIP 检查=静默 no-op）。
  - 删天花板连带丢其他 → [[3d-modify-incomplete-objects]]（union-merge 补回）。

### TC-07 墙改红 → edit_code（改 color 字面量）
- **起始状态**：TC-06（无天花板、墙默认色）。
- **指令**：「墙改为红色」。
- **预期**：墙变红；其他全在；灯亮/背景灰/镜头近保留。
- **验证点**：P0-6。
- **失败排查**：改墙丢其他物体 → [[3d-modify-incomplete-objects]]。

### TC-08 第3立柱变红 → set_instance（gap① 循环 cid，寻址矩阵）
- **起始状态**：TC-07（墙红、货架默认色）。
- **指令**：「把第3根货架立柱变红」。
- **预期**：**仅 `wh-racks-1-upright-2` 红**，其余立柱/横梁/货物箱不变；墙仍红；其他不变。
- **验证点**：P0-7；gap① 循环 cid 抽取（RE_LOOP_TMPL 枚举 upright-0..N 进候选）。
- **寻址矩阵关键**：racks 多同色（橙立柱×54），**edit_code patchHandlerMaterialColor 会 count>1→failed**，故此例**必须走 SUB_OVERRIDES 语义 cid**（picker 须返回 `upright-2` 非 part-N）。若全变红=走了 edit_code 改循环字面量（够不着单个）。
- **失败排查**：全变红 → [[3d-patch-silent-noop]] gap①（须 set_instance 单实例补丁）；候选无 upright-2 → RE_LOOP_TMPL 未枚举。
- **旁例（P0.1-3 ✅已修，e2e 待跑 TC-B4b）**：「把第一个集装箱变红」→ **预期走 set_instance 改 `racks-1-box-0` 不降级 modify**（只第一个 box 变红，场景级不漂移）。**根因（2026-09-01 源码实证，第三修）**：集装箱=racks handler 内部 box（cid `${node.id}-box-${xi++}`，v7 有非漏画非 bake），但 `RE_LOOP_TMPL` 正则 `(\w+)` 认不出 `xi++` → box 候选全失配（upright `ui++`/beam `bi++` 同失配）→ triage 无 box 候选 → set_instance 无候选 → 降级 modify 全量重写。**修法**：正则 `(\w+)`→`(\w+\+*\??)` + `resolveCounterLoopCount`（box=288 候选）+ triage 语义映射（集装箱=box）+ `searchHandlerForSynonymCid` 同义词兜底。node 实证正则抽 3 个 + count 推断正确。

### TC-09 加一列货架 → add_instance
- **起始状态**：TC-08（第3货架红）。
- **指令**：「再加一列货架」。
- **预期**：新增一列货架；**原货架（含第3红货架）不丢**；墙仍红。
- **验证点**：P0-8。
- **失败排查**：加货架丢原有 → [[3d-modify-objects-lost]]（modify 分区 merge 须 REPLACE 非 UNION）。

### TC-10 整体前移 → set_type_transform
- **起始状态**：TC-09（多一列货架、第3红货架）。
- **指令**：「把所有货架往前移2米」。
- **预期**：所有货架前移2米；不丢；第3货架仍红；墙仍红。
- **验证点**：P0-9。
- **失败排查**：整物移动误路由到部件 → [[3d-patch-silent-noop]]（set_type_transform 改 live-data params）。

---

## Phase 4 — modify 保真（D3 + G1 + G2，历史 v8「加小车丢叉车」实证）

> **核心组**。一次「加小车」操作拆三层独立判定，因为 D3 在历史 case 已工作（其他 type 没丢）但 G1/G2 失败，三层须分开验。
> **G2 锚点**：本步后，TC-02 调亮的灯、TC-03 换的灰背景、TC-04 的镜头近、TC-07 的墙红、TC-08 的第3货架红、TC-09 的多列货架——**应全部保留**。若任一被改回默认= G2 失败（modify 全量重写 live-data 顺手改了场景级保留键）。

### TC-11 加小车（modify）— 三层判定
- **起始状态**：TC-10（无天花板 / 墙红 / 第3货架红 / 多列货架 / 前移 / 灯亮 / 背景灰 / 镜头近 / 叉车 GLB）。
- **指令**：「仓库场景在原有叉车旁新增一辆小型手推平板小车（橙色车身+四个黑轮+推杆），与叉车并排停放在主通道内」（历史 v8 意图）。
- **预期**：
  - **D3 文件层（P0-11）**：地面/墙/天花板（已删）/货架/叉车**全在**（不只新增小车）；vite console 无 TS2307/404（index.ts import 的所有 type handler 文件都在 codeDir）。
  - **G1 handler 内部（P1-G1）**：原叉车仍是 hunyuan GLB（`ctx.loadModel('hunyuan:低面数仓库叉车，黄色')` 调用保留），**不退化成简陋 BoxGeometry**；新小车按指令渲染。
  - **G2 场景级不漂移（P1-G2）**：camera position / lights intensity / scene background **不变**——即 TC-02 灯亮 / TC-03 背景灰 / TC-04 镜头近 **全保留**；墙仍红 / 第3货架仍红 / 多列货架仍在。
- **验证点**：P0-11 + P1-G1 + P1-G2。
- **失败排查**：
  - 原叉车消失或变简陋体 → G1（codegen prompt 未约束 verbatim 照抄 `ctx.loadModel`）。
  - 灯变暗/背景变回/镜头变远 → G2（modify 物化后 host 未 merge 回原 live-data 场景级保留键）。
  - 其他 type 物体全丢 + vite 报 TS2307 → D3（host 端 loadCurrentCode + step 6c merge 漏补）。
  - 历史实证 diff：v7→v8 `forklift.ts` 丢 `ctx.loadModel`（G1）；`live-data.json` camera `[0,18,32]→[14,10,16]` + lights 改 + 加 hemisphere（G2）。
- **2026-08-31 实证（ses_fa99ddcf3ffe04dScVEH4uqakO，drift 表见 §十四 P0.1）**：**G1 ✅** 叉车仍 hunyuan GLB（forklift.ts:123 `ctx.loadModel` 保留，未退化）；**D3 ✅** 其他 type 不丢；**G2 ❌ 确认失败**——v9→v10 加小车 bg `#808080→#b8c4cc`、env `0.15→0.7`、cam `[26,18,-24]→[10,7,13]`、lights `0.12/0.1/0.15→0.55/0.4/1.1` 全漂移；v10→v11 加第二叉车 forklift transform 丢失（`[5,0,0]·1.57·1.2→[0,0,0]·无·无`）。**✅ G2 修法已落地（2026-09-01，6d 步骤：modify 时 host 端 merge camera/lights/scene 保留键回 sceneData + live-data.json 两处，完整覆盖非字段级 merge；UXAI tsgo EXIT=0 + oxlint 0 error，e2e 待跑本步 G2 三层判定）**。注：v10→v11 forklift transform 丢失属 G1/handler 重写范畴（6d 只治 env 三键不治 transform，transform 保真靠 G1 codegen prompt 约束照抄 + 6c handler merge）。

---

## Phase 5 — 编辑态落盘（M-1a 材质 / M-1b transform / GLB 改色）

### TC-12 编辑态改色三例（M-1a，寻址矩阵决定预期）
> 三例覆盖三种寻址路径，分开判定。起始状态均为 TC-11（含小车）。
- **TC-12a 墙色提交（part-N→edit_code，单 material）**：编辑态 → 点墙子 mesh → 改蓝 → 提交 → 墙蓝不回退。walls handler 单 material `0xd2d5d9`（count=1）→ `patchHandlerMaterialColor` 命中应过。P0-12；防 [[3d-edit-submit-color-revert]]；不卡「提交中」[[3d-commit-hang-startdev]]；提交后疯狂闪 → [[3d-preview-flash-reload]]（2000ms 止血）。
- **TC-12b roof truss-top 改色（语义 cid→SUB_OVERRIDES，活项）✅ 实证**：编辑态 → 选 `wh-roof-1-truss-2-top`（语义 cid）→ 改色 → 提交 → 生效。steel_roof.ts SUB_OVERRIDES 落 `#4d98f5`，单 Mesh applyOverride material 命中。**多同色 0x5f6e80 走 edit_code 会 count>1→failed，故此例必须语义 cid**。
- **TC-12c lights part-43 改色（part-N，改错部件+全变）❌ P0.1-5 待修**：编辑态 → 选 `wh-lights-1-part-43`（第15盏 shade，part-N）→ 改色 → 提交 → **改错部件（杆变色非罩）+15 杆全变**。**根因（2026-08-31 二修）**：makeLamp() 函数体每颜色字面量各 1 次（杆 0x41b6f1/罩 0x37474f/泡 0xfffbe8），patchHandlerMaterialColor 取**首匹配=杆**，count=1 成功→改错部件+全变（非 count>1 failed）。真根因=组内子 mesh 无语义 __id+applyOverride（只灯组盖）→ picker 返回 part-N → commit 无法定位子部件只能取首匹配。**修=组内子 mesh 盖语义 `__id`（`${cid}-rod/shade/bulb`）+ applyOverride**（codegen prompt 补规则）→ picker 语义 cid → SUB_OVERRIDES 单子 mesh 生效，UXAI host 零改动。**✅ 修法已落地（A+B，2026-08-31）**：A patch-handler 多异色 skip（host 护现有）+ B HANDLER_CONTRACT 规则 3/codegen Constraints 3 补子 mesh __id 规则（prompt 根治新生成）；oxlint 0 new + tsgo 0；e2e 待跑。**修前作 P0.1-5 回归锚点**。

### TC-13 GLB 改色（叉车 paint traverse）
- **起始状态**：TC-12（含小车）。
- **操作**：编辑态 → 选叉车（hunyuan GLB，材质在内部子 mesh）→ 改色 → 提交。
- **预期**：叉车变色（edit_code 加 paint traverse 函数）；**布局不丢**（paint 只改材质不改 group.add 布局）。
- **验证点**：P0-10。
- **失败排查**：改色够不着 → [[3d-patch-silent-noop]] GLB 改色（applyOverride 不 traverse GLB Group，须 edit_code 加 paint）。

### TC-14 transform 落盘（M-1b，拆单实例/整体，P0.1-4）
> **2026-08-31 实证**：forklift.ts 只在 `spawnForklift`(:137) 内对实例 cid 调 applyOverride，**从不对 group 根调** → 整体 transform 写 SUB_OVERRIDES[group 根]=死项。末版实证两 key：group 根 [2.8,0.2,0]=死、实例 [4,0,-1]=活。
- **TC-14a 单实例 transform ✅ 实证**：编辑态 → 选单台叉车 `wh-forklift-1-forklift-0`（实例 cid）→ 拖动 → 提交 → 落盘生效（切走切回在新位置）。spawnForklift applyOverride 命中活项。
- **TC-14b 整体 transform ✅ e2e 验证通过（P0.1-4，2026-08-31）**：编辑态 → 选整台叉车 group 根 `wh-forklift-1` → 拖动 → 提交 → **✅ 验证生效**（提交后叉车移到新位置，切走切回保留）。根因（已修）：group 根无 applyOverride 调用点→SUB_OVERRIDES[group 根]死项。**修法（commit-edits.ts）**：group 根（`__id===node.id`）transform 改写 live-data `node.params`（同 set_type_transform），不走 SUB_OVERRIDES 死项；merged 经 onCodeVersionReady 落盘 + reload，handler 重读 `opts.position` 生效。oxlint 0 + tsgo 0。
- **验证点**：M-1b + P0.1-4。

---

## Phase 6 — 历史 bug 回归（基于前面场景）

### TC-15 改名 / 删物不重复不残留
- **起始状态**：TC-14。
- **指令**：「把叉车改名为运输车」然后「删掉小车」。
- **预期**：改名不产生重复物体；删小车真删掉（不留空 group）。
- **验证点**：防 [[3d-modify-objects-lost]]（element_id 漂移重映射 + modify 分区 REPLACE）。

### TC-16「无论输入都重建」hasScene 门控
- **起始状态**：TC-15（已有场景）。
- **操作**：连续两次小改（如「墙再暗一点」→「地板加一条线」）。
- **预期**：两次都走 patch/modify 路径（hasScene=true），**不走 create 重建**。
- **验证点**：防 [[3d-patch-silent-noop]]（patch 前置总闸 hasScene 同步）。

### TC-17 workspace 互踩（需双会话）
- **起始状态**：另开第二个 3D 会话。
- **操作**：会话 A 切版本 → 会话 B 也切版本（抢占 workspace dev）。
- **预期**：被接管方显示「被另一会话接管 [恢复]」横幅；点恢复能重新 acquire + switchVersion 回当前版本。
- **验证点**：防 [[3d-workspace-ownership]]。

---

## Phase 7 — 9a 门控（构造失败，独立不依赖主线）

### TC-18 缺 type 失败 → P0-13
- **构造**：让 modify 输出漏一个 type handler（index.ts import 缺文件）。
- **预期**：门控完整性检查失败，**不物化**，失败卡片可重试。

### TC-19 tsc 错失败 → P0-14
- **构造**：handler 有 TS 类型错（如拼错类型名）。
- **预期**：tsc 检查失败、不物化。

### TC-20 console 错失败 → P0-15
- **构造**：handler 运行时抛错（如访问 undefined）。
- **预期**：SCENE_CONSOLE_ERROR 捕获、失败卡片。

### TC-21 重试喂回 → P0-16
- **操作**：TC-18~20 任一失败后修正重试。
- **预期**：重试成功物化。

---

## Phase 8 — 性能（可选）

### TC-22 plan 加速
- **指令**：生成「机房」场景（[[3d-codegen-plan]] Step8① 静态注入）。
- **预期**：plan 阶段 ~7s（历史 11:35→7s）。

### TC-23 不 stall
- **构造**：LLM 流式 stall（断网/慢模型）。
- **预期**：3min idle 超时兜底→失败卡片可重试（[[3d-codegen-stall-timeout]]）。

---

## 执行记录表

| 步 | 指令摘要 | 通过? | 对应 todo | 备注 |
|---|---|---|---|---|
| TC-01 | 生成仓库 | ✅ | — | v1 基线；forklift [5,0,0]·1.57·1.2 |
| TC-01b | 生成中点停止 | ✅ | P0.2 | 2026-08-31 验证：code 中点停止 5s 内 spinner 清、输入恢复、无 22min 挂（abortWait 强制 reject） |
| TC-02 | 灯调暗(夜晚) | ✅ | P0-1 | v3 set_light 增量 mutate，cam/物不变（实测调暗非调亮，同 set_light 路径） |
| TC-03 | 背景换灰 | ✅ | P0-2 | v4 set_scene，留 v3 灯 |
| TC-04 | 镜头拉远 | ✅ | P0-3 | v5 set_camera，留 v3灯+v4bg（实测拉远非拉近，同 set_camera） |
| TC-05 | 切走切回 | ⬜ | P0-4 | 未直接测；每版落盘已证 persist，切历史时序见 P0.1-2 |
| TC-05b | 切历史生效性 | ✅ | P0.1-2 | 2026-08-31 验证通过：重启 desktop 后多切历史版本来回切，每次立即生效无需手刷（ipc.ts 端口预检+孤儿强杀） |
| TC-06 | 删天花板 | ✅ | P0-6 | v2 edit_code 生效、场景级不变；原闪 5-6 次（P0.1-1 ✅已修+e2e验证 2026-09-01，现只闪 1 次） |
| TC-07 | 墙透明(非改红) | ⚠️ | P0-6 | v6 edit_code 生效、场景级不变；实测「墙透明」非「墙改红」，同 edit_code 路径 |
| TC-08 | 集装箱变红 | ✅ | P0-7/P0.1-3 | ✅已修+e2e验证通过(2026-09-01)：根因=RE_LOOP_TMPL `(\w+)` 认不出 `xi++`→box 候选全失配→降级 modify；修=正则+resolveCounterLoopCount+triage 语义映射+同义词兜底；TC-B4b 走 set_instance 改 box-0 不降级 modify 场景级不漂移 |
| TC-09 | 加一列货架 | ✅ | P0-8 | v7 add_instance，场景级不变；集装箱在 racks handler 内部 box 循环（非独立 type） |
| TC-10 | 整体前移 | ✅ | P0-9 | v9 set_type_transform 生效、从 v7 分支；原闪很多次（P0.1-1 ✅已修+e2e验证 2026-09-01，现只闪 1 次） |
| TC-11 | 加小车(D3/G1/G2) | ✅✅⏳修后待跑 | P0-11+P1-G1+P1-G2 | v10：D3 ✅ 不丢 type / G1 ✅ 叉车仍 hunyuan GLB / G2 ❌ 场景级全漂移 → **✅已修(2026-09-01,6d 步骤 modify 时 merge camera/lights/scene 保留键)** |
| TC-12a | 墙色提交 | ⬜ | P0-12 | 未直接测；walls 单 material count=1，预期应过 |
| TC-12b | roof truss-top 改色 | ✅ | P0-12 | 实证 SUB_OVERRIDES 语义 cid 活项（#4d98f5 落盘） |
| TC-12c | lights part-43 改色 | ✅ | P0.1-5 | 实证**改错部件+全变**（杆非罩，makeLamp 字面量各 1 次→patchHandlerMaterialColor 取首匹配=杆 count=1 成功）；真根因=组内子 mesh 无语义 __id+applyOverride；**修法已落地 A+B + e2e 验证通过 2026-08-31**（host 多异色 skip + codegen prompt 补子 mesh __id 规则；重生场景选灯罩改色提交→单灯罩变、不串不全变） |
| TC-13 | GLB 改色 | ⬜ | P0-10 | 未明确测；forklift 仍 GLB（G1 ✅）但改色未验 |
| TC-14a | 单实例 transform | ✅ | M-1b | 实证 forklift-0 实例 cid 活项（[4,0,-1] 落盘）；原闪很多次（P0.1-1 ✅已修+e2e验证 2026-09-01，现只闪 1 次） |
| TC-14b | 整体 transform | ✅ | P0.1-4 | 实证 group 根死项（[2.8,0.2,0] 未生效）→ **修法已落地 + e2e 验证通过 2026-08-31**（commit-edits group 根 transform 走 live-data params，提交生效切走切回保留） |
| TC-15 | 改名/删物 | ⬜ | — | 未测 |
| TC-16 | 不重建门控 | ⬜ | — | 未测 |
| TC-17 | workspace 互踩 | ⬜ | — | 未测 |
| TC-18~21 | 9a 门控 | ⬜⬜⬜⬜ | P0-13~16 | 未测 |
| TC-22~23 | 性能 | ⬜⬜ | — | 未测 |

> **2026-08-31 首跑小结**（跑的是 §十五 矩阵版，本线性表按 session 映射回填）：通过 7（TC-01/02/03/04/09 + TC-12b/14a）⚠️ 部分 4（TC-06/07/10 闪 + TC-11 G2）❌ 失败 3（~~TC-08 集装箱重写~~ ✅已修+e2e验证 2026-09-01 / ~~TC-12c 灯改色~~ ✅已修+验证 2026-08-31 / ~~TC-14b 整体 transform~~ ✅已修+验证 2026-08-31）。根因全取证见 §十四 P0.1。修复优先级：~~P0.1-4（group 根死项）~~ ✅ → ~~P0.1-5（多同色改色）~~ ✅已修+e2e验证 → ~~**P0.2 stop 无响应**（TC-01b 新增，abortWait 强制 reject）~~ ✅已修+e2e验证 2026-08-31 → ~~**P0.1-2（切历史）**~~ ✅已修+e2e验证 2026-08-31（TC-05b）→ ~~**P0.1-1（闪烁根治）**~~ ✅已修+e2e验证 2026-09-01（单一重载源，TC-06/10/14a 各只闪 1 次）→ ~~**P0.1-3（非一等实例）**~~ ✅已修+e2e验证通过 2026-09-01（正则 `(\w+)`→`(\w+\+*\??)` 认 xi++ + resolveCounterLoopCount 嵌套 for-of 上界 + triage 语义映射 集装箱=box + searchHandlerForSynonymCid 同义词兜底；TC-B4b 走 set_instance 改 box-0 不降级 modify 场景级不漂移）。**P0.1 全系修完+e2e验证通过**。~~下一步 P1-G2（modify 场景级 merge，TC-11 锚点）~~ → **✅ P1-G2 修法已落地 2026-09-01**（6d 步骤：modify 时 host 端 merge camera/lights/scene 保留键回 sceneData + live-data.json 两处，完整覆盖非字段级 merge；镜像 6c handler merge 范式；UXAI tsgo EXIT=0 + oxlint 0 error，e2e 待跑 TC-11 G2 三层判定）。

# 3D 待办清单（活跃版）

> **唯一权威清单**：只列**还没做**的项，每项自带「是什么 + 测试用例」，看这一个文件就够。
> **新问题/新需求进来**：反馈给 Claude → 取证/评估 → 自动写入本清单（自评优先级，允许插队），同样自带说明+用例。完成一项打勾。
> 优先级判据：堵主流程/丢数据=🔴｜体感痛点=🟠｜低频遗留=🟡｜结构/功能补全=🟢｜大工程/外部依赖=⚪
>
> 完整全流程回归用例（开发完成后**交付测试团队**用）：[3D_E2E_TESTCASES.md](3D_E2E_TESTCASES.md)
> 已修项的根因取证归档：[3D_CODEGEN_DESIGN.md §十四](3D_CODEGEN_DESIGN.md)
> 最后更新：2026-09-04。

---

## 🔴 第一梯队 — e2e 收尾（现在就能跑）

### ⚡ plan JSON 截断抢救（已修，并入第 1 项 e2e 一起验证）⬜
**是什么**：GLM-V5_1 偶发 finish=stop 但正文 plan JSON 写到 camera 之后停（reasoning 占比大挤压输出），`scene_3d_plan` 正常分支只用 `extractJson`——绝地求生只认「完整闭合对象」，截断时返回最后一个闭合的相机内层碎片（key=[type,position,lookAt,perspective]，丢 types）→ 失败卡片「types 未覆盖分诊清单」。（旧代码只有 error 分支有 `extractJsonFromTruncated` 抢救，正常分支漏。）已修：正常分支 extractJson 出 null/碎片时追加截断抢救（补未闭合括号救外层壳 + safeEnd 回退掉不完整尾部），types 完整则继续；camera/lights/scene 残缺由 assemblePlan/merge 默认值兜底。prompt 加约束 6：types 优先完整输出、camera/lights/scene 放最后写。
**测试用例**：生成含 4+ type 的场景（仓库/操场同类），plan 阶段若输出中断**不再弹「types 未覆盖」失败卡片**——场景正常物化（types 完整，camera 缺省走默认）。日志见 `[scene_3d_plan] 正文 JSON 截断…继续流水线`。

### 1. 全清回归 + P1.5 组件 new 验证（合并跑一次）✅
**是什么**：孤儿 8-agent 全清后唯一收口；P1.5 组件统一（barrel import + 直接 new）只差这组 e2e。须**重启 opencode**（模板/注册变更要进程重启生效）。
**测试用例**（五步 + 组件专项）：
1. 新会话「一个大型物流仓库内部场景」→ 三卡片（需求分析→选型规划→代码生成）顺序出现、场景渲染；无 agent not found 报错、无 {占位符} 裸露
2. 同会话「加几台显示器」（modify）→ 只重写受影响 type、其他物体不丢、相机灯光背景不漂移
3. 「把墙改成蓝色」（patch）→ 走 edit_code 改 color 字面量，不整场景重写
4. 切别的会话再切回 → 场景恢复、卡片正常；旧 8-agent 时代 session 切回不弹暂停确认 UI、不崩
5. 组件专项（P1.5）：生成场景用库组件（墙/形状）直接 `new` 渲染正常；含纹理组件（HeatMap）和材质组件（MeshReflector）不白屏；`InstancedMesh2` 位置参数正确；带 update() 的组件动画跑起来
**验证结论（09-04，ses_f9563390）**：五步 + 组件专项全跑通（create 仓库 / modify 加叉车·删天花板·加热力图 / patch 墙色·背景 / 切走切回 / GLB 改色确认）。第 3 步「墙改蓝」暴露 Wall 组件 `hole` 漏 `segment` → 构造抛异常走 fallback 灰墙致改色失效，已在 3d-components `Wall.ts` 治本（`segment` 非法仅跳过挖洞、不再整墙 fallback）。⚡ plan 截断抢救未压到（本次 create 未截断），留待多 type 场景。
**绿了才能**：commit（第 2 项）。

### 2. 三仓 commit ✅
**是什么**：dev_cyc1 堆着 P1.5 + 全清 + P0.4~P0.10 约 40+ 文件未提交，e2e 绿后一次提交（含 3d-templete / 3d-components）。
**测试用例**：无（git 层操作；提交前跑 tsgo/oxlint 双包 0 error 即可）。
**结论（09-04）**：已提交并 push（3d-components `e287dfb` / 3d-templete `23dd6f7` / UXAI `f89cb51c6`）。UXAI push 前 turbo typecheck 12/12 通过（tsgo 0 error）；3d-components / 3d-templete lint-staged eslint 通过。

### 3. 打包 exe 内 3D 全链路 ⬜
**是什么**：`release.ts --win --channel dev` 打 exe，验 3D 全链路。exe 是最终分发形态，这条不绿都是 dev 自嗨。
**测试用例**：exe 里新会话生成场景 → 渲染 → modify 一版 → patch 一版 → 切历史 → 导出工程 zip，全链路与 dev 环境一致。白屏查 extraResources .3d-dist 是否进包。
**建议**：等 P6-1 完一起打包，一次覆盖两个节点。

## 🟠 第二梯队 — 性能（体感最强）

### 4. P6-1 codegen 并行 per-type 拆分 ⬜
**是什么**：plan 后按 type 拆 N 个并行 child 各写自己的 handler，host 合并 index.ts。实测 codegen 250-793s 是最大瓶颈，预期 **7-13min → ~2min**。
**风险**：index 合并竞态（D3 兜底已有）；type 间依赖（rack 依赖 room 尺寸 → plan JSON 全量注入每路）。
**测试用例**：
1. 生成 7-type 场景（如园区）→ 会话列表可见 N 个并行 child，墙钟 ≈ 最慢一路 + plan（目标 ~2min）
2. 回归：加小车（modify 单 type 重写，其他 type 不丢）；构造语法错 → scoped 自愈（只重输出出错文件）在并行路下仍成立

## 🟡 第三梯队 — 遗留 bug（低频，只差验证/收尾）

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

## ⚪ 第五梯队 — 大工程/外部依赖（推后）

### 11. M-4 数据驱动 handler ⬜
**是什么**：数量/尺寸进 params、handler 不重写——**根治** modify 保真 G1/G2 + 加删实例丢物体。大工程。
**测试用例**：「货架从 3 排加到 5 排」「集装箱数量翻倍」→ 只改 live-data params，handler 源码不变、无场景级漂移、无物体丢失。

### 12. P6-5 plan→codegen 流式衔接 ⬜
**是什么**：plan 流式吐 types[] 即启动 codegen，衔接 gap 归零，再省 1-7min；流式 JSON 解析复杂。
**测试用例**：生成场景观察 plan 未结束 codegen 已启动；最终产物完整性与串行版一致。

### 13. P6-4 triage→plan 合并（Step8②）⬜
**是什么**：单 agent 完成 routing+选型，省 12-39s，收益最小；plan prompt 膨胀风险。
**测试用例**：create/modify/patch 三路由行为与现 triage 一致（同第 1 项用例步骤 1-3）。

### 14. 9b VLM 审美评审 ⬜
**是什么**：生成后截图送 VLM 评布局/配色，低分喂回重试一轮；不阻塞物化（建议性）。
**测试用例**：构造一个明显配色失衡的场景 → VLM 低分 → 触发一轮重试 → 产物改善或至少不劣化。

### 15. 混元真实密钥验证 ⬜（等密钥）
**是什么**：.env.local 配真实密钥验 Step5 GLB 生成；顺带定 adm-zip 去留（返回 zip 还是 GLB）。
**测试用例**：生成含「用混元生成一个风机模型」的场景 → GLB 真实下载渲染成功。

### 16. P1.6 静默 typo 评估 ⬜（可选，大概率不做）
**是什么**：观察生成 handler 静默 typo（拼错属性不报错）发生率，低则不落地 tsgo 检查。
**测试用例**：统计近 10 次生成 handler 中 typo 出现次数；≥2 次才考虑落地检查。

---

## 建议节奏

跑 **1**（一次 e2e）→ 绿了 **2**（commit）→ 开工 **4**（P6-1，唯一值得马上投的性能项）→ **3**（exe）等 P6-1 完一起打包验。5/6/7 顺手穿插。

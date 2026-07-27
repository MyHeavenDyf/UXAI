# Dev 分支提交汇总

**统计范围**：从 `5a436bd71e09bf10d135e0b6dbb1b37b77fef318` 之后到 `origin/dev`（HEAD: `bebe8cdb1`）

**提交总数**：40 个

**时间跨度**：2026-06-10 ~ 2026-06-11

---

## 一、提交清单（按时间倒序）

### 2026-06-11

| Commit | 提交人 | 简要内容 |
|--------|--------|---------|
| `bebe8cdb1` | MyHeavenDyf | Merge PR #91 (dev_yfy) |
| `0e94fe310` | MyHeavenDyf | Merge PR #89 (dev_wenkai) |
| `18e8f7cbf` | yuanfayu | fix(insight): 侧栏对话收起后底部技能库/资产库/设置不再上移 |
| `ec47c8fe0` | yuanfayu | merge dev 到 dev_yfy |
| `9dcaae5ee` | MyHeavenDyf | Merge PR #90 (dev_dyf) |
| `0bdaf5f5c` | MyHeavenDyf | fix(mcp): 修复重连期间 tools() 阻塞 + tool 执行健壮化 |
| `3a8dd80f0` | Kevin199802 | fix(insight): 修复 agent prompt 误追问业务上下文 + 补全空文件引导 |
| `b72f01293` | MyHeavenDyf | Merge PR #88 (dev_wenkai) |
| `71140bc8f` | Kevin199802 | feat(insight): debug-observer 阶段2/3 + 剪贴板走主进程 |
| `285dc1c76` | MyHeavenDyf | merge origin/dev 到 dev_dyf |
| `d80a76358` | MyHeavenDyf | Merge PR #87 (dev_dyf) |
| `8e5e2e96c` | MyHeavenDyf | make 权限修改 |
| `1e64afacb` | MyHeavenDyf | Merge PR #85 (dev_wenkai) |
| `7adb96ea0` | yuanfayu | fix(insight): 切换会话时清空输入框草稿 |
| `07c838653` | ljc | merge dev_zf 到 dev |
| `c87b1751e` | yuanfayu | fix(insight): 拖拽上传仅接受 OS 外部文件，拦截应用内/网页图片误传 |
| `4424ee414` | ljc | fix(studio): 关闭最后一个 canvas tab 后生成时闪显旧内容 + details 同步隐藏 |
| `d1defda55` | ljc | merge origin/dev 到 dev_zf |
| `8b23a1c9e` | ljc | fix(studio): auto-add effect 导致新结果 tab 无法关闭 |
| `a4abe7790` | Kevin199802 | feat(env): 多环境构建配置体系 |
| `68b4e5d6a` | ljc | fix(studio): 切换 session 后 canvas 自动显示 + thumb 点击创建 tab 修复 |

### 2026-06-10

| Commit | 提交人 | 简要内容 |
|--------|--------|---------|
| `a10b7a6e9` | MyHeavenDyf | Merge PR #84 (dev_dyf) |
| `b9ac4debe` | MyHeavenDyf | fix(app): 修复 API Key 弹框提交后主页面报错 |
| `4a7b7fc65` | MyHeavenDyf | Merge PR #83 (dev_zf) |
| `dfdd7be53` | ljc | merge origin/dev 到 dev_zf |
| `485612df5` | ljc | fix(studio): tab 标签名称从 prompt 提取关键词 + 关闭后显示 empty 状态 |
| `53634a9cc` | MyHeavenDyf | Merge PR #82 (dev_wenkai) |
| `1e1c7a4d4` | MyHeavenDyf | Merge PR #81 (dev_djl) |
| `d27a78124` | Kevin199802 | feat(insight): debug-observer 阶段1 — SSE 事件观测 + octoDebug 控制台 API |
| `17c11d989` | ljc | fix(studio): 鉴权接口修改 |
| `dcc43b791` | MyHeavenDyf | Merge PR #76 (dev_mfn) |
| `caf1e6d4b` | MyHeavenDyf | Merge PR #79 (dev_zf) |
| `df5c0dc76` | MyHeavenDyf | Merge PR #80 (dev_yfy) |
| `d0af80094` | ljc | fix(studio): 合并冲突解决 + 恢复 stash 的 tab/删除/可见性修复 |
| `ac2905f68` | ljc | merge dev |
| `85f13ed41` | ljc | fix(studio): 鉴权接口添加 |
| `f9619fa57` | ljc | fix(studio): 细节问题修复 |
| `909445ba3` | moyuntian | 修改样式 |
| `8308bd4d5` | Kevin199802 | fix(ui): 修复 retry 状态重试卡多轮重复显示问题 |
| `fae1f04ca` | Kevin199802 | fix(ui): reasoning-only 回复时自动展开思维链 |

---

## 二、按提交人统计

| 提交人 | 提交数 | 主要内容 |
|--------|--------|---------|
| **MyHeavenDyf** | 17 | PR 合并 + make 权限修改 + MCP 重连修复 + API Key 弹框修复 |
| **ljc** | 13 | studio 模块：canvas tab 管理、鉴权接口、tab 标签等 |
| **Kevin199802** | 6 | insight debug-observer（3 个阶段）+ UI 修复 + 多环境构建 |
| **yuanfayu** | 3 | insight 侧栏/拖拽上传/输入框草稿 |
| **moyuntian** | 1 | 样式修改 |

---

## 三、主要功能模块

### 1. Studio 模块（ljc 主导）

- canvas tab 管理修复：切换 session 自动显示、thumb 点击创建 tab、tab 关闭与可见性
- 鉴权接口接入与修改
- tab 标签名称从 prompt 提取关键词
- 关闭最后一个 canvas tab 后生成时闪显旧内容修复
- auto-add effect 导致新结果 tab 无法关闭修复

### 2. Insight 模块（Kevin199802 + yuanfayu）

- **debug-observer 体系**（3 个阶段）：
  - 阶段 1：SSE 事件观测 + octoDebug 控制台 API
  - 阶段 2/3：剪贴板走主进程
- agent prompt 修复：误追问业务上下文 + 补全空文件引导
- 侧栏对话收起后底部布局修复
- 拖拽上传仅接受 OS 外部文件，拦截应用内/网页图片误传
- 切换会话时清空输入框草稿

### 3. MCP 模块（MyHeavenDyf）

- 重连期间 `tools()` 阻塞修复
- tool 执行健壮化

### 4. Agent 权限（MyHeavenDyf）

- octo_make agent 工具权限精简（仅允许 bash, read, glob, grep, task, webfetch, skill, question）

### 5. UI 通用修复

- retry 状态重试卡多轮重复显示修复（Kevin199802）
- reasoning-only 回复时自动展开思维链（Kevin199802）
- API Key 弹框提交后主页面报错修复（MyHeavenDyf）

### 6. 环境配置

- 多环境构建配置体系（Kevin199802）
- `.env.example` 桌面端配置模板

---

## 四、合并的 PR 列表

| PR | 来源分支 | 合并人 | 日期 |
|----|---------|--------|------|
| #76 | dev_mfn | MyHeavenDyf | 2026-06-10 |
| #79 | dev_zf | MyHeavenDyf | 2026-06-10 |
| #80 | dev_yfy | MyHeavenDyf | 2026-06-10 |
| #81 | dev_djl | MyHeavenDyf | 2026-06-10 |
| #82 | dev_wenkai | MyHeavenDyf | 2026-06-10 |
| #83 | dev_zf | MyHeavenDyf | 2026-06-10 |
| #84 | dev_dyf | MyHeavenDyf | 2026-06-10 |
| #85 | dev_wenkai | MyHeavenDyf | 2026-06-11 |
| #87 | dev_dyf | MyHeavenDyf | 2026-06-11 |
| #88 | dev_wenkai | MyHeavenDyf | 2026-06-11 |
| #89 | dev_wenkai | MyHeavenDyf | 2026-06-11 |
| #90 | dev_dyf | MyHeavenDyf | 2026-06-11 |
| #91 | dev_yfy | MyHeavenDyf | 2026-06-11 |

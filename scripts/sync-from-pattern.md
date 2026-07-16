# dev_pattern → 3D 页面 同步执行流程

> 每次需要把 dev_pattern 新改动同步到 3D 页面时，按本流程执行。
> 机制详见 `3D_PAGE_DESIGN.md` §4。状态文件：`3D_SYNC_STATE.yaml`。
> 适用边界：仅限 octoapp 工程内 `pages/3d/` 与 pattern 改动；单向吸收，不反向推回。

## 执行步骤

1. **取游标**
   - 读 `3D_SYNC_STATE.yaml` 的 `last_synced_commit`，记为 BASE。
   - 读 `sync_round`（当前轮次 N）。

2. **列改动**
   ```bash
   git fetch origin dev_pattern
   git log BASE..origin/dev_pattern --oneline -- packages/app/octoapp/pages/pattern
   git diff --name-only BASE..origin/dev_pattern -- packages/app/octoapp/pages/pattern
   ```
   拿到本轮 pattern 新增/改动的文件清单。

3. **分类（对照状态文件，避免重复评估）**
   - 对每个改动文件查 `3D_SYNC_STATE.yaml`：
     - 在 `always_skip` 里 → 直接跳过，报告里列出（不静默截断）。
     - 在 `file_mapping` 里 → 按既定 `transferability` 处理。
     - **不在表里（新文件）** → 本轮新评估：`git diff BASE..origin/dev_pattern -- <file>`，按迁移规则定 transferability。

4. **迁移规则（决策表）**
   | transferability | 处理 |
   |---|---|
   | `common` ✅ | 直接套用到 `pages/3d/` 对应文件，路径/命名按 3D 约定 |
   | `skip` ❌ | 跳过；3D 用 Raycaster+SCENE_PICK 等替代 |
   | `partial` ⚠️ | 借结构，把 2D 语义（A2UI/element/DOM picker）替换为 3D 语义（SceneConfig/object/SCENE_*） |

5. **冲突保护**
   - 若 pattern 改动触及 `pages/3d/` 里已被 3D 专属逻辑覆写的部分，只迁移"通用骨架改动"，保留 3D 专属覆写不动。
   - 冲突在 commit message 标注 `MANUAL-MERGE: <file>`，留人工复核痕迹。

6. **落地 + 验证**
   - 改 `pages/3d/` 对应文件。
   - 跑回归：iframe 握手（SCENE_READY）+ SCENE_UPDATE 渲染 + 三条解析路径（component/model/mesh）不回归。

7. **更新游标 + 记录**
   - 更新 `3D_SYNC_STATE.yaml`：
     - `last_synced_commit` → origin/dev_pattern 新 HEAD
     - `sync_round` → N+1
     - 新评估的文件补进 `file_mapping`
     - `history` 加一轮：`{ round: N+1, date: <今天>, commit: <新HEAD短>, files: <迁移数>, note: <摘要> }`
   - 提交：
     ```bash
     git add pages/3d/ 3D_SYNC_STATE.yaml
     git commit -m "3D-SYNC #N+1: <摘要> (base=<old短>..new=<new短>)"
     ```
   - commit message 以 `3D-SYNC #N` 开头 → `git log --grep='3D-SYNC'` 一键查全部同步历史。

## 产出
本轮同步报告（迁移/跳过/冲突清单），被跳过的文件一律显式列出。
格式：
```
## 3D-SYNC #N (date, base..new)
迁移(X): [文件列表]
跳过(Y): [文件列表 + 原因]
冲突(Z): [文件列表 + MANUAL-MERGE 标注]
回归验证: ✅/❌ 握手/渲染/三路径
```

## 注意
- 游标只向前推进，永不回退（除非主动 revert 并记入 history）。
- 不自动 merge —— 评估和语义迁移需人工/agent 判断，本流程只负责"列改动+分类提示+更新游标"。
- 3d-templete / 3d-components 不在 dev_pattern 同步范围内。

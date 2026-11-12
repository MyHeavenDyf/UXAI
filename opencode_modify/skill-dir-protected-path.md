# protected-path 守卫：禁止 agent 修改 skill 库目录

## 动机

edit 工具偶尔会修改 `~/.config/octo/skill/`（桌面端统一 skill 库目录）下的内容。该目录由应用技能库管理（桌面端 `migrate.ts` 的 `deployBuiltinSkills`/`deploySkillsJson` 用原生 fs 部署、技能库 UI 增删），agent 只应读取（skill 工具输出里明确要求用 read 工具读取 skill 文件），不应通过文件工具修改。需要在 tool 层保证 edit / write / apply_patch 无论如何构造路径都改不了这个目录。

## 保证范围（用户确认的范围）

- **覆盖**：builtin 文件写入工具 edit、write、apply_patch（含 move 目标路径与 delete 源路径）。
- **不覆盖**（明确不管）：shell 命令写文件、MCP/插件自带写文件工具。

闭环依据：排查过 `packages/opencode/src/tool/` 全部工具的落盘点——edit(2×`writeWithDirs`)、write(1×`writeWithDirs`)、apply_patch(3×`writeWithDirs` + `remove`) 全部以入口处守卫的 `filePath`/`movePath` 为目标；extract_document 落盘固定在 `<project>/.octo/<session>/`；truncate 固定在 `Global.Path.data/tool-output`；图片生成工具不落盘。因此入口守卫这两个路径即可 100% 覆盖三个工具的磁盘变更（format/Bom.syncFile 只在主写入成功后对同一路径运行，守卫先行拦截后不会到达）。

## 改动文件

| 文件 | 改动内容 |
|------|----------|
| `packages/opencode/src/tool/protected-path.ts` | 新增。受保护目录列表（当前仅 `Global.Path.octoConfig/skill`）+ `findProtectedDir` 判定 + `assertNotProtectedPath` Effect 守卫 |
| `packages/opencode/src/tool/edit.ts` | filePath 计算后、`assertExternalDirectoryEffect` 前插入守卫（两个写入分支共用入口，一次覆盖） |
| `packages/opencode/src/tool/write.ts` | 同上 |
| `packages/opencode/src/tool/apply_patch.ts` | hunk `filePath` 与 move 目标 `movePath` 两处插入守卫 |
| `packages/opencode/test/tool/protected-path.test.ts` | 新增。路径变体单测 |

## 实现要点

- **守卫顺序**：必须在 `assertExternalDirectoryEffect` 之前。skill 目录在项目外，若先走 external_directory 会弹权限框，用户批准后仍会被守卫拦下，交互错误。
- **错误呈现**：`Effect.fail(new Error(...)).pipe(Effect.orDie)` —— 与 apply_patch 既有失败路径同通路（tool.ts 外层 `orDie` + `ToolCalls.safely` 兜底），以工具错误形式返回给模型，错误文案明确告知该目录只读、应引导用户走技能库 UI，避免模型重试。
- **路径判定防变体**（`realPath`）：`path.resolve(windowsPath(p))` 消掉 `..`/混合分隔符；再解析**最长已存在祖先**的 `realpathSync.native` 并拼接不存在尾段（新建文件场景），同时防住符号链接别名、win32 大小写与 8.3 短名。realpath 遇非 ENOENT 错误（杀软瞬时 EPERM/EBUSY）退回规范化路径，守卫只松不炸。
- **双形式匹配**：受保护目录同时以原串与 `realPath(dir)` 匹配——原串覆盖目录尚未部署（不存在）的场景，real 形式覆盖 `~/.config` 等祖先是符号链接、而 target 已被 realpath 到真实路径的场景。
- **E=never**：`execute`/`ctx.ask` 的类型约定是 E=never（权限拒绝也内部 die），守卫经 `orDie` 自满足，调用处可裸 `yield*`。

## 已知边界

- 「经符号链接祖先写新建文件」在 realpath 失败（非 ENOENT）时守卫退化为字符串匹配；与 external_directory 权限检查的既有失败模式一致，且 agent 无 shell 之外的建链手段。
- `skill_config.json`/`skills.json` 在 `octoConfig` 根下、不在本次保护范围（用户只要 skill 目录）；如需扩大，往 `protected-path.ts` 的 `protectedDirs` 列表追加即可。

## 测试

`packages/opencode/test/tool/protected-path.test.ts`：直接/`..`/新建尾段/win32 大小写与分隔符变体命中；目录外、同名前缀目录（`skilllib`）、祖先目录不误伤；posix 符号链接别名（含新建尾段）命中（win32 因建链需特权 skip）。

# octo_make edit 后返回 text/link artifact

## 背景

用户反馈：当用户要求修改文件内容（模型调用 `edit` 工具）时，前端收不到任何 `<artifact>` 标签，产物面板无卡片显示。

根因在 `octo_make.txt` 的 edit 规则原文：

> edit：……成功后用文字简述改动，**不要重新输出 artifact**

该规则本意是避免 edit 后重新输出文件全文（浪费 token），但矫枉过正——连 `text/link` 形式的 artifact 也被禁止，前端完全没有产物卡片。

## 前端链路现状（无需改动，已验证支持）

- `text/link` artifact → 解析为 `link` 卡片（`insight-turn.tsx` 的 `ARTIFACT_TYPE_MAP`）
- link 卡片内容为磁盘路径时（`index.tsx` `handleOpenResult` 的 link 分支）：
  - 归一化为绝对路径（相对路径基于 projectDir 拼接）
  - 已有同 filePath 的 tab → 重新读磁盘并 `updateTabContent` 刷新展示
  - 无 tab → 按 `inferOutputType` 推断类型新开 tab，`html-renderer` 从 `filePath` 读内容渲染
- 前端注入的 `[Existing artifacts in this session]` 列表本身就是绝对路径，模型原样回填即可

## 修改内容

`packages/opencode/src/agent/prompt/octo_make.txt`：

1. edit 规则拆分，移除"不要重新输出 artifact"，新增 **edit 返回路径** 规则：
   - edit 成功后先用 1-2 句话简述改动
   - **必须**用 `<artifact type="text/link">` 包裹被修改文件的完整路径输出
   - 不要用 artifact 重新输出文件全文
   - 修改多个文件时，所有 link artifact **集中在最终回复中连续输出**
2. 示例章节标题更新为「本地路径 / 网络地址（write / edit 操作文件后必须使用）」

## 多 artifact 边界问题（前端已知限制，提示词侧规避）

`insight-turn.tsx` 的 `outputCards` 实现是**倒序**遍历 text part，遇到第一个含 artifact 的 part 即 `return`——若 artifact 分布在多个 text part（模型在工具调用之间穿插输出 link artifact），只有最后一个 part 的卡片会显示。

因此提示词明确要求"集中在最终回复中连续输出"，保证所有 link artifact 落在同一个 text part，全部正常生成卡片。流式占位（`scanArtifactHeaders`）与最终卡片（`parseAllArtifactsFromText`）对同一段文本内的多个 artifact 均逐个生成卡片，点击后各自开 tab。

## 后续可选

- 若希望彻底支持跨 text part 的多 artifact，需修改 `insight-turn.tsx` 的 `outputCards` 聚合所有 text part 的 artifact（目前用提示词规避）

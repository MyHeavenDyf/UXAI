# Insight 打点清单

记录 insight agent 已埋入的所有打点，新增/变更打点时同步维护此表。

接入规范见 [`/docs/tracker.md`](../../../../../../docs/tracker.md)。

## 打点列表

| # | type | module | name | 触发时机 | 代码位置 |
|---|------|--------|------|----------|----------|
| 1 | page | insight | insight-page | insight 页面挂载 | `index.tsx` `InsightContent` onMount |
| 2 | interaction | insight | new-session | 新建对话成功、跳转到新会话 | `index.tsx` `createAndNavigate` |

## 维护说明

- 新增打点 → 在表格末尾追加一行
- 删除打点 → 删除对应行，重要变更可加删除线保留记录
- 修改 `name` / `module` → 同步更新表格，并通知后端确认字段变更

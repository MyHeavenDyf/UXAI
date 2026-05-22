# Bug 追踪

本文档记录项目中发现的待修复 Bug，按优先级排序。

---

## HIGH — 立即修复

### Bug 1: AuthError 被 InitError 包装，错误类型丢失

**文件**: `src/provider/provider.ts:1628-1631`

**状态**: ✅ 已修复 — catch 块中已添加 `if (e instanceof AuthError) throw e` 透传（2026-05-13）

---

### Bug 2: `session-category.ts` 的 `listByCategory` 绕过 `fromRow` 转换

**文件**: `src/session/session-category.ts:100`

**状态**: ✅ 已修复 — 已改为 `fromRow(r.session, category)` 替代双重类型断言（2026-05-13）

---

### Bug 3: `_shell/sidebar.tsx` 和 `topbar.tsx` 使用不存在的 `/insight` 路由

**文件**: `packages/app/octoapp/pages/_shell/sidebar.tsx:106-125`, `topbar.tsx:9,38`

sidebar 导航到 `/insight` 和 `/insight/:id`，但路由表中只有 `/:dir/cowork/:id?`，无 `/insight` 路由。

**影响**: 点击 topbar "Cowork" 或 sidebar "Octo Insight" 会导致 404/导航失败。

**修复**: 将 `/insight` 改为正确的 `/${slug}/cowork` 路径，或添加路由。

**状态**: ✅ 已修复 — 已添加 `/insight/:id?` 和 `/make/:id?` 路由（2026-05-13）

---

### Bug 4: `CoworkPage.createAndNavigate()` 导航路径缺少 `:dir` 前缀

**文件**: `packages/app/octoapp/pages/cowork/index.tsx:234`

```typescript
navigate(`/cowork/${session.id}`)  // 缺少 :dir 前缀
```

**修复**: `navigate(`/${slug()}/cowork/${session.id}`)`

**状态**: ✅ 已修复 — Cowork 页面已移除，改用 `/insight` 和 `/make` 独立路由（2026-05-13）

---

## MEDIUM — 本轮修复

### Bug 5: `session.ts` 的 `children` 函数未传递 category

**文件**: `src/session/session.ts:590`

```typescript
return rows.map((row) => fromRow(row))  // 无 LEFT JOIN SessionCategoryTable
```

子会话列表中所有 `category` 为 `undefined`。

**修复**: 添加 LEFT JOIN SessionCategoryTable 并传递 category。

---

### Bug 6: `server/projectors.ts` 重建 Info 时未传递 category

**文件**: `src/server/projectors.ts:14-20`

`session.updated` 事件投影时从 DB 重新读取行构造 Info，但没有 JOIN category 表。

**影响**: 多节点同步场景下推送的会话信息丢失 category。

**修复**: 添加 LEFT JOIN SessionCategoryTable。

---

### Bug 7: `_shell/sidebar.tsx` 和 `components/sidebar.tsx` 硬编码中文文本

**文件**: `packages/app/octoapp/pages/_shell/sidebar.tsx` 多处, `components/sidebar.tsx:107-116`

硬编码"历史记录"、"搜索历史记录"、"暂无对话"、"设置"等中文文本，未走 i18n。英文用户看到中文界面。

---

### Bug 8: `zh.ts` 缺少约 22 个 i18n 翻译键

**文件**: `packages/app/octoapp/i18n/zh.ts`

缺少键：`command.project.previous/next`、`session.child.*`、`settings.general.row.*`、`sidebar.empty.*` 等。

---

## LOW — 后续处理

### Bug 9: `cli/cmd/stats.ts` 的 `fromRow` 未传递 category

**文件**: `src/cli/cmd/stats.ts:83` — 统计命令暂不使用 category，未来按 category 分组统计时会有问题。

### Bug 10: `db.node.ts` 的 migrate 跳过 hash 校验

**文件**: `src/storage/db.node.ts:20` — `hash: ""` 跳过迁移完整性校验，依赖 drizzle 内部 API `dialect.migrate`。

### Bug 11: `_shell/index.tsx` 组件未使用

**文件**: `packages/app/octoapp/pages/_shell/index.tsx` — `OctoShell`/`OctoPageShell` 未被任何文件导入。

### Bug 12: `createNext` 中 category 插入错误被静默吞噬

**文件**: `src/session/session.ts:549` — `Effect.catch(() => Effect.void)` 吞噬分类插入的所有错误，无日志记录。

---

## 已知问题（非 Bug）

| 问题 | 状态 | 说明 |
|------|------|------|
| Agent skills 未按 agent 限定 | 待开发 | 已记录在 CLAUDE.md，`agent.skills` 字段声明但未强制执行 |
| `plugin/index.ts:146` `Bun.$` | 安全 | 已有 typeof 守卫，Node 环境返回 undefined |

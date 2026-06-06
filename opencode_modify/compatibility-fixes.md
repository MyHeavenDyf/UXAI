# 环境兼容性修复

## 概述

修复 Electron/Node 环境下 Bun API 不可用的问题，包括 skills.json 读取、import.meta.dir、drizzle migrate。

## 提交记录

### `c55ba24ad` 修复 skills.json 读取在 Electron/Node 下的 Bun is not defined 错误

- `src/skill/index.ts`：`Bun.file().json()` → `import("fs/promises")` + `readFile` + `JSON.parse`
- Electron 在 Node.js 上运行，`Bun.file()` 不可用导致 `ReferenceError`

### `28f2e6be3` 修复 Electron/Node 环境兼容性

- `src/skill/index.ts`：`import.meta.dir`（Bun 专有）→ 优先使用 `import.meta.dirname`（Node 标准），以 `import.meta.dir` 作为回退
- `src/storage/db.ts`：`drizzle-orm/bun-sqlite` 的 `migrate` 直接导入 → 从 `#db`（条件导入）导入
- `src/storage/db.bun.ts` 和 `db.node.ts`：都添加了对应的 `migrate` 重新导出
- `Client` 类型从 `SQLiteBunDatabase` → `ReturnType<typeof init>`，平台无关

### `b332a0212` wrap drizzle node-sqlite migrate to support journal array input

- `src/storage/db.node.ts`：`drizzle-orm/bun-sqlite` 的 `migrate` 直接接受日志数组，但 `drizzle-orm/node-sqlite` 只接受 config 对象
- 包装 `migrate`：当输入是数组时，转换为 drizzle 内部格式（`--> statement-breakpoint` 分割 SQL），直接调用 `db.dialect.migrate`

### `0eb3e11d3` 内置 skills 扫描添加 scope 参数防止打包后 ENOENT 崩溃

- `src/skill/index.ts`：`scan()` 添加 `{ scope: "builtin" }` 参数
- 打包版本中 `import.meta.dir` 指向不存在的路径，`Glob.scan` 引发 `ENOENT` 错误导致进程崩溃

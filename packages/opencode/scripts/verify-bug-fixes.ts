/**
 * Bug 修复验证脚本
 *
 * 检测 Bug 1/2/5/6 的修复是否正确：
 * - Bug 1: AuthError 在 resolveSDK catch 中被透传
 * - Bug 2: listByCategory 使用 fromRow 而非 as unknown as Info
 * - Bug 5: children 函数 LEFT JOIN SessionCategoryTable
 * - Bug 6: projectors.ts LEFT JOIN SessionCategoryTable
 * - 额外: createNext category 错误日志
 */
import fs from "fs"
import path from "path"

const ROOT = path.resolve(import.meta.dirname, "..", "src")

type CheckResult = { name: string; pass: boolean; detail: string }

function check(name: string, fn: () => string | null): CheckResult {
  const fail = fn()
  return { name, pass: fail === null, detail: fail ?? "OK" }
}

const results: CheckResult[] = []

// ── Bug 1: AuthError 透传 ──
const providerPath = path.join(ROOT, "provider/provider.ts")
const providerCode = fs.readFileSync(providerPath, "utf-8")

results.push(check("Bug1: AuthError 在 catch 中透传", () => {
  const catchBlock = providerCode.match(/catch\s*\(\s*e\s*\)\s*\{[\s\S]*?throw new InitError/)
  if (!catchBlock) return "找不到 catch 块中的 InitError 抛出"
  if (!catchBlock[0].includes("instanceof AuthError")) return "catch 块中缺少 AuthError 透传检查"
  // 确认 AuthError 透传在 InitError 之前
  const authIdx = catchBlock[0].indexOf("instanceof AuthError")
  const initIdx = catchBlock[0].indexOf("throw new InitError")
  if (authIdx > initIdx) return "AuthError 检查应在 InitError 抛出之前"
  return null
}))

results.push(check("Bug1: AuthError 已导入", () => {
  if (!providerCode.includes('import { AuthError }') && !providerCode.includes("from \"@/session/message\""))
    return "provider.ts 未导入 AuthError"
  return null
}))

// ── Bug 2: listByCategory 使用 fromRow ──
const categoryPath = path.join(ROOT, "session/session-category.ts")
const categoryCode = fs.readFileSync(categoryPath, "utf-8")

results.push(check("Bug2: listByCategory 使用 fromRow", () => {
  if (categoryCode.includes("as unknown as Info")) return "仍存在 as unknown as Info 类型强转"
  if (!categoryCode.includes("fromRow(r.session, category)")) return "未使用 fromRow(r.session, category)"
  return null
}))

results.push(check("Bug2: fromRow 已导入", () => {
  if (!categoryCode.includes("fromRow")) return "session-category.ts 未导入 fromRow"
  const importLine = categoryCode.match(/import\s*\{[^}]*fromRow[^}]*\}\s*from\s*["']\.\/session["']/)
  if (!importLine) return "fromRow 未从 ./session 导入"
  return null
}))

// ── Bug 5: children 函数 LEFT JOIN ──
const sessionPath = path.join(ROOT, "session/session.ts")
const sessionCode = fs.readFileSync(sessionPath, "utf-8")

results.push(check("Bug5: children 函数 LEFT JOIN SessionCategoryTable", () => {
  // 找到 children 函数定义
  const childrenMatch = sessionCode.match(
    /const children\s*=\s*Effect\.fn\("Session\.children"\)[\s\S]*?\.all\(\)\s*,?\s*\)/
  )
  if (!childrenMatch) return "找不到 children 函数定义"
  const fn = childrenMatch[0]
  if (!fn.includes("SessionCategoryTable")) return "children 函数未引用 SessionCategoryTable"
  if (!fn.includes("leftJoin")) return "children 函数未使用 leftJoin"
  return null
}))

results.push(check("Bug5: children 传递 category 给 fromRow", () => {
  const childrenStart = sessionCode.indexOf("const children")
  if (childrenStart === -1) return "找不到 children 函数定义"
  const block = sessionCode.slice(childrenStart, childrenStart + 600)
  if (!block.includes("fromRow(row.session")) return "children 未使用 fromRow(row.session, ...)"
  if (!block.includes("row.category")) return "children 未传递 row.category 参数"
  return null
}))

// ── Bug 6: projectors LEFT JOIN ──
const projectorsPath = path.join(ROOT, "server/projectors.ts")
const projectorsCode = fs.readFileSync(projectorsPath, "utf-8")

results.push(check("Bug6: projectors 导入 SessionCategoryTable", () => {
  if (!projectorsCode.includes("SessionCategoryTable")) return "projectors.ts 未导入 SessionCategoryTable"
  return null
}))

results.push(check("Bug6: projectors 使用 LEFT JOIN", () => {
  if (!projectorsCode.includes("leftJoin")) return "projectors.ts 未使用 leftJoin"
  if (!projectorsCode.includes("SessionCategoryTable.category")) return "未选择 SessionCategoryTable.category"
  return null
}))

results.push(check("Bug6: projectors 传递 category 给 fromRow", () => {
  if (!projectorsCode.includes("fromRow(row.session")) return "未使用 fromRow(row.session, ...)"
  if (!projectorsCode.includes("row.category")) return "未传递 row.category 参数"
  return null
}))

// ── 额外: createNext category 错误日志 ──
results.push(check("Extra: createNext category 错误有日志", () => {
  const errorCatch = sessionCode.match(/Effect\.catch\([^)]+\)\s*=>\s*\{[\s\S]*?return Effect\.void/)
  if (!errorCatch) return "找不到 Effect.catch 中的日志记录"
  // 查找包含 log.error 的 catch 块
  const categorySection = sessionCode.match(
    /SessionCategoryTable[\s\S]*?\.pipe\(Effect\.catch\([\s\S]*?\)\)[\s\S]*?\}\s*\)/
  )
  if (!categorySection) return "找不到 category 插入的 Effect.catch"
  if (!categorySection[0].includes("log.error")) return "category 插入的 catch 中缺少 log.error"
  return null
}))

// ── Bug 9: stats.ts LEFT JOIN ──
const statsPath = path.join(ROOT, "cli/cmd/stats.ts")
const statsCode = fs.readFileSync(statsPath, "utf-8")

results.push(check("Bug9: stats.ts LEFT JOIN SessionCategoryTable", () => {
  if (!statsCode.includes("SessionCategoryTable")) return "stats.ts 未导入 SessionCategoryTable"
  if (!statsCode.includes("leftJoin")) return "stats.ts 未使用 leftJoin"
  return null
}))

results.push(check("Bug9: stats.ts 传递 category 给 fromRow", () => {
  if (!statsCode.includes("Session.fromRow(row.session")) return "stats.ts 未使用 fromRow(row.session, ...)"
  if (!statsCode.includes("row.category")) return "stats.ts 未传递 row.category 参数"
  return null
}))

// ── API: category 查询参数 ──
const sessionRoutePath = path.join(ROOT, "server/routes/instance/session.ts")
const sessionRouteCode = fs.readFileSync(sessionRoutePath, "utf-8")

results.push(check("API: session 路由支持 category 查询参数", () => {
  if (!sessionRouteCode.includes("category:")) return "session 路由未添加 category 参数定义"
  if (!sessionRouteCode.includes("query.category")) return "session 路由未传递 query.category"
  return null
}))

const httpapiGroupPath = path.join(ROOT, "server/routes/instance/httpapi/groups/session.ts")
const httpapiGroupCode = fs.readFileSync(httpapiGroupPath, "utf-8")

results.push(check("API: httpapi ListQuery 支持 category", () => {
  if (!httpapiGroupCode.includes("category:")) return "httpapi ListQuery 未添加 category 字段"
  return null
}))

const httpapiHandlerPath = path.join(ROOT, "server/routes/instance/httpapi/handlers/session.ts")
const httpapiHandlerCode = fs.readFileSync(httpapiHandlerPath, "utf-8")

results.push(check("API: httpapi handler 传递 category", () => {
  if (!httpapiHandlerCode.includes("ctx.query.category")) return "httpapi handler 未传递 ctx.query.category"
  return null
}))

// ── ListInput: category 字段 ──
results.push(check("API: ListInput 类型包含 category", () => {
  if (!sessionCode.includes("category?: string") || !sessionCode.includes("ListInput")) return "ListInput 未包含 category 字段"
  // Verify it's in the ListInput type
  const listInputMatch = sessionCode.match(/export type ListInput\s*=\s*\{[\s\S]*?\}/)
  if (!listInputMatch) return "找不到 ListInput 类型定义"
  if (!listInputMatch[0].includes("category")) return "ListInput 不包含 category 字段"
  return null
}))

// ── 汇总 ──
console.log("\n=== Bug 修复验证 ===\n")

let passed = 0
let failed = 0

for (const r of results) {
  const icon = r.pass ? "PASS" : "FAIL"
  console.log(`  [${icon}] ${r.name}`)
  if (!r.pass) console.log(`         ${r.detail}`)
  r.pass ? passed++ : failed++
}

console.log(`\n  结果: ${passed}/${results.length} 通过, ${failed} 失败\n`)

if (failed > 0) process.exit(1)

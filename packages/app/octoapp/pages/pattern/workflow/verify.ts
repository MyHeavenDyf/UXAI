/**
 * modify-json-quick-v2 快速修改工作流测试
 *
 * 数据来源：同目录 test.json 的 mergedA2UI（作为 getPendingData 返回值）
 * 运行：  bun ./octoapp/pages/pattern/workflow/verify-v2.ts
 *
 * 场景维度：
 *   A 静态元素（无绑定，parsed=null）        → 直接改 props
 *   B 根 state 绑定（path 绝对，parsed=null） → 回写 doc.state
 *   C 实例化绑定（path 相对，parsed 非空）    → 回写 state 数组项
 *   D 实例化非绑定（#4 架构限制）            → 改模板，一改全改
 *   E 类型还原（boolean/number → coerceValue）
 *   F 边界（元素不存在 → 早返回）
 */
import { handleModifyElement, type QuickModifyContext, type ModifyElementData } from "./modify-json-quick"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const snapshot = JSON.parse(readFileSync(join(import.meta.dir, "test.json"), "utf-8")) as any
const base = snapshot.mergedA2UI

let pass = 0
let fail = 0
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log("  PASS", msg) }
  else { fail++; console.log("  FAIL", msg) }
}
function eq(a: unknown, b: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(b)
  assert(ok, ok ? msg : `${msg}  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`)
}

/** 跑一次修改，返回 sendToPreview 推送的 doc（静默 v2 内部日志） */
function run(data: ModifyElementData, doc?: any): Promise<unknown> {
  const src = doc ?? base
  const log = console.log
  console.log = () => {}
  let captured: unknown = null
  const ctx: QuickModifyContext = {
    getPendingData: () => JSON.parse(JSON.stringify(src)),
    sendToPreview: (d) => { captured = d },
    refreshPreview: () => { },
    getHistoryDir: () => "",
    getSessionId: () => "test",
    getLastIntent: () => snapshot.lastIntent,
    getLastPlanner: () => snapshot.lastPlanner,
    getLastModules: () => snapshot.lastModules,
    setVersions: () => { },
    setCurrentVersionId: () => { },
  }
  return handleModifyElement(ctx, data).then(
    () => { console.log = log; return captured },
    (e) => { console.log = log; throw e },
  )
}

const el = (d: any, id: string) => d.elements.find((e: any) => e.id === id)

// ── A. 静态元素（无绑定，直接改 props） ──────────────────────
console.log("\n[A] 静态元素")

// 原始: {"id":"pageTitle","component":"h1","props":{"className":"text-lg font-bold text-on-surface","value":"Allowed-address-pair 报文"}}
// 修改: textContent="新标题"
// 结果: {"id":"pageTitle","component":"h1","props":{"className":"...","value":"新标题"}}  ← value 直写 props
{
  const d: any = await run({ elementId: "pageTitle", className: "", textContent: "新标题", componentProps: {} })
  eq(el(d, "pageTitle").props.value, "新标题", "A1 静态 value 直写 props")
}
// 原始: {"id":"gsIcon1","component":"Icon","props":{"name":"activity","className":"w-12 h-12",...}}
// 修改: className="w-8 h-8 new"
// 结果: {"id":"gsIcon1","props":{"className":"w-8 h-8 new",...}}  ← 仅 className 变
{
  const d: any = await run({ elementId: "gsIcon1", className: "w-8 h-8 new", textContent: "", componentProps: {} })
  eq(el(d, "gsIcon1").props.className, "w-8 h-8 new", "A2 静态 className 直写 props")
}
// 原始: {"id":"gsIcon1","component":"Icon","props":{"name":"activity",...}}
// 修改: componentProps={ name:"check" }
// 结果: {"id":"gsIcon1","props":{"name":"check",...}}  ← name 变
{
  const d: any = await run({ elementId: "gsIcon1", className: "x", textContent: "", componentProps: { name: "check" } })
  eq(el(d, "gsIcon1").props.name, "check", "A3 非绑定 componentProps 直写 props")
}

// ── B. 根 state 绑定（path 绝对，回写 doc.state） ────────────
console.log("\n[B] 根 state 绑定")

// 原始: 元素 {"id":"pmSearchInput","props":{"value":{"path":"/pmSearchValue"}}}  +  state.pmSearchValue=""
// 修改: componentProps={ value:"查询X" }
// 结果: 元素 props.value 仍 {"path":"/pmSearchValue"}（保留）  +  state.pmSearchValue="查询X"
{
  const d: any = await run({ elementId: "pmSearchInput", className: "", textContent: "", componentProps: { value: "查询X" } })
  eq(d.state.pmSearchValue, "查询X", "B1 根绑定 value 回写 state")
  eq(el(d, "pmSearchInput").props.value, { path: "/pmSearchValue" }, "B2 模板绑定保留")
}
// 原始: 元素 {"id":"tabContainer","props":{"activeKey":{"path":"/activeTab"}}}  +  state.activeTab="probe"
// 修改: componentProps={ activeKey:"packet" }
// 结果: state.activeTab="packet"
{
  const d: any = await run({ elementId: "tabContainer", className: "", textContent: "", componentProps: { activeKey: "packet" } })
  eq(d.state.activeTab, "packet", "B3 根绑定 activeKey 回写 state")
}

// ── C. 实例化绑定（path 相对，回写 state 数组项） ───────────
console.log("\n[C] 实例化绑定")

// 原始: 模板 {"id":"pmCellAapAddress","props":{"value":{"path":"aapAddress"}}}  +  state.pmProbeList[2].aapAddress="192.168.10.8"
// 修改: elementId="pmCellAapAddress:2" componentProps={ value:"ADDR_MOD" }
// 结果: state.pmProbeList[2].aapAddress="ADDR_MOD"（[0] 不变="192.168.10.5"）  +  模板 props.value 仍 {"path":"aapAddress"}(#1修复)
{
  const d: any = await run({ elementId: "pmCellAapAddress:2", className: "", textContent: "", componentProps: { value: "ADDR_MOD" } })
  eq(d.state.pmProbeList[2].aapAddress, "ADDR_MOD", "C1 实例化 value 回写 state 数组项")
  eq(d.state.pmProbeList[0].aapAddress, "192.168.10.5", "C2 其它实例不变")
  eq(el(d, "pmCellAapAddress").props.value, { path: "aapAddress" }, "C3 模板绑定保留(#1修复)")
}
// 原始: 模板 {"id":"pkErrorMessageText","props":{"value":{"path":"errorMessage"}}}  +  state.packetList[3].errorMessage="MAC Address Mismatch"
//        父链: pkErrorMessageText→pkCellErrorMessage(div)→pkTableRow→pkTable(children.path="/packetList")
// 修改: elementId="pkErrorMessageText:3" componentProps={ value:"ERR_MOD" }
// 结果: state.packetList[3].errorMessage="ERR_MOD"（[0] 不变="无"）
{
  const d: any = await run({ elementId: "pkErrorMessageText:3", className: "", textContent: "", componentProps: { value: "ERR_MOD" } })
  eq(d.state.packetList[3].errorMessage, "ERR_MOD", "C4 嵌套父链(div→TableRow→Table)回写 state")
  eq(d.state.packetList[0].errorMessage, "无", "C5 嵌套实例其它行不变")
}
// 原始: 模板 {"id":"pmCellStatus","props":{"icon":{"path":"statusIcon"},...}}  +  state.pmProbeList[2].statusIcon="check-circle"
// 修改: elementId="pmCellStatus:2" componentProps={ icon:"alert" }
// 结果: state.pmProbeList[2].statusIcon="alert"  +  模板 props.icon 仍 {"path":"statusIcon"}
{
  const d: any = await run({ elementId: "pmCellStatus:2", className: "", textContent: "", componentProps: { icon: "alert" } })
  eq(d.state.pmProbeList[2].statusIcon, "alert", "C6 嵌套 path 绑定(icon)回写 state")
  eq(el(d, "pmCellStatus").props.icon, { path: "statusIcon" }, "C7 icon 模板绑定保留")
}

// ── D. 实例化非绑定（#4：改模板，一改全改，state 不动） ─────
console.log("\n[D] 实例化非绑定（#4 架构限制）")

// 原始: 模板 {"id":"pmCellStatus","props":{"color":"success",...}}（非绑定，所有行共用）  +  state.pmProbeList[2].statusText="激活"
// 修改: elementId="pmCellStatus:2" componentProps={ color:"danger" }
// 结果: 模板 props.color="danger"（所有行一起变，#4限制）  +  state 不动(statusText 仍 "激活")
// 注: 单行定制需把 color 改成 {"path":"statusColor"} 绑定，state 每行存独立值
{
  const d: any = await run({ elementId: "pmCellStatus:2", className: "", textContent: "", componentProps: { color: "danger" } })
  eq(el(d, "pmCellStatus").props.color, "danger", "D1 非绑定 color 改模板")
  eq(d.state.pmProbeList[2].statusText, "激活", "D2 非绑定改不影响 state")
}
// 原始: 模板 {"id":"pkCellAapAddress","props":{"className":"text-on-surface","value":{"path":"aapAddress"}}}  +  state.pmProbeList[2].aapAddress="192.168.10.8"
// 修改: elementId="pkCellAapAddress:2" className="cls-mod"
// 结果: 模板 props.className="cls-mod"（#4限制）  +  state 不动(aapAddress 仍 "192.168.10.8")
{
  const d: any = await run({ elementId: "pkCellAapAddress:2", className: "cls-mod", textContent: "", componentProps: {} })
  eq(el(d, "pkCellAapAddress").props.className, "cls-mod", "D3 实例化 className 改模板")
  eq(d.state.pmProbeList[2].aapAddress, "192.168.10.8", "D4 className 改不影响 state")
}

// ── E. 类型还原（coerceValue：string → boolean） ────────────
console.log("\n[E] 类型还原")

// 原始: {"id":"pmCellStatus","props":{"closable":false,...}}  (boolean)
// 修改: componentProps={ closable:"true" }  (string，来自表单 input.value)
// 结果: {"id":"pmCellStatus","props":{"closable":true,...}}  (coerceValue "true"→true，非字符串 "true")
{
  const d: any = await run({ elementId: "pmCellStatus", className: "", textContent: "", componentProps: { closable: "true" } })
  assert(el(d, "pmCellStatus").props.closable === true, "E1 boolean 还原 (\"true\" → true)")
  assert(typeof el(d, "pmCellStatus").props.closable === "boolean", "E2 closable 类型为 boolean 而非 string")
}
// 注：test.json 的 state 无 number 字段被元素绑定，number 还原场景暂无法覆盖

// ── F. 边界（元素不存在 → found=false 早返回） ──────────────
console.log("\n[F] 边界")

// 原始: doc.elements 中无 {"id":"nonExistentId",...}（元素已删除/ID 错误）
// 修改: elementId="nonExistentId"
// 结果: found=false → 早返回，不 sendToPreview，不写版本历史
{
  const d: any = await run({ elementId: "nonExistentId", className: "x", textContent: "", componentProps: {} })
  assert(d === null, "F1 不存在元素 → 不推送预览(found=false 早返回)")
}

// ── G. 嵌套实例化（两层循环：外层 Table 里套内层 Table） ───
// 自造数据（test.json 无两层循环，这里构造一个）：
//   outerTable 循环 state.outerList（"/outerList" 绝对）
//   外层行里嵌 innerTable，循环 当前项.innerList（"innerList" 相对）
//   innerCellField:1:2 → state.outerList[1].innerList[2].innerField
console.log("\n[G] 嵌套实例化（两层循环）")

const nested = {
  rootId: "outerTable",
  elements: [
    { id: "outerTable", component: "Table", props: { dataSource: { path: "/outerList" } }, children: { path: "/outerList", componentId: "outerRow" } },
    { id: "outerRow", component: "TableRow", children: ["outerCellField", "innerTable"], props: {} },
    { id: "outerCellField", component: "span", props: { value: { path: "outerField" } } },
    { id: "innerTable", component: "Table", props: { dataSource: { path: "innerList" } }, children: { path: "innerList", componentId: "innerRow" } },
    { id: "innerRow", component: "TableRow", children: ["innerCellField"], props: {} },
    { id: "innerCellField", component: "span", props: { value: { path: "innerField" } } },
  ],
  state: {
    outerList: [
      { outerField: "outer0", innerList: [{ innerField: "i0" }, { innerField: "i1" }] },
      { outerField: "outer1", innerList: [{ innerField: "i2" }, { innerField: "i3" }, { innerField: "i4" }] },
    ],
  },
}

// 原始: 模板 {"id":"innerCellField","props":{"value":{"path":"innerField"}}}  +  state.outerList[1].innerList[2].innerField="i4"
//        父链: innerCellField→innerRow→innerTable(children.path="innerList",相对)→outerRow→outerTable(children.path="/outerList")
// 修改: elementId="innerCellField:1:2" componentProps={ value:"MOD" }
// 结果: state.outerList[1].innerList[2].innerField="MOD"（两层索引 [1,2] 反向消费）
{
  const d: any = await run({ elementId: "innerCellField:1:2", className: "", textContent: "", componentProps: { value: "MOD" } }, nested)
  eq(d.state.outerList[1].innerList[2].innerField, "MOD", "G1 两层嵌套 value 回写 state.outerList[1].innerList[2]")
  eq(d.state.outerList[0].innerList[0].innerField, "i0", "G2 其它项不变 [0][0]")
  eq(d.state.outerList[1].innerList[0].innerField, "i2", "G3 同行其它列不变 [1][0]")
  eq(el(d, "innerCellField").props.value, { path: "innerField" }, "G4 模板绑定保留")
}
// 原始: 模板 {"id":"outerCellField","props":{"value":{"path":"outerField"}}}  +  state.outerList[1].outerField="outer1"
// 修改: elementId="outerCellField:1" componentProps={ value:"OUT_MOD" }
// 结果: state.outerList[1].outerField="OUT_MOD"（外层单层索引 [1]）
{
  const d: any = await run({ elementId: "outerCellField:1", className: "", textContent: "", componentProps: { value: "OUT_MOD" } }, nested)
  eq(d.state.outerList[1].outerField, "OUT_MOD", "G5 外层 cell 回写 state.outerList[1]")
  eq(d.state.outerList[0].outerField, "outer0", "G6 外层其它行不变 [0]")
}

// ── 汇总 ──────────────────────────────────────────────────
console.log(`\n结果: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)

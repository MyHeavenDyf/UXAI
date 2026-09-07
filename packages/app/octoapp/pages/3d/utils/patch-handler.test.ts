import { describe, expect, test } from "bun:test"
import {
  resolveTypeId,
  patchHandlerOverride,
  patchHandlerSkip,
  hasSkipSkeleton,
  patchHandlerAdd,
  hasAddSkeleton,
  ensureApplyOverride,
  applySearchReplace,
  isFallbackPartId,
  patchHandlerMaterialColor,
} from "./patch-handler"

// ── resolveTypeId：__id → 顶层 type 反查 ──────────────────────────────
// 子实例 __id（server-room-1-rack-0-3）不在分组 id 里，靠根前缀反推；
// hm / hm-1 同前缀歧义须取最长 node.id（最具体前缀优先）。
describe("resolveTypeId", () => {
  const merged = {
    room: [{ id: "room-1" }],
    racks: [{ id: "racks-1" }, { id: "racks-2" }],
    hm: [{ id: "hm" }],
    "hm-group": [{ id: "hm-1" }],
    notArray: { x: 1 }, // 非数组须跳过
    noId: [{ foo: "bar" }], // 无 id 字段须跳过
  }

  test("精确命中 __id === node.id", () => {
    expect(resolveTypeId(merged, "room-1")).toBe("room")
  })

  test("前缀命中 __id = nodeId-suffix", () => {
    expect(resolveTypeId(merged, "racks-1-rack-0")).toBe("racks")
  })

  test("深层子实例靠根前缀反推", () => {
    // __id "racks-1-rack-0-3" 命中根节点 "racks-1"（startsWith "racks-1-"）
    expect(resolveTypeId(merged, "racks-1-rack-0-3")).toBe("racks")
  })

  test("同前缀歧义取最长 node.id（hm vs hm-1）", () => {
    // __id "hm-1-floor" 同时匹配 "hm"（startsWith "hm-"）和 "hm-1"（=== "hm-1" 无；startsWith "hm-1-"）
    // 最长 node.id = "hm-1" → type "hm-group"
    expect(resolveTypeId(merged, "hm-1-floor")).toBe("hm-group")
  })

  test("不属任何节点 → null", () => {
    expect(resolveTypeId(merged, "part-0")).toBeNull()
    expect(resolveTypeId(merged, "unknown-thing")).toBeNull()
  })

  test("非数组 / 无 id 分组被跳过不崩", () => {
    expect(resolveTypeId(merged, "notArray-x")).toBeNull()
    expect(resolveTypeId(merged, "noId-y")).toBeNull()
  })

  test("空 config → null", () => {
    expect(resolveTypeId({}, "anything")).toBeNull()
  })
})

// ── patchHandlerOverride：per-instance 材质/transform merge 进 SUB_OVERRIDES ──
// 契约前提：handler 顶部含 `const SUB_OVERRIDES: Record<...> = { ... }` 且内容合法 JSON。
describe("patchHandlerOverride", () => {
  const skeleton = (inner: string) =>
    `import * as THREE from "three"\nconst SUB_OVERRIDES: Record<string, OverrideSpec> = ${inner}\n// rest`

  const base = skeleton(`{
  "room-1-walls": {
    "material": { "color": "#8899aa", "type": "standard" }
  }
}`)

  test("material 字段级 merge：保留未覆盖字段", () => {
    const out = patchHandlerOverride(base, "room-1-walls", {
      material: { roughness: 0.5 },
    })
    // 既有 color 保留 + 新 roughness 合入
    expect(out).toContain('"color": "#8899aa"')
    expect(out).toContain('"roughness": 0.5')
  })

  test("material 覆盖既有字段值", () => {
    const out = patchHandlerOverride(base, "room-1-walls", {
      material: { color: "#ff0000" },
    })
    expect(out).toContain('"color": "#ff0000"')
    expect(out).not.toContain('"#8899aa"')
  })

  test("新 __id → 增项", () => {
    const out = patchHandlerOverride(base, "room-1-floor-0", {
      material: { color: "#00ff00" },
    })
    expect(out).toContain('"room-1-floor-0"')
    expect(out).toContain('"#00ff00"')
    // 既有项不丢
    expect(out).toContain('"room-1-walls"')
  })

  test("缺 type → 补 standard（applySyncProps 不读 type，补默认仅为过 vue-tsc）", () => {
    const out = patchHandlerOverride(base, "room-1-walls", {
      material: { color: "#112233" },
    })
    expect(out).toContain('"type": "standard"')
  })

  test("非 5 类 type（toon/points/undefined）→ 归一 standard", () => {
    const src = skeleton(`{
  "room-1-walls": { "material": { "color": "#fff", "type": "toon" } }
}`)
    const out = patchHandlerOverride(src, "room-1-walls", {
      material: { roughness: 1 },
    })
    expect(out).toContain('"type": "standard"')
    expect(out).not.toContain('"toon"')
  })

  test("合法 5 类 type 保留不改", () => {
    const src = skeleton(`{
  "room-1-walls": { "material": { "color": "#fff", "type": "physical" } }
}`)
    const out = patchHandlerOverride(src, "room-1-walls", {
      material: { roughness: 0.2 },
    })
    expect(out).toContain('"type": "physical"')
  })

  test("transform 子字段级 merge：保留未覆盖子字段", () => {
    const src = skeleton(`{
  "room-1-walls": { "transform": { "position": [1, 2, 3], "scale": [2, 2, 2] } }
}`)
    const out = patchHandlerOverride(src, "room-1-walls", {
      transform: { rotation: [0, Math.PI, 0] },
    })
    expect(out).toContain('"position": [')
    expect(out).toContain('"scale": [')
    expect(out).toContain('"rotation": [')
    // rotation 存弧度（Math.PI = 3.141592653589793）
    expect(out).toContain("3.141592653589793")
  })

  test("transform 覆盖既有子字段", () => {
    const out = patchHandlerOverride(base, "room-1-walls", {
      transform: { position: [9, 9, 9] },
    })
    expect(out).toContain('"position": [')
    expect(out).toContain("9,")
  })

  test("往返一致：patch 后再读回仍可 parse", () => {
    const out = patchHandlerOverride(base, "room-1-walls", {
      material: { color: "#abcdef" },
    })
    // 重组后源码仍含可 parse 的 SUB_OVERRIDES —— 用 locateOverridesLiteral 同款括号配对
    // 抓出完整 { } 块再 JSON.parse（非贪婪会停在首个 }，须手动配对，有界防死循环）
    const decl = out.match(/const SUB_OVERRIDES\b/)
    expect(decl).not.toBeNull()
    let start = decl!.index! + decl![0].length
    while (start < out.length && out[start] !== "{") start++
    expect(out[start]).toBe("{")
    let depth = 0
    let end = -1
    for (let i = start; i < out.length; i++) {
      if (out[i] === "{") depth++
      else if (out[i] === "}") {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    expect(end).toBeGreaterThan(start)
    expect(() => JSON.parse(out.slice(start, end + 1))).not.toThrow()
  })

  // ── 契约违例全抛错（不合契约的 handler 须显式失败，不静默 no-op）──
  test("无 SUB_OVERRIDES 声明 → 抛错", () => {
    expect(() => patchHandlerOverride("const X = 1", "id", { material: {} })).toThrow(
      /SUB_OVERRIDES/,
    )
  })

  test("SUB_OVERRIDES 非直接赋对象字面量（函数包装）→ 抛错", () => {
    const bad = `const SUB_OVERRIDES = makeOverrides()`
    expect(() => patchHandlerOverride(bad, "id", { material: {} })).toThrow(/直接赋对象字面量/)
  })

  test("花括号不配对 → 抛错", () => {
    const bad = `const SUB_OVERRIDES = { "a": { `
    expect(() => patchHandlerOverride(bad, "id", { material: {} })).toThrow(/花括号不配对/)
  })

  test("内容非合法 JSON（单引号 key / trailing comma）→ 抛错", () => {
    const bad = `const SUB_OVERRIDES = { 'a': 1, }`
    expect(() => patchHandlerOverride(bad, "id", { material: {} })).toThrow(/非合法 JSON/)
  })

  test("字符串字面量里的 } 不误判结束", () => {
    // SUB_OVERRIDES 值里的 color 字符串含 } 字符，括号配对须尊重字符串不误判
    const src = skeleton(`{
  "room-1-walls": { "material": { "color": "#fff" } }
}`)
    const out = patchHandlerOverride(src, "room-1-walls", {
      material: { roughness: 0.1 },
    })
    expect(out).toContain('"room-1-walls"')
    expect(out).toContain('"roughness": 0.1')
  })
})

// ── patchHandlerSkip：SUB_SKIP 删除集合 add/remove ──────────────────
describe("patchHandlerSkip", () => {
  const skel = (inner: string) =>
    `const SUB_SKIP: string[] = ${inner}\nif (SUB_SKIP.includes(cid)) continue`

  test("add 新 cid → push", () => {
    const out = patchHandlerSkip(skel(`[]`), "racks-1-rack-0", "add")
    expect(out).toContain('"racks-1-rack-0"')
  })

  test("add 幂等：重复加不重复入", () => {
    const src = skel(`["racks-1-rack-0"]`)
    const out = patchHandlerSkip(src, "racks-1-rack-0", "add")
    // 只一份
    expect(out.match(/racks-1-rack-0/g)?.length).toBe(1)
  })

  test("remove 撤回删除", () => {
    const src = skel(`["racks-1-rack-0", "racks-1-rack-1"]`)
    const out = patchHandlerSkip(src, "racks-1-rack-0", "remove")
    expect(out).not.toContain('"racks-1-rack-0"')
    expect(out).toContain('"racks-1-rack-1"')
  })

  test("remove 不存在的 cid → 无变化", () => {
    const src = skel(`["racks-1-rack-0"]`)
    const out = patchHandlerSkip(src, "racks-1-rack-9", "remove")
    expect(out).toContain('"racks-1-rack-0"')
  })

  test("无 SUB_SKIP 声明 → 抛错", () => {
    expect(() => patchHandlerSkip("const X = 1", "id", "add")).toThrow(/SUB_SKIP/)
  })
})

// ── hasSkipSkeleton：删子物能否 data-patch 的前提 ────────────────────
describe("hasSkipSkeleton", () => {
  test("有声明 + 有 includes 调用 → true", () => {
    expect(hasSkipSkeleton(`const SUB_SKIP: string[] = []\nif (SUB_SKIP.includes(cid)) continue`)).toBe(true)
  })

  test("有声明无 includes 调用 → false", () => {
    expect(hasSkipSkeleton(`const SUB_SKIP: string[] = []`)).toBe(false)
  })

  test("无声明 → false", () => {
    expect(hasSkipSkeleton(`const X = 1`)).toBe(false)
  })
})

// ── patchHandlerAdd：SUB_ADD 加子物集合 ──────────────────────────────
describe("patchHandlerAdd", () => {
  const skel = (inner: string) =>
    `const SUB_ADD: Array<AddEntry> = ${inner}\nfor (const add of SUB_ADD) { group.add(make(add)) }`

  test("新 cid → push", () => {
    const out = patchHandlerAdd(skel(`[]`), {
      cid: "racks-1-rack-9",
      position: [1, 2, 3],
    })
    expect(out).toContain('"cid": "racks-1-rack-9"')
  })

  test("同 cid → 替换（幂等，不重复 push）", () => {
    const src = skel(`[{ "cid": "racks-1-rack-9", "position": [0, 0, 0] }]`)
    const out = patchHandlerAdd(src, {
      cid: "racks-1-rack-9",
      position: [9, 9, 9],
      material: { color: "#ff0000" },
    })
    expect(out.match(/racks-1-rack-9/g)?.length).toBe(1)
    expect(out).toContain('"position": [')
    expect(out).toContain("9,")
    expect(out).toContain('"#ff0000"')
  })

  test("无 SUB_ADD 声明 → 抛错", () => {
    expect(() => patchHandlerAdd("const X = 1", { cid: "x", position: [] })).toThrow(/SUB_ADD/)
  })
})

// ── hasAddSkeleton：加子物能否 data-patch 的前提 ────────────────────
describe("hasAddSkeleton", () => {
  test("有声明 + 有 for...of SUB_ADD → true", () => {
    expect(
      hasAddSkeleton(`const SUB_ADD = []\nfor (const add of SUB_ADD) { x() }`),
    ).toBe(true)
  })

  test("有声明无遍历 → false", () => {
    expect(hasAddSkeleton(`const SUB_ADD = []`)).toBe(false)
  })
})

// ── ensureApplyOverride：自愈漏调 applyOverride 的 handler ────────────
// 根因（用户「改墙色没反应」）：handler 设了 userData.__id 却漏调 applyOverride →
// SUB_OVERRIDES 项永不读 → 静默 no-op。本函数在 .add(objVar) 前注入调用。
describe("ensureApplyOverride", () => {
  // A 内联模板：obj.userData.__id = `${node.id}-walls`
  test("A 内联模板：注入 applyOverride 到 .add(objVar) 前", () => {
    const src = [
      `const wall = new THREE.Mesh(geo, mat)`,
      `wall.userData.__id = \`\${node.id}-walls\``,
      `wall.position.set(0, 0, 0)`,
      `group.add(wall)`,
    ].join("\n")
    const { source, injected, reason } = ensureApplyOverride(src, "room-1-walls", "room-1")
    expect(injected).toBe(true)
    expect(reason).toBeUndefined()
    // 注入在 .add(wall) 行前
    const addIdx = source.indexOf("group.add(wall)")
    const injectIdx = source.indexOf("applyOverride(SUB_OVERRIDES, wall,")
    expect(injectIdx).toBeGreaterThan(-1)
    expect(injectIdx).toBeLessThan(addIdx)
  })

  // B 变量模板：const cid = `${node.id}-walls` → obj.userData.__id = cid
  test("B 变量模板：注入 applyOverride（cid 用变量名）", () => {
    const src = [
      `const cid = \`\${node.id}-walls\``,
      `const wall = new THREE.Mesh(geo, mat)`,
      `wall.userData.__id = cid`,
      `group.add(wall)`,
    ].join("\n")
    const { source, injected } = ensureApplyOverride(src, "room-1-walls", "room-1")
    expect(injected).toBe(true)
    // 注入的 cidExpr 须是变量名 cid（与运行时一致），非反引号模板
    expect(source).toContain("applyOverride(SUB_OVERRIDES, wall, cid)")
  })

  test("已存在 applyOverride → 幂等不重注", () => {
    const src = [
      `const wall = new THREE.Mesh(geo, mat)`,
      `wall.userData.__id = \`\${node.id}-walls\``,
      `applyOverride(SUB_OVERRIDES, wall, \`\${node.id}-walls\`)`,
      `group.add(wall)`,
    ].join("\n")
    const { source, injected } = ensureApplyOverride(src, "room-1-walls", "room-1")
    expect(injected).toBe(false)
    expect(source.match(/applyOverride/g)?.length).toBe(1)
  })

  test("无 .add(objVar) → 回退注入到 __id 行后", () => {
    const src = [
      `const wall = new THREE.Mesh(geo, mat)`,
      `wall.userData.__id = \`\${node.id}-walls\``,
      `wall.position.set(0, 0, 0)`,
    ].join("\n")
    const { source, injected } = ensureApplyOverride(src, "room-1-walls", "room-1")
    expect(injected).toBe(true)
    // 注入在 __id 行之后（下一行行首）
    const idIdx = source.indexOf("wall.userData.__id")
    const injectIdx = source.indexOf("applyOverride(SUB_OVERRIDES, wall,")
    expect(injectIdx).toBeGreaterThan(idIdx)
  })

  test("suffix 推不出（__id 不含 nodeId 前缀）→ reason 降级", () => {
    const src = `wall.userData.__id = \`\${node.id}-walls\``
    const { injected, reason } = ensureApplyOverride(src, "other-1-walls", "room-1")
    expect(injected).toBe(false)
    expect(reason).toBeTruthy()
  })

  test("非契约形态（字符串拼接非模板）→ reason 降级", () => {
    const src = `wall.userData.__id = node.id + "-walls"`
    const { injected, reason } = ensureApplyOverride(src, "room-1-walls", "room-1")
    expect(injected).toBe(false)
    expect(reason).toBeTruthy()
  })
})

// ── applySearchReplace：通用 edit_code（Aider 式唯一匹配）──────────────
// all-or-nothing：0 处或 >1 处 → failed，不部分应用。
describe("applySearchReplace", () => {
  test("唯一匹配 → 替换", () => {
    const src = `const wallHeight = 3`
    const { source, failed } = applySearchReplace(src, [
      { search: "wallHeight = 3", replace: "wallHeight = 1.5" },
    ])
    expect(failed).toBeUndefined()
    expect(source).toContain("wallHeight = 1.5")
  })

  test("0 处匹配 → failed（不破源码）", () => {
    const src = `const wallHeight = 3`
    const { source, failed } = applySearchReplace(src, [
      { search: "NOT_EXIST", replace: "x" },
    ])
    expect(failed).toBeDefined()
    expect(failed!.reason).toContain("0 处")
    expect(source).toBe(src) // 原样返回
  })

  test(">1 处匹配 → failed（须唯一）", () => {
    const src = `const a = 1\nconst b = 1`
    const { failed } = applySearchReplace(src, [
      { search: "= 1", replace: "= 2" },
    ])
    expect(failed).toBeDefined()
    expect(failed!.reason).toContain("2 处")
  })

  test("空 search → failed", () => {
    const { failed } = applySearchReplace("const a = 1", [
      { search: "", replace: "x" },
    ])
    expect(failed).toBeDefined()
    expect(failed!.reason).toContain("空")
  })

  test("多条 edit 顺序应用", () => {
    const src = `const a = 1\nconst b = 2`
    const { source, failed } = applySearchReplace(src, [
      { search: "a = 1", replace: "a = 10" },
      { search: "b = 2", replace: "b = 20" },
    ])
    expect(failed).toBeUndefined()
    expect(source).toContain("a = 10")
    expect(source).toContain("b = 20")
  })

  test("replace 含 $& / $1 等模式字符 → 当字面量不当模式（函数式 replace）", () => {
    const src = `const x = "old"`
    const { source, failed } = applySearchReplace(src, [
      { search: `"old"`, replace: `"$&new"` },
    ])
    expect(failed).toBeUndefined()
    // $& 须原样保留，不被 String.replace 解释为匹配模式
    expect(source).toContain(`"$&new"`)
  })
})

// ── isFallbackPartId：引擎兜底 part-N 检测 ───────────────────────────
// part-N 是 manager.stampMissingIds 盖的兜底 __id，applyOverride 不查 →
// commitEdits 写进 SUB_OVERRIDES[part-N] 是死项 → 须走 edit_code 改字面量。
describe("isFallbackPartId", () => {
  test("part-N → true", () => {
    expect(isFallbackPartId("room-1-part-0")).toBe(true)
    expect(isFallbackPartId("racks-1-rack-0-part-12")).toBe(true)
  })

  test("语义 cid → false", () => {
    expect(isFallbackPartId("room-1-walls")).toBe(false)
    expect(isFallbackPartId("racks-1-rack-0")).toBe(false)
  })

  test("part 非结尾 → false（part-N 必须在 __id 末尾）", () => {
    expect(isFallbackPartId("room-1-part-0-extra")).toBe(false)
  })
})

// ── patchHandlerMaterialColor：edit_code 改 color 字面量 ─────────────
// 仅认单 material handler（墙/地板/天花板）；多部件异色 → skip 防改错部件+全变。
describe("patchHandlerMaterialColor", () => {
  test("单色 → 替换首个 color 字面量", () => {
    const src = `const mat = new THREE.MeshStandardMaterial({ color: 0x8899aa })`
    const { source, failed } = patchHandlerMaterialColor(src, "0xff0000")
    expect(failed).toBeUndefined()
    expect(source).toContain("0xff0000")
    expect(source).not.toContain("0x8899aa")
  })

  test("0 个 color 字面量 → failed", () => {
    const src = `const mat = new THREE.MeshStandardMaterial({ roughness: 0.5 })`
    const { failed } = patchHandlerMaterialColor(src, "0xff0000")
    expect(failed).toBeDefined()
    expect(failed!.reason).toContain("未找到")
  })

  test("多部件异色（distinct>1）→ failed 防改错部件+全变", () => {
    const src = [
      `const pole = new THREE.MeshStandardMaterial({ color: 0xaaaaaa })`,
      `const shade = new THREE.MeshStandardMaterial({ color: 0xbbbbbb })`,
      `const bulb = new THREE.MeshStandardMaterial({ color: 0xcccccc })`,
    ].join("\n")
    const { failed } = patchHandlerMaterialColor(src, "0xff0000")
    expect(failed).toBeDefined()
    expect(failed!.reason).toContain("多部件异色")
  })

  test("同色多份（distinct=1 但 count>1）→ failed（无法唯一定位）", () => {
    const src = [
      `const a = new THREE.MeshStandardMaterial({ color: 0x8899aa })`,
      `const b = new THREE.MeshStandardMaterial({ color: 0x8899aa })`,
    ].join("\n")
    const { failed } = patchHandlerMaterialColor(src, "0xff0000")
    expect(failed).toBeDefined()
    expect(failed!.reason).toContain("不唯一")
  })

  test("保空格格式（search verbatim 含原空格）", () => {
    const src = `const mat = new THREE.MeshStandardMaterial({ color:  0x8899aa })`
    const { source, failed } = patchHandlerMaterialColor(src, "0xff0000")
    expect(failed).toBeUndefined()
    // 双空格保留（replace 仅换 hex）
    expect(source).toContain("color:  0xff0000")
  })
})

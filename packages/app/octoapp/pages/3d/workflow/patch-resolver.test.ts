import { describe, expect, test } from "bun:test"
import {
  extractPatchCandidates,
  looksLikeScalarChange,
  searchHandlerForSynonymCid,
  type PatchCandidate,
} from "./patch-resolver"
import type { CodeFile } from "../utils/parse-code-files"

// ── extractPatchCandidates：抽 handler 源码中所有可 patch 的子实例 __id 候选 ──
// 完全字面量 cid / 循环 cid 枚举 / 跳过 SUB_* 声明块 / 中文注释 label。
describe("extractPatchCandidates", () => {
  const merged = {
    room: [{ id: "room-1" }],
    racks: [{ id: "racks-1" }, { id: "racks-2" }],
    // 保留 key 须被剔除
    version: [{ id: "v1" }],
    scene: [{ id: "s1" }],
  }

  test("完全字面量 cid：`${node.id}-floor-0` → 每个根节点展开", () => {
    const files: CodeFile[] = [
      {
        path: "handlers/room/room.ts",
        content: [
          "// 地板",
          `obj.userData.__id = \`\${node.id}-floor-0\``,
        ].join("\n"),
      },
    ]
    const cands = extractPatchCandidates(files, merged)
    // room 下 1 个根节点 room-1 → 1 个候选
    expect(cands.map((c) => c.__id)).toContain("room-1-floor-0")
  })

  test("多根节点展开：racks 有 racks-1/racks-2 → 各一个", () => {
    const files: CodeFile[] = [
      {
        path: "handlers/racks/racks.ts",
        content: `obj.userData.__id = \`\${node.id}-rack-0\``,
      },
    ]
    const cands = extractPatchCandidates(files, merged)
    expect(cands.map((c) => c.__id)).toContain("racks-1-rack-0")
    expect(cands.map((c) => c.__id)).toContain("racks-2-rack-0")
  })

  test("循环 cid `${node.id}-rack-${i++}` → 字面量上界 N 枚举 0..N-1", () => {
    const files: CodeFile[] = [
      {
        path: "handlers/racks/racks.ts",
        content: [
          `for (let i = 0; i < 4; i++) {`,
          `  obj.userData.__id = \`\${node.id}-rack-\${i++}\``,
          `}`,
        ].join("\n"),
      },
    ]
    const cands = extractPatchCandidates(files, merged)
    // racks-1 有 4 个：rack-0..rack-3
    const ids = cands.map((c) => c.__id).filter((x) => x.startsWith("racks-1-rack-"))
    expect(ids).toEqual(
      expect.arrayContaining(["racks-1-rack-0", "racks-1-rack-1", "racks-1-rack-2", "racks-1-rack-3"]),
    )
  })

  test("循环 cid 数组长度上界 `arr.length` → 反推 count", () => {
    const files: CodeFile[] = [
      {
        path: "handlers/racks/racks.ts",
        content: [
          `const positions = [1, 2, 3]`,
          `for (let i = 0; i < positions.length; i++) {`,
          `  obj.userData.__id = \`\${node.id}-bay-\${i}\``,
          `}`,
        ].join("\n"),
      },
    ]
    const cands = extractPatchCandidates(files, merged)
    const ids = cands.map((c) => c.__id).filter((x) => x.startsWith("racks-1-bay-"))
    expect(ids).toHaveLength(3)
  })

  test("跳过 SUB_OVERRIDES 声明块：块内字面量不抽成候选（防假候选喂 triage）", () => {
    const files: CodeFile[] = [
      {
        path: "handlers/racks/racks.ts",
        content: [
          `const SUB_OVERRIDES = {`,
          `  "racks-1-fake-0": { "material": { "color": "#fff" } }`,
          `};`,
          `obj.userData.__id = \`\${node.id}-real-0\``,
        ].join("\n"),
      },
    ]
    const cands = extractPatchCandidates(files, merged)
    const ids = cands.map((c) => c.__id)
    expect(ids).toContain("racks-1-real-0")
    // SUB_OVERRIDES 块内的 fake-0 不该被抽成候选
    expect(ids).not.toContain("racks-1-fake-0")
  })

  test("跳过 SUB_SKIP / SUB_ADD 声明块", () => {
    const files: CodeFile[] = [
      {
        path: "handlers/racks/racks.ts",
        content: [
          `const SUB_SKIP = ["racks-1-skip-0"];`,
          `const SUB_ADD = [{ "cid": "racks-1-add-0", "position": [0,0,0] }];`,
          `obj.userData.__id = \`\${node.id}-keep-0\``,
        ].join("\n"),
      },
    ]
    const ids = extractPatchCandidates(files, merged).map((c) => c.__id)
    expect(ids).toContain("racks-1-keep-0")
    expect(ids).not.toContain("racks-1-skip-0")
    expect(ids).not.toContain("racks-1-add-0")
  })

  test("中文注释作 label", () => {
    const files: CodeFile[] = [
      {
        path: "handlers/room/room.ts",
        content: [
          `// 地板层`,
          `obj.userData.__id = \`\${node.id}-floor-0\``,
        ].join("\n"),
      },
    ]
    const cand = extractPatchCandidates(files, merged).find((c) => c.__id === "room-1-floor-0")
    expect(cand).toBeDefined()
    expect(cand!.label).toBe("地板层")
  })

  test("无中文注释 → suffix 作 label", () => {
    const files: CodeFile[] = [
      {
        path: "handlers/room/room.ts",
        content: `obj.userData.__id = \`\${node.id}-floor-0\``,
      },
    ]
    const cand = extractPatchCandidates(files, merged).find((c) => c.__id === "room-1-floor-0")
    expect(cand).toBeDefined()
    expect(cand!.label).toBe("floor-0")
  })

  test("候选去重（同 __id 不重复入）", () => {
    const files: CodeFile[] = [
      {
        path: "handlers/room/room.ts",
        content: [
          `obj.userData.__id = \`\${node.id}-floor-0\``,
          `obj2.userData.__id = \`\${node.id}-floor-0\``,
        ].join("\n"),
      },
    ]
    const cands = extractPatchCandidates(files, merged).filter((c) => c.__id === "room-1-floor-0")
    expect(cands).toHaveLength(1)
  })

  test("保留 key（version/scene/camera/lights/remove）的 type 不抽候选", () => {
    const files: CodeFile[] = [
      {
        path: "handlers/version/version.ts",
        content: `obj.userData.__id = \`\${node.id}-x-0\``,
      },
    ]
    const cands = extractPatchCandidates(files, merged)
    expect(cands.every((c) => c.type !== "version")).toBe(true)
  })

  test("字符串字面量 cid（已展开）按 nodeId 前缀匹配", () => {
    const files: CodeFile[] = [
      {
        path: "handlers/room/room.ts",
        content: `obj.userData.__id = "room-1-floor-0"`,
      },
    ]
    const cands = extractPatchCandidates(files, merged)
    expect(cands.map((c) => c.__id)).toContain("room-1-floor-0")
  })

  test("type/nodeId 反查正确", () => {
    const files: CodeFile[] = [
      {
        path: "handlers/racks/racks.ts",
        content: `obj.userData.__id = \`\${node.id}-rack-0\``,
      },
    ]
    const cand = extractPatchCandidates(files, merged).find((c) => c.__id === "racks-1-rack-0")
    expect(cand).toBeDefined()
    expect(cand!.type).toBe("racks")
    expect(cand!.nodeId).toBe("racks-1")
  })

  test("空文件列表 → 空数组", () => {
    expect(extractPatchCandidates([], merged)).toEqual([])
  })

  test("无根节点 → 空数组", () => {
    expect(extractPatchCandidates([], {})).toEqual([])
  })

  test("非 handlers 路径文件跳过", () => {
    const files: CodeFile[] = [
      {
        path: "src/utils/helper.ts",
        content: `obj.userData.__id = \`\${node.id}-floor-0\``,
      },
    ]
    expect(extractPatchCandidates(files, merged)).toEqual([])
  })
})

// ── looksLikeScalarChange：标量改动轻量门 ────────────────────────────
// 宽网：误报只多一次再问（不崩）；漏报才危险（标量改动漏掉 → 重建）。
describe("looksLikeScalarChange", () => {
  const truthy = [
    "把墙变成红色",
    "机柜颜色改成蓝色",
    "地板材质改成金属",
    "把小车前移 2 米",
    "机柜旋转 90 度",
    "放大灯光",
    "缩小集装箱",
    "改一下天花板高度",
    "墙的粗糙度调高",
    "灯柱漆成白色",
  ]
  for (const s of truthy) {
    test(`标量改动 → true：${s}`, () => {
      expect(looksLikeScalarChange(s)).toBe(true)
    })
  }

  const falsy = [
    "加一个喷泉",
    "删掉天花板",
    "去掉所有机柜",
    "换成纹理贴图",
    "新建一排货架",
  ]
  for (const s of falsy) {
    test(`结构性改动 → false：${s}`, () => {
      expect(looksLikeScalarChange(s)).toBe(false)
    })
  }
})

// ── searchHandlerForSynonymCid：triage 臆造 __id 的同义词兜底 ────────
// container/cargo/crate → box；先查候选清单命中，再扫源码确认模板存在。
describe("searchHandlerForSynonymCid", () => {
  const candidates: PatchCandidate[] = [
    { __id: "racks-1-box-0", label: "box-0", type: "racks", nodeId: "racks-1" },
    { __id: "racks-1-box-1", label: "box-1", type: "racks", nodeId: "racks-1" },
  ]

  test("container → box：先查候选清单命中", () => {
    const files: CodeFile[] = []
    const got = searchHandlerForSynonymCid("racks-1-container-0", candidates, files)
    expect(got).not.toBeNull()
    expect(got!.__id).toBe("racks-1-box-0")
  })

  test("cargo → box：候选清单命中", () => {
    const got = searchHandlerForSynonymCid("racks-1-cargo-1", candidates, [])
    expect(got).not.toBeNull()
    expect(got!.__id).toBe("racks-1-box-1")
  })

  test("crate → box：候选清单无 → 扫源码确认模板存在", () => {
    const files: CodeFile[] = [
      {
        path: "handlers/racks/racks.ts",
        content: `obj.userData.__id = \`\${node.id}-box-\${i}\``,
      },
    ]
    // 候选清单只给 box-0/box-1，查 box-9 不在 → 扫源码
    const got = searchHandlerForSynonymCid("racks-1-crate-9", candidates, files)
    expect(got).not.toBeNull()
    expect(got!.__id).toBe("racks-1-box-9")
  })

  test("非同义词（unknown）→ null", () => {
    expect(searchHandlerForSynonymCid("racks-1-unknown-0", candidates, [])).toBeNull()
  })

  test("__id 段数不足 3 → null", () => {
    expect(searchHandlerForSynonymCid("racks-1", candidates, [])).toBeNull()
  })

  test("index 非数字 → null", () => {
    expect(searchHandlerForSynonymCid("racks-1-container-x", candidates, [])).toBeNull()
  })

  test("候选清单无 + 源码无模板 → null", () => {
    const files: CodeFile[] = [
      { path: "handlers/racks/racks.ts", content: "const x = 1" },
    ]
    expect(searchHandlerForSynonymCid("racks-1-crate-9", candidates, files)).toBeNull()
  })
})

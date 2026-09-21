import { describe, expect, test } from "bun:test"

import {
  convertTailwindToCSS,
  convertTailwindToCSSGrouped,
  convertTailwindToLessRule,
  generateLessContent,
} from "./tailwind-to-css"

// tailwind-to-css 转换器守卫。
// 依赖项：测试启动时模块级 designSystem 必须成功初始化（__unstable__loadDesignSystem），
// 否则所有用例会因返回 {} / null 而批量挂掉——这本身也是一条隐式守卫。
// 期望值取自项目 tailwindConfig（colors/spacing/boxShadow/borderRadius/fontSize 等 extend），
// 不是猜测：用 probe 脚本对真实 designSystem 采样后固化为断言。

// ─── 基础工具类（useVar=false，值完全解析为字面量） ─────────────────────
describe("convertTailwindToCSS 基础工具类", () => {
  test("display 类直出字面量", () => {
    expect(convertTailwindToCSS("flex")).toEqual({ display: "flex" })
    expect(convertTailwindToCSS("block")).toEqual({ display: "block" })
    expect(convertTailwindToCSS("hidden")).toEqual({ display: "none" })
  })

  test("align/justify 类直出字面量", () => {
    expect(convertTailwindToCSS("items-center")).toEqual({ alignItems: "center" })
    expect(convertTailwindToCSS("justify-center")).toEqual({ justifyContent: "center" })
  })

  test("spacing 数字刻度 calc(var(--spacing)*N) 折算为 Npx", () => {
    expect(convertTailwindToCSS("h-15")).toEqual({ height: "60px" })
    expect(convertTailwindToCSS("w-480")).toEqual({ width: "1920px" })
    expect(convertTailwindToCSS("p-4")).toEqual({ padding: "16px" })
    expect(convertTailwindToCSS("mt-8")).toEqual({ marginTop: "32px" })
  })

  test("mt-0 走 v4 特例直出 0（不经 calc）", () => {
    expect(convertTailwindToCSS("mt-0")).toEqual({ marginTop: "0" })
  })

  test("自定义 spacing token（page/inline/stack）解析为配置的 rem 值", () => {
    expect(convertTailwindToCSS("px-page")).toEqual({ paddingLeft: "2rem", paddingRight: "2rem" })
    expect(convertTailwindToCSS("p-inline")).toEqual({ padding: "0.5rem" })
    expect(convertTailwindToCSS("py-stack")).toEqual({ paddingTop: "0.75rem", paddingBottom: "0.75rem" })
  })

  test("主题颜色类解析到 var() 链兜底字面量", () => {
    expect(convertTailwindToCSS("bg-primary")).toEqual({ backgroundColor: "#0067D1" })
    expect(convertTailwindToCSS("bg-surface-container-highest")).toEqual({ backgroundColor: "#FFFFFF" })
    expect(convertTailwindToCSS("text-on-surface")).toEqual({ color: "#191919" })
    expect(convertTailwindToCSS("bg-error")).toEqual({ backgroundColor: "#E02128" })
  })

  test("boxShadow 解析 var(--shadow-*) 链并保留占位层", () => {
    expect(convertTailwindToCSS("shadow-sm")).toEqual({
      boxShadow: "0 0 #0000, 0 0 #0000, 0 0 #0000, 0 0 #0000, 0px 1px 6px 0 rgba(0, 0, 0, 0.08)",
    })
    expect(convertTailwindToCSS("shadow-md")).toEqual({
      boxShadow: "0 0 #0000, 0 0 #0000, 0 0 #0000, 0 0 #0000, 0 8px 24px rgba(0, 0, 0, 0.08)",
    })
    // shadow-card 别名同 shadow-sm（boxShadow.card 复用 --shadow-sm）
    expect(convertTailwindToCSS("shadow-card")).toEqual({
      boxShadow: "0 0 #0000, 0 0 #0000, 0 0 #0000, 0 0 #0000, 0px 1px 6px 0 rgba(0, 0, 0, 0.08)",
    })
  })

  test("borderRadius 解析 var(--radius-*)", () => {
    expect(convertTailwindToCSS("rounded-none")).toEqual({ borderRadius: "0px" })
    expect(convertTailwindToCSS("rounded-lg")).toEqual({ borderRadius: "8px" })
    expect(convertTailwindToCSS("rounded-full")).toEqual({ borderRadius: "9999px" })
  })

  test("fontSize 解析 size + lineHeight", () => {
    expect(convertTailwindToCSS("text-sm")).toEqual({ fontSize: "12px", lineHeight: "1.6" })
    expect(convertTailwindToCSS("text-2xl")).toEqual({ fontSize: "20px", lineHeight: "1.4" })
  })

  test("任意值 [..] 原样透传", () => {
    expect(convertTailwindToCSS("w-[226px]")).toEqual({ width: "226px" })
    expect(convertTailwindToCSS("h-[50vh]")).toEqual({ height: "50vh" })
  })
})

// ─── 逻辑属性 → 物理属性映射（logicalToPhysical） ──────────────────────
describe("convertTailwindToCSS 逻辑属性→物理映射", () => {
  test("px-* (padding-inline) 拆为 paddingLeft/Right", () => {
    expect(convertTailwindToCSS("px-4")).toEqual({ paddingLeft: "16px", paddingRight: "16px" })
  })
  test("py-* (padding-block) 拆为 paddingTop/Bottom", () => {
    expect(convertTailwindToCSS("py-4")).toEqual({ paddingTop: "16px", paddingBottom: "16px" })
  })
  test("mx-* (margin-inline) 拆为 marginLeft/Right", () => {
    expect(convertTailwindToCSS("mx-4")).toEqual({ marginLeft: "16px", marginRight: "16px" })
  })
  test("my-* (margin-block) 拆为 marginTop/Bottom", () => {
    expect(convertTailwindToCSS("my-4")).toEqual({ marginTop: "16px", marginBottom: "16px" })
  })
})

// ─── !important 处理（含本次 bug 修复回归） ─────────────────────────────
describe("convertTailwindToCSS !important 处理", () => {
  test("单 ! 前缀给简单声明追加 !important", () => {
    expect(convertTailwindToCSS("!flex")).toEqual({ display: "flex !important" })
  })

  test("!shadow-sm 仅一个 !important（修复前为 '!important !important'）", () => {
    const out = convertTailwindToCSS("!shadow-sm")
    expect(out.boxShadow).toBe(
      "0 0 #0000, 0 0 #0000, 0 0 #0000, 0 0 #0000, 0px 1px 6px 0 rgba(0, 0, 0, 0.08) !important",
    )
    // 关键：不能出现双重 !important（回归守卫）
    expect(out.boxShadow?.match(/!important/g)?.length).toBe(1)
  })

  test("无 ! 的 shadow-sm 不带 !important（剥离局部 --tw-shadow 的 !important 不误伤）", () => {
    const out = convertTailwindToCSS("shadow-sm")
    expect(out.boxShadow?.includes("!important")).toBe(false)
  })

  test("混合 ! 类与普通类：! 前缀逐类生效，rounded-none 不带 !", () => {
    const out = convertTailwindToCSS(
      "!flex !items-center !h-15 !px-page !bg-surface-container-highest !shadow-sm !w-480 !mt-0 !mx-0 rounded-none",
    )
    expect(out).toEqual({
      display: "flex !important",
      alignItems: "center !important",
      height: "60px !important",
      paddingLeft: "2rem !important",
      paddingRight: "2rem !important",
      backgroundColor: "#FFFFFF !important",
      boxShadow: "0 0 #0000, 0 0 #0000, 0 0 #0000, 0 0 #0000, 0px 1px 6px 0 rgba(0, 0, 0, 0.08) !important",
      width: "1920px !important",
      marginTop: "0 !important",
      marginLeft: "0 !important",
      marginRight: "0 !important",
      borderRadius: "0px",
    })
    // 全量回归守卫：任一值都不应出现双 !important
    for (const v of Object.values(out)) {
      const n = v.match(/!important/g)?.length ?? 0
      expect(n).toBeLessThanOrEqual(1)
    }
  })
})

// ─── useVar=true（保留运行时可覆盖 var，shadow 占位层简化） ──────────────
describe("convertTailwindToCSS useVar=true", () => {
  test("颜色类保留 var(--color-bg-2) 形式", () => {
    expect(convertTailwindToCSS("bg-surface-container-highest", true)).toEqual({
      backgroundColor: "var(--color-bg-2)",
    })
  })

  test("shadow 简化为单个 var(--shadow-sm)（剥离前导 0 0 #0000, 占位层）", () => {
    expect(convertTailwindToCSS("shadow-sm", true)).toEqual({ boxShadow: "var(--shadow-sm)" })
  })

  test("无 var 的声明不受 useVar 影响", () => {
    expect(convertTailwindToCSS("flex", true)).toEqual({ display: "flex" })
  })

  test("useVar=true 下 !shadow-sm 仍是单 !important", () => {
    const out = convertTailwindToCSS("!shadow-sm", true)
    expect(out.boxShadow).toBe("var(--shadow-sm) !important")
    expect(out.boxShadow?.match(/!important/g)?.length).toBe(1)
  })
})

// ─── 边界 ──────────────────────────────────────────────────────────────
describe("convertTailwindToCSS 边界", () => {
  test("空串/纯空白返回 {}", () => {
    expect(convertTailwindToCSS("")).toEqual({})
    expect(convertTailwindToCSS("   ")).toEqual({})
    expect(convertTailwindToCSS("\t\n")).toEqual({})
  })

  test("无效候选被 candidatesToCss 跳过，返回 {}", () => {
    expect(convertTailwindToCSS("not-a-real-class-zzz")).toEqual({})
  })

  test("有效+无效混合只保留有效类的声明", () => {
    expect(convertTailwindToCSS("flex not-a-real-class-zzz items-center")).toEqual({
      display: "flex",
      alignItems: "center",
    })
  })
})

// ─── Grouped 变体解析（伪类 / 媒体查询） ─────────────────────────────────
describe("convertTailwindToCSSGrouped 变体解析", () => {
  test("base 与 variant 分离：base 空、hover 进 variants", () => {
    const g = convertTailwindToCSSGrouped("flex hover:bg-primary")
    expect(g.base).toEqual({ display: "flex" })
    expect(g.variants).toHaveLength(1)
    const v = g.variants[0]
    expect(v.pseudos).toEqual(["&:hover"])
    // hover 在 v4 走 (hover: hover) 媒体守卫
    expect(v.mediaQueries).toContain("(hover: hover)")
    expect(v.props).toEqual({ backgroundColor: "#0067D1" })
  })

  test("响应式 md: 仅媒体查询、无伪类", () => {
    const v = convertTailwindToCSSGrouped("md:flex").variants[0]
    expect(v.pseudos).toEqual([])
    expect(v.mediaQueries).toContain("(width >= 48rem)")
    expect(v.props).toEqual({ display: "flex" })
  })

  test("dark: 走 prefers-color-scheme 媒体查询", () => {
    const v = convertTailwindToCSSGrouped("dark:bg-primary").variants[0]
    expect(v.pseudos).toEqual([])
    expect(v.mediaQueries).toContain("(prefers-color-scheme: dark)")
  })

  test("rtl: 产出 :dir(rtl) 伪类（断言含关键子串，不绑定完整选择器文本）", () => {
    const v = convertTailwindToCSSGrouped("rtl:flex").variants[0]
    expect(v.mediaQueries).toEqual([])
    expect(v.pseudos).toHaveLength(1)
    expect(v.pseudos[0]).toContain(":dir(rtl)")
    expect(v.props).toEqual({ display: "flex" })
  })

  test("group-hover: 产出组合伪类 + hover 媒体守卫", () => {
    const v = convertTailwindToCSSGrouped("group-hover:bg-primary").variants[0]
    expect(v.pseudos[0]).toContain(".group")
    expect(v.mediaQueries).toContain("(hover: hover)")
    expect(v.props).toEqual({ backgroundColor: "#0067D1" })
  })

  test("focus: 伪类无媒体查询", () => {
    const v = convertTailwindToCSSGrouped("focus:outline-brand").variants[0]
    expect(v.pseudos).toEqual(["&:focus"])
    expect(v.mediaQueries).toEqual([])
    expect(v.props).toEqual({ outlineColor: "#0067D1" })
  })

  test("同 (pseudos, medias) 组合跨类合并到同 variant", () => {
    const g = convertTailwindToCSSGrouped("hover:bg-primary hover:bg-error")
    expect(g.variants).toHaveLength(1)
    expect(g.variants[0].props).toEqual({ backgroundColor: "#E02128" })
  })

  test("base+variant+responsive 三者并存", () => {
    const g = convertTailwindToCSSGrouped("flex hover:bg-primary md:block")
    expect(g.base).toEqual({ display: "flex" })
    expect(g.variants).toHaveLength(2)
    expect(g.variants.some(v => v.pseudos.includes("&:hover"))).toBe(true)
    expect(g.variants.some(v => v.mediaQueries.includes("(width >= 48rem)"))).toBe(true)
  })
})

// ─── LessRule 产出（选择器折叠 / importantSizing / null） ────────────────
describe("convertTailwindToLessRule", () => {
  test("base + variants 折叠：hover→.my:hover，md→@media 包裹 .my", () => {
    const r = convertTailwindToLessRule("flex hover:bg-primary md:block", ".my")
    expect(r).not.toBeNull()
    expect(r!.selector).toBe(".my")
    expect(r!.declarations).toEqual([{ prop: "display", value: "flex" }])
    expect(r!.variants).toHaveLength(2)
    const hover = r!.variants.find(v => v.selector === ".my:hover")!
    expect(hover.mediaQueries).toContain("(hover: hover)")
    expect(hover.declarations).toEqual([{ prop: "background-color", value: "#0067D1" }])
    const md = r!.variants.find(v => v.mediaQueries.includes("(width >= 48rem)"))!
    expect(md.selector).toBe(".my")
    expect(md.declarations).toEqual([{ prop: "display", value: "block" }])
  })

  test("importantSizing 仅给 width/height 加 !important，display 不加", () => {
    const r = convertTailwindToLessRule("w-100 h-50 flex", ".c", { importantSizing: true })
    const byProp = (p: string) => r!.declarations.find(d => d.prop === p)!.value
    expect(byProp("width")).toBe("400px !important")
    expect(byProp("height")).toBe("200px !important")
    expect(byProp("display")).toBe("flex")
  })

  test("空/无效 className 返回 null", () => {
    expect(convertTailwindToLessRule("", ".x")).toBeNull()
    expect(convertTailwindToLessRule("   ", ".x")).toBeNull()
    expect(convertTailwindToLessRule("not-a-real-class-zzz", ".x")).toBeNull()
  })
})

// ─── LESS 文本序列化 ───────────────────────────────────────────────────
describe("generateLessContent", () => {
  test("空规则数组只产头部注释", () => {
    expect(generateLessContent([])).toBe("// Auto-generated by a2ui-transformer\n")
  })

  test("base + @media 包裹的 variant 各成块", () => {
    const out = generateLessContent([
      convertTailwindToLessRule("flex hover:bg-primary md:block", ".my")!,
    ])
    expect(out).toContain(".my {\n  display: flex;\n}")
    expect(out).toContain("@media (hover: hover) {\n  .my:hover {\n    background-color: #0067D1;\n  }\n}")
    expect(out).toContain("@media (width >= 48rem) {\n  .my {\n    display: block;\n  }\n}")
    expect(out.startsWith("// Auto-generated by a2ui-transformer")).toBe(true)
  })

  test("importantSizing 的 !important 透传到 LESS 文本", () => {
    const out = generateLessContent([convertTailwindToLessRule("w-100 h-50 flex", ".c", { importantSizing: true })!])
    expect(out).toContain("width: 400px !important;")
    expect(out).toContain("height: 200px !important;")
    expect(out).toContain("display: flex;")
  })
})

import { describe, expect, test } from "bun:test"
import {
  EXECUTE_TOOL_DESCRIPTION,
  OUTPUT_BUDGET_CHARS,
  SEARCH_TOOLS_DESCRIPTION,
  clampMaxResults,
  formatAnnouncement,
  parseQuery,
  rankTools,
  scoreTool,
  searchDeferredTools,
  type DeferredTool,
} from "../../src/tool/tool-search"

function entry(name: string, description: string, schema: object = { type: "object" }): DeferredTool {
  return {
    name,
    description,
    schema: schema as DeferredTool["schema"],
    execute: async () => undefined,
  }
}

const bucket: Record<string, DeferredTool> = {
  bash: entry(
    "bash",
    "Runs a shell command. Supports background commands, timeouts, and file argument appending.",
    { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  ),
  fetch: entry("fetch", "Fetches a file from a URL and converts it to markdown for the model."),
  pixso_get_file: entry("pixso_get_file", "Get a design file from Pixso by file key."),
}

describe("tool-search.parseQuery", () => {
  test("select form parses comma-separated names", () => {
    expect(parseQuery("select:bash, fetch")).toEqual({ kind: "select", names: ["bash", "fetch"] })
  })

  test("select form drops empty segments", () => {
    expect(parseQuery("select: bash ,,")).toEqual({ kind: "select", names: ["bash"] })
  })

  test("discover form falls back to keyword tokens", () => {
    expect(parseQuery("discover: run shell")).toEqual({ kind: "keywords", terms: ["run", "shell"] })
  })

  test("plain text becomes lowercase keyword tokens", () => {
    expect(parseQuery("  Run SHELL! ")).toEqual({ kind: "keywords", terms: ["run", "shell"] })
  })

  test("empty query yields no terms", () => {
    expect(parseQuery("   ")).toEqual({ kind: "keywords", terms: [] })
  })
})

describe("tool-search.scoreTool", () => {
  test("exact name match scores highest", () => {
    expect(scoreTool("bash", "Runs shell commands", ["bash"])).toBe(6)
  })

  test("word-boundary name match beats substring", () => {
    const word = scoreTool("pixso_get_file", "design file", ["get"])
    const substring = scoreTool("pixso_get_file", "design file", ["g"])
    expect(word).toBe(4)
    expect(substring).toBe(3)
  })

  test("description-only match scores lowest", () => {
    expect(scoreTool("bash", "Runs shell commands", ["design"])).toBe(0)
    expect(scoreTool("bash", "design file export", ["design"])).toBe(1)
  })

  test("score accumulates across terms", () => {
    // bash exact name (6) + "shell" description (1) + "background" description (1)
    const score = scoreTool("bash", "Runs shell commands in the background", ["bash", "shell", "background"])
    expect(score).toBe(8)
  })
})

describe("tool-search.rankTools", () => {
  test("ranks by score desc, name asc on ties, caps at limit", () => {
    const ranked = rankTools(bucket, ["file", "design"], 2)
    // pixso_get_file: "file" word match (4) + "design" description (1) = 5;
    // bash 与 fetch 均只有 "file" description (1) 分,并列后按名字序 bash 在前
    expect(ranked.map((e) => e.name)).toEqual(["pixso_get_file", "bash"])

    const single = rankTools(bucket, ["file", "design"], 1)
    expect(single.map((e) => e.name)).toEqual(["pixso_get_file"])
  })

  test("ties break alphabetically", () => {
    const local: Record<string, DeferredTool> = {
      b_tool: entry("b_tool", "batch export"),
      a_tool: entry("a_tool", "batch export"),
    }
    expect(rankTools(local, ["export"], 5).map((e) => e.name)).toEqual(["a_tool", "b_tool"])
  })

  test("zero-score tools are excluded", () => {
    expect(rankTools(bucket, ["kubernetes"], 5)).toEqual([])
  })
})

describe("tool-search.searchDeferredTools", () => {
  test("select returns full details with schema", () => {
    const out = searchDeferredTools(bucket, "select:bash", 5)
    expect(out).toContain("Found 1 deferred tool(s)")
    expect(out).toContain("### bash")
    expect(out).toContain('"required": [')
    expect(out).toContain('"command"')
    expect(out).toContain('execute_tool: {"tool_name": "<name>", "params": {...}}')
  })

  test("select reports missing names with available list", () => {
    const out = searchDeferredTools(bucket, "select:nope", 5)
    expect(out).toContain('No deferred tool named "nope"')
    expect(out).toContain("Available deferred tools: bash, fetch, pixso_get_file")
  })

  test("keyword search formats ranked matches", () => {
    const out = searchDeferredTools(bucket, "design", 5)
    expect(out).toContain("### pixso_get_file")
    expect(out).not.toContain("### bash")
  })

  test("keyword miss lists available tools", () => {
    const out = searchDeferredTools(bucket, "kubernetes", 5)
    expect(out).toContain("No deferred tools matched kubernetes")
  })

  test("empty query lists available tools", () => {
    expect(searchDeferredTools(bucket, "", 5)).toContain("Empty query")
  })

  test("empty select query returns guidance with available list", () => {
    const out = searchDeferredTools(bucket, "select:", 5)
    expect(out).toContain("Empty select: query")
    expect(out).toContain("Available deferred tools: bash, fetch, pixso_get_file")
  })

  test("non-numeric max_results falls back to 5 instead of clearing results", () => {
    // 历史缺陷:Number("notanumber") || 5 兜底前,NaN 直接流入 slice(0, NaN) 会清空结果
    const out = searchDeferredTools(bucket, "file", "notanumber")
    expect(out).toContain("Found 3 deferred tool(s)")
  })

  test("max_results below 1 is clamped up to 1", () => {
    const out = searchDeferredTools(bucket, "file", 0)
    expect(out).toContain("Found 1 deferred tool(s)")
    expect(out).toContain("### pixso_get_file")
  })

  test("max_results above 20 is clamped down", () => {
    const local: Record<string, DeferredTool> = {}
    for (let i = 0; i < 25; i++) local[`kw_${i}`] = entry(`kw_${i}`, "shared description keyword")
    const out = searchDeferredTools(local, "keyword", 500)
    expect(out).toContain("Found 20 deferred tool(s)")
  })

  test("select caps requested names at 16 with footer", () => {
    const local: Record<string, DeferredTool> = {}
    for (let i = 0; i < 20; i++) local[`sel_${i}`] = entry(`sel_${i}`, "selected tool")
    const names = Array.from({ length: 20 }, (_, i) => `sel_${i}`).join(",")
    const out = searchDeferredTools(local, `select:${names}`, 5)
    expect(out).toContain("Only the first 16 of 20 requested names")
    expect(out).toContain("### sel_0")
    expect(out).not.toContain("### sel_16")
  })

  test("budget truncates whole entries and keeps the first entry complete", () => {
    // 15k×2 ≈ 30k > 24k 预算 → 第二条起进省略名单;首条(即使单独超预算)完整保留
    const big = "x".repeat(15_000)
    const local: Record<string, DeferredTool> = {
      big_a: entry("big_a", big),
      big_b: entry("big_b", big),
      big_c: entry("big_c", big),
    }
    const out = searchDeferredTools(local, "select:big_a,big_b,big_c", 5)
    expect(out).toContain("### big_a")
    expect(out).not.toContain("### big_b")
    expect(out).toContain("+2 more tools not shown (big_b, big_c)")
    expect(out).toContain("Call select:Name to fetch them individually.")
  })

  test("first entry is kept whole even when it alone exceeds the budget", () => {
    const huge = "y".repeat(OUTPUT_BUDGET_CHARS + 1_000)
    const local: Record<string, DeferredTool> = {
      huge_a: entry("huge_a", huge),
      small_b: entry("small_b", "tiny"),
    }
    const out = searchDeferredTools(local, "select:huge_a,small_b", 5)
    expect(out).toContain("### huge_a")
    expect(out.length).toBeGreaterThan(OUTPUT_BUDGET_CHARS)
    expect(out).toContain("+1 more tools not shown (small_b)")
  })

  test("available name list caps at 50 with pointer to announcement", () => {
    const local: Record<string, DeferredTool> = {}
    for (let i = 0; i < 60; i++) local[`mcp_tool_${i}`] = entry(`mcp_tool_${i}`, "desc")
    const out = searchDeferredTools(local, "nomatchkeyword", 5)
    expect(out).toContain("(+10 more, see <available-deferred-tools> in system)")
    expect(out).not.toContain("mcp_tool_59")
  })
})

describe("tool-search.clampMaxResults", () => {
  test("clamps into [1, 20] and falls back to 5 on non-finite input", () => {
    expect(clampMaxResults(0)).toBe(1)
    expect(clampMaxResults(-3)).toBe(1)
    expect(clampMaxResults(2.7)).toBe(2)
    expect(clampMaxResults(500)).toBe(20)
    expect(clampMaxResults(NaN)).toBe(5)
    expect(clampMaxResults(undefined)).toBe(5)
    expect(clampMaxResults("notanumber")).toBe(5)
  })
})

describe("tool-search.formatAnnouncement", () => {
  test("lists sorted names inside the tag", () => {
    const out = formatAnnouncement(["fetch", "bash", "pixso_get_file"])
    expect(out).toStartWith("<available-deferred-tools>")
    expect(out).toEndWith("</available-deferred-tools>")
    const body = out.split("\n")
    expect(body.slice(2, 5)).toEqual(["- bash", "- fetch", "- pixso_get_file"])
  })
})

describe("tool-search descriptions", () => {
  test("meta tool descriptions reference each other and the announcement tag", () => {
    expect(SEARCH_TOOLS_DESCRIPTION).toContain("<available-deferred-tools>")
    expect(SEARCH_TOOLS_DESCRIPTION).toContain("execute_tool")
    expect(EXECUTE_TOOL_DESCRIPTION).toContain("search_tools")
    expect(EXECUTE_TOOL_DESCRIPTION).toContain("NOT a remote or external tool")
  })
})

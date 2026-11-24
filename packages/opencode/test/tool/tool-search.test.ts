import { describe, expect, test } from "bun:test"
import {
  EXECUTE_TOOL_DESCRIPTION,
  SEARCH_TOOLS_DESCRIPTION,
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

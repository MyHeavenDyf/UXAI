import { describe, expect, test } from "bun:test"
import { basename, canOpenLocally, findEditCards, findWriteCards, findWriteOnlyCards, langFromPath } from "./write-output"

function toolPart(tool: unknown, status: string, metaPath?: string, inputPath?: string) {
  const state: Record<string, unknown> = { status }
  if (metaPath) state.metadata = { filepath: metaPath }
  if (inputPath) state.input = { filePath: inputPath }
  return { type: "tool", tool, state }
}

describe("canOpenLocally", () => {
  test("returns false for executable extensions", () => {
    expect(canOpenLocally("app.exe")).toBe(false)
    expect(canOpenLocally("lib.so")).toBe(false)
    expect(canOpenLocally("module.wasm")).toBe(false)
  })

  test("returns true for normal files", () => {
    expect(canOpenLocally("report.md")).toBe(true)
    expect(canOpenLocally("index.html")).toBe(true)
    expect(canOpenLocally("data.csv")).toBe(true)
  })
})

describe("basename", () => {
  test("handles forward slashes", () => {
    expect(basename("/a/b/c.md")).toBe("c.md")
  })

  test("handles backslashes", () => {
    expect(basename("C:\\a\\b\\c.md")).toBe("c.md")
  })

  test("returns input when no separator", () => {
    expect(basename("file.md")).toBe("file.md")
  })
})

describe("langFromPath", () => {
  test("maps known extensions", () => {
    expect(langFromPath("foo.ts")).toBe("typescript")
    expect(langFromPath("bar.py")).toBe("python")
    expect(langFromPath("Makefile")).toBe("makefile")
  })

  test("falls back to text", () => {
    expect(langFromPath("README")).toBe("text")
    expect(langFromPath("foo.unknown")).toBe("text")
  })

  test("recognizes Dockerfile by basename", () => {
    expect(langFromPath("Dockerfile")).toBe("docker")
    expect(langFromPath("/project/Dockerfile")).toBe("docker")
  })
})

describe("findWriteCards / findWriteOnlyCards / findEditCards", () => {
  const parts = [
    toolPart("write", "completed", "/out/report.md"),
    toolPart("edit", "completed", "/out/report.md"),
    toolPart("write", "completed", "/out/index.html"),
    toolPart("mcp:edit", "completed", "/out/data.csv"),
    toolPart("client_write", "completed", "/out/a.ts"),
    toolPart("client_edit", "completed", "/out/b.ts"),
    toolPart("read", "completed", "/out/ignored.md"),
    toolPart("bash", "completed", "/out/ignored2.md"),
    toolPart("write", "running", "/out/pending.md"),
    toolPart(123, "completed", "/out/bad.md"),
    toolPart("write", "completed", undefined, "/out/fallback.md"),
    toolPart(null, "completed", "/out/null-tool.md"),
  ]

  describe("findWriteCards", () => {
    test("matches both write and edit tools", () => {
      const cards = findWriteCards(parts)
      const paths = cards.map((c) => c.filePath)
      expect(paths).toContain("/out/report.md")
      expect(paths).toContain("/out/index.html")
      expect(paths).toContain("/out/data.csv")
      expect(paths).toContain("/out/a.ts")
      expect(paths).toContain("/out/b.ts")
      expect(paths).toContain("/out/fallback.md")
    })

    test("excludes non-matching tools and non-completed status", () => {
      const cards = findWriteCards(parts)
      const paths = cards.map((c) => c.filePath)
      expect(paths).not.toContain("/out/ignored.md")
      expect(paths).not.toContain("/out/ignored2.md")
      expect(paths).not.toContain("/out/pending.md")
      expect(paths).not.toContain("/out/bad.md")
      expect(paths).not.toContain("/out/null-tool.md")
    })

    test("deduplicates same filePath, keeping last occurrence", () => {
      const dup = [
        toolPart("write", "completed", "/out/file.md"),
        toolPart("edit", "completed", "/out/file.md"),
      ]
      const cards = findWriteCards(dup)
      expect(cards).toHaveLength(1)
      expect(cards[0].filePath).toBe("/out/file.md")
    })

    test("prefers metadata.filepath over input.filePath", () => {
      const metaFirst = [
        {
          type: "tool",
          tool: "write",
          state: {
            status: "completed",
            metadata: { filepath: "/real/path.md" },
            input: { filePath: "/input/path.md" },
          },
        },
      ]
      const cards = findWriteCards(metaFirst)
      expect(cards).toHaveLength(1)
      expect(cards[0].filePath).toBe("/real/path.md")
    })

    test("falls back to input.filePath when metadata is absent", () => {
      const inputOnly = [
        {
          type: "tool",
          tool: "write",
          state: { status: "completed", input: { filePath: "/input/path.md" } },
        },
      ]
      const cards = findWriteCards(inputOnly)
      expect(cards).toHaveLength(1)
      expect(cards[0].filePath).toBe("/input/path.md")
    })

    test("skips parts without any file path source", () => {
      const noPath = [
        { type: "tool", tool: "write", state: { status: "completed" } },
      ]
      expect(findWriteCards(noPath)).toHaveLength(0)
    })

    test("returns empty for empty input", () => {
      expect(findWriteCards([])).toHaveLength(0)
    })

    test("skips non-tool parts and null entries", () => {
      const mixed = [
        null,
        undefined,
        { type: "text", content: "hello" },
        toolPart("write", "completed", "/out/ok.md"),
      ]
      const cards = findWriteCards(mixed as unknown[])
      expect(cards).toHaveLength(1)
      expect(cards[0].filePath).toBe("/out/ok.md")
    })

    test("resolves OutputCardType from file extension", () => {
      const typed = [
        toolPart("write", "completed", "/out/report.md"),
        toolPart("write", "completed", "/out/page.html"),
        toolPart("write", "completed", "/out/data.json"),
        toolPart("write", "completed", "/out/app.ts"),
        toolPart("write", "completed", "/out/archive.zip"),
        toolPart("write", "completed", "/out/logo.png"),
      ]
      const cards = findWriteCards(typed)
      const byPath = Object.fromEntries(cards.map((c) => [c.filePath, c.type]))
      expect(byPath["/out/report.md"]).toBe("markdown")
      expect(byPath["/out/page.html"]).toBe("html")
      expect(byPath["/out/data.json"]).toBe("json")
      expect(byPath["/out/app.ts"]).toBe("code")
      expect(byPath["/out/archive.zip"]).toBe("file")
      expect(byPath["/out/logo.png"]).toBe("image")
    })
  })

  describe("findWriteOnlyCards", () => {
    test("matches only write tools, excludes edit", () => {
      const cards = findWriteOnlyCards(parts)
      const paths = cards.map((c) => c.filePath)
      expect(paths).toContain("/out/index.html")
      expect(paths).toContain("/out/a.ts")
      expect(paths).toContain("/out/fallback.md")
      expect(paths).not.toContain("/out/data.csv")
      expect(paths).not.toContain("/out/b.ts")
    })

    test("excludes non-matching tools", () => {
      const cards = findWriteOnlyCards(parts)
      const paths = cards.map((c) => c.filePath)
      expect(paths).not.toContain("/out/ignored.md")
      expect(paths).not.toContain("/out/pending.md")
    })

    test("deduplicates same filePath", () => {
      const dup = [
        toolPart("write", "completed", "/out/file.md"),
        toolPart("write", "completed", "/out/file.md"),
      ]
      const cards = findWriteOnlyCards(dup)
      expect(cards).toHaveLength(1)
    })
  })

  describe("findEditCards", () => {
    test("matches only edit tools, excludes write", () => {
      const cards = findEditCards(parts)
      const paths = cards.map((c) => c.filePath)
      expect(paths).toContain("/out/data.csv")
      expect(paths).toContain("/out/b.ts")
      expect(paths).not.toContain("/out/index.html")
      expect(paths).not.toContain("/out/a.ts")
      expect(paths).not.toContain("/out/fallback.md")
    })

    test("excludes non-matching tools", () => {
      const cards = findEditCards(parts)
      const paths = cards.map((c) => c.filePath)
      expect(paths).not.toContain("/out/ignored.md")
      expect(paths).not.toContain("/out/pending.md")
    })

    test("deduplicates same filePath", () => {
      const dup = [
        toolPart("edit", "completed", "/out/file.md"),
        toolPart("mcp:edit", "completed", "/out/file.md"),
      ]
      const cards = findEditCards(dup)
      expect(cards).toHaveLength(1)
    })
  })

  describe("partition invariant", () => {
    test("findWriteCards paths == union of findWriteOnlyCards and findEditCards paths", () => {
      const all = findWriteCards(parts)
      const writes = findWriteOnlyCards(parts)
      const edits = findEditCards(parts)

      const allPaths = new Set(all.map((c) => c.filePath))
      const writePaths = new Set(writes.map((c) => c.filePath))
      const editPaths = new Set(edits.map((c) => c.filePath))

      for (const p of writePaths) expect(allPaths.has(p)).toBe(true)
      for (const p of editPaths) expect(allPaths.has(p)).toBe(true)
      for (const p of allPaths) expect(writePaths.has(p) || editPaths.has(p)).toBe(true)
    })

    test("non-overlapping data produces exact partition", () => {
      const nonOverlapping = [
        toolPart("write", "completed", "/out/a.md"),
        toolPart("edit", "completed", "/out/b.md"),
        toolPart("client_write", "completed", "/out/c.ts"),
        toolPart("mcp:edit", "completed", "/out/d.csv"),
      ]
      const all = findWriteCards(nonOverlapping)
      const writes = findWriteOnlyCards(nonOverlapping)
      const edits = findEditCards(nonOverlapping)

      expect(writes.length + edits.length).toBe(all.length)
      const union = [...writes, ...edits].sort((a, b) => a.filePath.localeCompare(b.filePath))
      const sorted = [...all].sort((a, b) => a.filePath.localeCompare(b.filePath))
      expect(union).toEqual(sorted)
    })
  })
})

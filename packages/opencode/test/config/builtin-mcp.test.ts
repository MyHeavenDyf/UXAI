import { describe, expect, test } from "bun:test"
import * as BuiltinMCP from "@/config/builtin-mcp"

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_")

describe("Agent MCP Binding", () => {
  describe("Builtin MCP Config", () => {
    test("BUILTIN_MCP_SERVERS has expected entries", () => {
      const keys = Object.keys(BuiltinMCP.BUILTIN_MCP_SERVERS)
      expect(keys.length).toBeGreaterThanOrEqual(1)
    })

    test("BUILTIN_MCP_KEYS matches server keys", () => {
      const keys = Object.keys(BuiltinMCP.BUILTIN_MCP_SERVERS)
      expect(BuiltinMCP.BUILTIN_MCP_KEYS.size).toBe(keys.length)
      for (const k of keys) {
        expect(BuiltinMCP.BUILTIN_MCP_KEYS.has(k)).toBe(true)
      }
    })

    test("all builtin servers have required fields", () => {
      for (const [name, config] of Object.entries(BuiltinMCP.BUILTIN_MCP_SERVERS)) {
        expect(config).toHaveProperty("type")
        expect(config).toHaveProperty("enabled")
        if (config.type === "remote") {
          expect(config).toHaveProperty("url")
        }
        if (config.type === "local") {
          expect(config).toHaveProperty("command")
        }
      }
    })
  })

  describe("Tool Key Filtering Logic", () => {
    function filterTools(
      allTools: Record<string, object>,
      agentMcp: string[] | undefined,
      customServerNames: string[],
    ): Record<string, object> {
      if (!agentMcp || agentMcp.length === 0) {
        if (customServerNames.length === 0) return {}
        const customPrefixes = customServerNames.map(sanitize)
        return Object.fromEntries(
          Object.entries(allTools).filter(([key]) =>
            customPrefixes.some((p) => key.startsWith(p + "_")),
          ),
        )
      }
      const prefixes = [...agentMcp.map(sanitize), ...customServerNames.map(sanitize)]
      return Object.fromEntries(
        Object.entries(allTools).filter(([key]) =>
          prefixes.some((p) => key.startsWith(p + "_")),
        ),
      )
    }

    // Tool key format: {sanitizedServerName}_{toolName}
    const allTools = {
      "uxr-tool_analyze_interview": {},
      "uxr-tool_extract_themes": {},
      "pixso-design_create_shape": {},
      "prototype-dev_generate_html": {},
      "my-custom_do_stuff": {},
      "other_tool_action": {},
    }

    test("undefined agentMcp returns only custom tools (no builtin)", () => {
      const result = filterTools(allTools, undefined, ["my-custom"])
      expect(Object.keys(result)).toEqual([
        "my-custom_do_stuff",
      ])
    })

    test("undefined agentMcp with no custom servers returns empty", () => {
      const result = filterTools(allTools, undefined, [])
      expect(Object.keys(result).length).toBe(0)
    })

    test("empty agentMcp returns only custom tools (no builtin)", () => {
      const result = filterTools(allTools, [], ["my-custom"])
      expect(Object.keys(result)).toEqual([
        "my-custom_do_stuff",
      ])
    })

    test("agent with single mcp binding sees its tools + custom", () => {
      const result = filterTools(allTools, ["uxr-tool"], ["my-custom"])
      expect(Object.keys(result)).toEqual([
        "uxr-tool_analyze_interview",
        "uxr-tool_extract_themes",
        "my-custom_do_stuff",
      ])
    })

    test("no custom servers, only builtin", () => {
      const result = filterTools(allTools, ["uxr-tool"], [])
      expect(Object.keys(result)).toEqual([
        "uxr-tool_analyze_interview",
        "uxr-tool_extract_themes",
      ])
    })

    test("non-matching tools are excluded", () => {
      const result = filterTools(allTools, ["uxr-tool"], [])
      expect(result).not.toHaveProperty("pixso-design_create_shape")
      expect(result).not.toHaveProperty("other_tool_action")
    })

    test("user custom MCP key identification", () => {
      const configMcp = {
        "uxr-tool": { type: "remote" },
        "my-custom": { type: "local" },
      }
      const userKeys = Object.keys(configMcp).filter((k) => !BuiltinMCP.BUILTIN_MCP_KEYS.has(k))
      expect(userKeys).toEqual(["my-custom"])
    })

    test("sanitize preserves hyphens", () => {
      expect(sanitize("uxr-tool")).toBe("uxr-tool")
      expect(sanitize("my custom")).toBe("my_custom")
    })

    test("startsWith prefix matching works correctly", () => {
      const prefix = sanitize("uxr-tool")
      expect("uxr-tool_analyze_interview".startsWith(prefix + "_")).toBe(true)
      expect("pixso-design_create_shape".startsWith(prefix + "_")).toBe(false)
    })
  })
})
import { describe, expect, test } from "bun:test"
import { escapeInlineHtml } from "./markdown"

describe("escapeInlineHtml", () => {
  test("escapes inline HTML tags", () => {
    expect(escapeInlineHtml("<div>hello</div>")).toBe("&lt;div&gt;hello&lt;/div&gt;")
    expect(escapeInlineHtml("<span class='test'>text</span>")).toBe("&lt;span class='test'&gt;text&lt;/span&gt;")
    expect(escapeInlineHtml("<button>Click me</button>")).toBe("&lt;button&gt;Click me&lt;/button&gt;")
  })

  test("preserves code blocks", () => {
    expect(escapeInlineHtml("```\n<div>test</div>\n```")).toBe("```\n<div>test</div>\n```")
    expect(escapeInlineHtml("```html\n<button>Click</button>\n```")).toBe("```html\n<button>Click</button>\n```")
  })

  test("preserves inline code", () => {
    expect(escapeInlineHtml("`<div>test</div>`")).toBe("`<div>test</div>`")
    expect(escapeInlineHtml("use `<button>` to create a button")).toBe("use `<button>` to create a button")
  })

  test("handles mixed content", () => {
    expect(escapeInlineHtml("Here is a `<div>` tag and a <span>real tag</span>")).toBe(
      "Here is a `<div>` tag and a &lt;span&gt;real tag&lt;/span&gt;",
    )
  })

  test("escapes self-closing tags", () => {
    expect(escapeInlineHtml("<br/>")).toBe("&lt;br/&gt;")
    expect(escapeInlineHtml("<img src='test.png' />")).toBe("&lt;img src='test.png' /&gt;")
  })

  test("preserves markdown content", () => {
    expect(escapeInlineHtml("# Heading\n\n**bold** and *italic*")).toBe("# Heading\n\n**bold** and *italic*")
    expect(escapeInlineHtml("[link](https://example.com)")).toBe("[link](https://example.com)")
  })

  test("handles empty string", () => {
    expect(escapeInlineHtml("")).toBe("")
  })

  test("handles text without HTML", () => {
    expect(escapeInlineHtml("plain text without tags")).toBe("plain text without tags")
  })

  test("escapes tags with attributes", () => {
    expect(escapeInlineHtml("<a href='https://example.com'>link</a>")).toBe(
      "&lt;a href='https://example.com'&gt;link&lt;/a&gt;",
    )
    expect(escapeInlineHtml('<input type="text" disabled>')).toBe('&lt;input type="text" disabled&gt;')
  })

  test("handles multiple code blocks and inline code", () => {
    expect(escapeInlineHtml("`<a>` and `<b>` then <div>real</div> then `</div>`")).toBe(
      "`<a>` and `<b>` then &lt;div&gt;real&lt;/div&gt; then `</div>`",
    )
  })

  test("preserves already escaped entities", () => {
    expect(escapeInlineHtml("&lt;div&gt;")).toBe("&lt;div&gt;")
  })

  test("handles unclosed code blocks gracefully", () => {
    expect(escapeInlineHtml("```\n<div>unclosed")).toBe("```\n&lt;div&gt;unclosed")
  })

  test("handles nested backticks in code blocks", () => {
    expect(escapeInlineHtml("```js\nconst html = `<div>`\n```")).toBe("```js\nconst html = `<div>`\n```")
  })
})
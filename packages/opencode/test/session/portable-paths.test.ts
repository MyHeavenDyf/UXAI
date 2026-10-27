import { expect, test } from "bun:test"
import { planPortablePaths, rewritePortableDocument } from "@/session/portable-paths"

const files = (names: string[], scope: "project" | "session" = "project") =>
  names.map((path) => ({ sessionID: "ses_test", scope, directory: ".", path }))

test("does not crash on multiline strings containing query or fragment markers", () => {
  const plan = planPortablePaths({ sourceDirectory: "/work", files: files(["index.html", "assets:icon.svg"]) })
  const query = "./assets:icon.svg?v=1\n&theme=light\n"
  const fragment = "./assets:icon.svg#part\nsecond line\n"
  expect(plan.reference(query, 0)).toBe("./assets~003a~icon.svg?v=1\n&theme=light\n")
  expect(plan.reference(fragment, 0)).toBe("./assets~003a~icon.svg#part\nsecond line\n")
  const script = 'const example = `unrelated?\nfirst line\nsecond line`;'
  expect(rewritePortableDocument(script, "example.js", (value) => plan.reference(value, 0))).toBe(script)
})

test("plans deterministic encoding for invalid characters, reserved names and trailing dots/spaces", () => {
  const plan = planPortablePaths({
    sourceDirectory: "/workspace",
    files: files([
      "assets:README.md",
      "assets_README.md",
      "assets~003a~README.md",
      "AUX.txt",
      "space. ",
      "中文 😀.svg",
      "control\u0001.png",
    ]),
  })
  expect(plan.entries[0].path).toContain("~003a~")
  expect(plan.entries[1].path).toBe("assets_README.md")
  expect(plan.entries[3].path).toBe("~reserved~AUX.txt")
  expect(plan.entries[4].path).toBe("space~002e~~0020~")
  expect(plan.entries[5].path).toBe("中文 😀.svg")
  expect(plan.entries[6].path).toBe("control~0001~.png")
  expect(new Set(plan.entries.map((entry) => entry.path.toLowerCase())).size).toBe(plan.entries.length)
  const again = planPortablePaths({
    sourceDirectory: "/workspace",
    files: files(plan.entries.map((entry) => entry.path)),
  })
  expect(again.entries.map((entry) => entry.path)).toEqual(plan.entries.map((entry) => entry.path))
})

test("normalizes safe dot segments, duplicates, empty directory and proven in-root absolute paths", () => {
  const plan = planPortablePaths({
    sourceDirectory: "C:\\work",
    files: [
      ...files([".\\outputs\\..\\uploads\\a.png", "C:\\work\\outputs\\b.png"]),
      { sessionID: "ses_test", scope: "session", directory: "", path: "C:\\work\\.octo\\ses_test\\outputs\\a.png" },
    ],
  })
  expect(plan.entries.map((entry) => entry.path)).toEqual(["uploads/a.png", "outputs/b.png", "outputs/a.png"])
  for (const path of ["../a", "C:\\other\\a", "C:relative", "\\\\server\\share\\a", "", "a\0b"]) {
    expect(() => planPortablePaths({ sourceDirectory: "C:\\work", files: files([path]) })).toThrow("files[0]")
  }
})

test("keeps real Unix backslashes as filename characters but normalizes Windows separators", () => {
  expect(planPortablePaths({ sourceDirectory: "/work", files: files(["outputs/a\\b.svg"]) }).entries[0].path).toBe(
    "outputs/a~005c~b.svg",
  )
  expect(planPortablePaths({ sourceDirectory: "C:\\work", files: files(["outputs\\a\\b.svg"]) }).entries[0].path).toBe(
    "outputs/a/b.svg",
  )
})

test("resolves case and Unicode collisions with stable suffixes independent of input order", () => {
  const names = ["Logo.svg", "logo.svg", "é.txt", "e\u0301.txt", "Images/a.svg", "images/b.svg"]
  const first = planPortablePaths({ sourceDirectory: "/work", files: files(names) })
  const reversed = planPortablePaths({ sourceDirectory: "/work", files: files(names.toReversed()) })
  expect(first.entries.map((entry) => entry.path)).toEqual(reversed.entries.map((entry) => entry.path).toReversed())
  expect(new Set(first.entries.map((entry) => entry.path.normalize("NFC").toLowerCase())).size).toBe(names.length)
})

test("shortens long components and full paths while retaining an outputs root", () => {
  const plan = planPortablePaths({
    sourceDirectory: "/work",
    maxLength: 80,
    files: files([`outputs/${"目录".repeat(150)}/${"nested/".repeat(25)}page.html`]),
  })
  expect(plan.entries[0].path.length).toBeLessThanOrEqual(80)
  expect(plan.entries[0].path).toMatch(/^outputs\/portable-long\//)
})

test("rewrites exact scoped references, preserves query/fragments and unrelated prose or filenames", () => {
  const plan = planPortablePaths({
    sourceDirectory: "/work",
    files: files(["a/index.html", "a/assets:icon.svg", "b/assets:icon.svg", "b/index.html"]),
  })
  const text =
    '<p>assets:icon.svg</p><img src="./assets%3aicon.svg?v=1#icon"><a href="../b/assets:icon.svg">B</a><!-- <img src="./assets:icon.svg"> -->'
  const rewritten = rewritePortableDocument(text, "a/index.html", (value, base) => plan.reference(value, 0, true, base))
  expect(rewritten).toContain("<p>assets:icon.svg</p>")
  expect(rewritten).toContain('src="./assets~003a~icon.svg?v=1#icon"')
  expect(rewritten).toContain('href="../b/assets~003a~icon.svg"')
  expect(rewritten).toContain('<!-- <img src="./assets:icon.svg"> -->')
  expect(plan.rewriteText("/work/a/assets:icon.svg /work/a/assets:icon.svg.bak")).toBe(
    "/work/a/assets~003a~icon.svg /work/a/assets:icon.svg.bak",
  )
  expect(plan.reference("https://example.com/assets:icon.svg", 0)).toBe("https://example.com/assets:icon.svg")
})

test("CSS and JS references are resolved relative to the owning file without changing comments", () => {
  const plan = planPortablePaths({
    sourceDirectory: "/work",
    files: files(["styles/a.css", "styles/bg:1.svg", "script/main.js", "script/dep:1.js"]),
  })
  expect(
    rewritePortableDocument('/* url("bg:1.svg") */ body { background:url("./bg:1.svg#x") }', "styles/a.css", (value) =>
      plan.reference(value, 0),
    ),
  ).toBe('/* url("bg:1.svg") */ body { background:url("./bg~003a~1.svg#x") }')
  expect(
    rewritePortableDocument('// import "./dep:1.js"\nimport "./dep:1.js";', "script/main.js", (value) =>
      plan.reference(value, 2),
    ),
  ).toBe('// import "./dep:1.js"\nimport "./dep~003a~1.js";')
})

test("keeps file URL encoding, query/fragments and local base URLs correct after renaming", () => {
  const plan = planPortablePaths({ sourceDirectory: "/work", files: files(["index.html", "assets:dir/中文.svg"]) })
  expect(plan.reference("file:///work/assets%3Adir/%E4%B8%AD%E6%96%87.svg?v=1#x", 0)).toBe("file:///work/assets~003a~dir/%E4%B8%AD%E6%96%87.svg?v=1#x")
  const html = '<base href="./assets:dir/"><p>url("中文.svg")</p><img src="中文.svg?v=1#x">'
  const result = rewritePortableDocument(html, "index.html", (value, base) => plan.reference(value, 0, true, base))
  expect(result).toContain('<base href="./">')
  expect(result).toContain('<p>url("中文.svg")</p>')
  expect(result).toContain('src="assets~003a~dir/%E4%B8%AD%E6%96%87.svg?v=1#x"')
  const percent = planPortablePaths({ sourceDirectory: "/work", files: files(["assets:%25.svg"]) })
  expect(percent.rewriteText("file:///work/assets%3A%2525.svg")).toBe("file:///work/assets~003a~%2525.svg")
})

test("resolves resources with the same filename independently per session", () => {
  const plan = planPortablePaths({ sourceDirectory: "/work", files: [
    ...files(["outputs/index.html", "outputs/a:b.svg"], "session"),
    ...files(["outputs/index.html", "outputs/a:b.svg"], "session").map((file) => ({ ...file, sessionID: "ses_other" })),
  ] })
  expect(plan.rewriteText("/work/.octo/ses_other/outputs/a:b.svg")).toBe("/work/.octo/ses_other/outputs/a~003a~b.svg")
  expect(plan.reference("./a:b.svg", 0)).toBe("./a~003a~b.svg")
  expect(plan.reference("./a:b.svg", 2)).toBe("./a~003a~b.svg")
})

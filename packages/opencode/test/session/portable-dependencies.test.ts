import { expect, spyOn, test } from "bun:test"
import path from "node:path"
import { symlink } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { collectPortableDependencies } from "@/session/portable-dependencies"
import { isExcludedPortableFile } from "@/session/portable-exclusions"
import { tmpdir } from "../fixture/fixture"

test("skips website-root references without guessing disk paths or changing source files", async () => {
  await using project = await tmpdir()
  const page = path.join(project.path, "index.html")
  const script = path.join(project.path, "runtime.js")
  const css = path.join(project.path, "theme.css")
  const html = '<script type="module" src="/src/entry.ts"></script><script src="/src/entry.ts"></script><script src="./runtime.js"></script><link rel="stylesheet" href="./theme.css">'
  await Bun.write(page, html)
  await Bun.write(script, 'import "/src/module.ts"; import "./keep.js";')
  await Bun.write(css, 'body { background: url("/images/background.svg") }')
  await Bun.write(path.join(project.path, "keep.js"), "window.ready = true")
  // Even a matching project file does not establish the website's server root.
  await Bun.write(path.join(project.path, "src/entry.ts"), "must not guess this location")
  const reads: string[] = []
  const logging = spyOn(console, "warn")
  try {
    const dependencies = await collectPortableDependencies({
      root: project.path,
      files: [page],
      trustedRoots: [],
      read: async (file) => {
        reads.push(file)
        return new Uint8Array(await Bun.file(file).arrayBuffer())
      },
    })
    expect(dependencies.map((entry) => path.basename(entry.file)).sort()).toEqual(["keep.js", "runtime.js", "theme.css"])
    expect(reads.sort()).toEqual([page, script, css, path.join(project.path, "keep.js")].sort())
    expect(await Bun.file(page).text()).toBe(html)
    expect(logging).toHaveBeenCalledTimes(3)
    expect(logging.mock.calls.every((call) => call[0] === "[octo:share] skipped dependency")).toBe(true)
    expect(JSON.parse(String(logging.mock.calls[0]?.[1]))).toEqual({
      source: page,
      reference: "/src/entry.ts",
      base: pathToFileURL(page).href,
      reason: "web-root-relative",
    })
  } finally {
    logging.mockRestore()
  }
})

test.each(["relative escape", "explicit file URL", "hidden directory"])("still rejects a %s dependency", async (mode) => {
  await using project = await tmpdir()
  await using outside = await tmpdir()
  const page = path.join(project.path, "index.html")
  const ref = mode === "relative escape" ? "../secret.js"
    : mode === "explicit file URL" ? pathToFileURL(path.join(outside.path, "secret.js")).href
    : "./.private/secret.js"
  await Bun.write(page, `<script src="${ref}"></script>`)
  await expect(collectPortableDependencies({
    root: project.path,
    files: [page],
    trustedRoots: [],
    read: async (file) => new Uint8Array(await Bun.file(file).arrayBuffer()),
  })).rejects.toThrow("页面依赖无法安全保留相对路径")
})

test("does not read blacklisted ASAR dependencies or virtual contents, but retains unpacked dependencies", async () => {
  await using project = await tmpdir()
  const page = path.join(project.path, "index.html")
  await Bun.write(page, '<script src="./app.asar"></script><script src="./virtual.ASAR/entry.js"></script><script src="./app.asar.unpacked/keep.js"></script>')
  await Bun.write(path.join(project.path, "app.asar"), "archive bytes")
  await Bun.write(path.join(project.path, "virtual.ASAR", "entry.js"), "archive content")
  await Bun.write(path.join(project.path, "app.asar.unpacked", "keep.js"), "window.kept = true")
  const dependencies = await collectPortableDependencies({ root: project.path, files: [page], trustedRoots: [], blacklist: [".asar"], read: async (file) => {
    expect(isExcludedPortableFile(file, [".asar"])).toBe(false)
    return new Uint8Array(await Bun.file(file).arrayBuffer())
  } })
  expect(dependencies.map((item) => path.relative(project.path, item.file))).toEqual([path.join("app.asar.unpacked", "keep.js")])
  expect(isExcludedPortableFile("D:\\workspace\\APP.ASAR", [".asar"])).toBe(true)
  expect(isExcludedPortableFile("D:\\workspace\\APP.ASAR\\entry.js", [".asar"])).toBe(true)
  expect(isExcludedPortableFile("D:\\workspace\\app.asar.unpacked\\native.node", [".asar"])).toBe(false)
  expect(isExcludedPortableFile("D:\\workspace\\app.asar")).toBe(false)
})

test("collects dependencies from HTML, JavaScript and CSS files larger than 4 MiB", async () => {
  await using project = await tmpdir()
  const page = path.join(project.path, "index.html")
  const padding = "x".repeat(4 * 1024 * 1024 + 1)
  await Bun.write(page, `<!--${padding}--><script src="./large.js"></script><link rel="stylesheet" href="./large.css">`)
  await Bun.write(path.join(project.path, "large.js"), `/*${padding}*/\nimport "./extra.js";`)
  await Bun.write(path.join(project.path, "large.css"), `/*${padding}*/\n@font-face { src: url("./font.woff2") }`)
  await Bun.write(path.join(project.path, "extra.js"), "window.ready = true")
  await Bun.write(path.join(project.path, "font.woff2"), "font bytes")
  const dependencies = await collectPortableDependencies({
    root: project.path,
    files: [page],
    trustedRoots: [],
    read: async (file) => new Uint8Array(await Bun.file(file).arrayBuffer()),
  })
  expect(dependencies.map((item) => path.basename(item.file)).sort()).toEqual([
    "extra.js", "font.woff2", "large.css", "large.js",
  ])
})

test("warns with the original reference and source when an unrelated output page points at absent resources", async () => {
  await using project = await tmpdir()
  await using resources = await tmpdir()
  const page = path.join(project.path, "register.html")
  const copy = path.join(project.path, "output/login.html")
  const icon = path.join(project.path, "outputs/resource/icon/icon.svg")
  const reference = "./outputs/resource/icon/icon.svg"
  await Bun.write(page, `<img src="${reference}"><script src="./assets/runtime.js"></script>`)
  await Bun.write(copy, `<img src="${reference}"><img src="${reference}">`)
  await Bun.write(icon, "<svg/>")
  await Bun.write(path.join(resources.path, "runtime.js"), "window.ready = true")
  await symlink(resources.path, path.join(project.path, "assets"), process.platform === "win32" ? "junction" : "dir")
  const logging = spyOn(console, "warn")
  try {
    const dependencies = await collectPortableDependencies({
      root: project.path,
      files: [page, copy, icon],
      trustedRoots: [resources.path],
      read: async (file) => new Uint8Array(await Bun.file(file).arrayBuffer()),
    })
    expect(dependencies.map((item) => item.file)).toEqual([path.join(project.path, "assets/runtime.js")])
    expect(logging).toHaveBeenCalledTimes(1)
    expect(logging.mock.calls[0]?.[0]).toBe("[octo:share] missing dependency")
    expect(JSON.parse(String(logging.mock.calls[0]?.[1]))).toEqual({
      source: copy,
      reference,
      base: pathToFileURL(copy).href,
      target: path.join(project.path, "output/outputs/resource/icon/icon.svg"),
    })
  } finally {
    logging.mockRestore()
  }
})

test.each(["inline", "external"])(
  "collects immutable resource bindings and setAttribute references in %s scripts",
  async (mode) => {
    await using project = await tmpdir()
    await using resources = await tmpdir()
    const page = path.join(project.path, "index.html")
    const script = path.join(project.path, "scripts/header.jsx")
    const source = `
    const Photo = () => <img src={photo} data-src={unused} />;
    const photo = "./assets/uploads/photo.png";
    const alias = photo;
    const image = document.createElement("img");
    image.src = alias;
    image.setAttribute("src", "./assets/uploads/setter.png");
    image.setAttribute("poster", poster);
    image.setAttribute("data-src", unused);
    const poster = "./assets/uploads/poster.png";
    const Gallery = () => <img srcSet="./assets/uploads/small.png 1x, ./assets/uploads/large.png 2x" />;
    const unused = "./assets/uploads/unused.png";
    const src = "./assets/uploads/unused-src.png";
    const cycleA = cycleB;
    const cycleB = cycleA;
    const Unknown = () => <img src={cycleA} />;
    // const commented = "./assets/uploads/not-requested.png";
  `
    await Bun.write(script, source)
    await Bun.write(
      page,
      mode === "inline"
        ? `<script type="text/babel">${source}</script>`
        : '<script type="text/babel" src="./scripts/header.jsx"></script>',
    )
    for (const name of ["photo", "setter", "poster", "small", "large"]) {
      await Bun.write(path.join(resources.path, `uploads/${name}.png`), name)
    }
    await symlink(resources.path, path.join(project.path, "assets"), process.platform === "win32" ? "junction" : "dir")
    const input = {
      root: project.path,
      files: [page, script],
      trustedRoots: [resources.path],
      read: async (file: string) => new Uint8Array(await Bun.file(file).arrayBuffer()),
    }
    expect(
      (await collectPortableDependencies(input))
        .map((item) => path.relative(project.path, item.file).replaceAll("\\", "/"))
        .sort(),
    ).toEqual([
      "assets/uploads/large.png",
      "assets/uploads/photo.png",
      "assets/uploads/poster.png",
      "assets/uploads/setter.png",
      "assets/uploads/small.png",
    ])
    const missing = 'const photo = "./assets/uploads/missing.png"; const Photo = () => <img src={photo} />;'
    await Bun.write(script, missing)
    await Bun.write(
      page,
      mode === "inline"
        ? `<script type="text/babel">${missing}</script>`
        : '<script type="text/babel" src="./scripts/header.jsx"></script>',
    )
    await expect(collectPortableDependencies(input)).resolves.toBeInstanceOf(Array)
  },
)

test("collects actual JSX resources without treating data attributes or unrelated constants as requests", async () => {
  await using project = await tmpdir()
  await using resources = await tmpdir()
  const page = path.join(project.path, "index.html")
  const script = path.join(project.path, "header.jsx")
  const source = `
    const unused = "./assets/uploads/not-requested.png";
    const Example = () => <img data-src="./assets/uploads/lazy.png" data-src={"./assets/uploads/lazy-expression.png"}
      title="./assets/uploads/title.png" src={"./assets/uploads/photo.png"} />;
    const options = { image: "./assets/uploads/empty.svg" };
  `
  await Bun.write(script, source)
  await Bun.write(
    page,
    `<script type="text/babel">${source}</script><script type="text/babel" src="./header.jsx"></script>`,
  )
  await Bun.write(path.join(resources.path, "uploads/photo.png"), "photo")
  await Bun.write(path.join(resources.path, "uploads/empty.svg"), "<svg/>")
  await symlink(resources.path, path.join(project.path, "assets"), process.platform === "win32" ? "junction" : "dir")
  const input = {
    root: project.path,
    files: [page, script],
    trustedRoots: [resources.path],
    read: async (file: string) => new Uint8Array(await Bun.file(file).arrayBuffer()),
  }
  expect(
    (await collectPortableDependencies(input))
      .map((item) => path.relative(project.path, item.file).replaceAll("\\", "/"))
      .sort(),
  ).toEqual(["assets/uploads/empty.svg", "assets/uploads/photo.png"])
  await Bun.write(
    page,
    '<script type="text/babel">const Missing = () => <img src="./assets/uploads/missing.png" />;</script>',
  )
  await expect(collectPortableDependencies(input)).resolves.toBeInstanceOf(Array)
})

test("ignores metadata links but collects stylesheet, icon and preload links", async () => {
  await using project = await tmpdir()
  const page = path.join(project.path, "index.html")
  await Bun.write(
    page,
    `
    <link rel="canonical" href="./about"><link rel="alternate" href="./other-language">
    <link rel="help" href="./help"><link rel="dns-prefetch" href="./host">
    <link rel="STYLESHEET" href="./theme.css"><link rel="shortcut icon" href="./icon.svg">
    <link rel="preload" as="font" href="./font.woff2"><link rel="modulepreload" href="./app.js">
    <img title=' src="not-a-resource.png"' src="./icon.svg">
  `,
  )
  await Bun.write(path.join(project.path, "theme.css"), "body {}")
  await Bun.write(path.join(project.path, "icon.svg"), "<svg/>")
  await Bun.write(path.join(project.path, "font.woff2"), "font")
  await Bun.write(path.join(project.path, "app.js"), "window.ready = true")
  const input = {
    root: project.path,
    files: [page],
    trustedRoots: [],
    read: async (file: string) => new Uint8Array(await Bun.file(file).arrayBuffer()),
  }
  expect((await collectPortableDependencies(input)).map((item) => path.basename(item.file)).sort()).toEqual([
    "app.js",
    "font.woff2",
    "icon.svg",
    "theme.css",
  ])
  await Bun.write(page, '<link rel="stylesheet" href="./missing.css">')
  await expect(collectPortableDependencies(input)).resolves.toBeInstanceOf(Array)
})

test("ignores commented markup and data attributes while preserving actual resource attributes", async () => {
  await using project = await tmpdir()
  const page = path.join(project.path, "index.html")
  await Bun.write(
    page,
    `
    <!-- <base href="missing/"><img src="removed.png"><script src="removed.js"></script>
      <script>import "./removed-module.js"</script><style>body { background: url(removed.svg) }</style> -->
    <img data-src="lazy.png" data-srcset="lazy-large.png 2x" data-style="background:url(lazy.svg)" src="real.svg">
  `,
  )
  await Bun.write(path.join(project.path, "real.svg"), "<svg/>")
  const input = {
    root: project.path,
    files: [page],
    trustedRoots: [],
    read: async (file: string) => new Uint8Array(await Bun.file(file).arrayBuffer()),
  }
  expect((await collectPortableDependencies(input)).map((file) => file.file)).toEqual([
    path.join(project.path, "real.svg"),
  ])
  await Bun.write(page, '<img src="missing.png">')
  await expect(collectPortableDependencies(input)).resolves.toBeInstanceOf(Array)
})

test("keeps each document base through external script imports without changing module-relative URLs", async () => {
  await using project = await tmpdir()
  await using resources = await tmpdir()
  const pages = ["one", "two"].map((dir) => path.join(project.path, dir, "index.html"))
  const script = path.join(project.path, "scripts/app.js")
  const component = path.join(project.path, "scripts/components/header.jsx")
  await Bun.write(script, 'import "./components/header.jsx";')
  await Bun.write(
    component,
    `
    import "../../scripts/app.js";
    const image = document.createElement("img"); image.src = "./assets/uploads/photo.png";
    const icon = new URL("./assets/icon.svg", import.meta.url);
  `,
  )
  await Bun.write(path.join(resources.path, "module/icon.svg"), "<svg/>")
  await Bun.write(path.join(resources.path, "one/uploads/photo.png"), "first image")
  await Bun.write(path.join(resources.path, "two/uploads/photo.png"), "second image")
  await symlink(
    path.join(resources.path, "module"),
    path.join(project.path, "scripts/components/assets"),
    process.platform === "win32" ? "junction" : "dir",
  )
  for (const [index, page] of pages.entries()) {
    await Bun.write(page, '<script type="module" src="../scripts/app.js"></script>')
    await symlink(
      path.join(resources.path, index === 0 ? "one" : "two"),
      path.join(path.dirname(page), "assets"),
      process.platform === "win32" ? "junction" : "dir",
    )
  }
  const dependencies = await collectPortableDependencies({
    root: project.path,
    files: [...pages, script, component],
    trustedRoots: [resources.path],
    read: async (file) => new Uint8Array(await Bun.file(file).arrayBuffer()),
  })
  expect(dependencies.map((file) => path.relative(project.path, file.file).replaceAll("\\", "/")).sort()).toEqual([
    "one/assets/uploads/photo.png",
    "scripts/components/assets/icon.svg",
    "two/assets/uploads/photo.png",
  ])
})

test("copies only referenced linked assets while preserving their logical paths and recursive dependencies", async () => {
  await using project = await tmpdir()
  await using resources = await tmpdir()
  const page = path.join(project.path, "preview", "index.page.html")
  const snapshot = path.join(project.path, "preview", ".history", "old", "self.html")
  await Bun.write(
    page,
    String.raw`<script src="./assets/library/react.js"></script><link rel="stylesheet" href="assets/style/theme.css"><a href="missing-route">route</a><style>body { background: url(\"data:image/svg+xml,<svg xmlns='http://example.com'></svg>\") }</style><script type="text/babel">const example = "import './not-a-module.js'"; const indicator = <img src="./assets/uploads/loading.svg"/>;</script>`,
  )
  await Bun.write(snapshot, '<script src="missing-history-library.js"></script>')
  await Bun.write(path.join(resources.path, "library/react.js"), 'import "./extra"; require("./bundled-internal-id");')
  await Bun.write(path.join(resources.path, "library/extra.js"), 'import "./react.js";')
  await Bun.write(path.join(resources.path, "style/theme.css"), '@font-face { src: url("../font/Regular.woff2?v=1") }')
  await Bun.write(path.join(resources.path, "font/Regular.woff2"), "font bytes")
  await Bun.write(path.join(resources.path, "uploads/loading.svg"), "<svg/>")
  await Bun.write(path.join(resources.path, "library/unused.js"), "unused bytes")
  await symlink(
    resources.path,
    path.join(project.path, "preview/assets"),
    process.platform === "win32" ? "junction" : "dir",
  )
  const dependencies = await collectPortableDependencies({
    root: project.path,
    files: [page, snapshot],
    trustedRoots: [resources.path],
    read: async (file) => new Uint8Array(await Bun.file(file).arrayBuffer()),
  })
  expect(dependencies.map((file) => path.relative(project.path, file.file).replaceAll("\\", "/")).sort()).toEqual([
    "preview/assets/font/Regular.woff2",
    "preview/assets/library/extra.js",
    "preview/assets/library/react.js",
    "preview/assets/style/theme.css",
    "preview/assets/uploads/loading.svg",
  ])
  expect(dependencies.every((file) => file.source.startsWith(resources.path + path.sep))).toBe(true)
})

test("allows missing dependencies but still rejects untrusted links and escaping paths", async () => {
  await using project = await tmpdir()
  await using outside = await tmpdir()
  const page = path.join(project.path, "index.html")
  await Bun.write(page, '<script src="missing.js"></script>')
  const input = {
    root: project.path,
    files: [page],
    trustedRoots: [],
    read: async (file: string) => new Uint8Array(await Bun.file(file).arrayBuffer()),
  }
  await expect(collectPortableDependencies(input)).resolves.toEqual([])
  await Bun.write(path.join(outside.path, "secret.js"), "not a trusted resource")
  await symlink(outside.path, path.join(project.path, "assets"), process.platform === "win32" ? "junction" : "dir")
  await Bun.write(page, '<script src="assets/secret.js"></script>')
  await expect(collectPortableDependencies(input)).rejects.toThrow("超出允许的资源目录")
  await Bun.write(page, '<script src="../secret.js"></script>')
  await expect(collectPortableDependencies(input)).rejects.toThrow("无法安全保留相对路径")
})

test("resolves bundled JSX image strings against the HTML document instead of the original component directory", async () => {
  await using project = await tmpdir()
  await using resources = await tmpdir()
  const page = path.join(project.path, "preview/index.page.html")
  const component = path.join(project.path, "preview/src/views/header-bar/index.jsx")
  const source = 'const Header = () => <img src="./assets/uploads/user.png" />;'
  await Bun.write(page, `<script type="text/babel">${source}</script>`)
  await Bun.write(component, source)
  await Bun.write(path.join(resources.path, "uploads/user.png"), "image bytes")
  await symlink(
    resources.path,
    path.join(project.path, "preview/assets"),
    process.platform === "win32" ? "junction" : "dir",
  )
  const input = {
    root: project.path,
    files: [page, component],
    trustedRoots: [resources.path],
    read: async (file: string) => new Uint8Array(await Bun.file(file).arrayBuffer()),
  }
  expect((await collectPortableDependencies(input)).map((file) => file.file)).toEqual([
    path.join(project.path, "preview/assets/uploads/user.png"),
  ])
  // Missing module imports must not prevent existing assets from being collected.
  await Bun.write(component, `${source}\nimport "./missing.js";`)
  expect((await collectPortableDependencies(input)).map((file) => file.file)).toEqual([
    path.join(project.path, "preview/assets/uploads/user.png"),
  ])
})

import { expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { mkdir, symlink } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { tmpdir } from "../fixture/fixture"

test("collects project configuration and workspace dependencies under Node without Bun", async () => {
  await using source = await tmpdir()
  await Bun.write(path.join(source.path, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }))
  await Bun.write(
    path.join(source.path, "apps/page/package.json"),
    JSON.stringify({
      dependencies: {
        shared: "workspace:*",
        local: "file:../../local",
        missing: "link:../../missing",
      },
    }),
  )
  await Bun.write(
    path.join(source.path, "apps/page/tsconfig.json"),
    '{"compilerOptions":{"paths":{"@common/*":["../../common/*"]}}}',
  )
  await Bun.write(
    path.join(source.path, "apps/page/vite.config.ts"),
    'export default {resolve:{alias:{icons:new URL("../../icons",import.meta.url).pathname}}}',
  )
  await Bun.write(path.join(source.path, "packages/shared/package.json"), '{"name":"shared"}')
  await Bun.write(path.join(source.path, "packages/unused/package.json"), '{"name":"unused"}')
  for (const file of [
    "apps/page/src/main.ts",
    "packages/shared/index.ts",
    "packages/unused/index.ts",
    "local/util.ts",
    "common/types.ts",
    "icons/logo.svg",
  ]) {
    await Bun.write(path.join(source.path, file), "contents")
  }
  const build = await Bun.build({
    entrypoints: [fileURLToPath(new URL("../../src/session/portable-files.ts", import.meta.url))],
    target: "node",
    format: "esm",
    // Match the Node production build: jsonc-parser's UMD entry is not bundled.
    external: ["jsonc-parser"],
  })
  expect(build.success).toBe(true)
  const bundle = path.join(source.path, "portable-files.mjs")
  await Bun.write(bundle, build.outputs[0])
  await mkdir(path.join(source.path, "node_modules"))
  await symlink(
    path.dirname(fileURLToPath(import.meta.resolve("jsonc-parser/package.json"))),
    path.join(source.path, "node_modules", "jsonc-parser"),
    process.platform === "win32" ? "junction" : "dir",
  )
  const result = await promisify(execFile)("node", [
    "--input-type=module",
    "--eval",
    `
    import assert from "node:assert/strict"
    import { readdir, lstat } from "node:fs/promises"
    import path from "node:path"
    import { collectPortableProjectFiles } from ${JSON.stringify(pathToFileURL(bundle).href)}
    assert.equal(typeof Bun, "undefined")
    const root = ${JSON.stringify(source.path)}
    const files = await collectPortableProjectFiles({
      root,
      sessions: [{ info: { id: "ses_node" }, messages: [{
        info: { role: "user" }, parts: [{ type: "text", text: "[页面](apps/page/src/main.ts) [缺失](missing.html)" }],
      }] }],
      list: async (directory) => {
        const files = await readdir(directory, { recursive: true })
        const entries = await Promise.all(files.map(async (file) => {
          const target = path.join(directory, file)
          return (await lstat(target)).isFile() ? target : undefined
        }))
        return entries.filter(Boolean)
      },
    })
    console.log(JSON.stringify(files.map((file) => path.relative(root, file).split(path.sep).join("/"))))
  `,
  ])
  const files = JSON.parse(result.stdout) as string[]
  expect(files).toContain("apps/page/src/main.ts")
  expect(files).toContain("packages/shared/index.ts")
  expect(files).toContain("local/util.ts")
  expect(files).toContain("common/types.ts")
  expect(files).toContain("icons/logo.svg")
  expect(files).not.toContain("packages/unused/index.ts")
})

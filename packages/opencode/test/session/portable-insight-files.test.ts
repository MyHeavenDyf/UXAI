import { expect, test } from "bun:test"
import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { tmpdir } from "../fixture/fixture"

test("collects explicit Insight attachments under Node without scanning directory mentions", async () => {
  await using source = await tmpdir()
  await Bun.write(path.join(source.path, "upload.pdf"), "upload")
  await Bun.write(path.join(source.path, "edited.txt"), "edited")
  await Bun.write(path.join(source.path, "design/index.html"), "not referenced")
  const build = await Bun.build({
    entrypoints: [fileURLToPath(new URL("../../src/session/portable-insight-files.ts", import.meta.url))],
    target: "node",
    format: "esm",
  })
  expect(build.success).toBe(true)
  const bundle = path.join(source.path, "insight-files.mjs")
  await Bun.write(bundle, build.outputs[0])
  const result = await promisify(execFile)("node", [
    "--input-type=module",
    "--eval",
    `
    import assert from "node:assert/strict"
    import path from "node:path"
    import { collectInsightSharedFiles } from ${JSON.stringify(pathToFileURL(bundle).href)}
    assert.equal(typeof Bun, "undefined")
    const root = ${JSON.stringify(source.path)}
    const files = await collectInsightSharedFiles({
      root,
      sessions: [{ messages: [{ info: { role: "user" }, parts: [
        { type: "file", url: ${JSON.stringify(pathToFileURL(path.join(source.path, "upload.pdf")).href)} },
        { type: "text", text: "[工作区](" + root + ")" },
        { type: "text", synthetic: true, text: "[附件]\\n- 根目录: " + root },
        { type: "tool", tool: "read", state: { status: "completed", input: { path: root }, metadata: {} } },
        { type: "tool", tool: "write", state: { status: "completed", input: { filePath: "edited.txt" }, metadata: {} } },
        { type: "tool", tool: "bash", state: { status: "completed", input: { workdir: root }, output: "design/index.html", metadata: {} } },
      ] }] }],
      list: async () => { throw new Error("Must not scan the workspace") },
    })
    console.log(JSON.stringify(files.map((file) => path.basename(file)).sort()))
  `,
  ])
  expect(JSON.parse(result.stdout)).toEqual(["edited.txt", "upload.pdf"])
})

import { expect, test } from "bun:test"
import { mkdtemp, mkdir, chmod, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { parseUpdateInfo } from "electron-updater/out/providers/Provider"
import { parseForceUpdate } from "../../scripts/release-policy"

test("release policy only accepts boolean configuration", () => {
  expect(parseForceUpdate()).toBe(false)
  expect(parseForceUpdate("true")).toBe(true)
  expect(parseForceUpdate("false")).toBe(false)
  expect(() => parseForceUpdate('"true"')).toThrow()
})

test.each([
  { setting: "true", metadata: "", expected: true },
  { setting: "false", metadata: "", expected: false },
  { setting: "false", metadata: "forceUpdate: true\n", expected: true },
])("release pipeline preserves forceUpdate for Windows and macOS ($setting, $metadata)", async ({ setting, metadata, expected }) => {
  const directory = await mkdtemp(path.join(tmpdir(), "octo-update-metadata-"))
  try {
    const bin = path.join(directory, "bin")
    const output = path.join(directory, "output")
    await mkdir(bin)
    await mkdir(output)
    // Replace only the external upload command; execute the real metadata scripts.
    await Bun.write(path.join(bin, "gh"), "#!/bin/sh\nexit 0\n")
    await chmod(path.join(bin, "gh"), 0o755)
    for (const [target, filename] of [
      ["x86_64-pc-windows-msvc", "latest.yml"],
      ["aarch64-apple-darwin", "latest-mac.yml"],
    ]) {
      await mkdir(path.join(directory, `latest-yml-${target}`))
      await Bun.write(path.join(directory, `latest-yml-${target}`, filename),
        `version: 3.3.3\n${metadata}files:\n  - url: installer.zip\n    sha512: test\n    size: 10\nreleaseDate: '2026-11-26T00:00:00Z'\n`)
    }
    for (const script of ["finalize-latest-yml.ts", "inject-release-notes.ts"]) {
      const process = Bun.spawn(["bun", new URL(`../../scripts/${script}`, import.meta.url).pathname], {
        env: { ...Bun.env, PATH: `${bin}:${Bun.env.PATH}`, LATEST_YML_DIR: directory, RUNNER_TEMP: output,
          GH_REPO: "test/repository", OCTO_VERSION: "3.3.3", OCTO_FORCE_UPDATE: setting,
          OCTO_RELEASE_NOTES: "第一行\n第二行" },
        stdout: "pipe", stderr: "pipe",
      })
      const stderr = await new Response(process.stderr).text()
      expect(await process.exited, stderr).toBe(0)
    }
    for (const filename of ["latest.yml", "latest-mac.yml"]) {
      const info = parseUpdateInfo(await Bun.file(path.join(output, filename)).text(), filename, new URL(`https://example.com/${filename}`))
      expect("forceUpdate" in info && info.forceUpdate).toBe(expected)
      expect(info.releaseNotes).toBe("第一行\n第二行")
      expect(info.files[0].url).toBe("installer.zip")
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})

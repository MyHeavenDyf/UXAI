import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(import.meta.dir, "index.tsx"), "utf8")

test("share menu prefers the live session title after the first reply", () => {
  expect(source).toMatch(/const menuSession = \(\) => info\(\) \?\? sessionInfoMirror\(\)/)
  expect(source).toMatch(/const menuHasMessages = \(\) => \{\s*const s = menuSession\(\)/)
})

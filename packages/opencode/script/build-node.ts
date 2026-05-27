#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

await import("./generate.ts")

// Load migrations from migration directories
const migrationDirs = (
  await fs.promises.readdir(path.join(dir, "migration"), {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const file = path.join(dir, "migration", name, "migration.sql")
    const sql = await Bun.file(file).text()
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = match
      ? Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        )
      : 0
    return { sql, timestamp, name }
  }),
)
console.log(`Loaded ${migrations.length} migrations`)

// Generate skills.json from built-in skills
const skillsDir = path.join(dir, "src", "agent", "skills")
const skillEntries: Record<string, { description: string; import: boolean; type: string }> = {}
if (fs.existsSync(skillsDir)) {
  const skillFiles = fs.globSync("**/SKILL.md", { cwd: skillsDir })
  for (const relPath of skillFiles) {
    const fullPath = path.join(skillsDir, relPath)
    const content = fs.readFileSync(fullPath, "utf-8")
    const dirName = path.basename(path.dirname(fullPath))
    const descMatch = content.match(/^---\s*\n.*?description:\s*(.+?)\s*\n.*?---/s)
    const agentName = relPath.split(/[/\\]/)[0] // e.g. "octo_insight"
    skillEntries[dirName] = {
      description: descMatch ? descMatch[1] : "",
      import: false,
      type: agentName,
    }
  }
}
const skillsJsonPath = path.join(dir, "dist", "node", "skills.json")
fs.mkdirSync(path.dirname(skillsJsonPath), { recursive: true })
fs.writeFileSync(skillsJsonPath, JSON.stringify(skillEntries, null, 2))
console.log(`Generated skills.json with ${Object.keys(skillEntries).length} skills`)

// Copy built-in skills to dist/node/skill/ (flattened structure)
const distSkillDir = path.join(dir, "dist", "node", "skill")
fs.mkdirSync(distSkillDir, { recursive: true })
if (fs.existsSync(skillsDir)) {
  const skillFiles = fs.globSync("**/SKILL.md", { cwd: skillsDir })
  for (const relPath of skillFiles) {
    const skillSourceDir = path.dirname(path.join(skillsDir, relPath))
    const skillName = path.basename(skillSourceDir)
    const destDir = path.join(distSkillDir, skillName)
    if (!fs.existsSync(destDir)) {
      fs.cpSync(skillSourceDir, destDir, { recursive: true })
    }
  }
  console.log(`Copied built-in skills to ${distSkillDir}`)
}

await Bun.build({
  target: "node",
  entrypoints: ["./src/node.ts"],
  outdir: "./dist/node",
  format: "esm",
  sourcemap: "linked",
  external: ["jsonc-parser", "@lydell/node-pty"],
  define: {
    OCTO_MIGRATIONS: JSON.stringify(migrations),
    OCTO_CHANNEL: `'${Script.channel}'`,
  },
  files: {
    "opencode-web-ui.gen.ts": "",
  },
})

console.log("Build complete")

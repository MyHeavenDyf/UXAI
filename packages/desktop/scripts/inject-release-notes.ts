#!/usr/bin/env bun

import { $ } from "bun"
import path from "node:path"
import { releaseNotes } from "./release-notes"

const repo = process.env.GH_REPO
if (!repo) throw new Error("GH_REPO is required")

const version = process.env.OCTO_VERSION
if (!version) throw new Error("OCTO_VERSION is required")

const file = Bun.file(path.join(process.env.RUNNER_TEMP ?? "/tmp", "latest-mac.yml"))
if (!(await file.exists())) throw new Error("latest-mac.yml is required")

const content = await file.text()
const releaseDate = content.indexOf("releaseDate:")
if (releaseDate === -1) throw new Error("releaseDate is required in latest-mac.yml")

await Bun.write(
  file,
  `${content.slice(0, releaseDate)}releaseNotes: |-\n${releaseNotes
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n")}\n${content.slice(releaseDate)}`,
)
await $`gh release upload ${`v${version}`} ${file.name!} --clobber --repo ${repo}`

console.log("injected release notes into latest-mac.yml")

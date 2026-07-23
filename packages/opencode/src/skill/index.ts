import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import { Effect, Layer, Context, Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { NamedError } from "@opencode-ai/core/util/error"
import type { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { Permission } from "@/permission"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { Glob } from "@opencode-ai/core/util/glob"
import * as Log from "@opencode-ai/core/util/log"
import { Discovery } from "./discovery"

const log = Log.create({ service: "skill" })
const CLAUDE_EXTERNAL_DIR = ".claude"
const AGENTS_EXTERNAL_DIR = ".agents"
const EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"
const OPENCODE_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"
const SKILL_PATTERN = "**/SKILL.md"

// Agent skill mapping: agents not listed in skill_config.json can inherit skill mappings from another agent.
// Key: agent name pattern (supports "*" suffix for prefix match, e.g. "proto_*"), Value: target agent name to inherit from.
const AGENT_SKILL_ALIASES: Record<string, string> = {
  "proto_*": "octo_make",
}

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  location: Schema.String,
  content: Schema.String,
  type: Schema.optional(Schema.String),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>

export const InvalidError = NamedError.create(
  "SkillInvalidError",
  z.object({
    path: z.string(),
    message: z.string().optional(),
    issues: z.custom<z.core.$ZodIssue[]>().optional(),
  }),
)

export const NameMismatchError = NamedError.create(
  "SkillNameMismatchError",
  z.object({
    path: z.string(),
    expected: z.string(),
    actual: z.string(),
  }),
)

type State = {
  skills: Record<string, Info>
  skillDirMap: Record<string, string> // skillName -> skillDir
  dirs: Set<string>
}

type DiscoveryState = {
  matches: string[]
  dirs: string[]
  typeMap: Record<string, string>
  agentConfig: Record<string, string[]>
}

type ScanState = {
  matches: Set<string>
  dirs: Set<string>
}

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly getMany: (names: string[]) => Effect.Effect<Info[]>
  readonly all: () => Effect.Effect<Info[]>
  readonly dirs: () => Effect.Effect<string[]>
  readonly available: (agent?: Agent.Info) => Effect.Effect<Info[]>
  readonly refresh: () => Effect.Effect<void>
}

const add = Effect.fnUntraced(function* (state: State, match: string, bus: Bus.Interface, typeMap?: Record<string, string>) {
  const md = yield* Effect.tryPromise({
    try: () => ConfigMarkdown.parse(match),
    catch: (err) => err,
  }).pipe(
    Effect.catch(
      Effect.fnUntraced(function* (err) {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse skill ${match}`
        const { Session } = yield* Effect.promise(() => import("@/session/session"))
        yield* bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load skill", { skill: match, err })
        return undefined
      }),
    ),
  )

  if (!md) return

  const parsed = z.object({ name: z.string(), description: z.string() }).safeParse(md.data)
  if (!parsed.success) return

  if (state.skills[parsed.data.name]) {
    log.warn("duplicate skill name", {
      name: parsed.data.name,
      existing: state.skills[parsed.data.name].location,
      duplicate: match,
    })
  }

  state.dirs.add(path.dirname(match))
  const skillDir = path.basename(path.dirname(match))
  state.skills[parsed.data.name] = {
    name: parsed.data.name,
    description: parsed.data.description,
    location: match,
    content: md.content,
    type: typeMap?.[skillDir],
  }
  state.skillDirMap[parsed.data.name] = skillDir
})

const scan = Effect.fnUntraced(function* (
  state: ScanState,
  root: string,
  pattern: string,
  opts?: { dot?: boolean; scope?: string },
) {
  const matches = yield* Effect.tryPromise({
    try: () =>
      Glob.scan(pattern, {
        cwd: root,
        absolute: true,
        include: "file",
        symlink: true,
        dot: opts?.dot,
      }),
    catch: (error) => error,
  }).pipe(
    Effect.catch((error) => {
      if (!opts?.scope) return Effect.die(error)
      log.error(`failed to scan ${opts.scope} skills`, { dir: root, error })
      return Effect.succeed([] as string[])
    }),
  )

  for (const match of matches) {
    state.matches.add(match)
    state.dirs.add(path.dirname(match))
  }
})

const discoverSkills = Effect.fnUntraced(function* (
  config: Config.Interface,
  discovery: Discovery.Interface,
  fsys: AppFileSystem.Interface,
  global: Global.Interface,
  directory: string,
  worktree: string,
) {
  const state: ScanState = { matches: new Set(), dirs: new Set() }

  const externalDirs: string[] = []
  if (!Flag.OPENCODE_DISABLE_EXTERNAL_SKILLS) {
    if (!Flag.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS) externalDirs.push(CLAUDE_EXTERNAL_DIR)
    externalDirs.push(AGENTS_EXTERNAL_DIR)

    for (const dir of externalDirs) {
      const root = path.join(global.home, dir)
      if (!(yield* fsys.isDir(root))) continue
      yield* scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "global" })
    }

    const upDirs = yield* fsys
      .up({ targets: externalDirs, start: directory, stop: worktree })
      .pipe(Effect.catch(() => Effect.succeed([] as string[])))

    for (const root of upDirs) {
      yield* scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "project" })
    }
  }

  const configDirs = yield* config.directories()
  for (const dir of configDirs) {
    yield* scan(state, dir, OPENCODE_SKILL_PATTERN)
  }

  // Unified skill directory at octoConfig/skill/ (all skills including built-in)
  // Only scan SKILL.md at depth 1 (skill-name/SKILL.md) to avoid picking up dist/ or nested copies
  const octoSkillDir = path.join(global.octoConfig, "skill")
  if (yield* fsys.isDir(octoSkillDir)) {
    yield* scan(state, octoSkillDir, "*/SKILL.md")
  }

  const cfg = yield* config.get()
  for (const item of cfg.skills?.paths ?? []) {
    const expanded = item.startsWith("~/") ? path.join(global.home, item.slice(2)) : item
    const dir = path.isAbsolute(expanded) ? expanded : path.join(directory, expanded)
    if (!(yield* fsys.isDir(dir))) {
      log.warn("skill path not found", { path: dir })
      continue
    }

    yield* scan(state, dir, SKILL_PATTERN)
  }

  for (const url of cfg.skills?.urls ?? []) {
    const pulledDirs = yield* discovery.pull(url)
    for (const dir of pulledDirs) {
      yield* scan(state, dir, SKILL_PATTERN)
    }
  }

  // Filter skills based on ~/.config/octo/skill_config.json, fallback to skills.json
  let matches = Array.from(state.matches)
  let agentConfig: Record<string, string[]> = {}
  const skillConfigPath = path.join(global.octoConfig, "skill_config.json")
  const skillConfig = yield* Effect.tryPromise({
    try: () =>
      import("fs/promises").then((fs) =>
        fs.readFile(skillConfigPath, "utf-8").then((text) => {
          const parsed = JSON.parse(text) as {
            skill?: Record<string, { description?: string; import?: boolean; type?: string }>
            agent?: Record<string, string[]>
          }
          return parsed
        }),
      ),
    catch: () => null,
  }).pipe(Effect.catch(() => Effect.succeed(null)))
  const typeMap: Record<string, string> = {}
  if (skillConfig && typeof skillConfig === "object") {
    agentConfig = skillConfig.agent ?? {}
    const skillData = skillConfig.skill
    if (skillData && typeof skillData === "object") {
      matches = matches.filter((match) => {
        const skillDir = path.basename(path.dirname(match))
        const entry = skillData[skillDir]
        if (entry && typeof entry === "object") {
          if (entry.type) typeMap[skillDir] = entry.type
          return entry.import !== false
        }
        return true
      })
    }
  } else {
    // Fallback: read skills.json for backward compatibility
    const legacyPath = path.join(global.octoConfig, "skills.json")
    const legacyConfig = yield* Effect.tryPromise({
      try: () =>
        import("fs/promises").then((fs) =>
          fs.readFile(legacyPath, "utf-8").then((text) => JSON.parse(text) as Record<string, { description?: string; import?: boolean; type?: string }>),
        ),
      catch: () => null,
    }).pipe(Effect.catch(() => Effect.succeed(null)))
    if (legacyConfig && typeof legacyConfig === "object") {
      matches = matches.filter((match) => {
        const skillDir = path.basename(path.dirname(match))
        const entry = legacyConfig[skillDir]
        if (entry && typeof entry === "object") {
          if (entry.type) typeMap[skillDir] = entry.type
          return entry.import !== false
        }
        return true
      })
      // Build agentConfig from legacy type field
      for (const [name, entry] of Object.entries(legacyConfig)) {
        if (entry.import === false) continue
        const t = entry.type || "common"
        if (t === "common") {
          for (const key of ["octo_insight", "octo_make", "octo_studio"]) {
            agentConfig[key] = agentConfig[key] ?? []
            agentConfig[key].push(name)
          }
        } else if (["octo_insight", "octo_make", "octo_studio"].includes(t)) {
          agentConfig[t] = agentConfig[t] ?? []
          agentConfig[t].push(name)
        }
      }
    }
  }

  return {
    matches,
    dirs: Array.from(state.dirs),
    typeMap,
    agentConfig,
  }
})

const loadSkills = Effect.fnUntraced(function* (state: State, discovered: DiscoveryState, bus: Bus.Interface) {
  yield* Effect.forEach(discovered.matches, (match) => add(state, match, bus, discovered.typeMap), {
    concurrency: "unbounded",
    discard: true,
  })

  log.info("init", { count: Object.keys(state.skills).length })
})

export class Service extends Context.Service<Service, Interface>()("@opencode/Skill") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const discovery = yield* Discovery.Service
    const config = yield* Config.Service
    const bus = yield* Bus.Service
    const fsys = yield* AppFileSystem.Service
    const global = yield* Global.Service
    const discovered = yield* InstanceState.make(
      Effect.fn("Skill.discovery")(function* (ctx) {
        return yield* discoverSkills(config, discovery, fsys, global, ctx.directory, ctx.worktree)
      }),
    ).pipe(Effect.orDie)
    const state = yield* InstanceState.make(
      Effect.fn("Skill.state")(function* () {
        const s: State = { skills: {}, skillDirMap: {}, dirs: new Set() }
        yield* loadSkills(s, yield* InstanceState.get(discovered), bus)
        return s
      }),
    ).pipe(Effect.orDie)

    const get = Effect.fn("Skill.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      return s.skills[name]
    })

    const getMany = Effect.fn("Skill.getMany")(function* (names: string[]) {
      const s = yield* InstanceState.get(state)
      return names.map((name) => s.skills[name]).filter((skill): skill is Info => skill !== undefined)
    })

    const all = Effect.fn("Skill.all")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.skills)
    })

    const dirs = Effect.fn("Skill.dirs")(function* () {
      return (yield* InstanceState.get(discovered)).dirs
    })

    const available = Effect.fn("Skill.available")(function* (agent?: Agent.Info) {
      const s = yield* InstanceState.get(state)
      const d = yield* InstanceState.get(discovered)
      const list = Object.values(s.skills).toSorted((a, b) => a.name.localeCompare(b.name))
      if (!agent) return list

      // Resolve agent skill alias: if agent name matches a prefix pattern in AGENT_SKILL_ALIASES,
      // use the mapped agent's skill config instead.
      let agentKey = agent.name
      for (const [pattern, target] of Object.entries(AGENT_SKILL_ALIASES)) {
        if (pattern.endsWith("*") && agent.name.startsWith(pattern.slice(0, -1))) {
          agentKey = target
          break
        }
        if (pattern === agent.name) {
          agentKey = target
          break
        }
      }

      const allowedDirs = d.agentConfig[agentKey] ?? []
      const allowedSet = new Set(allowedDirs)
      return list.filter((skill) => {
        if (Permission.evaluate("skill", skill.name, agent.permission).action === "deny") return false
        const skillDir = s.skillDirMap[skill.name]
        return allowedSet.has(skillDir)
      })
    })

    const refresh = Effect.fn("Skill.refresh")(function* () {
      // skill_config.json / skill 目录是全局配置,所有 directory 的实例共享。
      // 用 invalidateAll 清掉所有 directory 的缓存,避免单 directory invalidate
      // 让其它 directory 的实例仍读到旧 skill 列表(详见 opencode_modify 记录)。
      yield* InstanceState.invalidateAll(discovered)
      yield* InstanceState.invalidateAll(state)
    })

    return Service.of({ get, getMany, all, dirs, available, refresh })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Discovery.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Bus.layer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Global.layer),
)

export function fmt(list: Info[], opts: { verbose: boolean }) {
  if (list.length === 0) return "No skills are currently available."
  if (opts.verbose) {
    return [
      "<available_skills>",
      ...list
        .sort((a, b) => a.name.localeCompare(b.name))
        .flatMap((skill) => [
          "  <skill>",
          `    <name>${skill.name}</name>`,
          `    <description>${skill.description}</description>`,
          `    <location>${pathToFileURL(skill.location).href}</location>`,
          "  </skill>",
        ]),
      "</available_skills>",
    ].join("\n")
  }

  return [
    "## Available Skills",
    ...list
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((skill) => `- **${skill.name}**: ${skill.description}`),
  ].join("\n")
}

import { SkillUsed } from "./events"

export { SkillUsed }

export * as Skill from "."

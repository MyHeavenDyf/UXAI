/**
 * migrate.ts 的部署与迁移函数 —— 全部走注入参数,不触发任何 `app.*`
 * (configDir/sourcePath 的默认值表达式永不求值)。
 *
 * 重点钉住 migrateLegacyOctoConfig 的两条不变量:**copy-if-missing、绝不覆盖**
 * (用户定制与新版本部署优先),以及 carve-out —— proxy_config.json 与
 * prototype/ 不随迁(消费方刻意钉死 `~/.config/octo`)。
 */
import { afterAll, describe, expect, mock, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const root = realpathSync(mkdtempSync(join(tmpdir(), "migrate-test-")))

// migrate.ts / constants.ts 具名导入 electron,bun 的 ESM 加载器对 CJS 字符串导出
// 做具名链接会失败,必须 mock。`default` 不能省:electron-store 是 ESM 且
// default-import electron。注册必须先于下面的动态 import。
const electronMock = { app: { getPath: () => join(root, "user-data"), isPackaged: false }, dialog: {} }
mock.module("electron", () => ({ ...electronMock, default: electronMock }))

const Migrate = await import("./migrate")

afterAll(() => rmSync(root, { recursive: true, force: true }))

function dir(name: string): string {
  const d = join(root, name)
  mkdirSync(d, { recursive: true })
  return d
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data), "utf8")
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"))
}

describe("deploySkillsJson", () => {
  test("目标缺失时整份复制", () => {
    const configDir = dir("sj-copy")
    const source = dir("sj-copy-src")
    writeJson(join(source, "skills.json"), { "my-skill": { description: "x", type: "agent" } })

    Migrate.deploySkillsJson({ configDir, sourcePath: join(source, "skills.json") })

    expect(readJson(join(configDir, "skills.json"))).toEqual({ "my-skill": { description: "x", type: "agent" } })
  })

  test("目标已存在时只 merge 缺失的 type,不覆盖已有内容也不新增条目", () => {
    const configDir = dir("sj-merge")
    const source = dir("sj-merge-src")
    writeJson(join(configDir, "skills.json"), {
      "my-skill": { description: "自定义" },
      "typed-skill": { description: "t", type: "builtin" },
      "user-skill": { description: "y" },
    })
    writeJson(join(source, "skills.json"), {
      "my-skill": { description: "x", type: "agent" },
      "typed-skill": { description: "x", type: "agent" },
      "new-skill": { description: "z", type: "agent" },
    })

    Migrate.deploySkillsJson({ configDir, sourcePath: join(source, "skills.json") })

    const merged = readJson(join(configDir, "skills.json"))
    expect(merged["my-skill"]).toEqual({ description: "自定义", type: "agent" })
    expect(merged["typed-skill"]).toEqual({ description: "t", type: "builtin" })
    expect(merged["user-skill"]).toEqual({ description: "y" })
    expect(merged["new-skill"]).toBeUndefined()
  })

  test("源文件缺失时告警跳过,不抛错", () => {
    const configDir = dir("sj-missing")

    expect(() =>
      Migrate.deploySkillsJson({ configDir, sourcePath: join(root, "sj", "no-such.json") }),
    ).not.toThrow()
    expect(existsSync(join(configDir, "skills.json"))).toBe(false)
  })
})

describe("deployBuiltinSkills", () => {
  function makeSource(tag: string, names: string[]): string {
    const src = dir(`bs-src-${tag}`)
    for (const name of names) {
      mkdirSync(join(src, name), { recursive: true })
      writeFileSync(join(src, name, "SKILL.md"), `---\nname: ${name}\n---\n`)
    }
    return src
  }

  test("逐个复制缺失的 skill 目录", () => {
    const configDir = dir("bs-copy")
    const source = makeSource("copy", ["alpha", "beta"])

    Migrate.deployBuiltinSkills({ configDir, skillsSource: source })

    expect(existsSync(join(configDir, "skill", "alpha", "SKILL.md"))).toBe(true)
    expect(existsSync(join(configDir, "skill", "beta", "SKILL.md"))).toBe(true)
  })

  test("已存在的目录保持原样 —— 用户定制优先", () => {
    const configDir = dir("bs-keep")
    const source = makeSource("keep", ["alpha"])
    const customized = join(configDir, "skill", "alpha")
    mkdirSync(customized, { recursive: true })
    writeFileSync(join(customized, "SKILL.md"), "user customized")

    Migrate.deployBuiltinSkills({ configDir, skillsSource: source })

    expect(readFileSync(join(customized, "SKILL.md"), "utf8")).toBe("user customized")
  })

  test("spreadsheets 跳过不部署 —— 同名目录必须是用户自定义技能", () => {
    const configDir = dir("bs-spreadsheets")
    const source = makeSource("sp", ["spreadsheets", "alpha"])

    Migrate.deployBuiltinSkills({ configDir, skillsSource: source })

    expect(existsSync(join(configDir, "skill", "spreadsheets"))).toBe(false)
    expect(existsSync(join(configDir, "skill", "alpha"))).toBe(true)
  })
})

describe("migrateLegacyOctoConfig", () => {
  function makeLegacy(base: string): string {
    mkdirSync(join(base, "skill", "user-skill"), { recursive: true })
    writeFileSync(join(base, "skill", "user-skill", "SKILL.md"), "user")
    mkdirSync(join(base, "skill", "fastui-vue-creator"), { recursive: true })
    writeFileSync(join(base, "skill", "fastui-vue-creator", "SKILL.md"), "builtin-old")
    writeJson(join(base, "octo.json"), { theme: "dark" })
    writeJson(join(base, "skills.json"), { "user-skill": { description: "x" } })
    // 两个 carve-out:proxy_config.json 由 proxy-config.ts 钉死,prototype/ 由 server 端硬编码消费
    writeJson(join(base, "proxy_config.json"), { proxy: "secret" })
    mkdirSync(join(base, "prototype", "v1"), { recursive: true })
    return base
  }

  test("覆盖激活时 copy-if-missing 过去,绝不覆盖已有项,carve-out 不迁", () => {
    const legacy = makeLegacy(dir("mc-legacy"))
    const target = dir("mc-target")
    // target 已有用户改过的 skill 与自己的 octo.json,都必须原样保留
    mkdirSync(join(target, "skill", "fastui-vue-creator"), { recursive: true })
    writeFileSync(join(target, "skill", "fastui-vue-creator", "SKILL.md"), "user-modified")
    writeJson(join(target, "octo.json"), { theme: "light" })

    Migrate.migrateLegacyOctoConfig({ sourceDir: legacy, targetDir: target })

    expect(readFileSync(join(target, "skill", "fastui-vue-creator", "SKILL.md"), "utf8")).toBe("user-modified")
    expect(readFileSync(join(target, "skill", "user-skill", "SKILL.md"), "utf8")).toBe("user")
    expect(readJson(join(target, "octo.json"))).toEqual({ theme: "light" })
    expect(readJson(join(target, "skills.json"))).toEqual({ "user-skill": { description: "x" } })
    expect(existsSync(join(target, "proxy_config.json"))).toBe(false)
    expect(existsSync(join(target, "prototype"))).toBe(false)
  })

  test("源目录不存在时静默 no-op", () => {
    const target = dir("mc-noop")

    expect(() =>
      Migrate.migrateLegacyOctoConfig({ sourceDir: join(root, "mc", "no-such"), targetDir: target }),
    ).not.toThrow()
    expect(existsSync(join(target, "skills.json"))).toBe(false)
  })

  test("同路径(未覆盖激活)时走 rescue:救回坏窗口期间 server 写进 xdg-config 的配置", () => {
    const standard = dir("mc-standard")
    mkdirSync(join(standard, "skill", "fastui-vue-creator"), { recursive: true })
    writeFileSync(join(standard, "skill", "fastui-vue-creator", "SKILL.md"), "deployed")
    const rescue = dir("mc-rescue")
    writeJson(join(rescue, "octo.json"), { savedDuringBrokenWindow: true })
    mkdirSync(join(rescue, "skill", "window-skill"), { recursive: true })
    writeFileSync(join(rescue, "skill", "window-skill", "SKILL.md"), "rescued")

    Migrate.migrateLegacyOctoConfig({ sourceDir: standard, targetDir: standard, rescueDir: rescue })

    expect(readJson(join(standard, "octo.json"))).toEqual({ savedDuringBrokenWindow: true })
    expect(readFileSync(join(standard, "skill", "window-skill", "SKILL.md"), "utf8")).toBe("rescued")
    expect(readFileSync(join(standard, "skill", "fastui-vue-creator", "SKILL.md"), "utf8")).toBe("deployed")
  })

  test("同路径且无 rescue 时 no-op", () => {
    const standard = dir("mc-same")
    writeJson(join(standard, "octo.json"), { a: 1 })

    expect(() => Migrate.migrateLegacyOctoConfig({ sourceDir: standard, targetDir: standard })).not.toThrow()
    expect(readJson(join(standard, "octo.json"))).toEqual({ a: 1 })
  })
})

describe("deployRipgrep", () => {
  const rgName = process.platform === "win32" ? "rg.exe" : "rg"

  test("复制二进制到注入的 bin 目录", () => {
    const source = dir("rg-src")
    writeFileSync(join(source, "rg.bin"), "fake binary")
    const target = dir("rg-target")

    Migrate.deployRipgrep({ targetDir: target, sourcePath: join(source, "rg.bin") })

    expect(readFileSync(join(target, rgName), "utf8")).toBe("fake binary")
  })

  test("目标已存在时跳过", () => {
    const source = dir("rg-src2")
    writeFileSync(join(source, "rg.bin"), "new binary")
    const target = dir("rg-target2")
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, rgName), "existing binary")

    Migrate.deployRipgrep({ targetDir: target, sourcePath: join(source, "rg.bin") })

    expect(readFileSync(join(target, rgName), "utf8")).toBe("existing binary")
  })
})

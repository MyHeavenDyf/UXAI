import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs"
import { join, dirname, resolve, relative, basename } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))

async function loadBabel() {
  const babelCandidates = [
    join(scriptDir, "babel.min.js"),
    join(scriptDir, "..", "babel.min.js"),
    join(scriptDir, "assets", "babel.min.js"),
  ]
  for (const p of babelCandidates) {
    if (existsSync(p)) {
      const imported = await import(pathToFileURL(p).href)
      return imported.default ?? imported.Babel ?? imported ?? globalThis.Babel
    }
  }
  try {
    const imported = await import("@babel/standalone")
    return imported.transform ? imported : imported.default
  } catch {}
  console.error("[compile-react-components] 找不到 Babel，请满足以下任一条件:")
  console.error("  1. 同目录存在 babel.min.js（推荐，构建时自动生成）")
  console.error("  2. 运行环境安装了 @babel/standalone（bun add @babel/standalone）")
  process.exit(1)
}

const Babel = await loadBabel()
if (!Babel || typeof Babel.transform !== "function") {
  console.error("[compile-react-components] Babel 加载成功但缺少 transform 方法")
  process.exit(1)
}

const candidates = process.argv[2]
  ? [resolve(process.argv[2])]
  : [
      join(process.cwd(), "components"),
      join(scriptDir, "..", "components"),
      join(scriptDir, "..", "..", "components"),
      join(scriptDir, "..", "..", "..", "previewdist", "components"),
    ]

const root = candidates.find((p) => existsSync(p))
if (!root) {
  console.error(`[compile-react-components] 未找到 components 目录，尝试过: ${candidates.join(", ")}`)
  console.error("用法: bun compile-react-components.mjs [previewdist 目录或 components 目录]")
  process.exit(1)
}

const IMPORT_RE = /(?:import\s[^;]*?from\s*|import\s*|require\s*\(\s*)["'](\.[^"']+)["']/g

function resolveDep(baseDir, spec) {
  const candidatesFor = [
    resolve(baseDir, spec),
    resolve(baseDir, spec + ".jsx"),
    resolve(baseDir, spec + ".js"),
  ]
  for (const c of candidatesFor) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

function compileModule(source, filename) {
  return (
    Babel.transform(source, {
      presets: [["env", { targets: { chrome: "100" }, modules: "commonjs" }], "react"],
      filename,
    }).code ?? ""
  )
}

function buildBundle(componentDir, name) {
  const entryFile = join(componentDir, `${name}.jsx`)
  const modules = []
  const seen = new Set()
  const pending = [{ file: entryFile, key: `./${name}.jsx` }]

  while (pending.length) {
    const { file, key } = pending.shift()
    if (seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(file, "utf8")
    const baseDir = dirname(file)
    const importMap = {}
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[1]
      if (/\.css$/.test(spec)) continue
      const resolved = resolveDep(baseDir, spec)
      if (!resolved) continue
      const depKey = "./" + relative(componentDir, resolved).replace(/\\/g, "/")
      importMap[spec] = depKey
      pending.push({ file: resolved, key: depKey })
    }
    let code = compileModule(source, basename(file))
    for (const [spec, depKey] of Object.entries(importMap)) {
      code = code.split(JSON.stringify(spec)).join(JSON.stringify(depKey))
    }
    modules.push({ key, code })
  }

  const entryKey = `./${name}.jsx`
  const moduleFns = modules
    .map(
      (m) =>
        `  ${JSON.stringify(m.key)}: function(module, exports, require) {\n${m.code}\n  }`
    )
    .join(",\n")

  return `window.__A2UI_REGISTER_COMPONENT__&&window.__A2UI_REGISTER_COMPONENT__(${JSON.stringify(
    name
  )},function(require,module,exports){
var __modules={
${moduleFns}
};
var __cache={};
function __localRequire(id){
  if(__modules[id]){
    if(!__cache[id]){
      var mod={exports:{}};
      __cache[id]=mod;
      __modules[id](mod,mod.exports,__localRequire);
    }
    return __cache[id].exports;
  }
  return require(id);
}
var __entry={exports:{}};
__modules[${JSON.stringify(entryKey)}](__entry,__entry.exports,__localRequire);
module.exports=__entry.exports;
})`
}

for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const name = entry.name
  const componentDir = join(root, name)
  const jsxPath = join(componentDir, `${name}.jsx`)
  if (!existsSync(jsxPath)) continue
  writeFileSync(join(componentDir, `${name}.js`), buildBundle(componentDir, name))
  console.log(`compiled: ${name}/${name}.js`)
}

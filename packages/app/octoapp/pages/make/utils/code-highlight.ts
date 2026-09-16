import Prism from "prismjs"
import "prismjs/themes/prism.css"

import "prismjs/components/prism-clike"
import "prismjs/components/prism-markup"
import "prismjs/components/prism-css"
import "prismjs/components/prism-javascript"
import "prismjs/components/prism-json"
import "prismjs/components/prism-typescript"
import "prismjs/components/prism-jsx"
import "prismjs/components/prism-tsx"
import "prismjs/components/prism-scss"
import "prismjs/components/prism-less"
import "prismjs/components/prism-c"
import "prismjs/components/prism-cpp"
import "prismjs/components/prism-csharp"
import "prismjs/components/prism-python"
import "prismjs/components/prism-go"
import "prismjs/components/prism-rust"
import "prismjs/components/prism-java"
import "prismjs/components/prism-kotlin"
import "prismjs/components/prism-swift"
import "prismjs/components/prism-php"
import "prismjs/components/prism-markup-templating"
import "prismjs/components/prism-ruby"
import "prismjs/components/prism-bash"
import "prismjs/components/prism-yaml"
import "prismjs/components/prism-toml"
import "prismjs/components/prism-sql"
import "prismjs/components/prism-graphql"
import "prismjs/components/prism-docker"
import "prismjs/components/prism-markdown"

const EXT_TO_LANG: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  vue: "markup",
  svelte: "markup",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  rss: "markup",
  atom: "markup",
  css: "css",
  scss: "scss",
  less: "less",
  json: "json",
  jsonc: "json",
  json5: "json",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  rb: "ruby",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sql: "sql",
  graphql: "graphql",
  dockerfile: "docker",
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

const CODE_KIND_EXTENSIONS = new Set([
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "vue", "svelte",
  "css", "scss", "less", "sass",
  "json", "jsonc", "json5",
  "py", "go", "rs", "java", "kt", "swift",
  "c", "h", "cpp", "cc", "hpp", "cs", "php", "rb",
  "sh", "bash", "zsh",
  "yml", "yaml", "toml",
  "sql", "graphql",
])

export function isCodeFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  if (ext === "dockerfile") return true
  return CODE_KIND_EXTENSIONS.has(ext)
}

export function getLanguageFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  if (ext === "dockerfile") return "docker"
  return EXT_TO_LANG[ext] ?? "clike"
}

export function highlightCode(code: string, language: string): string {
  const grammar = Prism.languages[language]
  if (!grammar) return escapeHtml(code)
  return Prism.highlight(code, grammar, language)
}

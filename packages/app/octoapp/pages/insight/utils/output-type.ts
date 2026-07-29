// 产物类型判定 —— **单一入口**(SPEC-INS-026 §4.2)。
//
// 收敛前系统里有三套判定,同一个文件能得出不同结论:
//   - `mimeToOutputType(mimeType)` + `business_type` 覆盖(路径 A,MCP resource_link)
//   - `extToOutputType(filename)`(路径 C,write 产物 / 文件管理)
//   - `fileKind(filename)`(文件管理筛选分组,12 值,第三套扩展名表)
// 典型分叉:`.csv` → `table` vs `file`;`text/plain` → `file` vs `code`。tab 去重键里带了
// type,于是同一份磁盘文件从两个入口打开会开出两个 tab —— 这是 PR #445 那个「双开」的直接成因。
//
// 解析顺序对齐 VS Code `ILanguageService` 的单一解析链:**扩展名 → mimeType 兜底 → `code`**。
// 扩展名优先是因为身份就是磁盘路径,文件名是身份的一部分;mimeType 只在文件名给不出结论
// (无扩展名)时兜底。
//
// `business_type` 不参与判定(§8):它的定义是「产生该资源的 MCP tool 名」,被误当成了
// 「用哪个渲染器」。思维导图不是独立类型,是「json 的一种内容形态」,由渲染层的
// `isMindmapJSON` 按内容判定 —— 实事求是,不管这份 json 从哪来。

/**
 * 产物卡 / tab 的类型。**六个,收敛后不再增减**(§4.2)。
 *
 * 已退役:`mindmap`(是 json 的内容形态,由 isMindmapJSON 判定)、`table`(§7:唯一生产者是
 * `text/csv`,而 csv→markdown 表格的转换函数从未实现,TableRenderer 喂原始 CSV 只会渲成
 * 「未检测到表格内容」;csv 归 `file`,用 Excel/Numbers 打开体验更好)。
 */
export type OutputCardType = "markdown" | "html" | "json" | "code" | "file" | "image"

// ── 扩展名分类(SOT:与 docs/specs/ui/output-renderers.md §2.6.1 扩展名清单同源)──
//
// 分流总原则:
//   1. RENDER_EXT —— 我们渲染得好的,应用内专用 renderer(md→markdown / html→iframe / json→shiki)
//   2. FILE_EXT   —— office / 表格 / 图片(不可浏览器渲染的)/ 媒体 / 压缩 / 字体 / 二进制:拉本地应用打开
//   3. 兜底 code  —— 其余一律当「能读到文本内容的代码/纯文本」,应用内 shiki 预览
//      (无需穷举代码扩展名——不在 RENDER/FILE 的都走 code,新语言零维护)

const RENDER_EXT: Record<string, OutputCardType> = {
  md: "markdown", markdown: "markdown", mdown: "markdown", mkd: "markdown",
  html: "html", htm: "html", xhtml: "html",
  // .json 扩展名不携带语义 —— 普通配置 JSON 与思维导图 JSON 同扩展名,无法靠扩展名区分。
  // 故一律出 json 卡;内容恰为导图 shape 时由渲染层 isMindmapJSON 判定渲 markmap(§4.2)。
  json: "json", json5: "json", jsonc: "json",
  // 图片扩展名 → image 卡(走 ImageRenderer,local:// 协议读盘渲染 / uri 直接加载),
  // 不走 file 卡(FileFallback 三按钮)。与 Design 页签同款行为。
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", bmp: "image",
  tiff: "image", tif: "image", ico: "image", svg: "image", heic: "image", heif: "image", avif: "image",
}

// 走 file 卡(本地应用打开)的扩展名。判据:**office/系统能打开但我们应用内渲染无价值或无法渲染**。
// 列全这一类即可——其余文本自动兜底 code。
const FILE_EXT = new Set([
  // 表格(含 csv:原始逗号数据,Excel/Numbers 打开体验远好过硬渲染;§7 起 text/csv 也归这里)
  "csv", "tsv", "xls", "xlsx", "xlsm", "xlsb", "ods",
  // 文档 / 演示
  "doc", "docx", "ppt", "pptx", "odt", "odp", "rtf", "pdf", "pages", "numbers", "key", "epub",
  // 图片(仅 psd/ai/sketch/fig 等无法浏览器内渲染的归 file;png/jpg/gif/svg 等已进 RENDER_EXT → image 卡)
  "psd", "ai", "sketch", "fig",
  // 音视频
  "mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v", "mp3", "wav", "flac", "m4a", "aac", "ogg", "opus",
  // 压缩 / 镜像 / 安装包
  "zip", "tar", "gz", "tgz", "bz2", "xz", "zst", "rar", "7z", "iso", "dmg", "pkg", "deb", "rpm", "msi", "apk",
  // 字体
  "woff", "woff2", "ttf", "otf", "eot",
  // 可执行 / 库 / 目标文件(出 file 卡但隐藏打开按钮,见 write-output.canOpenLocally)
  "exe", "dll", "so", "dylib", "bin", "o", "a", "lib", "obj", "class", "wasm", "app",
])

// mimeType 兜底表:**只在文件名无扩展名时**用到(有扩展名就已经有结论了,再看 mime 只会制造分叉)。
const MIME_TYPE: Record<string, OutputCardType> = {
  "text/html": "html",
  "text/markdown": "markdown",
  "application/json": "json",
  "text/plain": "code",
  // §7:原本映射到 `table`(那条链路是死的,见 OutputCardType 注释)。归 file,与 `.csv` 扩展名一致。
  "text/csv": "file",
}

/** 取小写扩展名;无扩展名(含 `Makefile` / `.gitignore` 这种纯点号开头)返回空串。 */
export function extOf(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? ""
  const dot = base.lastIndexOf(".")
  // dot <= 0 覆盖「没有点」与「点在开头(.gitignore,整串是主名不是扩展名)」两种情况
  if (dot <= 0 || dot === base.length - 1) return ""
  return base.slice(dot + 1).toLowerCase()
}

/**
 * 文件名(+ 可选 mimeType)→ 产物类型。**全系统唯一的类型判定入口**。
 *
 * @param filename 磁盘 basename 或完整路径(内部只取 basename)
 * @param mimeType MCP resource_link 的 mimeType;**仅在文件名无扩展名时**参与判定
 */
export function resolveOutputType(filename: string, mimeType?: string): OutputCardType {
  const ext = extOf(filename)
  if (ext) {
    if (RENDER_EXT[ext]) return RENDER_EXT[ext]
    if (FILE_EXT.has(ext)) return "file"
    // 已知有扩展名但不在两张表里(.py/.ts/.txt/.conf/未知扩展名)→ 文本,应用内 shiki 预览。
    // 这里**不再看 mimeType**:扩展名已经给出结论,mime 只会带来第二个答案。
    return "code"
  }
  if (mimeType) {
    const byMime = MIME_TYPE[mimeType]
    if (byMime) return byMime
    if (mimeType.startsWith("image/")) return "image"
    // pdf / office / 其他二进制:无扩展名又是二进制 mime → 本地应用打开
    if (!mimeType.startsWith("text/")) return "file"
  }
  return "code"
}

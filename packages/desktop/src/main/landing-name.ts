// 产物落盘文件名 —— 唯一清洗入口(SPEC-INS-026 §4.1「命名:只做必要清洗」)。
//
// **必要 = 不清洗就落不了盘、或不安全。** 其余一律保持来源文件名与磁盘名逐字一致:
// 展示名(对话入口卡 / tab 标签 / 文件管理)直接取磁盘 basename,没有转换就不会有分叉。
//
// 明确废除的旧规则(SPEC-INS-014 §3.1 的 sanitizeWorktreeName):空格 → `_`、括号等 → `_`、
// 主名截 100 字符。那条源自「文件名随 basename 进 S3 URL、特殊字符致 MCP 下载失败」,
// 而文件名已退出 URL(上传合同 v2),约束消失——它正是 `林(2).json` 在文件管理里显示成
// `林_2_.json` 的原因。上传(copy-file-to-worktree)与下载(download-resource-to-temp)两个方向同废。
//
// 撞名不归本模块管,仍走 ipc.ts 的 collisionFreePath(` (n)` 后缀)。
//
// > 反模式提醒:不要在渲染进程复刻本模块来「预测落盘名」。它假设所有产物都走同一条落盘路径,
// > 而 write 产物不走,反而会制造新的名字分叉。展示名用磁盘 basename 即可。见 SPEC-INS-026 §4.3。

/**
 * 拒绝类失败的 message 前缀。渲染端据此把「文件名不合法」与「网络失败」区分开
 * (前者重试无用,要响亮 toast;后者静默重试即可)。
 *
 * **跨进程边界的同步点**:渲染端副本在
 * `packages/app/octoapp/pages/insight/utils/local-resource.ts` 的 `NAME_REJECTED_PREFIX`,
 * 主进程不 import 渲染端包,改这里必须同步改那里。
 */
export const LANDING_NAME_REJECTED = "[octo:name-rejected]"

/** 文件系统单个文件名的字节上限(APFS / ext4 / NTFS 均 >= 255;取最保守的 255 字节)。 */
const NAME_MAX_BYTES = 255

/** Windows 非法字符(NUL 与分隔符已在全平台拒绝,这里只管其余的)。 */
const WINDOWS_ILLEGAL = /[<>:"|?*\x01-\x1f]/g

/** Windows 设备保留名(不分大小写,且带扩展名的 `CON.txt` 同样被保留)。 */
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

function reject(raw: string, reason: string): never {
  throw new Error(`${LANDING_NAME_REJECTED} ${reason}:${JSON.stringify(raw)}`)
}

/** UTF-8 字节数。 */
function byteLength(s: string): number {
  return Buffer.byteLength(s, "utf8")
}

/**
 * 按 UTF-8 字节截断到 `maxBytes`,**按码点边界切**(不产生半个字符 / U+FFFD)。
 * 用 Array.from 而非索引遍历:代理对(emoji 等)要整体保留或整体丢弃。
 */
function truncateBytes(s: string, maxBytes: number): string {
  if (byteLength(s) <= maxBytes) return s
  let out = ""
  let used = 0
  for (const ch of s) {
    const n = byteLength(ch)
    if (used + n > maxBytes) break
    out += ch
    used += n
  }
  return out
}

/**
 * 超长按字节截断、**保住扩展名**。扩展名本身就撑爆上限(病态输入)时放弃保扩展名,整体截断。
 */
function fitToNameMax(name: string): string {
  if (byteLength(name) <= NAME_MAX_BYTES) return name
  const dot = name.lastIndexOf(".")
  const hasExt = dot > 0 && dot < name.length - 1
  if (!hasExt) return truncateBytes(name, NAME_MAX_BYTES)
  const ext = name.slice(dot)
  const extBytes = byteLength(ext)
  // 扩展名 + 至少 1 字节主名都放不下 → 不保扩展名
  if (extBytes >= NAME_MAX_BYTES) return truncateBytes(name, NAME_MAX_BYTES)
  const stem = truncateBytes(name.slice(0, dot), NAME_MAX_BYTES - extBytes)
  // 截完主名为空(如主名首字符就是多字节且放不下)→ 退回整体截断,不产出裸扩展名
  return stem.length > 0 ? stem + ext : truncateBytes(name, NAME_MAX_BYTES)
}

/**
 * Windows 专属处理:非法字符替换、保留名规避、去掉尾部 `.` 与空格。
 * 不处理的话 `fs.writeFile` 直接抛 `EINVAL`,产物丢失;macOS/Linux 这些字符合法,**不处理**。
 */
function forWindows(name: string): string {
  let out = name.replace(WINDOWS_ILLEGAL, "_")
  // 尾部 `.` 与空格:Windows 会静默吞掉,导致磁盘名 ≠ 请求名(又一处名字分叉),主动去掉
  out = out.replace(/[. ]+$/, "")
  if (out.length === 0) return "_"
  const dot = out.lastIndexOf(".")
  const stem = dot > 0 ? out.slice(0, dot) : out
  const ext = dot > 0 ? out.slice(dot) : ""
  // `CON` / `CON.txt` 都会被 Windows 解析成设备,主名加 `_` 后缀避开(仍与原名可辨认对应)
  return WINDOWS_RESERVED.test(stem) ? `${stem}_${ext}` : out
}

/**
 * MCP / 用户提供的文件名 → 可安全落盘的文件名。
 *
 * 全平台**拒绝**(抛错,不静默改名):
 *   - 空名 / 纯空白 —— 落不了盘
 *   - 含 `/` `\` `NUL` —— 含分隔符的字符串不是文件名;`join(dir, "a/b.json")` 会写进子目录、
 *     `../` 会写出会话目录(路径穿越,OS 不会拦)
 *   - 名字为 `.` 或 `..` —— 同上
 *
 * Windows 额外做替换(见 forWindows);全平台超长按字节截断保扩展名。
 *
 * @param platform 便于单测两个分支;生产调用不传,取 `process.platform`。
 */
export function landingName(raw: string, platform: NodeJS.Platform = process.platform): string {
  if (typeof raw !== "string" || raw.trim().length === 0) reject(raw, "文件名为空")
  if (raw.includes("/") || raw.includes("\\")) reject(raw, "文件名含路径分隔符")
  if (raw.includes("\0")) reject(raw, "文件名含 NUL 字符")
  if (raw === "." || raw === "..") reject(raw, "文件名是目录引用")

  const adjusted = platform === "win32" ? forWindows(raw) : raw
  // Windows 处理后可能退化成 `.` / `..`(如 `..  ` 去尾空格后)——再拦一次,拒绝优先于兜底改名
  if (adjusted === "." || adjusted === "..") reject(raw, "文件名是目录引用")
  return fitToNameMax(adjusted)
}

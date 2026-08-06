// EDM 文件归档(EdmUtil.upload)单文件大小区间 1B~4GiB(下限 1 字节、上限 4GiB=4*1024³,1024 进制,超界服务端拒)。
// 仅 file 模式归档用;HTML 走另一条链路(zip + uploadVersion),无此限制。
const ARCHIVE_MIN_FILE_SIZE = 1
const ARCHIVE_MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024

// 单文件大小校验:返回 null=通过,否则返回拒绝文案,供按钮 tooltip / 文件管理菜单项 / 中央守卫 toast 复用。
// size 缺值(uri 源 tab 无 size)→ 返回 null:不在按钮层前置置灰,交由 archive-flow 中央守卫读真实 File.size 兜底。
export function archiveFileSizeError(size: number | undefined): string | null {
  if (typeof size !== "number") return null
  return size < ARCHIVE_MIN_FILE_SIZE || size > ARCHIVE_MAX_FILE_SIZE ? "仅支持 1B~4GB 的文件" : null
}

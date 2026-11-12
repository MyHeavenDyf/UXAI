import { decodeHtmlBytes } from "@opencode-ai/core/bridge-scripts"
import type { DesktopApi } from "../lib/electron-api"
import { createHtmlHistory } from "./html-history"

export async function saveHtmlEdit(path: string, original: string, content: string, api: DesktopApi, active: () => boolean) {
  if (!api.readFileBuffer || !api.writeFileBuffer) throw new Error("当前环境不支持保存 HTML")
  const check = async () => {
    const bytes = await api.readFileBuffer!(path)
    if (!bytes || decodeHtmlBytes(new Uint8Array(bytes)) !== original) throw new Error("文件已发生变化，请退出局部修改并刷新后重试")
    if (!active()) throw new Error("页面状态已变化，请重新打开编辑")
  }
  await check()
  const history = createHtmlHistory(path, api)
  await history.record("user")
  await check()
  const bytes = new TextEncoder().encode(content)
  await api.writeFileBuffer(path, bytes.buffer)
  const saved = await api.readFileBuffer(path)
  if (!saved || saved.byteLength !== bytes.byteLength || !bytes.every((value, index) => value === new Uint8Array(saved)[index])) throw new Error("HTML 保存校验失败，请从历史版本恢复后重试")
  await history.record("user")
}

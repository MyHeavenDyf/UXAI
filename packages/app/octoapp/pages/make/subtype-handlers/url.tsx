import type { SubtypeHandler } from './types'
import defaultHandler from './default'

/**
 * external URL tab（`{ type: "html", subtype: "url" }`）
 *
 * 所有 http(s) 链接 tab 的通用形态 —— 链接卡片、`/preview <URL>` 都走它。行为整体沿用
 * _default，能力开关在 subtype-config 里已经把编辑类功能全关掉了。
 *
 * fastui 预览卡片不走这里，有自己的 subtype（SPEC-DES-005，见 ./fastui）。
 */
const urlHandler: SubtypeHandler = {
  ...defaultHandler,
  name: 'url',
}

export default urlHandler satisfies SubtypeHandler

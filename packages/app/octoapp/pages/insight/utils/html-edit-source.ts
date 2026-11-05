import { applyManualEditPatch, type ManualEditStyles } from "../../make/edit-mode/source-patches"

/** 将面板发出的编辑指令应用到源码，禁止把运行时 DOM 当成源码。 */
export function applyHtmlEditMessage(source: string, message: unknown): string {
  if (!message || typeof message !== "object") return source
  const data = message as { type?: string; id?: string; elementId?: string; value?: string; styles?: Partial<ManualEditStyles> & { href?: string } }
  const patch = data.type === "od:edit-text" && data.elementId && typeof data.value === "string"
    ? { id: data.elementId, kind: "set-text" as const, value: data.value }
    : data.type === "od:edit-preview-style" && data.id && data.styles
      ? { id: data.id, kind: "set-style" as const, styles: data.styles }
      : undefined
  if (!patch) return source
  const result = applyManualEditPatch(source, patch)
  if (!result.ok) throw new Error("该元素无法在原始 HTML 中修改，请修改生成它的代码")
  if (data.styles?.href !== undefined && data.id) {
    const linked = applyManualEditPatch(result.source, { id: data.id, kind: "set-attributes", attributes: { href: data.styles.href } })
    if (!linked.ok) throw new Error("无法修改链接")
    return linked.source
  }
  return result.source
}

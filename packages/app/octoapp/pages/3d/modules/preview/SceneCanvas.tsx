/**
 * SceneCanvas —— SceneRenderer 的 Solid 薄包装。
 * ============================================================================
 * 仅负责 Solid 生命周期挂载(onMount/createEffect/onCleanup)与 props 适配,
 * Three.js 渲染逻辑全部在 SceneRenderer.ts(框架无关,独立预览页复用同一份)。
 * 详见 SceneRenderer.ts 顶部注释。
 */
import { createEffect, on, onCleanup, onMount, type JSX } from "solid-js"
import { SceneRenderer } from "./SceneRenderer"
import type { SceneDocument } from "../../utils/scene-protocol"

export type SceneCanvasAPI = {
  resetView: () => void
  refresh: () => void
}

export function SceneCanvas(props: {
  doc: SceneDocument | null | undefined
  onPickObject?: (id: string | null) => void
  ref?: (api: SceneCanvasAPI) => void
}): JSX.Element {
  let containerRef: HTMLDivElement | undefined
  let renderer: SceneRenderer | undefined

  onMount(() => {
    if (!containerRef) return
    // 用 wrapper 包 onPickObject:SceneRenderer 持有固定的 wrapper 引用,
    // 但每次点击都经 props.onPickObject 读取最新值(等价原闭包直接读 props 的行为)
    renderer = new SceneRenderer(containerRef, { onPickObject: (id) => props.onPickObject?.(id) })
    renderer.setDoc(props.doc) // 首次构建
    if (props.ref) {
      props.ref({
        resetView: () => renderer?.resetView(),
        refresh: () => renderer?.refresh(),
      })
    }
  })

  // 后续 doc 变化重建(跳过首次,首次由 onMount 负责)
  createEffect(
    on(
      () => props.doc,
      (doc, prev) => {
        if (prev !== undefined) renderer?.setDoc(doc)
      },
    ),
  )

  onCleanup(() => renderer?.dispose())

  return <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }} />
}

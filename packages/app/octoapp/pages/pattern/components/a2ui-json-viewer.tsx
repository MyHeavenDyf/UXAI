import { createMemo, Show, For, type JSX } from "solid-js"
import type { A2UIDocument, A2UIElement } from "../utils/a2ui-protocol"

function TreeNode(props: {
  element: A2UIElement
  allElements: Map<string, A2UIElement>
  depth: number
}): JSX.Element {
  const children = createMemo(() => {
    const ch = props.element.children
    if (!ch) return []
    if (Array.isArray(ch)) {
      return ch.map((id) => props.allElements.get(id)).filter(Boolean) as A2UIElement[]
    }
    return []
  })

  const isLoopBinding = createMemo(() => {
    const ch = props.element.children
    return ch && !Array.isArray(ch)
  })

  const loopInfo = createMemo(() => {
    const ch = props.element.children
    if (!ch || Array.isArray(ch)) return null
    return ch as { path: string; componentId: string }
  })

  return (
    <div style={{ "padding-left": `${props.depth * 16}px` }}>
      <div
        class="flex items-center gap-2 py-1 px-2 rounded text-xs hover:bg-[rgba(0,0,0,0.03)]"
        style={{ color: "var(--octo-text-primary)" }}
      >
        <span
          class="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold"
          style={{
            background: props.element.component === "div" || props.element.component === "section" || props.element.component === "span"
              ? "rgba(107,114,128,0.1)" : "rgba(59,130,246,0.1)",
            color: props.element.component === "div" || props.element.component === "section" || props.element.component === "span"
              ? "#6b7280" : "#3b82f6",
          }}
        >
          {props.element.component}
        </span>
        <span class="opacity-50 font-mono text-[10px]">#{props.element.id}</span>
        <Show when={isLoopBinding()}>
          <span class="text-[10px] px-1 py-0.5 rounded bg-[rgba(168,85,247,0.1)] text-purple-600">
            loop: {loopInfo()?.path}
          </span>
        </Show>
        <Show when={props.element.props?.className}>
          <span class="text-[10px] opacity-40 truncate max-w-[120px]" title={props.element.props?.className as string}>
            {(props.element.props?.className as string)?.slice(0, 40)}
          </span>
        </Show>
      </div>
      <For each={children()}>
        {(child) => <TreeNode element={child} allElements={props.allElements} depth={props.depth + 1} />}
      </For>
    </div>
  )
}

export function A2UIJsonViewer(props: { content: string }): JSX.Element {
  const doc = createMemo(() => {
    try {
      const raw = props.content.includes("```json")
        ? props.content.match(/```json\s*\n([\s\S]*?)\n?```/)?.[1] ?? props.content
        : props.content
      const parsed = JSON.parse(raw.trim())
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.elements) && parsed.rootId) {
        return parsed as A2UIDocument
      }
    } catch {}
    return null
  })

  const elementMap = createMemo(() => {
    const map = new Map<string, A2UIElement>()
    if (doc()) {
      for (const el of doc()!.elements) {
        map.set(el.id, el)
      }
    }
    return map
  })

  const root = createMemo(() => {
    const d = doc()
    if (!d) return null
    return elementMap().get(d.rootId) ?? null
  })

  const stats = createMemo(() => {
    const d = doc()
    if (!d) return null
    const components = new Set<string>()
    let loopCount = 0
    let stateKeys = 0
    for (const el of d.elements) {
      components.add(el.component)
      if (el.children && !Array.isArray(el.children)) loopCount++
    }
    if (d.state) stateKeys = Object.keys(d.state).length
    return { elements: d.elements.length, components: components.size, loopCount, stateKeys }
  })

  const statePreview = createMemo(() => {
    const d = doc()
    if (!d?.state) return null
    return JSON.stringify(d.state, null, 2)
  })

  return (
    <div class="h-full overflow-auto">
      <Show
        when={doc() && root()}
        fallback={
          <div class="p-4">
            <pre
              class="text-sm text-[var(--octo-text-primary)] p-4 rounded-lg overflow-auto"
              style={{ background: "rgba(243,244,246,1)", "font-family": "monospace" }}
            >
              {props.content}
            </pre>
          </div>
        }
      >
        <div class="p-4 flex flex-col gap-3">
          <div class="flex items-center gap-3 flex-wrap">
            <span class="text-xs font-semibold" style={{ color: "var(--octo-text-strong)" }}>
              A2UI Document
            </span>
            <Show when={stats()}>
              {(s) => (
                <div class="flex items-center gap-2 text-[11px] flex-wrap" style={{ color: "var(--octo-text-secondary)" }}>
                  <span class="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{s().elements} elements</span>
                  <span class="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{s().components} components</span>
                  <Show when={s().loopCount > 0}>
                    <span class="px-1.5 py-0.5 rounded bg-purple-50 text-purple-600">{s().loopCount} loops</span>
                  </Show>
                  <Show when={s().stateKeys > 0}>
                    <span class="px-1.5 py-0.5 rounded bg-green-50 text-green-600">{s().stateKeys} state keys</span>
                  </Show>
                </div>
              )}
            </Show>
          </div>

          <div
            class="rounded-lg p-2"
            style={{ border: "1px solid var(--octo-border-default)", background: "var(--octo-surface-page)" }}
          >
            <TreeNode element={root()!} allElements={elementMap()} depth={0} />
          </div>

          <Show when={statePreview()}>
            <details class="text-xs">
              <summary class="cursor-pointer py-1 font-medium" style={{ color: "var(--octo-text-secondary)" }}>
                State Data ({stats()?.stateKeys} keys)
              </summary>
              <pre
                class="mt-2 text-[11px] p-3 rounded-lg overflow-auto max-h-[300px]"
                style={{ background: "rgba(243,244,246,1)", "font-family": "monospace" }}
              >
                {statePreview()}
              </pre>
            </details>
          </Show>

          <details class="text-xs">
            <summary class="cursor-pointer py-1 font-medium" style={{ color: "var(--octo-text-secondary)" }}>
              Raw JSON
            </summary>
            <pre
              class="mt-2 text-[11px] p-3 rounded-lg overflow-auto max-h-[400px]"
              style={{ background: "rgba(243,244,246,1)", "font-family": "monospace" }}
            >
              {JSON.stringify(doc(), null, 2)}
            </pre>
          </details>
        </div>
      </Show>
    </div>
  )
}

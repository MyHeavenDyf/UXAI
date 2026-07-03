import { createSignal, createEffect, onCleanup, Show, type JSX } from "solid-js"
import type { PatternMatchItem } from "../../utils/pattern-resource"
import "../../assets/style/preview/templateCardStack.css"

export type TemplateCardStackApi = {
  cycleNext: () => void
  cyclePrev: () => void
}

export function TemplateCardStack(props: {
  ref?: (api: TemplateCardStackApi) => void
  matches: PatternMatchItem[]
}): JSX.Element {
  const count = () => props.matches.length

  let isAnimating = false
  const [order, setOrder] = createSignal<number[]>(props.matches.map((_, i) => i))
  const [animClass, setAnimClass] = createSignal<Record<number, string>>({})

  createEffect(() => {
    if (props.matches.length === 0) return
    setOrder(props.matches.map((_, i) => i))
  })

  function positionClass(pos: number): string {
    if (pos === 0) return "tpos-0"
    if (pos >= count() - 1) return "tpos-2"
    return "tpos-1"
  }

  function cycleNext() {
    if (isAnimating || count() < 2) return
    isAnimating = true

    const curOrder = order()
    const nextClasses: Record<number, string> = {}
    const front = curOrder[0]
    nextClasses[front] = "tswipe-out"

    for (let i = 1; i < count(); i++) {
      nextClasses[curOrder[i]] = positionClass(i - 1)
    }
    setAnimClass(nextClasses)

    setTimeout(() => {
      const newOrder = [...curOrder.slice(1), curOrder[0]]
      const resetClasses: Record<number, string> = {}
      newOrder.forEach((id, i) => { resetClasses[id] = positionClass(i) })
      setOrder(newOrder)
      setAnimClass(resetClasses)
      setTimeout(() => { isAnimating = false }, 50)
    }, 450)
  }

  function cyclePrev() {
    if (isAnimating || count() < 2) return
    isAnimating = true

    const curOrder = order()
    const back = curOrder[curOrder.length - 1]

    const prepClasses: Record<number, string> = { ...Object.fromEntries(curOrder.map((id, i) => [id, positionClass(i)])) }
    prepClasses[back] = "tswipe-in-prep"
    setAnimClass(prepClasses)

    requestAnimationFrame(() => {
      const newOrder = [curOrder[curOrder.length - 1], ...curOrder.slice(0, -1)]
      const nextClasses: Record<number, string> = {}
      newOrder.forEach((id, i) => { nextClasses[id] = positionClass(i) })
      setAnimClass(nextClasses)
      setOrder(newOrder)
      setTimeout(() => { isAnimating = false }, 500)
    })
  }

  function handleCardClick(index: number) {
    if (animClass()[index] === "tpos-0") cycleNext()
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); cycleNext() }
    if (e.key === "ArrowLeft") { e.preventDefault(); cyclePrev() }
  })
  onCleanup(() => {
    document.removeEventListener("keydown", () => {})
  })

  props.ref?.({ cycleNext, cyclePrev })

  return (
    <div class="template-card-stack">
      <div class="template-card-area">
        {props.matches.map((match, idx) => {
          const pos = order().indexOf(idx)
          const cls = animClass()[idx] || positionClass(pos)
          return (
            <div
              class={`template-card ${cls}`}
              onClick={() => handleCardClick(idx)}
            >
              <Show when={match.previewUrl}>
                <img class="template-card-preview" src={match.previewUrl ?? undefined} alt={match.pattern.name} />
              </Show>
            </div>
          )
        })}
      </div>
    </div>
  )
}

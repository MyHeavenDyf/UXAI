import { createSignal, createEffect, onCleanup, Show, type JSX } from "solid-js"
import type { PatternMatchItem } from "../../utils/pattern-resource"
import "../../assets/style/preview/template-card-stack.css"

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
  const cardRefs: HTMLDivElement[] = []
  let cardAreaRef: HTMLDivElement | undefined

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
    const front = curOrder[0]

    // Step 1: front card swipes out, others move up one position
    const frontEl = cardRefs[front]
    if (frontEl) {
      frontEl.classList.remove("tpos-0")
      frontEl.classList.add("tswipe-out")
    }
    for (let i = 1; i < curOrder.length; i++) {
      const el = cardRefs[curOrder[i]]
      if (el) {
        el.classList.remove(positionClass(i))
        el.classList.add(positionClass(i - 1))
      }
    }

    // Step 2: after swipe-out animation, move front to back
    setTimeout(() => {
      if (frontEl) {
        frontEl.classList.remove("tswipe-out")
        frontEl.classList.add("tpos-2")
      }
      setOrder([...curOrder.slice(1), curOrder[0]])
      setTimeout(() => { isAnimating = false }, 50)
    }, 400)
  }

  function cyclePrev() {
    if (isAnimating || count() < 2) return
    isAnimating = true

    const curOrder = order()
    const back = curOrder[curOrder.length - 1]
    const backEl = cardRefs[back]

    // Step 1: instantly move back card to above (transition: none)
    if (backEl) {
      backEl.classList.add("tswipe-in-prep")
    }

    // Step 2: force synchronous reflow on the CARD itself so transition: none takes effect
    void backEl?.offsetWidth

    // Step 3: remove prep + add tpos-0 (drops in with animation), others step back
    if (backEl) {
      backEl.classList.remove("tswipe-in-prep", "tpos-2")
      backEl.classList.add("tpos-0")
    }
    const front = curOrder[0]
    const frontEl = cardRefs[front]
    if (frontEl) {
      frontEl.classList.remove("tpos-0")
      frontEl.classList.add(count() > 2 ? "tpos-1" : "tpos-2")
    }
    if (count() > 2) {
      const mid = curOrder[1]
      const midEl = cardRefs[mid]
      if (midEl) {
        midEl.classList.remove("tpos-1")
        midEl.classList.add("tpos-2")
      }
    }

    // Delay setOrder until animation completes — SolidJS class binding would otherwise
    // overwrite the manual classList changes mid-transition
    setTimeout(() => {
      setOrder([curOrder[curOrder.length - 1], ...curOrder.slice(0, -1)])
      isAnimating = false
    }, 500)
  }

  const keydownHandler = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); cycleNext() }
    if (e.key === "ArrowLeft") { e.preventDefault(); cyclePrev() }
  }
  document.addEventListener("keydown", keydownHandler)
  onCleanup(() => {
    document.removeEventListener("keydown", keydownHandler)
  })

  props.ref?.({ cycleNext, cyclePrev })

  return (
    <div class="template-card-stack">
      <div class="template-card-area" ref={cardAreaRef}>
        {props.matches.map((match, idx) => {
          const pos = order().indexOf(idx)
          return (
            <div
              ref={(el) => { cardRefs[idx] = el }}
              class={`template-card ${positionClass(pos)}`}
            >
              <Show when={match.previewUrl}>
                <img class="template-card-preview" src={match.previewUrl ?? undefined} alt={match.pattern.name} draggable={false} />
              </Show>
            </div>
          )
        })}
      </div>
    </div>
  )
}

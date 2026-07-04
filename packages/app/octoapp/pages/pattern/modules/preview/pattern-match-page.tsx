import { createSignal, Show, type JSX } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { ScaledFrame } from "./scaled-frame"
import { TemplateCardStack, type TemplateCardStackApi } from "./template-card-stack"
import { WireframeTree } from "./wireframe-tree"
import type { PatternMatchItem } from "../../utils/pattern-resource"
import "../../assets/style/preview/wireframe.css"
import "../../assets/style/preview/patternMatch.css"
import "../../assets/style/preview/templateCardStack.css"

export function PatternMatchPage(props: {
  planner: Record<string, unknown>
  intentDescription: Record<string, unknown>
  patternMatches: PatternMatchItem[]
  onEnterWireframe: () => void
}): JSX.Element {
  const [cardStack, setCardStack] = createSignal<TemplateCardStackApi | undefined>()
  return (
    <div class="pattern-match-container">
      <div class="pattern-match-header">
        <span class="pattern-match-title-icon">?</span>
        <div class="pattern-match-title">请选择下一步方案</div>
      </div>

      <div class="pattern-match-body">
        <div class="pattern-match-col">
          <div class="pattern-match-col-title">页面模板</div>
          <ScaledFrame width={1920} height={1080}>
            <TemplateCardStack ref={setCardStack} matches={props.patternMatches} />
          </ScaledFrame>
          <div class="pattern-match-btn-wrap">
            <button class="template-card-nav-btn" onClick={() => cardStack()?.cyclePrev()} aria-label="上一张">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 19l-7-7 7-7"/></svg>
            </button>
            <button class="template-card-confirm-btn">选择当前模板</button>

            <button class="template-card-nav-btn" onClick={() => cardStack()?.cycleNext()} aria-label="下一张">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
            </button>
          </div>
        </div>

        <div class="pattern-match-col">
          <div class="pattern-match-col-title">线框编辑</div>
          <ScaledFrame width={1920} height={1080}>
            <Show
              when={props.planner && props.intentDescription}
              fallback={<div class="pattern-match-blank-page"><div class="pattern-match-blank-placeholder">暂无线框数据</div></div>}
            >
              <div class="pattern-match-wireframe-scroll">
                <WireframeTree
                  planner={props.planner}
                  intentDescription={props.intentDescription}
                  showSectionInfo={false}
                  boxBorderWidth={10}
                />
              </div>
            </Show>
          </ScaledFrame>
          <div class="pattern-match-btn-wrap">
            <button class="template-card-confirm-btn" onClick={props.onEnterWireframe}>
              选择线框图编辑
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

import type { JSX } from "solid-js"
import "../../assets/style/preview/pattern-generating.css"

/**
 * 页面生成中的加载状态组件
 *
 * 在需求确认页面点击「确认」后，
 * 后端开始执行意图扩展 + 布局规划 + 模块生成 + 合并模块
 * 此期间预览区展示该加载态，避免出现空白占位页。
 */
export function PatternGenerating(): JSX.Element {
  return (
    <div class="pattern-generating-overlay">
      <div class="pattern-generating-spinner" />
      <div class="pattern-generating-text">正在生成页面...</div>
    </div>
  )
}

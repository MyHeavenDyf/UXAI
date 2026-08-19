/**
 * Pipeline — 管线执行引擎
 *
 * 按顺序执行注册的步骤，支持链式 .add() 和 .run()。
 */

import { Step } from '../core/step-base'
import type { PipelineContext } from './pipeline-context'

type StepConstructor = { new(): Step }

export class Pipeline {
  #steps: Array<StepConstructor | (() => Step)> = []

  add(StepClass: StepConstructor | (() => Step)): Pipeline {
    if (typeof StepClass !== 'function') {
      throw new Error('Pipeline.add() 需要一个类参数')
    }
    this.#steps.push(StepClass)
    return this
  }

  async run(ctx: PipelineContext): Promise<PipelineContext> {
    if (!ctx) throw new Error('Pipeline.run() 需要 ctx 参数')

    for (const StepClass of this.#steps) {
      const step = this.#instantiate(StepClass)
      const start = Date.now()
      // 清空当前页标记，避免上一 step 残留误导诊断（per-page step 在循环里设置）
      ctx.currentPage = undefined
      try {
        await step.execute(ctx)
        const elapsed = Date.now() - start
        console.log(`  ✔ ${step.name} (${elapsed}ms)`)
      } catch (err: any) {
        // 带页面上下文：per-page step 抛错时 currentPage 已设为出错页名
        const pageHint = ctx.currentPage ? ` (page: ${ctx.currentPage})` : ''
        console.error(`  ✘ ${step.name}${pageHint} 失败:`, err.message)
        throw err
      }
    }

    return ctx
  }

  reset(): void {
    this.#steps = []
  }

  get stepCount(): number {
    return this.#steps.length
  }

  #instantiate(StepClass: StepConstructor | (() => Step)): Step {
    const instance = new (StepClass as StepConstructor)()
    if (typeof (instance as any).execute !== 'function') {
      throw new Error(`${(StepClass as any).name} 不是合法的 Step`)
    }
    return instance as Step
  }
}

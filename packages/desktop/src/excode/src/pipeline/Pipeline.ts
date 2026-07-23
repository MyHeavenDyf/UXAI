/**
 * Pipeline — 管线执行引擎
 *
 * 按顺序执行注册的步骤，支持链式 .add() 和 .run()。
 */

import { Step } from '../core/step'
import type { PipelineContext } from './pipelineContext'

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
      try {
        await step.execute(ctx)
        const elapsed = Date.now() - start
        console.log(`  ✔ ${step.name} (${elapsed}ms)`)
      } catch (err: any) {
        console.error(`  ✘ ${step.name} 失败:`, err.message)
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

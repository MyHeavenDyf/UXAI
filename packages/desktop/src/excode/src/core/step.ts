/**
 * Step — 管线步骤基类
 */

import type { PipelineContext } from '../pipeline/pipelineContext'

export class Step {
  async execute(ctx: PipelineContext): Promise<void> {
    throw new Error(`Step ${this.constructor.name} 未实现 execute 方法`)
  }

  get name(): string {
    return this.constructor.name
  }
}

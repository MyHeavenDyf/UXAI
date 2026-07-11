import type { PipelineContext } from '../pipeline/PipelineContext.ts';

/**
 * Step — 管线步骤基类
 *
 * 每个管线步骤继承此类，实现 execute(ctx) 方法。
 * execute 接收 PipelineContext，可读取/写入 ctx 上的数据。
 */
export class Step {
  /**
   * 步骤执行逻辑
   * @param ctx - 管线上下文
   */
  async execute(ctx: PipelineContext): Promise<void> {
    throw new Error(`Step ${this.constructor.name} 未实现 execute 方法`);
  }

  /**
   * 步骤名称（默认取类名）
   */
  get name(): string {
    return this.constructor.name;
  }
}
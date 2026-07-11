/**
 * Pipeline — 管线执行引擎
 *
 * 按顺序执行注册的步骤。
 * 支持链式 .add() 注册、.run() 执行、.reset() 重置。
 */
import { Step } from '../core/Step';
import type { PipelineContext } from './PipelineContext';

type StepConstructor = { new(): Step };

export class Pipeline {
  /** @type {Array<StepConstructor | (() => Step)>} */
  #steps: Array<StepConstructor | (() => Step)> = [];

  /**
   * 注册一个步骤
   * @param StepClass - 步骤类（默认无参构造）
   * @returns {Pipeline} this
   */
  add(StepClass: StepConstructor | (() => Step)): Pipeline {
    if (typeof StepClass !== 'function') {
      throw new Error('Pipeline.add() 需要一个类（class）参数');
    }
    this.#steps.push(StepClass);
    return this;
  }

  /**
   * 执行管线
   * @param ctx - 管线上下文
   * @returns 执行完毕的 ctx
   */
  async run(ctx: PipelineContext): Promise<PipelineContext> {
    if (!ctx) throw new Error('Pipeline.run() 需要 ctx 参数');

    for (const StepClass of this.#steps) {
      const step = this.#instantiate(StepClass);
      const start = Date.now();
      try {
        await step.execute(ctx);
        const elapsed = Date.now() - start;
        console.log(`  ✔ ${step.name} (${elapsed}ms)`);
      } catch (err: any) {
        console.error(`  ✘ ${step.name} 失败:`, err.message);
        throw err;
      }
    }

    return ctx;
  }

  /**
   * 重置管线（清空步骤列表）
   */
  reset(): void {
    this.#steps = [];
  }

  /**
   * 获取已注册的步骤数
   */
  get stepCount(): number {
    return this.#steps.length;
  }

  /**
   * 实例化步骤（支持无参构造和工厂函数）
   */
  #instantiate(StepClass: StepConstructor | (() => Step)): Step {
    const instance = new (StepClass as StepConstructor)();
    if (typeof (instance as any).execute !== 'function') {
      throw new Error(`${(StepClass as any).name} 不是合法的 Step（需要 execute 方法）`);
    }
    return instance as Step;
  }
}
/**
 * adapter.ts — Tailwind 转换适配器工厂
 *
 * 创建与 TailwindConverter 兼容的 { convert } 接口实例。
 * 外部注入（如 desktop）可自行构造 { convert } 对象；
 * 本地开发调试时直接使用 local 适配器（配置已内聚在 local.ts 内部 import）。
 */
import { createLocalConverter } from './converters/local';
import { createDesktopConverter } from './converters/desktop';

/**
 * 创建 tailwind 转换适配器实例
 *
 * @param adapterName - 适配器名称: "local" | "desktop"
 * @returns {{ convert: (className: string) => Record<string, string | number> }}
 */
export async function createTailwindAdapter(adapterName: string = 'local'): Promise<{ convert: (className: string) => Record<string, string | number> }> {
  if (adapterName === 'local') {
    return createLocalConverter();
  }
  if (adapterName === 'desktop') {
    return createDesktopConverter();
  }
  throw new Error(`[tailwind/adapter] 未知适配器: ${adapterName}`);
}
/**
 * local.ts — 本地开发环境适配器
 *
 * 封装 tw-to-css 库的 tailwindToCSS 函数，提供与 uiux 版一致的 convert 接口。
 * 仅供 transformer 本地开发调试使用。
 * Tailwind 主题配置直接在模块内 import，不依赖外部注入。
 *
 * 用法:
 *   const cvt = createLocalConverter();
 *   cvt.convert('bg-surface text-on-surface')  // → { backgroundColor: '#F3F3F3', color: '#191919' }
 */
import { tailwindToCSS } from 'tw-to-css';
import { tailwindConfig } from '../../../dev/tailwind.config';

/**
 * 创建本地 tw-to-css 转换器实例
 * Tailwind 配置已通过 import 注入，无需传参。
 *
 * @returns {{ convert: (className: string) => Record<string, string | number> }}
 */
export function createLocalConverter(): { convert: (className: string) => Record<string, string | number> } {
  // 单例缓存 twj 实例
  let twjInstance: ((className: string) => Record<string, string | number>) | null = null;

  function getTwj(): (className: string) => Record<string, string | number> {
    if (twjInstance) return twjInstance;
    const { twj } = tailwindToCSS({ config: tailwindConfig as any });
    twjInstance = (className: string) => twj(className) as Record<string, string | number>;
    return twjInstance;
  }

  return {
    /**
     * 将 Tailwind 类名转换为 CSS 样式对象
     * @param className - 一个或多个 tailwind 类名（空格分隔）
     * @returns CSS 属性键值对
     */
    convert(className: string): Record<string, string | number> {
      if (!className || !className.trim()) return {};
      return getTwj()(className);
    },
  };
}
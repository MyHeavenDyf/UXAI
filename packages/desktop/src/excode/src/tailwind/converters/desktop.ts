/**
 * desktop 转换器
 *
 * 直接引用 desktop 主进程的 convertTailwindToCSS 函数，
 * 将 tailwind 类名转换为 CSS 样式对象。
 *
 * 适用于 Desktop 集成环境（Electron 主进程）。
 */
import { convertTailwindToCSS } from '../../../../main/tailwind-to-css';

/**
 * 创建 Desktop 环境转换器实例
 *
 * @returns {{ convert: (className: string) => Record<string, string> }}
 */
export async function createDesktopConverter(): Promise<{ convert: (className: string) => Record<string, string> }> {
  return {
    convert(className: string): Record<string, string> {
      if (!className || !className.trim()) return {};
      return convertTailwindToCSS(className);
    },
  };
}
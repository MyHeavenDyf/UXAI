/**
 * tailwind — Tailwind CSS 转换独立模块
 *
 * 对外暴露 createTailwindAdapter 工厂函数，供管线代码使用。
 * 本模块与 tw-to-css 库解耦，可自由切换本地版与 uiux 版。
 *
 * 用法:
 *   import { createTailwindAdapter } from './tailwind/index';
 *   const cvt = await createTailwindAdapter(tailwindConfig, 'local');
 *   cvt.convert('bg-surface');
 */
export { createTailwindAdapter } from './adapter';
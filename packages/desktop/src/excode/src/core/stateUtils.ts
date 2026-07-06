/**
 * stateUtils — 状态工具函数
 *
 * 提供在 mapping transform 中操作 state 的通用工具函数。
 * 不依赖管线上下文，纯函数，可自由在任何地方调用。
 */

/**
 * 从 rawState 中按 DataBinding 的 accessPath 提取原始值
 *
 * 用法（在 mapping transform 中）：
 * ```ts
 * import { resolveBindingValue } from '../../src/core/stateUtils';
 *
 * transform(node, { rawState }) {
 *   const items = resolveBindingValue(rawState, node.props.items);
 *   // items 此时已是实际数组（或原始值）
 * }
 * ```
 *
 * @param rawState  A2UI 原始 state（context.rawState）
 * @param binding   任意值。如果是 DataBinding（带 __binding 标记），
 *                  则按 accessPath 从 rawState 中取值返回；
 *                  否则原样返回 binding 自身。
 * @returns 绑定后的实际值，或 binding 自身（非 binding 时）
 */
export function resolveBindingValue(rawState: Record<string, any> | null | undefined, binding: any): any {
  if (!binding?.__binding) return binding;

  const { accessPath } = binding;
  if (!accessPath || !rawState) return undefined;

  return accessPath
    .split('.')
    .reduce((obj: any, key: string) => (obj != null ? obj[key] : undefined), rawState);
}
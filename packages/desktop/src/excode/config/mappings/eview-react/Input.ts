/**
 * Input → TextField 映射
 *
 * A2UI Input → eview-react TextField 组件。
 *
 * ## 映射规则
 *
 * - value：two-way binding 自动生成 useState
 * - prefix/suffix → resolveIcon 转为 __slotNode 嵌入
 * - password → type='password'
 * - placeholder → 透传
 */
import { resolveBindingValue } from '../../../src/core/stateUtils';
import { resolveIcon } from './Icon';


/**
 * 从 DataBinding 或字面量中提取实际值
 *
 * 返回 [actualValue, stateKey | null]
 */
function resolveValue(rawState: any, prop: any): [any, string | null] {
  if (prop?.__binding) {
    const path = prop.accessPath;
    const value = resolveBindingValue(rawState, prop);
    return [value, path];
  }
  return [prop, null];
}
export default {
  tag: 'TextField',
  import: '@nce/eview-react/TextField',

  binding: {
    value: {
      changeEvent: 'onChange',
      valueExtractor: (setter: string) => `(e) => ${setter}(e.target.value)`,
    },
  },

  propsMap: {
  },

  valueMap: {
  },

  defaults: {
  },

  /**
   * transform — props 转换
   */
  transform(node: any, { rawState, iconNameMap }: { rawState?: any; iconNameMap?: Record<string, string> }) {
    const p = { ...(node.props || {}) };
    const iconMap = iconNameMap || {};

    const outputProps: Record<string, any> = {};

    // prefix/suffix icon → __slotNode
    if ('prefix' in p && typeof p.prefix === 'string') {
      const iconNode = resolveIcon(p.prefix, iconMap);
      outputProps.prefix = { __slotNode: iconNode };
    }
    if ('suffix' in p && typeof p.suffix === 'string') {
      const iconNode = resolveIcon(p.suffix, iconMap);
      outputProps.suffix = { __slotNode: iconNode };
    }

    if (p.className) {
      outputProps.className = p.className;
    }

    if (p.password) {
      outputProps.type = 'password';
    }
    if (p.maxLength) {
      outputProps.maxLength = p.maxLength;
    }
    if (p.placeholder) {
      const [placeholder] = resolveValue(rawState, p.placeholder);
      outputProps.placeholder = placeholder;
    }

    return { props: outputProps, children: null };
  },
};

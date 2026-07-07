/**
 * Input → Input 映射
 *
 * A2UI Input → eview-react Input 组件。
 *
 * ## 映射规则
 *
 * 1. value → 通过 binding 表声明 two-way 绑定，自动生成 useState
 * 2. placeholder → 透传
 * 3. prefix → icon 名称，通过 resolveIcon 转为 CodeGenNode，通过 __slotNode 嵌入 prefix prop
 * 4. size：medium → normal（枚举映射），其余透传
 * 5. className → 透传
 *
 * ## binding 表
 *
 * value 声明为 two-way binding，管线自动生成：
 *   const [value, setValue] = useState(initialState.value);
 *   <Input value={value} onChange={(e) => setValue(e.target.value)} />
 */
import { resolveBindingValue } from '../../../src/core/stateUtils';
import { resolveIcon } from './Icon';


/**
 * 从 DataBinding 或字面量中提取实际值
 *
 * 返回 [actualValue, stateKey | null]
 * - actualValue: 实际数组或原始值
 * - stateKey: 如果是从 state 中取的数据，返回用于删除的 path；否则 null
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
    // value 由 binding 表处理，无需改名
  },

  valueMap: {

  },

  defaults: {
  },

  /**
   * transform — props 转换
   *
   * context 提供：
   *   - iconNameMap: A2UI name → @hui/icon-plus 组件名映射表
   *   - rawState: A2UI 原始 state（透传）
   *
   */
  transform(node: any, { rawState, iconNameMap }: { rawState?: any; iconNameMap?: Record<string, string> }) {
    const p = { ...(node.props || {}) };
    const iconMap = iconNameMap || {};

    
    // ─── 5. 构造 output props ───
    const outputProps: Record<string, any> = {};

    // ─── 1. prefix icon → __slotNode ───
    if ('prefix' in p && typeof p.prefix === 'string') {
      const iconNode = resolveIcon(p.prefix, iconMap);
      outputProps.prefix = { __slotNode: iconNode };
    }
    // ─── 2. suffix icon → __slotNode ───
    if ('suffix' in p && typeof p.suffix === 'string') {
      const iconNode = resolveIcon(p.suffix, iconMap);
      outputProps.suffix = { __slotNode: iconNode };
    }

    // 透传 className
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
      const [placeholder, placeholderPath] = resolveValue(rawState, p.placeholder);
      outputProps.placeholder = placeholder;
    }
    if(p.size) {}

    return { props: outputProps, children: null };
  },
};

/**
 * Menu → Accordion 映射
 *
 * A2UI Menu 组件 → eview-react Accordion 组件。
 *
 * ## 核心逻辑
 *
 * 1. items 处理（支持 DataBinding 和字面量）：
 *    - 如果是 DataBinding（{ __binding: true, stateKey, accessPath }），
 *      通过 resolveBindingValue 从 rawState 中取原始数组
 *    - 如果是普通数组，直接使用
 *    - 转换每个 menuItem：{ title, key→value, icon, children? }
 *    - 转换后的数组放到 componentData.menuData 中
 *    - props.data 引用 { __varRef: 'menuData' }
 *    - 原 state 字段通过 __deleteFields 删除
 *
 * 2. openKeys 处理：
 *    - 获取实际 openKeys 数组（支持 DataBinding / 字面量）
 *    - 在 data 中对应 key 的 dataItem 设置 isExpand: true
 *    - 原 state 字段通过 __deleteFields 删除
 *
 * 3. selectedKeys 处理：
 *    - 如果是 DataBinding，通过 binding 表声明 two-way → 自动生成 useState
 *    - 如果是字面量数组，取第一项作为 selectedValue
 *    - 新生成的 selectedValue 值通过 stateData 写入
 *
 * 4. inlineCollapsed 处理（仅字面量 boolean）：
 *    - A2UI `inlineCollapsed`（antd 语义：false=展开，true=收起）
 *      直接 1:1 映射到 eview-react Accordion 的 `expanded` 属性
 *      （文档明确标注 expanded 是"反直觉"语义：false=展开，true=收起）
 *    - 未提供 inlineCollapsed → 不输出 expanded prop（Accordion 走默认值 expanded=false，即展开）
 *    - 配合 defaults.enableExpand=true 才能让 Accordion 支持折叠交互
 *
 * 5. mode 属性：eview-react Accordion 不支持 horizontal 模式，直接略过
 *
 * 6. icon 处理：调用 resolveIcon(item.icon, iconNameMap) 返回 CodeGenNode，
 *    直接嵌入 dataItem.icon 位置，StateTransformer 序列化为 <IconPlusXxx /> JSX。
 */
import { resolveBindingValue } from '../../../src/core/stateUtils';
import { resolveIcon } from './Icon';

/**
 * 递归转换 menuItem 数组 → Accordion dataItem 数组
 *
 * 转换规则：
 *   - title → title（透传）
 *   - key → value（改名）
 *   - icon → resolveIcon 返回的 CodeGenNode（直接嵌入，序列化为 <IconPlusXxx />）
 *   - children → children（递归转换）
 *   - openKeySet 中存在 key → isExpand: true
 */
function convertMenuItems(
  items: any[],
  openKeySet: Set<string | number>,
  iconNameMap: Record<string, string>,
): any[] {
  if (!Array.isArray(items)) return [];

  return items.map((item: any) => {
    const dataItem: Record<string, any> = {
      title: item.title,
      value: item.key,
    };

    // icon 字符串 → CodeGenNode（resolveIcon 返回 <IconPlusXxx /> 节点）
    if (item.icon !== undefined) {
      if (typeof item.icon === 'string') {
        dataItem.icon = resolveIcon(item.icon, iconNameMap);
      } else {
        // 非字符串：保留原值
        dataItem.icon = item.icon;
      }
    }

    // 展开状态
    if (openKeySet.has(item.key)) {
      dataItem.isExpand = true;
    }

    // 递归子菜单
    if (Array.isArray(item.children) && item.children.length > 0) {
      dataItem.children = convertMenuItems(item.children, openKeySet, iconNameMap);
    }

    return dataItem;
  });
}

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
  tag: 'Accordion',
  import: '@nce/eview-react/Accordion',

  // binding 表无需声明 selectedKeys，因为 transform 中手动处理了
  // selectedKeys（数组）→ selectedValue（单项）的转换，
  // 并在 output 中构造了新的 two-way binding 指向 selectedValue。
  binding: {},

  propsMap: {
    // Menu 的 selectedKeys（数组）→ Accordion 的 selectedValue（字符串）
    // 但我们需要在 transform 中手动处理，这里不做自动改名
    // 以免与 transform 逻辑冲突
  },

  defaults: {
    hideTitleBar: true,
    enableMultiOpen: true,
    isControlSelectedValue: true,
    // 开启折叠功能，让 inlineCollapsed 映射到 expanded 才能生效
    enableExpand: true,
  },

  /**
   * transform — Menu → Accordion
   *
   * context 提供：
   *   - rawState: A2UI 原始 state
   *   - resolveNode: 递归解析任意 A2UI 节点
   *
   * selectedKeys 处理策略（适配 eview-react Accordion 的 `selectedValue: string`）：
   *   1. 未提供 selectedKeys 字段 → 不输出 selectedValue prop（让 Accordion 走组件内部默认值）
   *   2. 字面量数组 — 始终转为 useState：
   *      - 非空：取第一项作为 useState 初始值
   *      - 空：初始值为 ''
   *   3. DataBinding — 始终在 stateData 写入 selectedValue 初始值（空数组时为 ''）
   *      并构造 two-way binding，确保 useState 在组件内被生成
   *
   * 无论字面量还是 DataBinding，只要存在 selectedKeys 字段，
   * 都会在 stateData 写入 selectedValue 初值并构造 two-way binding，
   * 让管线自动生成 `const [selectedValue, setSelectedValue] = useState(...)`。
   */
  transform(node: any, { rawState, iconNameMap }: { rawState: any; iconNameMap?: Record<string, string> }) {
    const props = node.props || {};
    const iconMap = iconNameMap || {};

    // ─── 1. items ───
    const deleteFields: string[] = [];
    const [rawItems, itemsStateKey] = resolveValue(rawState, props.items);
    if (itemsStateKey) deleteFields.push(itemsStateKey);

    // ─── 2. openKeys ───
    const [rawOpenKeys, openKeysStateKey] = resolveValue(rawState, props.openKeys);
    if (openKeysStateKey) deleteFields.push(openKeysStateKey);

    // 构建 openKey set
    const openKeySet = new Set<string | number>(
      Array.isArray(rawOpenKeys) ? rawOpenKeys : []
    );

    // ─── 3. 转换 data ───
    const menuData = convertMenuItems(
      Array.isArray(rawItems) ? rawItems : [],
      openKeySet,
      iconMap,
    );

    // ─── 4. selectedKeys → selectedValue ───
    const stateData: Record<string, any> = {};
    let selectedValueProp: any = undefined;
    // 标记是否需要输出 selectedValue prop（无 selectedKeys 字段时不输出）
    let hasSelectedKeys = Object.prototype.hasOwnProperty.call(props, 'selectedKeys');

    if (hasSelectedKeys && props.selectedKeys?.__binding) {
      // DataBinding 模式：
      // a) 从 rawState 取实际数组，取第一项作为 useState 初始值
      // b) 即使实际数组为空也要写入 stateData.selectedValue=''，避免 initialState 缺字段
      // c) 构造 two-way binding 指向 selectedValue，让管线自动生成 useState
      const actualArray = resolveBindingValue(rawState, props.selectedKeys);
      const initialVal = Array.isArray(actualArray) && actualArray.length > 0
        ? actualArray[0]
        : '';
      stateData.selectedValue = initialVal;
    } else if (Array.isArray(props.selectedKeys)) {
      // 字面量数组：同样转为 useState
      // a) 非空：取第一项作为初始值
      // b) 空：初始值为 ''
      stateData.selectedValue = props.selectedKeys.length > 0
        ? props.selectedKeys[0]
        : '';
    }

    if (hasSelectedKeys && (props.selectedKeys?.__binding || Array.isArray(props.selectedKeys))) {
      // 两种情况都构造 two-way binding，让管线自动生成 useState
      selectedValueProp = {
        __binding: true,
        bindMode: 'two-way',
        pathType: 'absolute',
        stateKey: 'selectedValue',
        accessPath: 'selectedValue',
        control: {
          changeEvent: 'onClick',
          valueExtractor: (setter: string) => `(node) => ${setter}(node.value)`,
        },
      };
    }
    // else: 没有 selectedKeys 字段 → selectedValueProp 保持 undefined，不输出 prop

    // ─── 5. 构造 output props ───
    const outputProps: Record<string, any> = {
      // data 引用模块顶部的 const 声明
      data: { __varRef: 'menuData' },
      // selectedValue 处理 — 只在原 Menu 显式声明了 selectedKeys 时输出
      ...(selectedValueProp !== undefined ? { selectedValue: selectedValueProp } : {}),
    };

    // 透传 className
    if (props.className) {
      outputProps.className = props.className;
    }

    // ─── inlineCollapsed（字面量 boolean）→ expanded ───
    // A2UI inlineCollapsed（antd 语义：false=展开，true=收起）
    // eview-react Accordion expanded 语义与之一致：false=展开，true=收起（反直觉）
    // 所以直接 1:1 传递，无需取反
    if (Object.prototype.hasOwnProperty.call(props, 'inlineCollapsed')) {
      outputProps.expanded = props.inlineCollapsed;
    }

    // ─── 6. 构造 stateData / componentData ───
    if (deleteFields.length > 0) {
      stateData.__deleteFields = deleteFields;
    }

    return {
      props: outputProps,
      children: null,
      stateData: Object.keys(stateData).length > 0 ? stateData : undefined,
      componentData: { menuData },
    };
  },
};
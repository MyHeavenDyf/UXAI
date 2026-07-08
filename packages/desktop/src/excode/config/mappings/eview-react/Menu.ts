/**
 * Menu → Accordion 映射
 *
 * A2UI Menu → eview-react Accordion 组件。
 *
 * ## 核心逻辑
 *
 * 1. items 处理（支持 DataBinding 和字面量）：
 *    - 从 rawState 取实际数组，转换每个 menuItem（title, key→value, icon, children）
 *    - 转换结果放到 componentData.menuData，props.data 引用 { __varRef: 'menuData' }
 *    - 原 state 字段通过 __deleteFields 删除
 *
 * 2. openKeys：在对应 dataItem 上设置 isExpand: true，原字段 __deleteFields 删除
 *
 * 3. selectedKeys（数组）→ selectedValue（单项）：
 *    - DataBinding → 取数组第一项作为 useState 初始值，构造 two-way binding
 *    - 字面量数组 → 取第一项作为初始值
 *    - 无 selectedKeys 字段 → 不输出 selectedValue prop
 *
 * 4. inlineCollapsed → expanded（1:1 传递）
 *
 * 5. icon：resolveIcon 转为 CodeGenNode，嵌入 dataItem.icon
 */
import { resolveBindingValue } from '../../../src/core/stateUtils';
import { resolveIcon } from './Icon';

/**
 * 递归转换 menuItem → Accordion dataItem
 *
 * title→title, key→value, icon→resolveIcon, children→递归
 * openKeySet 中存在 key → isExpand: true
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

    // icon 字符串 → CodeGenNode
    if (item.icon !== undefined) {
      if (typeof item.icon === 'string') {
        dataItem.icon = resolveIcon(item.icon, iconNameMap);
      } else {
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

  // binding 表无需声明 selectedKeys，transform 中手动处理
  // selectedKeys（数组）→ selectedValue（单项），构造新的 two-way binding
  binding: {},

  propsMap: {
    // transform 中手动处理 selectedKeys→selectedValue，不做自动改名
  },

  defaults: {
    hideTitleBar: true,
    enableMultiOpen: true,
    isControlSelectedValue: true,
    enableExpand: true,
  },

  /**
   * transform — Menu → Accordion
   *
   * selectedKeys 处理策略（适配 Accordion 的 selectedValue: string）：
   *   1. 未提供 selectedKeys → 不输出 selectedValue prop
   *   2. 字面量数组 → 取第一项作为 useState 初始值
   *   3. DataBinding → 取实际数组第一项，写入 stateData，构造 two-way binding
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
    let hasSelectedKeys = Object.prototype.hasOwnProperty.call(props, 'selectedKeys');

    if (hasSelectedKeys && props.selectedKeys?.__binding) {
      const actualArray = resolveBindingValue(rawState, props.selectedKeys);
      const initialVal = Array.isArray(actualArray) && actualArray.length > 0
        ? actualArray[0]
        : '';
      stateData.selectedValue = initialVal;
    } else if (Array.isArray(props.selectedKeys)) {
      stateData.selectedValue = props.selectedKeys.length > 0
        ? props.selectedKeys[0]
        : '';
    }

    if (hasSelectedKeys && (props.selectedKeys?.__binding || Array.isArray(props.selectedKeys))) {
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
    // 无 selectedKeys 字段 → 不输出 selectedValue prop

    // ─── 5. 构造 output props ───
    const outputProps: Record<string, any> = {
      data: { __varRef: 'menuData' },
      ...(selectedValueProp !== undefined ? { selectedValue: selectedValueProp } : {}),
    };

    if (props.className) {
      outputProps.className = props.className;
    }

    if (props.inlineCollapsed !== undefined) {
      outputProps.expanded = !props.inlineCollapsed;
    }

    // ─── inlineCollapsed（字面量 boolean）→ expanded ───
    // A2UI inlineCollapsed（antd 语义：false=展开，true=收起）
    // eview-react Accordion expanded 语义与之一致：false=展开，true=收起（反直觉）
    // 所以直接 1:1 传递，无需取反 → expanded ───

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
/**
 * Tabs → Tab 映射
 *
 * A2UI Tabs → eview-react Tab 组件。
 *
 * ## 映射规则
 *
 * 1. activeKey（受控绑定）→ selectedIndex（数字索引，0-based）
 *    四种情况处理 key→index 转换，统一输出 two-way binding：
 *    - 无 activeKey 字段 → 不输出 selectedIndex prop，不生成 useState，走组件默认值
 *    - 字面量 string + StaticChildren → 遍历 children[i].props.key 匹配
 *    - 字面量 string + 循环 → rawState[_loopBinding.stateKey] 数据数组 → 遍历 item.key 匹配
 *    - DataBinding + StaticChildren → rawState 取值 → 遍历 children.props.key 匹配
 *    - DataBinding + 循环 → rawState 取值 + 取循环数组 → 遍历 item.key 匹配
 *    - 非法值/空字符串/未匹配 → selectedIndex = 0（默认选中第一个）
 *
 * 2. types → type
 *    line → main, card → sub, editable-card → sub
 *
 * 3. tabPlacement → position
 *    top → top, end → right, bottom → bottom, start → left
 *
 * 4. onClick → two-way binding，回传 index
 *    eview-react Tab onClick(index) 回传选中 tab 的 index
 */
import { resolveBindingValue } from '../../../src/core/stateUtils';

/**
 * 尝试从 children 或循环数据中找出 activeKey 对应的 index
 *
 * @param children - 已解析的 children 节点数组
 * @param activeKeyVal - 要匹配的 activeKey 值（字面量 string）
 * @param rawState - 原始 state（循环场景需要）
 * @param loopStateKey - 循环数据在 state 中的 key（如 tabItems），无循环时为 null
 * @returns 匹配的 index，-1 表示未找到
 */
function findIndexByKey(
  children: any[] | null | undefined,
  activeKeyVal: string,
  rawState: any,
  loopStateKey: string | null,
): number {
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child?.props?.key === activeKeyVal) return i;
    }
  }

  if (loopStateKey) {
    const items = rawState?.[loopStateKey];
    if (Array.isArray(items)) {
      for (let i = 0; i < items.length; i++) {
        if (items[i]?.key === activeKeyVal) return i;
      }
    }
  }

  return -1;
}

/**
 * 构造 two-way binding 标记，让管线自动生成 useState + onClick handler
 *
 * @param id - 节点 id，用于生成独立 state key（如 "mCnPrimaryNav" → "mCnPrimaryNavSelectedIndex"）
 */
function makeTwoWayBinding(id: string) {
  const stateKey = `${id}SelectedIndex`;
  return {
    __binding: true,
    bindMode: 'two-way' as const,
    pathType: 'absolute' as const,
    stateKey,
    accessPath: stateKey,
    control: {
      changeEvent: 'onClick',
      valueExtractor: (setter: string) => `(index) => ${setter}(index)`,
    },
  };
}

export default {
  tag: 'Tab',
  import: '@nce/eview-react/Tab',

  binding: {
    activeKey: {
      changeEvent: 'onClick',
      valueExtractor: ()=>{},
    },
  },

  propsMap: {
    types: 'type',
    tabPlacement: 'position',
  },

  valueMap: {
    type: {
      line: 'main',
      card: 'sub',
      'editable-card': 'sub',
    },
    position: {
      top: 'top',
      end: 'right',
      bottom: 'bottom',
      start: 'left',
    },
  },

  transform(node: any, { rawState }: { rawState: any }) {
    const p = { ...(node.props || {}) };
    const deleteFields: string[] = [];
    const stateData: Record<string, any> = {};

    // ─── 无 activeKey → 不输出 selectedIndex，不生成 useState ───
    const hasActiveKey = Object.prototype.hasOwnProperty.call(p, 'activeKey');
    if (!hasActiveKey) {
      return {
        props: p,
        children: node.children,
      };
    }

    // ─── 有 activeKey → 用 node.id 生成独立 state key（小驼峰），避免多 Tab state 冲突 ───
    const stateKey = `${node.id}SelectedIndex`;

    const isLoop = !!node._isLoop;
    const loopStateKey = isLoop && node._loopBinding?.stateKey
      ? node._loopBinding.stateKey
      : null;

    const isDataBinding = !!(p.activeKey?.__binding);

    let activeKeyVal: string | null = null;
    if (isDataBinding) {
      const rawVal = resolveBindingValue(rawState, p.activeKey);
      activeKeyVal = rawVal !== undefined && rawVal !== null ? String(rawVal) : null;
      if (p.activeKey.accessPath) {
        deleteFields.push(p.activeKey.accessPath);
      }
    } else if (typeof p.activeKey === 'string') {
      activeKeyVal = p.activeKey;
    }

    let selectedIndex: number = 0;
    if (activeKeyVal && activeKeyVal !== '') {
      const idx = findIndexByKey(node.children, activeKeyVal, rawState, loopStateKey);
      if (idx !== -1) {
        selectedIndex = idx;
      }
    }

    stateData[stateKey] = selectedIndex;
    p.selectedIndex = makeTwoWayBinding(node.id);
    delete p.activeKey;

    if (deleteFields.length > 0) {
      stateData.__deleteFields = deleteFields;
    }

    return {
      props: p,
      children: node.children,
      stateData,
    };
  },
};
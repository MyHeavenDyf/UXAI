/**
 * TabItem → TabItem 映射
 *
 * A2UI TabItem → eview-react TabItem 组件。
 *
 * ## 映射规则
 *
 * 1. key → 删除（由 children 顺序决定索引，Tabs 的 onClick 回传 index）
 * 2. label → title
 * 3. content → children（三分支处理）
 *    - 纯文本字符串 → 直接作为顶层字符串 children
 *    - DataBinding → resolveBindingValue 从 rawState 取实际值 → 顶层字符串 children
 *    - SlotNode → resolveNode 递归解析
 * 4. icon → 保留（透传 Lucide icon name）
 */
export default {
  tag: 'TabItem',
  import: '@nce/eview-react/TabItem',

  propsMap: {
    label: 'title',
  },

  /**
   * transform — props 转换
   *
   * content 转为 children：
   *   1. 纯文本 → children = 字符串（顶层，不引入 DOM 包装）
   *   2. DataBinding → 从 rawState 取值后转为字符串 children
   *   3. SlotNode → resolveNode 递归
   */
  transform(node: any, { rawState, resolveNode }: { rawState?: any; resolveNode?: Function }) {
    const p = { ...(node.props || {}) };
    let children = node.children || [];

    // ─── content → children ───
    if ('content' in p) {
      const content = p.content;
      delete p.content;

      if (typeof content === 'string') {
        // 1. 纯文本 → 顶层字符串 children（不引入 DOM）
        if (content !== '') children = content;
      } else if (content?.__binding) {
        // 2. DataBinding → 从 rawState 取值
        const path = content.accessPath || content.path?.replace(/^\//, '');
        let actual;
        if (path && rawState) {
          actual = path.split(/[.[\]']+/).filter(Boolean).reduce((o: any, k: string) => o?.[k], rawState);
        }
        children = actual !== undefined ? String(actual) : '';
      } else if (content?.__slotNode && typeof resolveNode === 'function') {
        // 3. SlotNode → resolveNode 递归
        const resolved = resolveNode(content.__slotNode);
        if (resolved) children = Array.isArray(resolved) ? resolved : [resolved];
      }
    }

    // ─── key → 删除（由顺序决定索引）───
    delete p.key;

    return { props: p, children };
  },
};
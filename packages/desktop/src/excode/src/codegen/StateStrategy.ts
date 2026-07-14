/**
 * StateStrategy — A2UI state → React 声明策略
 *
 * 将 BindingResolver 收集的绑定信息（bindings）转换为 React state 管理代码：
 *   - 生成页面级 state.js（导出 initialState）
 *   - 生成模块级声明（readonly + loop 引用：const xxx = initialState.xxx）
 *   - 生成组件内 hook（two-way：const [x, setX] = useState(initialState.x)）
 *
 * 核心策略（对齐 a2ui-codegen skill）：
 *   - bindMode === 'two-way' → useState（读写）
 *   - bindMode === 'readonly' 或 'loop' → 模块级 const（只读）
 */

type StateRefs = Map<string, string>;

export class StateStrategy {
  /**
   * 从节点树收集 state 引用（绝对绑定 stateKey，去重 + bindMode）
   *
   * @param elements - 节点数组
   * @param stateRefs - stateKey → bindMode
   */
  static collectStateRefs(elements: any[], stateRefs: StateRefs): void {
    for (const el of elements) {
      StateStrategy._walkRefs(el, stateRefs);
    }
  }

  static _walkRefs(node: any, stateRefs: StateRefs): void {
    if (!node) return;

    // 循环数据源绑定（兼容 _deepResolve 前的 _loopBinding 标记）
    if (node._loopBinding && node._loopBinding.pathType === 'absolute') {
      const { stateKey, bindMode } = node._loopBinding;
      if (stateKey) {
        const existing = stateRefs.get(stateKey);
        if (existing !== 'two-way') {
          stateRefs.set(stateKey, bindMode);
        }
      }
    }

    // __type: 'loop' 节点（_deepResolve 转换后的循环节点，此时 _loopBinding 已被消耗）
    // 从 node.data 中提取 stateKey，作为 readonly 引用
    if (node.__type === 'loop' && node.data) {
      if (node.data.__binding && node.data.pathType === 'absolute' && node.data.stateKey) {
        const existing = stateRefs.get(node.data.stateKey);
        if (existing !== 'two-way') {
          stateRefs.set(node.data.stateKey, 'readonly');
        }
      }
      // 递归处理 template body 中的子节点（收集其中的路径绑定）
      if (node.template && node.template.body) {
        StateStrategy._walkRefs(node.template.body, stateRefs);
      }
      return; // 不再走下面的 props/children 递归
    }

    // props 中的绝对绑定
    if (node.props) {
      for (const value of Object.values(node.props)) {
        StateStrategy._collectBindingKey(value, stateRefs);
      }
    }

    // 递归子节点
    if (node.children && Array.isArray(node.children)) {
      node.children.forEach((child: any) => StateStrategy._walkRefs(child, stateRefs));
    }

    // 循环模板
    if (node._isLoop && node._loopTemplate) {
      StateStrategy._walkRefs(node._loopTemplate, stateRefs);
    }
  }

  static _collectBindingKey(value: any, stateRefs: StateRefs): void {
    if (!value || typeof value !== 'object') return;

    if (value.__binding && value.pathType === 'absolute' && value.stateKey) {
      const existing = stateRefs.get(value.stateKey);
      if (existing !== 'two-way') {
        stateRefs.set(value.stateKey, value.bindMode);
      }
      return;
    }

    if (value.__slotNode) {
      StateStrategy._walkRefs(value.__slotNode, stateRefs);
      return;
    }

    for (const v of Object.values(value)) {
      StateStrategy._collectBindingKey(v, stateRefs);
    }
  }

  /**
   * 生成 state.js 内容
   *
   * @param state - A2UI 原始 state
   * @returns state.js 文件内容
   */
  static generateStateFile(state: Record<string, any>): string {
    const entries = Object.entries(state || {})
      .map(([key, value]) => `  ${key}: ${StateStrategy._serializeJS(value)},`)
      .join('\n');

    return `/**
 * 页面级数据源（自动生成，请勿手动修改）
 * 1:1 对应 A2UI JSON 的 state 字段
 */
export const initialState = {
${entries}
};
`;
  }

  /**
   * 生成模块级声明（组件外 const）
   *
   * @param stateRefs - stateKey → bindMode
   * @param staticVars - [{ name, value }]
   * @returns 声明代码块
   */
  static generateModuleDecls(stateRefs: StateRefs, staticVars: Array<{ name: string; value: any }>): string {
    const lines: string[] = [];

    const refKeys = [...stateRefs.keys()].sort();
    for (const key of refKeys) {
      if (stateRefs.get(key) !== 'two-way') {
        lines.push(`const ${key} = initialState.${key};`);
      }
    }

    for (const v of staticVars || []) {
      lines.push(`const ${v.name} = ${StateStrategy._serializeJS(v.value)};`);
    }

    return lines.length > 0 ? '\n' + lines.join('\n') + '\n' : '';
  }

  /**
   * 生成组件内 hook 声明（two-way → useState）
   *
   * @param stateRefs
   * @returns 带 2 空格缩进的 hook 代码（无则空串）
   */
  static generateHookDecls(stateRefs: StateRefs): string {
    const lines: string[] = [];
    const refKeys = [...stateRefs.keys()].sort();
    for (const key of refKeys) {
      if (stateRefs.get(key) === 'two-way') {
        const setter = 'set' + key.charAt(0).toUpperCase() + key.slice(1);
        lines.push(`  const [${key}, ${setter}] = useState(initialState.${key});`);
      }
    }
    return lines.length > 0 ? lines.join('\n') + '\n' : '';
  }

  // ─── 内部工具 ───

  static _serializeJS(value: any): string {
    if (value === null) return 'null';
    if (typeof value === 'string') {
      return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);

    if (value && typeof value === 'object' && value.__rawExpr) {
      return value.__rawExpr;
    }
    if (value && typeof value === 'object' && value.__binding) {
      return value.accessPath || 'null';
    }
    if (value && typeof value === 'object' && value.__varRef) {
      return value.__varRef;
    }

    if (Array.isArray(value)) {
      const items = value.map((v: any) => StateStrategy._serializeJS(v));
      return '[\n' + items.map((item: string) => StateStrategy._indent(item, 2)).join(',\n') + '\n]';
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value)
        .map(([k, v]) => {
          if (k.startsWith('__')) return null;
          return `${k}: ${StateStrategy._serializeJS(v)}`;
        })
        .filter(Boolean);
      if (entries.length === 0) return '{}';
      return '{\n' + entries.map(e => `  ${e}`).join(',\n') + '\n}';
    }

    return String(value);
  }

  /**
   * 生成运行时适配函数声明
   * @param adapterFns - fnName → fnBody
   * @returns
   */
  static generateAdapterDecls(adapterFns: Map<string, string>): string {
    if (!adapterFns || adapterFns.size === 0) return '';
    const lines: string[] = [];
    for (const [, fnBody] of adapterFns) {
      lines.push(fnBody);
    }
    return '\n' + lines.join('\n\n') + '\n';
  }

  /**
   * 辅助：缩进代码
   */
  static _indent(code: string, spaces: number): string {
    const indentStr = ' '.repeat(spaces);
    return code.split('\n').map(line => indentStr + line).join('\n');
  }
}
/**
 * BindingResolver — 解析 A2UI 路径绑定 → 带上绑定标记的节点树
 *
 * 核心逻辑（对应旧 steps/03-resolve-state）：
 *   - 递归遍历节点树，对 props 中的 { path: "/xxx" } 打标为 { __binding: true, bindMode, ... }
 *   - bindMode 表驱动判定（通过 registry.getBinding 查询 binding 表）
 *   - 收集所有绑定点，供后续 step 生成 state.js / useState 声明
 *   - 对 slot 根节点跳过内部子树（模块解析负责）
 *
 * 不再编译期内联 state 值，state 作为集中数据源由 StateStrategy 生成 state.js。
 */

export class BindingResolver {
  /**
   * 递归解析单个节点树
   *
   * @param node - 原始节点
   * @param registry - ComponentRegistry（透传给 makeAbsoluteBinding）
   * @param skipSlotRoots - 跳过 ID 集合
   * @param loopContext - 是否在循环体内
   * @param bindings - 绑定收集数组
   * @param resolveNodeRef - resolveNode 引用（resolveValue 回调用）
   * @returns 解析后的节点树
   */
  static resolveNode(
    node: any,
    registry: any,
    skipSlotRoots: Set<string> | null,
    loopContext: boolean,
    bindings: any[],
    resolveNodeRef: Function
  ): any {
    if (!node) return null;

    const isSlotRoot = skipSlotRoots && skipSlotRoots.has(node.id);

    const resolved: any = {
      id: node.id,
      component: node.component,
      props: {},
      children: null,
      _isLoop: node._isLoop,
      _loopPath: node._loopPath,
      _loopComponentId: node._loopComponentId,
      _loopBinding: null,
      _isSlotRoot: !!node._isSlotRoot,
      _sectionId: node._sectionId || null,
      _idPrefix: node._idPrefix || null,
    };

    // 处理循环数据源绑定
    if (node._isLoop && node._loopPath) {
      const loopBinding = BindingResolver.makeAbsoluteBinding(
        node._loopPath, node.component, registry, 'loop'
      );
      if (loopBinding) {
        resolved._loopBinding = loopBinding;
        bindings.push({ elementId: node.id, propKey: '_loopPath', ...loopBinding });
      }
    }

    // 应用声明式 schema（propsMap 改名 + valueMap 值转换）
    const schemaProps = registry.applySchema(node.component, node.props);
    for (const [key, value] of Object.entries(schemaProps)) {
      resolved.props[key] = BindingResolver.resolveValue(
        value, node.id, key, node.component, loopContext, bindings,
        resolveNodeRef, registry  // 传透 registry
      );
    }

    // 子节点（跳过 slot 根节点的子树）
    if (isSlotRoot) {
      resolved.children = null;
    } else if (Array.isArray(node.children)) {
      resolved.children = node.children
        .map((child: any) => BindingResolver.resolveNode(child, registry, skipSlotRoots, loopContext, bindings, resolveNodeRef))
        .filter(Boolean);
    } else if (typeof node.children === 'string') {
      resolved.children = node.children;
    } else if (node.children && typeof node.children === 'object') {
      // 循环模板节点（作为单 children 直接挂载）：递归解析，走 loopContext=true
      resolved.children = BindingResolver.resolveNode(node.children, registry, skipSlotRoots, true, bindings, resolveNodeRef);
    }

    return resolved;
  }

  /**
   * 解析单个 prop 值
   */
  static resolveValue(
    value: any,
    elementId: string,
    propKey: string,
    component: string,
    loopContext: boolean,
    bindings: any[],
    resolveNodeFn: Function,
    registry: any
  ): any {
    if (value === null || value === undefined || typeof value !== 'object') {
      return value;
    }

    // prop slot
    if (value.__slotNode) {
      return { __slotNode: resolveNodeFn(value.__slotNode, loopContext, null) };
    }

    // 非 path 对象 → 递归
    if (!('path' in value)) {
      const resolved: any = Array.isArray(value) ? [] : {};
      for (const [k, v] of Object.entries(value)) {
        resolved[k] = BindingResolver.resolveValue(
          v, elementId, `${propKey}.${k}`, component, loopContext, bindings, resolveNodeFn, registry
        );
      }
      return resolved;
    }

    const pathStr = value.path;
    // 相对路径（无前导 /）
    if (!pathStr.startsWith('/')) {
      const binding = { __binding: true, bindMode: 'readonly' as const, pathType: 'relative' as const, path: pathStr };
      bindings.push({ elementId, propKey, ...binding });
      return binding;
    }

    // 绝对路径 → 打标（传 registry 去查 binding 表）
    const binding = BindingResolver.makeAbsoluteBinding(pathStr, component, registry, null, propKey);
    if (binding) {
      bindings.push({ elementId, propKey, ...binding });
      return binding;
    }

    console.warn(`[BindingResolver] 警告: path "${pathStr}" 在 element "${elementId}" 的 prop "${propKey}" 中格式异常`);
    return null;
  }

  /**
   * 构造绝对路径绑定标记（表驱动 bindMode 判定）
   *
   * @param pathStr - 绝对路径（如 "/ghNotification/count"）
   * @param component - 组件名
   * @param registry - ComponentRegistry（查 binding 表用）
   * @param forceBindMode - 强制 bindMode（如 'loop'）
   * @param propKey - prop 名（表驱动判定 two-way）
   * @returns 绑定标记对象
   */
  static makeAbsoluteBinding(
    pathStr: string,
    component: string,
    registry: any,
    forceBindMode: string | null = null,
    propKey: string | null = null
  ): any {
    if (!pathStr || !pathStr.startsWith('/')) return null;

    const segments = pathStr.slice(1).split('/');
    const stateKey = segments[0];
    let accessPath = segments[0];
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      accessPath += /^\d+$/.test(seg) ? `[${seg}]` : `.${seg}`;
    }

    let bindMode = forceBindMode || 'readonly';
    let control: any = null;
    if (!forceBindMode && propKey && registry) {
      const propMeta = registry.getBinding(component, propKey);
      if (propMeta) {
        bindMode = 'two-way';
        control = {
          changeEvent: propMeta.changeEvent,
          valueExtractor: propMeta.valueExtractor,
        };
      }
    }

    return {
      __binding: true,
      bindMode,
      pathType: 'absolute' as const,
      stateKey,
      accessPath,
      path: pathStr,
      control,
    };
  }
}
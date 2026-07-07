/**
 * TreeBuilder — A2UI 平面 elements → 嵌套节点树
 *
 * 核心功能：
 *   1. buildTree(rootId, elements, { splitMeta }) → 建树 + 在构建时识别 slot 根节点
 *   2. getModuleTrees(ctx) → 在构建完成后获取模块切片结果
 *
 * 变更说明（v2）：
 *   - 不再需要 subtreeByModule BFS，splitMeta 在 buildTree 时直接处理
 *   - buildTree 接收 options.splitMeta，建树同时完成模块根节点识别打标
 *   - 消除了 findNodeById BFS，减少一次全树遍历
 *
 * 节点标记：
 *   - _isLoop / _loopPath / _loopComponentId
 *   - _isSlotRoot / _sectionId / _idPrefix（模块切片时打标）
 *   - props 中 { componentId } → 展开为 { __slotNode }
 *   - 循环 children：直接挂载模板节点到 children，标记挂在模板节点上
 */

interface BuildOptions {
  maxDepth?: number;
  splitMeta?: Array<{ id_prefix: string; section_id: string; element_id: string }>;
  moduleRoots?: any[];
}

interface SlotMapEntry {
  section_id: string;
  id_prefix: string;
}

export class TreeBuilder {
  /**
   * 构建完整 A2UI 嵌套树
   *
   * @param rootId - 根节点 ID
   * @param elements - 扁平元素列表
   * @param options
   * @returns 树根节点
   */
  static buildTree(rootId: string, elements: any[], options: BuildOptions = {}): any {
    const maxDepth = options.maxDepth || 200;

    // 预构建 element_id → splitMeta 映射，消除建树时的 BFS
    const slotMap = new Map<string, SlotMapEntry>();
    const moduleRoots = options.moduleRoots || [];
    if (Array.isArray(options.splitMeta)) {
      for (const slot of options.splitMeta) {
        if (slot.element_id) {
          slotMap.set(slot.element_id, {
            section_id: slot.section_id,
            id_prefix: slot.id_prefix,
          });
        }
      }
    }

    const elementMap = new Map<string, any>();
    for (const el of elements) {
      elementMap.set(el.id, el);
    }

    function build(elementId: string, depth: number = 0): any {
      if (depth > maxDepth) {
        console.warn(`[TreeBuilder] 深度超过 ${maxDepth}，终止: ${elementId}`);
        return null;
      }

      const el = elementMap.get(elementId);
      if (!el) {
        console.warn(`[TreeBuilder] 引用的 id "${elementId}" 未定义，跳过`);
        return null;
      }

      const slotInfo = slotMap.get(el.id);

      const node: any = {
        id: el.id,
        component: el.component,
        __nodeType: 'unresolved',
        props: el.props ? JSON.parse(JSON.stringify(el.props)) : {},
        children: null,
        _isLoop: false,
        _loopPath: null,
        _loopComponentId: null,
        // 模块根节点标记（来自 splitMeta）
        _isSlotRoot: !!slotInfo,
        _sectionId: slotInfo ? slotInfo.section_id : null,
        _idPrefix: slotInfo ? slotInfo.id_prefix : null,
      };

      // 如果当前节点是 slot 根节点，收集到 moduleRoots
      if (slotInfo) {
        moduleRoots.push(node);
      }

      // 处理 children
      if (el.children === undefined || el.children === null) {
        node.children = null;
      } else if (Array.isArray(el.children)) {
        node.children = el.children
          .map((childId: string) => build(childId, depth + 1))
          .filter(Boolean);
      } else if (typeof el.children === 'object' && !Array.isArray(el.children)) {
        // 循环列表: { path: "/xxx", componentId: "yyy" }
        // 模板节点直接挂载为 children，标记 (_isLoop/_loopPath) 挂在模板节点自身
        if (el.children.componentId) {
          const templateNode = build(el.children.componentId, depth + 1);
          if (templateNode) {
            templateNode._isLoop = true;
            templateNode._loopPath = el.children.path;
            templateNode._loopComponentId = el.children.componentId;
          }
          node.children = templateNode;
        } else {
          node.children = null;
        }
      } else if (typeof el.children === 'string') {
        node.children = el.children;
      }

      // 处理 props 中的 componentId 引用（slot）
      if (node.props) {
        for (const [key, value] of Object.entries(node.props)) {
          const v = value as any;
          if (v && typeof v === 'object' && v.componentId && !v.path) {
            const refId = v.componentId;
            const refNode = build(refId, depth + 1);
            if (refNode) {
              node.props[key] = { __slotNode: refNode };
            } else {
              delete node.props[key];
            }
          }
        }
      }

      return node;
    }

    const rootTree = build(rootId);
    if (!rootTree) {
      throw new Error(`[TreeBuilder] rootId "${rootId}" 在 elements 中不存在`);
    }
    return rootTree;
  }

  /**
   * 从 moduleRoots 构建模块切片结果
   *
   * 此方法替代 subtreeByModule BFS。在 buildTree 过程中已收集 moduleRoots，
   * 只需将其格式化为与旧 subtreeByModule 相同输出结构。
   *
   * @param moduleRoots - buildTree 收集的 slot 根节点引用数组
   * @returns [{ id_prefix, section_id, elements: [rootNode] }]
   */
  static getModuleTrees(moduleRoots: any[]): Array<{ id_prefix: string; section_id: string; elements: any[] }> {
    return moduleRoots.map((root: any) => ({
      id_prefix: root._idPrefix,
      section_id: root._sectionId,
      elements: [root],
    }));
  }
}
/**
 * ImportCollector — 遍历节点树，收集所有组件导入声明
 *
 * 两趟收集：
 *   第一趟（collect）：遍历树，按 source 分组组件 import （含 wrapper.import）
 *   第二趟（generate）：生成 import 语句字符串
 *
 * 特性：
 *   - 递归收集 slotNode、loopTemplate、wrapper（递归 child 包含 wrapper 时自动处理）
 *   - 去重（按 source + specifier）
 *   - 区分 default import / named import
 *   - 自动合并同源 import（如 Carousel + CarouselItem 合并到同一 import 语句）
 */

interface ImportEntry {
  default: string | null;
  named: Set<string>;
}

type ImportMap = Map<string, ImportEntry>;

interface GenerateResult {
  statements: string[];
  fallbackComments: string[];
}

export class ImportCollector {
  /**
   * 遍历节点树收集 import
   *
   * @param node - 节点
   * @param imports - 收集容器：source → { default, named: Set }
   * @param transformFn - (component, node, { forImport }) => result
   */
  static collect(node: any, imports: ImportMap, transformFn: (component: string, node: any, opts: { forImport: boolean }) => any): void {
    if (!node) return;

    // 1. 收集节点自身的 import（通过 transformFn 的 forImport 模式）
    if (node.component || node.__nodeType === 'unresolved') {
      ImportCollector._collectNodeImport(node, imports, transformFn);
    } else if (node.__nodeType === 'component' && node.import) {
      // 直接使用已解析节点的 import
      if (node.importMode === 'named') {
        ImportCollector._addNamedImport(node.import, node.tag, imports);
      } else {
        ImportCollector._addImport(node.import, node.tag, imports);
      }
    }

    // 2. 收集 wrapper.import（wrapper 是 CodeGenNode，递归 collect 统一处理）
    if (node.wrapper) {
      ImportCollector.collect(node.wrapper, imports, transformFn);
    }

    // 3. 递归子节点和循环模板
    //    兼容两种循环节点形态：
    //    a) BuildTrees 阶段（_isLoop 标记）：模板节点挂在 children（单对象）或 _loopTemplate 字段
    //    b) _deepResolve 阶段（__type: 'loop' / 'renderFn'）：模板 body 在 template.body / body
    if (node._isLoop) {
      const template = node._loopTemplate || node._resolvedTemplate;
      if (template) {
        ImportCollector.collect(template, imports, transformFn);
      } else if (node.children && !Array.isArray(node.children)) {
        // BuildTrees 后：模板节点直接挂在 children 上（单个对象，非数组）
        ImportCollector.collect(node.children, imports, transformFn);
      }
    } else if (node.__type === 'loop') {
      // _deepResolve 阶段：循环表达式的 body 在 template.body
      if (node.template && node.template.body) {
        ImportCollector.collect(node.template.body, imports, transformFn);
      }
      // 抽取模式：node.template.refName 引用独立函数，函数体在 generateConstDecls 中单独收集
      return;
    } else if (node.__type === 'renderFn') {
      if (node.body) {
        ImportCollector.collect(node.body, imports, transformFn);
      }
      return;
    }
    if (node.children) {
      if (Array.isArray(node.children)) {
        node.children.forEach((child: any) => ImportCollector.collect(child, imports, transformFn));
      } else if (typeof node.children === 'object') {
        // BuildTrees 阶段：循环模板节点作为单 children 直接挂载（非数组）
        ImportCollector.collect(node.children, imports, transformFn);
      }
    }

    // 4. 从 props 中的 slotNode 递归
    if (node.props) {
      for (const value of Object.values(node.props)) {
        ImportCollector._collectFromPropValue(value, imports, transformFn);
      }
    }

    // 5. 从 componentData 中递归收集 import（如 Menu 的 icon 组件 CodeGenNode）
    if (node.componentData) {
      for (const value of Object.values(node.componentData)) {
        ImportCollector._collectFromPropValue(value, imports, transformFn);
      }
    }
  }

  /**
   * 通过 transformFn(forImport) 收集节点 import
   */
  static _collectNodeImport(node: any, imports: ImportMap, transformFn: (component: string, node: any, opts: { forImport: boolean }) => any): void {
    const result = transformFn(node.component, node, { forImport: true });
    if (result && result.__nodeType === 'component' && result.import) {
      if (result.importMode === 'named') {
        ImportCollector._addNamedImport(result.import, result.tag, imports);
      } else {
        ImportCollector._addImport(result.import, result.tag, imports);
      }
    }
  }

  /**
   * 向 imports 添加一条默认导入
   */
  static _addImport(importPath: string, tag: string, imports: ImportMap): void {
    if (!importPath) return;
    if (!imports.has(importPath)) {
      imports.set(importPath, { default: null, named: new Set() });
    }
    const entry = imports.get(importPath)!;
    if (!entry.default) {
      entry.default = tag;
    }
  }

  /**
   * 向 imports 添加一条命名导入
   */
  static _addNamedImport(importPath: string, specifier: string, imports: ImportMap): void {
    if (!importPath) return;
    if (!imports.has(importPath)) {
      imports.set(importPath, { default: null, named: new Set() });
    }
    const entry = imports.get(importPath)!;
    entry.named.add(specifier);
  }

  /**
   * 从 prop value 中递归收集 import（slotNode / CodeGenNode）
   */
  static _collectFromPropValue(value: any, imports: ImportMap, transformFn: (component: string, node: any, opts: { forImport: boolean }) => any): void {
    if (!value || typeof value !== 'object') return;
    if (value.__slotNode) {
      ImportCollector.collect(value.__slotNode, imports, transformFn);
      return;
    }
    // CodeGenNode — 递归 collect 收集其 import
    if (value.__nodeType === 'component' || value.__nodeType === 'html') {
      ImportCollector.collect(value, imports, transformFn);
      return;
    }
    for (const v of Object.values(value)) {
      ImportCollector._collectFromPropValue(v, imports, transformFn);
    }
  }

  /**
   * 生成 import 语句字符串
   *
   * @param imports - collect() 填入的 imports
   * @returns {{ statements, fallbackComments }}
   */
  static generate(imports: ImportMap): GenerateResult {
    const statements: string[] = [];
    const fallbackComments: string[] = [];

    for (const [source, info] of imports) {
      const defaultPart = info.default || '';
      const namedPart = (info.named && info.named.size > 0)
        ? `{ ${[...info.named].sort().join(', ')} }`
        : '';

      if (defaultPart && namedPart) {
        statements.push(`import ${defaultPart}, ${namedPart} from '${source}';`);
      } else if (namedPart) {
        statements.push(`import ${namedPart} from '${source}';`);
      } else if (defaultPart) {
        statements.push(`import ${defaultPart} from '${source}';`);
      }
    }

    return { statements, fallbackComments };
  }
}
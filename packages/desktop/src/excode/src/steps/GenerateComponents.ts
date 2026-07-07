/**
 * GenerateComponents — 代码生成编排
 *
 * 对每个页面，串联 ImportCollector、JsxSerializer、StateStrategy 生成：
 *   - state.js（页面级数据源，含 transform 产出的 stateData）
 *   - components/Xxx.jsx（每个模块一个组件文件，含 renderFn 等 componentData 变量声明）
 *   - index.jsx（主页面组件）
 *
 * 流程（每页面）：
 *   1. 解析所有模块节点树（registry.transform，注入 rawState + resolveNode）
 *   2. 解析页面根树
 *   3. 遍历解析后节点树，提取 stateData（合并到 initialState）和 componentData（路由到模块 const）
 *   4. 生成 state.js
 *   5. 对每个模块：注入 componentVars const，生成模块组件文件
 *   6. 组装主页面文件
 *
 * 设计决策：
 *   - stateData → 纯数据 → 合并到 initialState（state.js 永远不出现 JSX 代码）
 *   - componentData → 含 JSX 数据 → 模块顶部 const 声明
 *   - props 通过 {__varRef: 'name'} 引用 const，JsxSerializer 渲染时还原
 *   - 零 runtime 开销：所有转换在编译期完成
 *
 * 万物都是节点：
 *   - props 中的 {__varRef} 是节点
 *   - 含 JSX 的 render 函数是节点（renderFn body）
 *   - stateTransform 已合并到 transform，通过返回值产出 stateData/componentData
 */
import { Step } from '../core/Step';
import { JsxSerializer } from '../codegen/JsxSerializer';
import { ImportCollector } from '../codegen/ImportCollector';
import { StateStrategy } from '../codegen/StateStrategy';
import { StateTransformer } from '../codegen/StateTransformer';
import type { PipelineContext } from '../pipeline/PipelineContext';

export class GenerateComponents extends Step {
  async execute(ctx: PipelineContext): Promise<void> {
    ctx.generatedPages = [];

    for (const resolved of ctx.resolvedPages) {
      const { pageName, state, resolvedTree, resolvedModules } = resolved as any;

      // 预先查找本页面的样式结果
      const pageStyle = ctx.styleResults
        ? ctx.styleResults.find((s: any) => s.pageName === pageName)
        : null;

      // ── 阶段1：解析所有模块节点树（注入 rawState + resolveNode）──
      const moduleInfos: any[] = [];
      for (let modIdx = 0; modIdx < resolvedModules.length; modIdx++) {
        const mod = resolvedModules[modIdx];
        const moduleId = mod.id_prefix || mod.section_id;
        const moduleName = this._toPascalCase(mod.section_id || moduleId);

        const codeGenElements = mod.elements.map((el: any) =>
          this._deepResolve(el, ctx.registry, false, state, ctx.iconNameMap)
        );

        moduleInfos.push({ moduleId, moduleName, elements: codeGenElements, modRef: mod });
      }

      // ── 阶段2：解析页面根树（cutSlotRoots=true，slot 根截断为模块引用）──
      const rootCodeGen = this._deepResolve(resolvedTree, ctx.registry, true, state, ctx.iconNameMap);

      // ── 阶段3：遍历所有已解析节点树，提取 stateData + componentData ──
      //  - stateData：纯数据 → 合并到 initialState
      //  - componentData：含 JSX 数据 → 按模块路由
      const mergedState: Record<string, any> = { ...state };
      const moduleComponentVars: Map<string, Record<string, any>> = new Map();

      // 收集模块元素的 componentData
      for (const modInfo of moduleInfos) {
        const moduleVars: Record<string, any> = {};
        for (const el of modInfo.elements) {
          this._collectDataFromNode(el, mergedState, moduleVars);
        }
        if (Object.keys(moduleVars).length > 0) {
          moduleComponentVars.set(modInfo.moduleName, moduleVars);
        }
      }

      // 根树可能也有 componentData（页面级），归到页面级模块
      const rootComponentVars: Record<string, any> = {};
      this._collectDataFromNode(rootCodeGen, mergedState, rootComponentVars);

      // ── 阶段4：收集每个模块独立的 state 引用 ──
      const perModuleRefs: Map<string, Map<string, any>> = new Map();
      for (const modInfo of moduleInfos) {
        const moduleRefs: Map<string, any> = new Map();
        StateStrategy.collectStateRefs(modInfo.elements, moduleRefs);
        perModuleRefs.set(modInfo.moduleName, moduleRefs);
      }

      const pageStateRefs: Map<string, any> = new Map();
      StateStrategy.collectStateRefs([resolvedTree], pageStateRefs);
      for (const mod of resolvedModules) {
        StateStrategy.collectStateRefs(mod.elements, pageStateRefs);
      }

      // ── 阶段5：生成 state.js（使用合并后的 state）──
      const stateFileContent = StateStrategy.generateStateFile(mergedState);
      const stateFile = {
        fileName: 'state.js',
        content: stateFileContent,
      };

      // ── 阶段6：生成每个模块的组件文件 ──
      const componentFiles: Array<{ fileName: string; content: string }> = [];
      for (let modIdx = 0; modIdx < moduleInfos.length; modIdx++) {
        const { moduleName, elements } = moduleInfos[modIdx];
        const moduleRefs = perModuleRefs.get(moduleName) || new Map();

        // 6a. 取本模块的 componentVars（含 JSX）
        const modComponentVars = moduleComponentVars.get(moduleName) || {};

        // 6b. 收集 import
        //     来源 1：模块元素的常规 JSX
        //     来源 2：modComponentVars 中 renderFn body 的 CodeGenNode 树
        //     来源 3：loop template 中的 CodeGenNode
        const imports: Map<string, any> = new Map();
        const transformFn = (component: string, node: any, opts: any) =>
          ctx.registry.transform(component, node, { ...opts, iconNameMap: ctx.iconNameMap });

        for (const codeGenEl of elements) {
          ImportCollector.collect(codeGenEl, imports, transformFn);
        }
        if (Object.keys(modComponentVars).length > 0) {
          this._collectImportFromJsxVars(modComponentVars, imports, transformFn);
        }

        const { statements: importStmts } = ImportCollector.generate(imports);

        // 6c. 模块级 const 声明
        //     来源：moduleRefs（state 引用） + modComponentVars（含 JSX）
        //     - readonly / loop binding → 模块级 const（在组件函数外）
        //     - two-way binding → 组件函数内 useState（见 6g2 hookDecls）
        const decls = StateStrategy.generateModuleDecls(moduleRefs, []);

        // 6c2. 模块内 hook 声明（two-way binding → useState）
        //     在组件函数体内、return 之前输出
        const hookDecls = StateStrategy.generateHookDecls(moduleRefs);

        // 6d. 渲染模块 JSX
        const jsxCtx: any = {
          registry: ctx.registry,
          loopDepth: 0,
          staticVars: [],
          twoWayPromotions: new Set(),
        };

        const jsxParts = elements
          .map((el: any) => JsxSerializer.renderNode(el, jsxCtx))
          .filter(Boolean);

        // 6e. 生成 componentVars 的 const 声明（含 JSX 表达式）
        const compVarDecls = StateTransformer.generateComponentVarDecls(modComponentVars, jsxCtx);

        // 6f. 样式文件引用
        const styleImports: string[] = [];
        if (pageStyle) {
          const lessFile = pageStyle.lessFiles.find(
            (lf: any) => lf.moduleId === moduleName || lf.fileName === `${moduleName}.less`
          );
          if (lessFile) {
            styleImports.push(`import '../styles/${lessFile.fileName}';`);
          } else {
            styleImports.push(`import '../styles/${moduleName}.less';`);
          }
        }

        // 6g. 组装模块文件
        const hasCompVars = compVarDecls.trim().length > 0;
        const compVarBody = hasCompVars
          ? `  // 数据转换（编译期生成）\n${compVarDecls.split('\n').map((l: string) => `  ${l}`).join('\n')}\n\n`
          : '';

        const indentedJsx = jsxParts
          .map((p: string) => p.split('\n').map((line: string) => `    ${line}`).join('\n'))
          .join('\n');

        const fileContent = ([
          "import React, { useState } from 'react';",
          "import { initialState } from '../state';",
          ...(styleImports.length > 0 ? ['', ...styleImports] : []),
          '',
          ...importStmts,
          decls,
          '',
          `export const ${moduleName} = () => {`,
          hookDecls,
          compVarBody,
          '  return (',
          indentedJsx,
          '  );',
          '};',
          '',
          `export default ${moduleName};`,
        ]).join('\n');

        const fileName = `${moduleName}.jsx`;
        componentFiles.push({ fileName, content: fileContent });
      }

      // ── 阶段7：生成页面主文件 ──
      if (Object.keys(rootComponentVars).length > 0 && componentFiles.length > 0) {
        console.warn(`  [warn] 页面级 componentData 未分配到模块，请检查 mapping 设计`);
      }

      const pageImports: Map<string, any> = new Map();
      const pageTransformFn = (component: string, node: any, opts: any) =>
          ctx.registry.transform(component, node, { ...opts, iconNameMap: ctx.iconNameMap });
      ImportCollector.collect(rootCodeGen, pageImports, pageTransformFn);
      const { statements: pageImportStmts } = ImportCollector.generate(pageImports);

      const pageJsxCtx: any = {
        registry: ctx.registry,
        loopDepth: 0,
        staticVars: [],
        twoWayPromotions: new Set(),
      };
      const pageJSX = JsxSerializer.renderNode(rootCodeGen, pageJsxCtx);

      const hookDecls = StateStrategy.generateHookDecls(pageStateRefs);

      const moduleImports = componentFiles
        .map((f: { fileName: string; content: string }) => {
          const name = f.fileName.replace('.jsx', '');
          return `import ${name} from './components/${name}';`;
        })
        .join('\n');

      const pageStyleImport = pageStyle
        ? `import './styles/${pageName}.less';`
        : null;

      const pageFileContent = ([
        "import React, { useState } from 'react';",
        "import { initialState } from './state';",
        ...(pageStyleImport ? ['', pageStyleImport] : []),
        '',
        ...pageImportStmts,
        moduleImports,
        '',
        `const ${this._toPascalCase(pageName)}Page = () => {`,
        hookDecls,
        '  return (',
        ...pageJSX.split('\n').map((line: string) => `    ${line}`),
        '  );',
        '};',
        '',
        `export default ${this._toPascalCase(pageName)}Page;`,
      ]).join('\n');

      const pageComponent = {
        fileName: 'index.jsx',
        content: pageFileContent,
      };

      const componentStats = ctx.registry.getStats();

      ctx.generatedPages.push({
        pageName,
        componentFiles,
        pageComponent,
        stateFile,
        componentStats,
      });
    }

    console.log(`  ℹ  已生成 ${ctx.generatedPages.length} 个页面的组件代码`);
  }

  _collectDataFromNode(node: any, mergedState: Record<string, any>, componentVars: Record<string, any>): void {
    if (!node || typeof node !== 'object') return;

    if (node.stateData && typeof node.stateData === 'object') {
      if (node.stateData.__deleteFields && Array.isArray(node.stateData.__deleteFields)) {
        for (const fieldPath of node.stateData.__deleteFields) {
          const segments = fieldPath.split('.');
          if (segments.length === 1) {
            delete mergedState[fieldPath];
          } else {
            const parent = segments.slice(0, -1).reduce((obj: any, key: string) => obj?.[key], mergedState);
            if (parent) delete parent[segments[segments.length - 1]];
          }
        }
        delete node.stateData.__deleteFields;
      }
      for (const [key, value] of Object.entries(node.stateData)) {
        mergedState[key] = value;
      }
    }
    if (node.componentData && typeof node.componentData === 'object') {
      for (const [key, value] of Object.entries(node.componentData)) {
        componentVars[key] = value;
      }
    }

    if (node.__type === 'loop') {
      if (node.template) {
        this._collectDataFromNode(node.template, mergedState, componentVars);
        if (node.template.body) {
          this._collectDataFromNode(node.template.body, mergedState, componentVars);
        }
      }
      return;
    }

    if (node.__type === 'renderFn') {
      if (node.body) {
        this._collectDataFromNode(node.body, mergedState, componentVars);
      }
      return;
    }

    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        this._collectDataFromNode(child, mergedState, componentVars);
      }
    }

    if (node.wrapper) {
      this._collectDataFromNode(node.wrapper, mergedState, componentVars);
    }

    if (node.props) {
      for (const value of Object.values(node.props)) {
        if (value && typeof value === 'object' && (value as any).__slotNode) {
          this._collectDataFromNode((value as any).__slotNode, mergedState, componentVars);
        }
      }
    }
  }

  _collectImportFromJsxVars(vars: any, imports: Map<string, any>, transformFn: any): void {
    if (!vars || typeof vars !== 'object') return;
    for (const value of Object.values(vars)) {
      this._collectImportFromValue(value, imports, transformFn);
    }
  }

  _collectImportFromValue(value: any, imports: Map<string, any>, transformFn: any): void {
    if (!value || typeof value !== 'object') return;

    if (value.__type === 'renderFn') {
      if (value.body) {
        ImportCollector.collect(value.body, imports, transformFn);
      }
      return;
    }

    if (value.__type === 'loop') {
      if (value.template && value.template.body) {
        ImportCollector.collect(value.template.body, imports, transformFn);
      }
      return;
    }

    if (value.__type === 'jsxExpr') {
      if (value.body) {
        ImportCollector.collect(value.body, imports, transformFn);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        this._collectImportFromValue(item, imports, transformFn);
      }
      return;
    }

    for (const v of Object.values(value)) {
      this._collectImportFromValue(v, imports, transformFn);
    }
  }

  /**
   * 深度递归解析节点树
   *
   * 核心逻辑：
   *   1. Slot 根截断（cutSlotRoots=true 时有效）
   *   2. 已是 CodeGenNode（component/html）→ 递归 children
   *   3. 未解析节点 → 调用 registry.transform（注入 rawState + resolveNode）
   *      transform 返回后，处理三种 children 形式：
   *        - Array：逐个递归
   *        - Object（带 _isLoop）：包装为 __type:'loop' 节点
   *        - Object（普通）：递归解析
   *   4. 字符串节点 → 透传
   *
   * _isLoop → __type: 'loop' 转换说明：
   *   - _isLoop/_loopBinding 标记在 children 模板节点自身（由 TreeBuilder 挂载）
   *   - 循环数据源来自 _loopBinding
   *   - 循环模板 = children（已解析的 CodeGenNode）
   *   - 产出 { __type: 'loop', data, template: { body } }
   */
  _deepResolve(node: any, registry: any, cutSlotRoots: boolean = false, rawState: any = null, iconNameMap: Record<string, string> = {}): any {
    if (!node) return null;

    // ── 1. Slot 根截断 ──
    if (cutSlotRoots && node._isSlotRoot && node._sectionId) {
      const moduleName = this._toPascalCase(node._sectionId);
      return {
        __nodeType: 'component',
        tag: moduleName,
        props: {},
        children: null,
        selfClosing: true,
      };
    }

    // ── 2. 已是 CodeGenNode → 递归 children + slot props ──
    if (node.__nodeType === 'component' || node.__nodeType === 'html') {
      const resolved = { ...node };

      // 递归 children
      if (resolved.children && typeof resolved.children === 'object') {
        if (Array.isArray(resolved.children)) {
          resolved.children = resolved.children
            .map((child: any) => this._deepResolve(child, registry, cutSlotRoots, rawState, iconNameMap))
            .filter(Boolean);
        } else {
          // 单项 object children（如 transform 已处理的 loop body，或普通单项节点）
          resolved.children = this._deepResolve(resolved.children, registry, cutSlotRoots, rawState, iconNameMap);
        }
      }

      // 递归 props 中的 __slotNode
      if (resolved.props) {
        for (const [key, value] of Object.entries(resolved.props)) {
          if (value && typeof value === 'object' && (value as any).__slotNode) {
            resolved.props[key] = {
              __slotNode: this._deepResolve((value as any).__slotNode, registry, cutSlotRoots, rawState, iconNameMap)
            };
          }
        }
      }

      return resolved;
    }

    // ── 3. 未解析节点 → 调用 registry.transform ──
    if (node.__nodeType === 'unresolved' || node.component) {
      if (cutSlotRoots && node._isSlotRoot && node._sectionId) {
        const moduleName = this._toPascalCase(node._sectionId);
        return {
          __nodeType: 'component',
          tag: moduleName,
          props: {},
          children: null,
          selfClosing: true,
        };
      }

      const unifiedNode = node.__nodeType ? node : { ...node, __nodeType: 'unresolved' };

      const self = this;
      const codeGen = registry.transform(unifiedNode.component, unifiedNode, {
        rawState,
        iconNameMap,
        resolveNode: (childNode: any) =>
          self._deepResolve(childNode, registry, cutSlotRoots, rawState, iconNameMap),
      });

      if (!codeGen) {
        console.warn(`  [warn] deepResolve: ${unifiedNode.component} transform 返回 null`);
        return null;
      }

      if (unifiedNode.id) {
        codeGen.id = unifiedNode.id;
      }

      // ★ 处理 transform 返回的 children（三种形式）：
      //   1. Array → 逐个递归/透传
      //   2. Object + _isLoop + (有 __nodeType 表示已 resolve / 无表示未解析) → 包装为 loop
      //   3. Object + 非循环 → 递归
      if (codeGen.children && typeof codeGen.children === 'object') {
        if (Array.isArray(codeGen.children)) {
          codeGen.children = codeGen.children
            .map((child: any) => {
              if (typeof child === 'string') return child;
              if (child.__nodeType === 'unresolved') {
                return this._deepResolve(child, registry, cutSlotRoots, rawState, iconNameMap);
              }
              return child;
            })
            .filter(Boolean);
        } else {
          // Object children：检测 _isLoop 标记（标记在 children 模板节点自身）
          const child = codeGen.children;
          if (child._isLoop && child._loopBinding) {
            // 循环模板节点 → 包装为 __type: 'loop'
            let body: any;
            if (child.__nodeType) {
              // 已 resolve（transform 内调用了 resolveNode）
              body = child;
            } else {
              // 未 resolve → 深度递归后作为 body
              body = this._deepResolve(child, registry, cutSlotRoots, rawState, iconNameMap);
            }
            codeGen.children = [{
              __type: 'loop',
              extract: false,
              data: child._loopBinding,
              template: {
                __type: 'renderFn',
                params: '(item, idx)',
                body,
              },
            }];
          } else {
            // 普通 object children → 递归
            codeGen.children = this._deepResolve(child, registry, cutSlotRoots, rawState, iconNameMap);
          }
        }
      }

      return codeGen;
    }

    // ── 4. 字符串节点 → 透传 ──
    if (typeof node === 'string') {
      return node;
    }

    // ── 5. component 字段兜底 ──
    if (node.component) {
      return this._deepResolve(
        { ...node, __nodeType: 'unresolved' },
        registry,
        cutSlotRoots,
        rawState,
        iconNameMap
      );
    }

    console.warn(`  [warn] deepResolve: 无法识别的节点类型`, node);
    return node;
  }

  _toPascalCase(str: string): string {
    return str
      .replace(/[-_]/g, ' ')
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
  }
}
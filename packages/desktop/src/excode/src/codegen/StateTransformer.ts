/**
 * StateTransformer — JSX 表达式变量序列化工具
 *
 * 职责：
 *   1. generateComponentVarDecls：生成模块顶部的 const 声明（从 componentData）
 *   2. _serializeJsxVar：递归序列化含 JSX 表达式的数据为 JS 表达式字符串
 *   3. 支持 __type: 'renderFn'（含 extract 抽取）和旧的 __type: 'jsxExpr'
 *
 * 设计说明：
 *   - stateTransform 已并入 mapping.transform 内部逻辑
 *   - componentData 中的 renderFn 支持 extract: true，抽取为模块顶部 const 声明
 *   - 抽取的 renderFn 在模块顶部先声明，后续 column 对象的 render 属性引用函数名
 */
import { JsxSerializer } from './JsxSerializer';

export class StateTransformer {
  /**
   * 生成模块 const 声明（基于 componentData，含 renderFn/loop 等含 JSX 的变量）
   *
   * 流程：
   *   1. 从 vars 中递归收集所有 extract: true 的 renderFn
   *   2. 生成抽取函数的 const 声明（在顶部）
   *   3. 生成主变量的 const 声明（引用抽取函数名）
   *
   * @param vars - 变量名 → 值（值可为 renderFn/嵌套对象/数组）
   * @param jsxCtx - JsxSerializer 上下文
   * @returns 声明代码
   */
  static generateComponentVarDecls(vars: Record<string, any> | null | undefined, jsxCtx: Record<string, any>): string {
    if (!vars || Object.keys(vars).length === 0) return '';

    // 1. 递归收集所有 extract: true 的 renderFn
    const extractedFns: Array<{ refName: string; params: string; body: any }> = [];
    this._collectExtractedFns(vars, extractedFns);

    // 2. 生成抽取函数的 const 声明
    const fnDecls = extractedFns
      .map(fn => {
        const bodyCtx = {
          ...jsxCtx,
          loopVarName: 'rowData',
        };
        const bodyJSX = fn.body
          ? JsxSerializer.renderNode(fn.body, bodyCtx)
          : 'null';
        const indent = '  ';
        return `const ${fn.refName} = ${fn.params} => (\n${indent}${bodyJSX.split('\n').join('\n' + indent)}\n);`;
      });

    // 3. 生成主变量的 const 声明
    const mainDecls = Object.entries(vars)
      .map(([name, value]) => {
        return `const ${name} = ${StateTransformer._serializeJsxVar(value, jsxCtx, 0)};`;
      });

    return [...fnDecls, ...mainDecls].join('\n\n') + '\n';
  }

  /**
   * 从 componentVars 中递归收集所有 extract: true 的 renderFn
   */
  static _collectExtractedFns(vars: any, collected: Array<{ refName: string; params: string; body: any }>): void {
    if (!vars || typeof vars !== 'object') return;

    for (const value of Object.values(vars)) {
      this._collectFromValue(value, collected);
    }
  }

  static _collectFromValue(value: any, collected: Array<{ refName: string; params: string; body: any }>): void {
    if (!value || typeof value !== 'object') return;

    // renderFn with extract → 收集
    if (value.__type === 'renderFn' && value.extract && value.refName) {
      if (!collected.some(c => c.refName === value.refName)) {
        collected.push({
          refName: value.refName,
          params: value.params || '()',
          body: value.body,
        });
      }
      return; // 停止递归（body 已包含在收集物中）
    }

    // loop → 检查 template
    if (value.__type === 'loop' && value.template) {
      if (value.template.extract && value.template.refName) {
        if (!collected.some(c => c.refName === value.template.refName)) {
          collected.push({
            refName: value.template.refName,
            params: value.template.params || '(item, idx)',
            body: value.template.body,
          });
        }
      }
      return;
    }

    // 数组
    if (Array.isArray(value)) {
      for (const item of value) {
        this._collectFromValue(item, collected);
      }
      return;
    }

    // 普通对象 — 递归子属性
    for (const v of Object.values(value)) {
      this._collectFromValue(v, collected);
    }
  }

  /**
   * 递归序列化含 JSX 表达式的值
   *
   * 支持：
   *   - __type: 'renderFn' — 含 extract 时输出 refName，否则渲染内联箭头函数
   *   - __type: 'loop' — 渲染循环表达式
   *   - __type: 'jsxExpr' — 向后兼容旧格式
   *   - 普通对象/数组/原始值
   *
   * @param value
   * @param jsxCtx
   * @param depth
   * @returns
   */
  static _serializeJsxVar(value: any, jsxCtx: Record<string, any>, depth: number = 0): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') {
      return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);

    if (value && typeof value === 'object') {
      // CodeGenNode — 渲染为 JSX 元素（如 icon 组件嵌套在 componentData 中）
      if (value.__nodeType === 'component' || value.__nodeType === 'html') {
        const bodyCtx = { ...jsxCtx, loopVarName: 'rowData' };
        return JsxSerializer.renderNode(value, bodyCtx);
      }

      // renderFn — 新格式
      if (value.__type === 'renderFn') {
        if (value.extract && value.refName) {
          // 抽取模式：只输出函数名引用（函数声明由 generateComponentVarDecls 生成）
          return value.refName;
        }
        // 内联模式：渲染为箭头函数
        const bodyCtx = {
          ...jsxCtx,
          loopVarName: 'rowData',
        };
        const bodyJSX = value.body
          ? JsxSerializer.renderNode(value.body, bodyCtx)
          : 'null';
        const indent = '  '.repeat(depth + 1);
        return `${value.params || '()'} => (\n${indent}${bodyJSX.split('\n').join('\n' + indent)}\n${'  '.repeat(depth)})`;
      }

      // loop — 渲染循环表达式
      if (value.__type === 'loop') {
        const dataVar = value.data?.__varRef || (value.data?.path ? value.data.path.replace(/^\//, '') : 'data');
        const params = value.template?.params || '(item, idx)';
        const bodyJSX = value.template?.body
          ? JsxSerializer.renderNode(value.template.body, jsxCtx)
          : 'null';
        const indent = '  '.repeat(depth + 1);
        return `(${dataVar} || []).map(${params} => (\n${indent}${bodyJSX.split('\n').join('\n' + indent)}\n${'  '.repeat(depth)}))`;
      }

      // jsxExpr — 向后兼容旧格式
      if (value.__type === 'jsxExpr') {
        const bodyCtx = {
          ...jsxCtx,
          loopVarName: 'rowData',
        };
        const bodyJSX = value.body
          ? JsxSerializer.renderNode(value.body, bodyCtx)
          : 'null';
        const indent = '  '.repeat(depth + 1);
        return `${value.params || '()'} => (\n${indent}${bodyJSX.split('\n').join('\n' + indent)}\n${'  '.repeat(depth)})`;
      }

      // 数组
      if (Array.isArray(value)) {
        const items = value.map((v: any) => StateTransformer._serializeJsxVar(v, jsxCtx, depth + 1));
        const indent = '  '.repeat(depth + 1);
        return '[\n' + items.map((item: string) => `${indent}${item}`).join(',\n') + '\n' + '  '.repeat(depth) + ']';
      }

      // 对象（过滤 __前缀内部字段）
      const entries = Object.entries(value)
        .filter(([k]) => !k.startsWith('__'))
        .map(([k, v]) => {
          return `${k}: ${StateTransformer._serializeJsxVar(v, jsxCtx, depth + 1)}`;
        });
      if (entries.length === 0) return '{}';
      const indent = '  '.repeat(depth + 1);
      return '{\n' + entries.map(e => `${indent}${e}`).join(',\n') + '\n' + '  '.repeat(depth) + '}';
    }

    return String(value);
  }
}
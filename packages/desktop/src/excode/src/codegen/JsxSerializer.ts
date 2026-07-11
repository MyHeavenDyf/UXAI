/**
 * JsxSerializer — 核心 JSX 渲染引擎
 *
 * 将经过 ComponentRegistry.transform 解析后的 CodeGenNode 渲染为 JSX 字符串。
 *
 * 新增支持：
 *   - __type: 'renderFn' — 渲染函数（props 值中）
 *   - __type: 'loop' — 数据驱动循环（children 中）
 *   - extract 选项 — 内联/抽取到模块顶部
 *
 * 移除：
 *   - _renderLoop — 循环由 __type: 'loop' 统一处理
 */

interface SerializeCtx {
  registry?: any;
  loopDepth?: number;
  staticVars?: Array<{ name: string; value: any }>;
  twoWayPromotions?: Set<string>;
  loopVarName?: string;
  [key: string]: any;
}

interface ExtractedFn {
  refName: string;
  params?: string;
  body: any;
}

export class JsxSerializer {
  static renderNode(node: any, ctx: SerializeCtx): string {
    if (!node) return 'null';

    if (node.__nodeType === 'unresolved') {
      console.warn(`  [warn] JsxSerializer: 遇到 unresolved 节点 "${node.component || node.id}"，尝试重新解析...`);
      if (ctx && ctx.registry && ctx.registry.transform) {
        try {
          const resolved = ctx.registry.transform(node.component, node);
          if (resolved && resolved.__nodeType !== 'unresolved') {
            return JsxSerializer.renderNode(resolved, ctx);
          }
        } catch (e: any) {
          console.warn(`  [warn] JsxSerializer: 解析 unresolved 失败: ${e.message}`);
        }
      }
      return '';
    }

    // __type: 'loop' — 渲染循环表达式（作为独立的节点）
    if (node.__type === 'loop') {
      return JsxSerializer._renderLoopExpr(node, ctx);
    }

    // __type: 'renderFn' — 渲染函数表达式（作为独立的值）
    if (node.__type === 'renderFn') {
      return JsxSerializer._renderInlineFn(node, ctx);
    }

    const tag = node.tag;
    const props = node.props || {};
    const children = node.children;

    if (ctx.staticVars) {
      JsxSerializer._extractStaticVars(props, node.id, ctx.staticVars);
      if (node._inlineVarProps) {
        JsxSerializer._forceExtractInlineVar(props, node.id, ctx.staticVars, node._inlineVarProps);
      }
    }

    if (ctx.twoWayPromotions && props) {
      for (const value of Object.values(props)) {
        const v = value as any;
        if (v && typeof v === 'object' && v.__binding && v.bindMode === 'two-way' && v.stateKey) {
          ctx.twoWayPromotions.add(v.stateKey);
        }
      }
    }

    // 渲染当前节点的 JSX
    const innerJSX = JsxSerializer._renderInner(tag, node, ctx);

    // wrapper 包裹：wrapper 是 CodeGenNode，将其作为外层标签包裹本节点内容
    if (node.wrapper) {
      // innerJSX 已由 _renderInner 渲染（不含 wrapper 影响），直接包裹即可
      return JsxSerializer._applyWrapper(node.wrapper, innerJSX, ctx);
    }

    return innerJSX;
  }

  /**
   * 渲染 __type: 'loop' — 数据驱动循环
   *
   * 根据 extract 选项：
   *   extract=false（内联）：{(dataVar || []).map((item, idx) => (body))}
   *   extract=true（抽取）：{(dataVar || []).map(refName)}
   */
  static _renderLoopExpr(node: any, ctx: SerializeCtx): string {
    const data = node.data || {};
    const template = node.template || {};
    const params = template.params || '(item, idx)';

    // 数据源变量名
    let dataVar = 'data';
    if (data.__varRef) {
      dataVar = data.__varRef;
    } else if (data.path) {
      dataVar = data.path.replace(/^\//, '');
    } else if (data.stateKey) {
      dataVar = data.stateKey;
    }

    const loopCtx: SerializeCtx = { ...ctx, loopDepth: (ctx.loopDepth || 0) + 1 };

    if (node.extract && template.extract && template.refName) {
      // 抽取模式：dataVar.map(refName)
      return `{(${dataVar} || []).map(${template.refName})}`;
    } else if (template.body) {
      // 内联模式：dataVar.map((item, idx) => (body))
      const bodyJSX = JsxSerializer.renderNode(template.body, loopCtx);
      return `{(${dataVar} || []).map(${params} => (\n${JsxSerializer._indent(bodyJSX, 2)}\n))}`;
    }

    return '[]';
  }

  /**
   * 渲染 __type: 'renderFn' — 纯渲染函数（内联模式）
   *
   * 根据 extract 选项：
   *   extract=false（内联）：(params) => (body)
   *   extract=true（抽取）：refName（仅函数名引用）
   *
   * 注：此方法仅渲染内联模式（extract=false），
   *     抽取模式（extract=true）在 _generateProps 中直接输出 refName 引用，
   *     函数声明由 _collectExtractedFns 收集。
   */
  static _renderInlineFn(node: any, ctx: SerializeCtx): string {
    if (node.extract && node.refName) {
      return node.refName;
    }
    const params = node.params || '()';
    const loopCtx: SerializeCtx = { ...ctx, loopDepth: (ctx.loopDepth || 0) + 1 };
    const bodyJSX = node.body ? JsxSerializer.renderNode(node.body, loopCtx) : 'null';
    return `(${params}) => (\n${JsxSerializer._indent(bodyJSX, 2)}\n)`;
  }

  static _renderInner(tag: string, node: any, ctx: SerializeCtx): string {
    const props = node.props || {};
    const isSelfClosing = node.selfClosing;

    const isInLoop = (ctx.loopDepth || 0) >= 2;
    let propsForAttr = props;
    let valueChildren = '';

    // 仅对没有原生 value 属性的文本型 DOM 元素执行 value→children 下沉
    if (node.__nodeType === 'html' && HTML_TEXT_ELEMENTS.has(tag) && !HTML_VALUE_ATTRIBUTE_ELEMENTS.has(tag)) {
      const extracted = JsxSerializer._extractValueAsChildren(props, isInLoop, ctx);
      propsForAttr = extracted.remainingProps;
      valueChildren = extracted.valueChildren;
    }

    const propsStr = JsxSerializer._generateProps(propsForAttr, isInLoop, ctx);
    // 模块引用等无 id 节点不生成 className（避免 undefined_style）
    const classAttr = node.id ? `className="${node.id}_style"` : '';
    const idAttr = node.id ? `id="${node.id}"` : '';
    const allProps = [idAttr, classAttr, propsStr].filter(Boolean).join(' ');

    let childrenJSX = JsxSerializer._resolveChildren(node, ctx);

    if (valueChildren) {
      childrenJSX = childrenJSX ? `${valueChildren}\n${childrenJSX}` : valueChildren;
    }

    if (isSelfClosing || (!childrenJSX && !node.children)) {
      return `<${tag} ${allProps} />`;
    }

    if (typeof childrenJSX === 'string' && !childrenJSX.includes('\n')) {
      return `<${tag} ${allProps}>${childrenJSX}</${tag}>`;
    }

    return `<${tag} ${allProps}>\n${JsxSerializer._indent(childrenJSX || '', 2)}\n</${tag}>`;
  }

  static _applyWrapper(wrapper: any, innerJSX: string, ctx?: SerializeCtx): string {
    if (!wrapper) return innerJSX;

    // wrapper 是 CodeGenNode，提取 tag/props
    const wrapperTag = wrapper.tag;
    const wrapperProps = wrapper.props || {};
    const wrapperPropsStr = Object.entries(wrapperProps)
      .map(([k, v]) => {
        if (typeof v === 'string') return `${k}="${v}"`;
        return `${k}={${JSON.stringify(v)}}`;
      })
      .join(' ');
    const wrapperAllProps = wrapperPropsStr ? ` ${wrapperPropsStr}` : '';

    if (!innerJSX || innerJSX === 'null') {
      return `<${wrapperTag}${wrapperAllProps} />`;
    }

    const innerIndented = innerJSX.includes('\n')
      ? `\n${JsxSerializer._indent(innerJSX, 2)}\n`
      : innerJSX;

    return `<${wrapperTag}${wrapperAllProps}>${innerIndented}</${wrapperTag}>`;
  }

  static _resolveChildren(node: any, ctx: SerializeCtx): string {
    if (!node.children) return '';
    if (typeof node.children === 'string') return node.children;
    if (Array.isArray(node.children)) {
      return node.children
        .map((child: any) => {
          // 字符串 → 直接作为文本输出
          if (typeof child === 'string') return child;

          // __binding 对象 → 渲染为 JSX 表达式 {accessPath}
          if (child && typeof child === 'object' && child.__binding) {
            const isInLoop = (ctx.loopDepth || 0) >= 2;
            const itemVar = (ctx && ctx.loopVarName) || (isInLoop ? 'subItem' : 'item');
            if (child.pathType === 'relative') {
              return `{${itemVar}.${child.path}}`;
            }
            return `{${child.accessPath}}`;
          }

          // __varRef 对象 → 渲染为 {varName}
          if (child && typeof child === 'object' && child.__varRef) {
            return `{${child.__varRef}}`;
          }

          // __rawExpr 对象 → 渲染为 {expr}
          if (child && typeof child === 'object' && child.__rawExpr) {
            return `{${child.__rawExpr}}`;
          }

          // __type: 'loop' → 渲染为 JSX 表达式（dataVar || []).map(...)
          // __type: 'renderFn' → 渲染为函数表达式
          if (child && typeof child === 'object' && child.__type === 'loop') {
            const loopExpr = JsxSerializer._renderLoopExpr(child, ctx);
            // loop 在 children 位置需要被 {} 包裹（已经是 JSX 表达式）
            return loopExpr;
          }
          if (child && typeof child === 'object' && child.__type === 'renderFn') {
            return `{${JsxSerializer._renderInlineFn(child, ctx)}}`;
          }
          return JsxSerializer.renderNode(child, { ...ctx, loopDepth: ctx.loopDepth });
        })
        .filter(Boolean)
        .join('\n');
    }
    return '';
  }

  /**
   * 生成属性字符串
   *
   * isInLoop 表示是否在循环体内部。
   * 新增处理 __type: 'renderFn' — 渲染函数值
   */
  static _generateProps(props: Record<string, any>, isInLoop: boolean, ctx: SerializeCtx): string {
    const parts: string[] = [];
    // loopVarName 覆盖默认 item/subItem（用于 render 函数内）
    const itemVar = (ctx && ctx.loopVarName) || (isInLoop ? 'subItem' : 'item');
    for (const [key, value] of Object.entries(props)) {
      if (key === 'className') continue;

      if (value && typeof value === 'object' && value.__type === 'renderFn') {
        // renderFn 类型 — 渲染为 prop 值
        if (value.extract && value.refName) {
          // 抽取模式：{refName}
          parts.push(`${key}={${value.refName}}`);
        } else {
          // 内联模式：{ (params) => (body) }
          const inlineFn = JsxSerializer._renderInlineFn(value, ctx);
          parts.push(`${key}={${inlineFn}}`);
        }
      } else if (JsxSerializer._isBinding(value)) {
        if (value.pathType === 'relative') {
          parts.push(`${key}={${itemVar}.${value.path}}`);
        } else {
          parts.push(`${key}={${value.accessPath}}`);
          if (value.control) {
            const setter = `set${value.stateKey.charAt(0).toUpperCase()}${value.stateKey.slice(1)}`;
            parts.push(`${value.control.changeEvent}={${value.control.valueExtractor(setter)}}`);
          }
        }
      } else if (value && typeof value === 'object' && value.__slotNode) {
        const slotCtx: SerializeCtx = { ...ctx, loopDepth: isInLoop ? 2 : 0 };
        const slotJSX = JsxSerializer.renderNode(value.__slotNode, slotCtx);
        parts.push(`${key}={${slotJSX}}`);
      } else if (value && typeof value === 'object' && value.__varRef) {
        parts.push(`${key}={${value.__varRef}}`);
      } else if (typeof value === 'string') {
        parts.push(`${key}="${JsxSerializer._escapeJSX(value)}"`);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        parts.push(`${key}={${value}}`);
      } else if (value === null) {
        parts.push(`${key}={null}`);
      } else if (typeof value === 'object') {
        parts.push(`${key}={${JsxSerializer._serializePropValue(value, isInLoop, ctx)}}`);
      }
    }
    return parts.join(' ');
  }

  static _serializePropValue(value: any, isInLoop: boolean, ctx: SerializeCtx): string {
    const itemVar = (ctx && ctx.loopVarName) || (isInLoop ? 'subItem' : 'item');
    if (value && typeof value === 'object' && value.__rawExpr) {
      return value.__rawExpr;
    }
    if (JsxSerializer._isBinding(value)) {
      if (value.pathType === 'relative') {
        return `${itemVar}.${value.path}`;
      }
      return value.accessPath;
    }
    if (value && typeof value === 'object' && value.__varRef) {
      return value.__varRef;
    }
    if (value === null) return 'null';
    if (Array.isArray(value)) {
      return `[${value.map((v: any) => JsxSerializer._serializePropValue(v, isInLoop, ctx)).join(', ')}]`;
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value).map(
        ([k, v]) => `${k}: ${JsxSerializer._serializePropValue(v, isInLoop, ctx)}`
      );
      return `{ ${entries.join(', ')} }`;
    }
    return JSON.stringify(value);
  }

  /**
   * 从 CodeGenNode 树中递归收集所有 extract: true 的 renderFn/loop
   *
   * 返回数组：{ refName, params, body }[]
   * 调用方在模块顶部生成 const refName = (params) => (body);
   *
   * @param node - CodeGenNode 或子树
   * @param collected - 累积的数组
   */
  static collectExtractedFns(node: any, collected: ExtractedFn[] = []): ExtractedFn[] {
    if (!node || typeof node !== 'object') return collected;

    // 检查 __type: 'renderFn'（props 中）
    if (node.props) {
      for (const value of Object.values(node.props)) {
        const v = value as any;
        if (v && typeof v === 'object' && v.__type === 'renderFn' && v.extract) {
          collected.push({
            refName: v.refName,
            params: v.params,
            body: v.body,
          });
        }
        // 递归 slotNode
        if (v && typeof v === 'object' && v.__slotNode) {
          JsxSerializer.collectExtractedFns(v.__slotNode, collected);
        }
      }
    }

    // 检查 children 中的 loop（及其 template）
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child && typeof child === 'object') {
          if (child.__type === 'loop' && child.extract && child.template && child.template.extract) {
            collected.push({
              refName: child.template.refName,
              params: child.template.params,
              body: child.template.body,
            });
          }
          // 递归子节点
          JsxSerializer.collectExtractedFns(child, collected);
        }
      }
    }

    // 检查自身是 renderFn/loop（当 renderFn/loop 作为独立节点时）
    if (node.__type === 'renderFn' && node.extract && node.refName) {
      // 检查是否已收集（避免重复）
      if (!collected.some(c => c.refName === node.refName)) {
        collected.push({
          refName: node.refName,
          params: node.params,
          body: node.body,
        });
      }
    }
    if (node.__type === 'loop' && node.extract && node.template && node.template.extract) {
      if (!collected.some(c => c.refName === node.template.refName)) {
        collected.push({
          refName: node.template.refName,
          params: node.template.params,
          body: node.template.body,
        });
      }
    }

    // 递归 wrapper
    if (node.wrapper) {
      JsxSerializer.collectExtractedFns(node.wrapper, collected);
    }

    return collected;
  }

  static _extractStaticVars(effectiveProps: Record<string, any>, nodeId: string, staticVars: Array<{ name: string; value: any }>): void {
    if (!effectiveProps || typeof effectiveProps !== 'object') return;
    if (!nodeId) return; // 模块引用等无 id 节点不提取静态变量（避免 "undefined_key" 错误引用）
    for (const [key, value] of Object.entries(effectiveProps)) {
      if (key === 'className') continue;
      if (JsxSerializer._isBinding(value)) continue;
      if (value && typeof value === 'object' && value.__varRef) continue;
      if (value && typeof value === 'object' && value.__slotNode) continue;
      if (value && typeof value === 'object' && value.__type === 'renderFn') continue; // renderFn 不提取
      if (value && typeof value === 'object' && JsxSerializer._hasRawExpr(value)) continue;
      if (value === null || value === undefined || typeof value !== 'object') continue;
      if (JsxSerializer._hasBindingRecursive(value)) continue;

      const varName = `${nodeId}_${key}`;
      if (!staticVars.some(v => v.name === varName)) {
        staticVars.push({ name: varName, value });
      }
      effectiveProps[key] = { __varRef: varName };
    }
  }

  static _forceExtractInlineVar(effectiveProps: Record<string, any>, nodeId: string, staticVars: Array<{ name: string; value: any }>, inlineKeys: string[]): void {
    if (!effectiveProps || typeof effectiveProps !== 'object' || !Array.isArray(inlineKeys)) return;
    if (!nodeId) return; // 模块引用等无 id 节点不提取内联变量
    for (const key of inlineKeys) {
      if (!(key in effectiveProps)) continue;
      const value = effectiveProps[key];
      if (value === null || value === undefined) continue;
      if (value && typeof value === 'object' && value.__varRef) continue;
      if (JsxSerializer._isBinding(value)) continue;

      const varName = `${nodeId}_${key}`;
      if (!staticVars.some(v => v.name === varName)) {
        staticVars.push({ name: varName, value });
      }
      effectiveProps[key] = { __varRef: varName };
    }
  }

  static _isBinding(value: any): boolean {
    return value && typeof value === 'object' && value.__binding === true;
  }

  static _hasBindingRecursive(obj: any): boolean {
    if (!obj || typeof obj !== 'object') return false;
    if (obj.__binding !== undefined) return true;
    for (const val of Object.values(obj)) {
      if (JsxSerializer._hasBindingRecursive(val)) return true;
    }
    return false;
  }

  static _hasRawExpr(obj: any): boolean {
    if (!obj || typeof obj !== 'object') return false;
    if (obj.__rawExpr !== undefined) return true;
    for (const val of Object.values(obj)) {
      if (JsxSerializer._hasRawExpr(val)) return true;
    }
    return false;
  }

  static _extractValueAsChildren(props: Record<string, any>, isInLoop: boolean, ctx: SerializeCtx): { valueChildren: string; remainingProps: Record<string, any> } {
    const itemVar = (ctx && ctx.loopVarName) || (isInLoop ? 'subItem' : 'item');
    if (!props || props.value === undefined) {
      return { valueChildren: '', remainingProps: props };
    }

    const { value: valueProp, ...remainingProps } = props;
    let valueChildren = '';

    if (JsxSerializer._isBinding(valueProp)) {
      if (valueProp.pathType === 'relative') {
        valueChildren = `{${itemVar}.${valueProp.path}}`;
      } else {
        valueChildren = `{${valueProp.accessPath}}`;
      }
    } else if (valueProp && typeof valueProp === 'object' && valueProp.__varRef) {
      valueChildren = `{${valueProp.__varRef}}`;
    } else if (typeof valueProp === 'string') {
      valueChildren = valueProp;
    } else if (typeof valueProp === 'number' || typeof valueProp === 'boolean') {
      valueChildren = `{${valueProp}}`;
    }

    return { valueChildren, remainingProps };
  }

  static _escapeJSX(s: string): string {
    const AMP = '\u0026';
    return s
      .replace(/"/g, `${AMP}quot;`)
      .replace(/{/g, `${AMP}#123;`)
      .replace(/}/g, `${AMP}#125;`);
  }

  static _indent(code: string, spaces: number): string {
    const indentStr = ' '.repeat(spaces);
    return code.split('\n').map(line => `${indentStr}${line}`).join('\n');
  }
}

// 有原生 value 属性的 HTML 元素。
// 这些元素的 value prop 应保留为属性，不应转为 children 文本节点。
const HTML_VALUE_ATTRIBUTE_ELEMENTS = new Set([
  'button',
  'data',
  'input',
  'li',
  'meter',
  'option',
  'progress',
  'param',
]);

const HTML_TEXT_ELEMENTS = new Set([
  'span', 'div', 'p', 'label',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'footer', 'nav', 'section', 'article', 'aside',
  'main', 'strong', 'em', 'b', 'i', 'u',
  'small', 'mark', 'del', 'ins', 'sub', 'sup',
  'td', 'th', 'caption', 'figcaption', 'legend',
  'a', 'cite', 'code', 'pre', 'blockquote', 'q',
  'abbr', 'address', 'time', 'li', 'dt', 'dd', 'summary',
]);
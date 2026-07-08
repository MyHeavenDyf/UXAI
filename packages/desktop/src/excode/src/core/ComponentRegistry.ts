/**
 * ComponentRegistry — 组件转换注册中心
 *
 * 管理组件映射声明和 transform 函数。
 * 映射层（config/mappings/）使用本注册器注册组件定义，
 * 代码生成层（codegen/）使用本注册器查询组件信息。
 *
 * 注册内容：
 * - tag / import：目标组件名与导入路径
 * - propsMap：prop 改名规则
 * - valueMap：prop 值转换规则
 * - defaults：默认 prop 值
 * - binding：受控绑定元信息
 * - transform：节点树变换函数（可选）
 *
 * transform 函数契约：(node, context) => { props?, children?, _inlineVarProps?, selfClosing?, stateData?, componentData? }
 *   context = { rawState?, resolveNode? }
 *   不返回 tag/import（管线使用映射文件顶层的 tag/import）
 *   不拼接 JSX，不调用 renderNode。
 *
 * 调用 transform 前，管线自动完成：
 *   1. defaults 填充
 *   2. propsMap 改名
 *   3. valueMap 枚举值转换
 *   transform 收到的 node.props 已是处理后的值。
 *
 * transform 通过返回值产出 stateData/componentData（替代旧的 stateTransform）：
 *   - stateData：纯数据，合并到 initialState
 *   - componentData：含 JSX，路由到所属模块 const 声明
 *
 * 注意：
 * - defaults 字段在 applySchema（transform 前）和 transform 结果（transform 后）中
 *   都会兜底合并，确保任何 transform（包括完全重组的变换）也不会丢弃 defaults 字段。
 */

// ─── 类型定义 ───

export interface BindingInfo {
  changeEvent?: string;
  valueExtractor?: string;
  [key: string]: any;
}

export interface MappingDef {
  tag?: string;
  import?: string;
  binding?: Record<string, BindingInfo>;
  propsMap?: Record<string, string>;
  valueMap?: Record<string, any>;
  defaults?: Record<string, any>;
  transform?: (node: any, context: any) => any;
  [key: string]: any;
}

export interface TransformResult {
  __nodeType?: string;
  tag?: string;
  import?: string;
  props?: Record<string, any>;
  children?: any;
  /** wrapper — 包裹节点（作为 CodeGenNode，渲染时在当前节点外层套一层） */
  wrapper?: { __nodeType: string; tag: string; import?: string; importMode?: string; props?: Record<string, any>; children?: any[]; };
  _inlineVarProps?: any;
  selfClosing?: boolean;
  stateData?: Record<string, any>;
  componentData?: Record<string, any>;
  [key: string]: any;
}

export class ComponentRegistry {
  #transforms: Map<string, (node: any, context: any) => any> = new Map();
  #bindings: Map<string, Record<string, BindingInfo>> = new Map();
  #mappingDefs: Map<string, MappingDef> = new Map();

  /**
   * 注册单个组件的 transform 函数
   */
  register(componentName: string, transformFn: (node: any, context: any) => any): void {
    if (typeof componentName !== 'string' || !componentName) {
      throw new Error(`组件名必须为非空字符串，收到: ${componentName}`);
    }
    if (typeof transformFn !== 'function') {
      throw new Error(`转换函数必须为函数，收到: ${typeof transformFn}`);
    }
    this.#transforms.set(componentName, transformFn);
  }

  /**
   * 批量注册组件 transform 函数
   */
  registerAll(map: Record<string, (node: any, context: any) => any>): void {
    for (const [name, fn] of Object.entries(map)) {
      this.register(name, fn);
    }
  }

  /**
   * 加载声明式映射表
   *
   * 对每个组件：
   * - 若有 tag，注册一个声明式 transform（返回 tag/import/props）
   * - 若含 binding，存入 #bindings 供 getBinding 查询
   * - 存完整 def 到 #mappingDefs，供 applySchema 应用 propsMap/valueMap
   *
   * @param mappings  { ComponentName: { tag, import, binding?, propsMap?, valueMap?, defaults?, transform? } }
   */
  loadMappings(mappings: Record<string, MappingDef>): void {
    for (const [component, def] of Object.entries(mappings)) {
      this.#mappingDefs.set(component, def);

      if (def.binding) {
        this.#bindings.set(component, def.binding as Record<string, BindingInfo>);
      }

      // 注册 transform
      if (typeof def.transform === 'function') {
        this.#transforms.set(component, def.transform);
      } else if (def.tag) {
        // 无自定义 transform 时注册默认透传 transform
        this.#transforms.set(component, (node) => ({
          props: node.props || {},
          children: node.children || null,
        }));
      }
    }
  }

  /**
   * 应用声明式 schema（defaults 填充 + propsMap 改名 + valueMap 值转换）
   *
   * @param component 组件名
   * @param props 原 props（a2ui 名）
   * @returns 改名后的 props（浅拷贝新对象）
   */
  applySchema(component: string, props: Record<string, any>): Record<string, any> {
    const def = this.#mappingDefs.get(component);
    if (!def) return { ...(props || {}) };

    let result = { ...(props || {}) };
    if (def.defaults) result = applyDefaults(result, def.defaults);
    if (def.propsMap) result = applyPropsMap(result, def.propsMap);
    if (def.valueMap) result = applyValueMap(result, def.valueMap);
    return result;
  }

  /**
   * 查询某组件某 prop 的受控绑定元信息
   */
  getBinding(component: string, propKey: string): BindingInfo | null {
    const compBinding = this.#bindings.get(component);
    if (!compBinding) return null;
    return compBinding[propKey] || null;
  }

  /**
   * 转换一个节点
   *
   * 流程：
   *   1. 查找 transform 函数
   *   2. 如果找到 → 先 applySchema 处理 props，再调用 transform
   *   3. 从 mappingDefs 中取 tag/import 注入结果
   *   4. 从 transform 返回值中提取 stateData/componentData
   *   5. 未注册 → HTML 兜底或 default 兜底
   *
   * @param componentName 组件名
   * @param node 节点数据
   * @param opts 选项
   * @param opts.forImport 仅用于 import 收集（不调用 transform 以免副作用）
   * @param opts.rawState 注入到 transform 用于 state 访问
   * @param opts.resolveNode 递归解析器，供 transform 手动解析任意 A2UI 节点
   * @param opts.iconNameMap A2UI icon name → @nce/icon-plus 组件名映射表（由 ResolveIcons 步骤填充）
   * @returns 转换结果（含 stateData/componentData 时携带）
   */
  transform(componentName: string, node: any, opts: any = {}): TransformResult | null {
    const transformFn = this.#transforms.get(componentName);
    const def = this.#mappingDefs.get(componentName);

    // ── 已经过 transform 的 CodeGenNode（直接返回）──
    if (node.__nodeType === 'component' || node.__nodeType === 'html') {
      return node;
    }

    // ── 已注册组件 ──
    if (transformFn && def) {
      // 读取或生成 tag/import
      const tag = def.tag || componentName;
      const importPath = def.import;

      // 如果只用于 import 收集，返回一个轻量结果
      // 对于支持动态 tag/import 的组件（如 Icon），仍需调用 transform 获取真实 tag/import
      if (opts.forImport) {
        // 静态 tag/import 优先返回（性能优化：避免不必要的 transform 调用）
        if (!def.transform) {
          return { __nodeType: 'component', tag, import: importPath };
        }
        // 有自定义 transform 的组件：调用 transform 获取动态 tag/import
        // 注入与正常 transform 相同的 context（iconNameMap 等）
        const schemaProps = this.applySchema(componentName, node.props || {});
        const schemaNode = { ...node, props: schemaProps };
        try {
          const ctx = {
            rawState: opts.rawState,
            resolveNode: opts.resolveNode,
            iconNameMap: opts.iconNameMap,
          };
          const result = transformFn(schemaNode, ctx);
          return {
            __nodeType: 'component',
            tag: (result && result.tag) || tag,
            import: (result && result.import) || importPath,
            importMode: result && result.importMode,
          };
        } catch (err: any) {
          return { __nodeType: 'component', tag, import: importPath };
        }
      }

      // 1. 应用 schema 处理 props
      const schemaProps = this.applySchema(componentName, node.props || {});
      const schemaNode = { ...node, props: schemaProps };

      // 2. 调用 transform（注入 context: rawState + resolveNode + iconNameMap）
      let result: any;
      try {
        const ctx = {
          rawState: opts.rawState,
          resolveNode: opts.resolveNode,
          iconNameMap: opts.iconNameMap,
        };
        result = transformFn(schemaNode, ctx);
      } catch (err: any) {
        console.warn(`  [warn] transform 执行失败 ${componentName}:`, err.message);
        result = { props: schemaProps, children: node.children || null };
      }

      // 3. 确定最终 props（优先用 transform 输出，否则用 schemaProps）
      let finalProps: Record<string, any> =
        result.props !== undefined ? result.props : schemaProps;

      // 3a. transform 后兜底合并 defaults
      // 确保任何 transform（哪怕是完全重组 props）也不会丢弃 defaults 字段。
      // 这是 defaults 字段语义的"二次防御"：映射文件作者无需关心 transform
      // 是否透传 node.props，defaults 声明一定会出现在生成组件的 props 中。
      if (def.defaults) {
        finalProps = { ...finalProps };
        for (const [k, v] of Object.entries(def.defaults)) {
          if (!(k in finalProps)) finalProps[k] = v;
        }
      }

      // 3b. 组装 CodeGenNode（注入 tag/import）
      const codeGen: TransformResult = {
        __nodeType: 'component',
        tag: result.tag || tag,
        import: result.import || importPath,
        importMode: result.importMode,
        props: finalProps,
        children: result.children !== undefined ? result.children : (node.children || null),
        wrapper: result.wrapper || node.wrapper,
        _inlineVarProps: result._inlineVarProps,
        selfClosing: result.selfClosing,
      };

      // 4. 从 transform 返回值收集 stateData/componentData（替代旧的 stateTransform）
      if (result.stateData && typeof result.stateData === 'object') {
        codeGen.stateData = result.stateData;
      }
      if (result.componentData && typeof result.componentData === 'object') {
        codeGen.componentData = result.componentData;
      }

      return codeGen;
    }

    // ── 小写开头 → HTML 标签兜底 ──
    if (/^[a-z]/.test(componentName)) {
      return {
        __nodeType: 'html',
        tag: componentName,
        props: node.props || {},
        children: node.children || null,
        wrapper: node.wrapper,
      };
    }

    // ── 大写开头 → 默认 A2UI 组件兜底 ──
    return {
      __nodeType: 'component',
      tag: componentName,
      import: `@/components/${componentName}`,
      props: node.props || {},
      children: node.children || null,
      wrapper: node.wrapper,
    };
  }

  /**
   * 查询组件是否已注册
   */
  has(componentName: string): boolean {
    return this.#transforms.has(componentName);
  }

  /**
   * 统计组件类型
   */
  getStats(): { registeredCount: number; fallbackCount: number; htmlCount: number } {
    let registeredCount = 0;
    let fallbackCount = 0;
    let htmlCount = 0;

    for (const [name] of this.#transforms) {
      registeredCount++;
    }

    return { registeredCount, fallbackCount, htmlCount };
  }
}

// ─── Schema 应用工具函数（从旧架构迁移） ───

function applyDefaults(props: Record<string, any>, defaults: Record<string, any>): Record<string, any> {
  const result = { ...props };
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in result)) result[key] = value;
  }
  return result;
}

function applyPropsMap(props: Record<string, any>, propsMap: Record<string, string>): Record<string, any> {
  const result = { ...props };
  for (const [srcPath, target] of Object.entries(propsMap)) {
    applyPathRule(result, srcPath.split('.'), target as any, 0);
  }
  return result;
}

function applyPathRule(current: any, segments: string[], target: any, depth: number): void {
  if (current === null || current === undefined) return;
  if (Array.isArray(current)) {
    for (const item of current) applyPathRule(item, segments, target, depth);
    return;
  }
  if (typeof current !== 'object') return;

  const seg = segments[depth];
  const isLast = depth === segments.length - 1;

  if (typeof seg === 'string' && seg.startsWith('__')) return;

  if (isLast) {
    if (!(seg in current)) return;
    if (target === '__drop__') {
      delete current[seg];
    } else {
      current[target] = current[seg];
      delete current[seg];
    }
  } else {
    if (current[seg] !== undefined) {
      applyPathRule(current[seg], segments, target, depth + 1);
    }
  }
}

function applyValueMap(props: Record<string, any>, valueMap: Record<string, any>): Record<string, any> {
  const result = { ...props };
  for (const [key, rule] of Object.entries(valueMap)) {
    if (!(key in result)) continue;
    const value = result[key];
    // 跳过管线内部标记
    if (value && typeof value === 'object' &&
        (value.__type || value.__binding || value.__slotNode || value.__varRef)) {
      continue;
    }
    if (rule === 'firstOfArray') {
      if (Array.isArray(value)) result[key] = value[0];
    } else if (rule && typeof rule === 'object') {
      const mapped = rule[String(value)];
      if (mapped !== undefined) result[key] = mapped;
    }
  }
  return result;
}
/**
 * TailwindConverter — Tailwind CSS 类名 → LESS 样式转换
 *
 * 核心功能（不变）：
 *   1. collectRules(rootNode, options?) → 提取规则数组
 *   2. generateLess(rules) → 生成 LESS 字符串
 *   3. generateGlobalLess(tailwindMap) → 生成 LESS 变量文件
 *
 * 架构变更（关键）：
 *   不再直接 import { tailwindToCSS } from 'tw-to-css'，
 *   通过外部注入的 adapter.convert() 进行转换。
 *   adapter 由 src/tailwind/ 模块工厂创建，可自由切换 local/uiux 实现。
 *
 * 设计原则：
 *   - 样式提取在代码生成之前执行（确保从完整树提取所有样式）
 *   - 生成的 LESS 采用 ID 选择器（.${node.id}_style），与渲染生成的 className 匹配
 *   - 支持 hover: 变体伪类
 *   - 统计未识别的类名供告警
 */

interface StyleDeclaration {
  prop: string;
  value: string;
}

interface LessRule {
  selector: string;
  declarations: StyleDeclaration[];
}

interface ConvertPageResult {
  lessFiles: Array<{ fileName: string; content: string; moduleId: string }>;
  globalLess: string;
  pageRules: LessRule[];
  styleStats: {
    totalClasses: number;
    unrecognizedClasses: string[];
    unrecognizedCount: number;
    unrecognizedOccurrences: number;
    recognizedCount: number;
  };
}

export class TailwindConverter {
  private _adapter: { convert: (className: string) => Record<string, string> };
  private _unrecognized: Set<string>;
  private _totalClasses: number;
  private _unrecognizedOccurrences: number;
  private _classFreq: Map<string, number>;
  private _checkedClasses: Set<string>;

  /**
   * @param adapter - tailwind 转换适配器实例
   */
  constructor(adapter: { convert: (className: string) => Record<string, string> }) {
    this._adapter = adapter;
    this._unrecognized = new Set();
    this._totalClasses = 0;
    this._unrecognizedOccurrences = 0;
    this._classFreq = new Map();
    this._checkedClasses = new Set();
  }

  /**
   * 对页面节点收集 LESS 规则
   *
   * @param resolvedTree - 解析后的根树
   * @param resolvedModules - [{ id_prefix, section_id, elements }]
   * @param pageName - 页面名
   * @returns {{ lessFiles, globalLess, pageRules, styleStats }}
   */
  convertPage(resolvedTree: any, resolvedModules: any[], pageName: string): ConvertPageResult {
    this.resetStats();

    // 收集 slot 根节点 ID（模块样式各自处理）
    const slotRootIds = new Set((resolvedModules || []).map(m => m.elements[0]?.id).filter(Boolean));

    // 为每个模块生成 LESS
    const lessFiles: Array<{ fileName: string; content: string; moduleId: string }> = [];
    for (const mod of resolvedModules || []) {
      const rules: LessRule[] = [];
      for (const el of mod.elements) {
        this.collectRules(el, rules);
      }
      const less = this._generateLessContent(rules);
      const fileName = `${this._toComponentName(mod.section_id)}.less`;
      lessFiles.push({ fileName, content: less, moduleId: mod.id_prefix });
    }

    // 从 resolvedTree 收集 planner 骨架样式（排除 slot 根节点）
    const pageRules: LessRule[] = [];
    this.collectRules(resolvedTree, pageRules, slotRootIds);

    // 检查未识别的类
    this._checkUnrecognizedClasses();

    // 全局 LESS 变量
    const globalLess = this._generateVariablesLess([]);

    if (this._unrecognized.size > 0) {
      console.log(`\n[样式告警] 页面 "${pageName}" 中有 ${this._unrecognized.size} 个未转义的 Tailwind 类:`);
      for (const cls of [...this._unrecognized].sort()) {
        console.log(`  ⚠  ${cls}`);
      }
    }

    return {
      lessFiles,
      globalLess,
      pageRules,
      styleStats: {
        totalClasses: this._totalClasses,
        unrecognizedClasses: [...this._unrecognized].sort(),
        unrecognizedCount: this._unrecognized.size,
        unrecognizedOccurrences: this._unrecognizedOccurrences,
        recognizedCount: this._totalClasses - this._unrecognizedOccurrences,
      },
    };
  }

  /**
   * 收集样式规则
   */
  collectRules(node: any, rules: LessRule[], excludeIds: Set<string> | null = null): void {
    if (!node) return;
    if (excludeIds && excludeIds.has(node.id)) return;

    const selector = `.${node.id}_style`;
    const regularClasses: string[] = [];
    const hoverClasses: string[] = [];

    if (node.props && typeof node.props.className === 'string') {
      const classes = node.props.className.split(/\s+/).filter(Boolean);
      for (const cls of classes) {
        this._totalClasses++;
        this._classFreq.set(cls, (this._classFreq.get(cls) || 0) + 1);
        if (cls.startsWith('hover:')) {
          hoverClasses.push(cls.slice('hover:'.length));
        } else {
          regularClasses.push(cls);
        }
      }
    }

    const declarations: StyleDeclaration[] = [];
    if (regularClasses.length > 0) {
      const styleObj = this._adapter.convert(regularClasses.join(' '));
      declarations.push(...this._styleObjToDeclarations(styleObj));
    }

    const hoverDeclarations: StyleDeclaration[] = [];
    if (hoverClasses.length > 0) {
      const hoverStyleObj = this._adapter.convert(hoverClasses.join(' '));
      hoverDeclarations.push(...this._styleObjToDeclarations(hoverStyleObj));
    }

    if (declarations.length > 0) {
      rules.push({ selector, declarations });
    }
    if (hoverDeclarations.length > 0) {
      rules.push({ selector: `${selector}:hover`, declarations: hoverDeclarations });
    }

    if (node.children) {
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          this.collectRules(child, rules, excludeIds);
        }
      } else if (typeof node.children === 'object') {
        // BuildTrees 阶段：循环模板节点作为单 children 直接挂载（非数组）
        this.collectRules(node.children, rules, excludeIds);
      }
    }

    // 循环模板（兼容 BuildTrees 阶段与 _deepResolve 阶段两种形态）
    if (node._isLoop) {
      const template = node._loopTemplate || (node as any)._resolvedTemplate;
      if (template) {
        this.collectRules(template, rules, excludeIds);
      } else if (node.children && !Array.isArray(node.children)) {
        // BuildTrees 阶段：模板节点直接挂在 children（单个对象）
        this.collectRules(node.children, rules, excludeIds);
      }
    } else if ((node as any).__type === 'loop') {
      // _deepResolve 阶段：body 在 template.body
      if ((node as any).template && (node as any).template.body) {
        this.collectRules((node as any).template.body, rules, excludeIds);
      }
      return;  // 避免误入 template 对象的字段
    } else if ((node as any).__type === 'renderFn') {
      if ((node as any).body) {
        this.collectRules((node as any).body, rules, excludeIds);
      }
      return;
    }
  }

  // ─── 内部工具 ───

  private _camelToKebab(str: string): string {
    return str.replace(/([A-Z])/g, '-$1').toLowerCase();
  }

  private _styleObjToDeclarations(styleObj: Record<string, string>): StyleDeclaration[] {
    if (!styleObj || typeof styleObj !== 'object') return [];
    return Object.entries(styleObj).map(([key, value]) => ({
      prop: this._camelToKebab(key),
      value: String(value),
    }));
  }

  private _checkUnrecognizedClasses(): void {
    for (const [cls, freq] of this._classFreq) {
      if (this._checkedClasses.has(cls)) continue;
      this._checkedClasses.add(cls);
      const baseCls = cls.startsWith('hover:') ? cls.slice('hover:'.length) : cls;
      const styleObj = this._adapter.convert(baseCls);
      if (!styleObj || Object.keys(styleObj).length === 0) {
        this._unrecognized.add(cls);
        this._unrecognizedOccurrences += freq;
      }
    }
  }

  private _generateLessContent(rules: LessRule[]): string {
    const lines: string[] = [];
    lines.push('// Auto-generated by a2ui-transformer');
    lines.push("@import '../../../styles/variables.less';");
    lines.push('');
    for (const rule of rules) {
      lines.push(`${rule.selector} {`);
      for (const decl of rule.declarations) {
        lines.push(`  ${decl.prop}: ${decl.value};`);
      }
      lines.push('}');
      lines.push('');
    }
    return lines.join('\n');
  }

  private _generateVariablesLess(entries: Array<[string, string]>): string {
    const lines: string[] = [];
    lines.push('// Auto-generated global LESS variables');
    lines.push('');
    for (const [token, cssValue] of entries) {
      const varName = token.replace(/-/g, '_');
      lines.push(`@${varName}: ${cssValue};`);
    }
    return lines.join('\n');
  }

  private _toComponentName(sectionId: string): string {
    return sectionId.charAt(0).toUpperCase() + sectionId.slice(1);
  }

  resetStats(): void {
    this._unrecognized.clear();
    this._totalClasses = 0;
    this._unrecognizedOccurrences = 0;
    this._classFreq.clear();
    this._checkedClasses.clear();
  }
}
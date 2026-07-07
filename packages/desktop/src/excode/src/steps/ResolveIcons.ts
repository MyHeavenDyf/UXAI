/**
 * 步骤：ResolveIcons — 收集所有 icon 名称并调用接口映射到 @hui/icon-plus 组件名
 *
 * 在 BuildTrees 之后、GenerateComponents 之前执行。
 *
 * 收集范围（覆盖 A2UI 中所有可能出现的 icon 名称）：
 *   A. 节点树（resolvedTree + resolvedModules）：
 *      1. `component === 'Icon'` 节点的 `props.name`
 *      2. 任意节点 `props.icon`（字符串字面量，如 Button 的 icon prop）
 *      3. 任意节点 `props.items` 数组中元素的 `icon` 字段（字面量数组，如 Menu）
 *      4. `props.*.__slotNode` 递归（slot 节点）
 *      5. `children` 递归
 *      6. `_loopTemplate` 递归（循环模板中的 icon）
 *
 *   B. state 数据（resolvedPages[].state）：
 *      7. 递归遍历 state 中所有对象/数组，收集任意 `icon` 字段的字符串值
 *         （覆盖 menuItems[].icon、嵌套树形结构 children[].icon 等）
 *
 *   C. DataBinding 引用：
 *      8. 当节点 `props.items` 是 DataBinding（{ __binding: true, accessPath }）时，
 *         从 state 中按 accessPath 取出实际数组，再收集其中元素的 `icon` 字段
 *         （BuildTrees 已将 binding 解析为实际值，但 props.items 可能仍保留 binding 形式）
 *
 * 调用外部 API 批量查询映射，结果存入 ctx.iconNameMap。
 * 未映射的 name 使用占位图标 IconPlusIcPublicTransverseRectangleTemplate。
 *
 * 设计决策：
 *   - API 调用集中在编译期单步完成，避免 transform 内同步阻塞
 *   - 一次性批量查询所有 name，减少 API 请求次数
 *   - 占位图标保证未映射 name 仍能生成可运行代码
 *   - state 数据递归收集：保证 DataBinding 引用的树形数据中的 icon 不会遗漏
 *
 * 数据流：
 *   输入：ctx.resolvedPages[].{resolvedTree, resolvedModules, state}
 *   输出：ctx.iconNameMap = { [a2uiName]: '@hui/icon-plus 组件名' }
 */
import { Step } from '../core/Step';
import type { PipelineContext } from '../pipeline/PipelineContext';

// 占位图标组件名（与 Icon.ts 中保持一致）
const PLACEHOLDER_ICON = 'IconPlusIcPublicTransverseRectangleTemplate';

// icon 名称映射接口地址
// 接口协议：GET {ICON_API_URL}?keyword={names}&topK=2
// 返回 Array<{ icons: Array<{ name, group? }> }>
const ICON_API_URL = '/api/icons/search';

// state 递归深度上限，防止极端循环引用导致栈溢出
const MAX_STATE_DEPTH = 20;

/**
 * 将下划线格式的 icon 名称转换为 IconPlus 前缀的 PascalCase 组件名
 *
 * 转换规则：
 *   1. 去掉首尾空白
 *   2. 按下划线 _ 分段
 *   3. 每段首字母大写（PascalCase）
 *   4. 拼接后加上 IconPlus 前缀
 *
 * 示例：
 *   'ic_bpit_home'       → 'IconPlusIcBpitHome'
 *   'ic_ict_menu'        → 'IconPlusIcIctMenu'
 *   'ic_public_transverse_rectangle_template' → 'IconPlusIcPublicTransverseRectangleTemplate'
 */
function toIconComponentName(raw: string): string {
  const segments = raw.trim().split('_').filter(Boolean);
  const pascal = segments.map(seg => seg.charAt(0).toUpperCase() + seg.slice(1)).join('');
  return `IconPlus${pascal}`;
}

export class ResolveIcons extends Step {
  async execute(ctx: PipelineContext): Promise<void> {
    // 1. 收集所有 icon name（去重）
    const iconNames = new Set<string>();

    for (const resolved of ctx.resolvedPages) {
      const { resolvedTree, resolvedModules, state } = resolved as any;

      // A. 收集节点树中的 icon name（含 props.icon 字面量、props.items 字面量数组、
      //    DataBinding 引用 state 数组的 icon、children/slot/loop 递归）
      this._collectIconNames(resolvedTree, iconNames, state);

      for (const mod of resolvedModules || []) {
        for (const el of mod.elements || []) {
          this._collectIconNames(el, iconNames, state);
        }
      }

      // B. 收集 state 数据中所有 icon 字段（覆盖 menuItems[].icon、嵌套树形结构等）
      this._collectIconNamesFromState(state, iconNames, 0);
    }

    // 2. 调用 API 批量映射
    const iconNameMap: Record<string, string> = {};
    const names = Array.from(iconNames).filter(Boolean);

    if (names.length === 0) {
      ctx.iconNameMap = iconNameMap;
      return;
    }

    try {
      // 真实 API 返回的是按 names 顺序对应的英文名数组（可能含 null）
      // 返回格式如 'ic_bpit_home'，需转换为 'IconPlusIcBpitHome'
      const englishNames = await this._callIconApi(ICON_API_URL, names);
      for (let i = 0; i < names.length; i++) {
        const target = englishNames[i];
        iconNameMap[names[i]] = (typeof target === 'string' && target)
          ? toIconComponentName(target)
          : PLACEHOLDER_ICON;
      }
    } catch (err: any) {
      console.warn(`  [warn] ResolveIcons: API 调用失败 (${err.message})，使用占位图标`);
      for (const name of names) {
        iconNameMap[name] = PLACEHOLDER_ICON;
      }
    }

    ctx.iconNameMap = iconNameMap;
  }

  /**
   * 递归遍历节点树，收集所有 icon name
   *
   * @param node     - 当前节点
   * @param names    - 收集集合
   * @param pageState - 当前页面的 state（用于解析 DataBinding 引用的 items 数组）
   *
   * 收集规则：
   *   1. Icon 组件：props.name
   *   2. 任意节点 props.icon（字符串字面量，如 Button）
   *   3. 任意节点 props.items 数组中元素的 icon 字段（字面量数组）
   *   4. 当 props.items 是 DataBinding 时，从 pageState 中按 accessPath 取实际数组，
   *      再收集其中元素的 icon 字段
   *   5. 递归 children / props.*.__slotNode / _loopTemplate
   */
  private _collectIconNames(node: any, names: Set<string>, pageState: Record<string, any> | null): void {
    if (!node || typeof node !== 'object') return;

    // 字符串节点直接返回
    if (typeof node === 'string') return;

    // 1. Icon 组件节点：收集 props.name
    if (node.component === 'Icon' && node.props?.name) {
      names.add(node.props.name);
    }

    // 2. 任意节点 props.icon（字符串字面量，如 Button 的 icon prop）
    if (node.props && typeof node.props.icon === 'string') {
      names.add(node.props.icon);
    }

    // 3. 任意节点 props.items 数组（字面量形式）中元素的 icon 字段
    if (node.props?.items && Array.isArray(node.props.items)) {
      this._collectIconNamesFromArray(node.props.items, names);
    }

    // 4. 当 props.items 是 DataBinding 时，从 pageState 中按 accessPath 取实际数组
    if (node.props?.items && this._isBinding(node.props.items) && pageState) {
      const actualItems = this._resolveBindingValue(pageState, node.props.items);
      if (Array.isArray(actualItems)) {
        this._collectIconNamesFromArray(actualItems, names);
      }
    }

    // 5. 递归 children
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        this._collectIconNames(child, names, pageState);
      }
    }

    // 6. 递归 props 中的 __slotNode
    if (node.props) {
      for (const value of Object.values(node.props)) {
        if (value && typeof value === 'object' && (value as any).__slotNode) {
          this._collectIconNames((value as any).__slotNode, names, pageState);
        }
      }
    }

    // 7. 递归 _loopTemplate（循环模板中的 icon）
    if (node._loopTemplate) {
      this._collectIconNames(node._loopTemplate, names, pageState);
    }
  }

  /**
   * 从数组中收集 icon 字段（递归处理嵌套 children）
   * 用于 props.items 字面量数组和 state 中 DataBinding 解析后的数组
   */
  private _collectIconNamesFromArray(arr: any[], names: Set<string>): void {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      if (typeof item.icon === 'string') {
        names.add(item.icon);
      }
      // 递归嵌套 children（树形 menu 结构）
      if (Array.isArray(item.children)) {
        this._collectIconNamesFromArray(item.children, names);
      }
    }
  }

  /**
   * 递归遍历 state 数据，收集所有 icon 字段的字符串值
   *
   * 覆盖场景：
   *   - state.menuItems[].icon
   *   - state 中任意嵌套对象的 icon 字段
   *   - state 中树形结构（children 嵌套）的 icon 字段
   *
   * 防护：限制递归深度，避免极端循环引用导致栈溢出
   */
  private _collectIconNamesFromState(value: any, names: Set<string>, depth: number): void {
    if (depth > MAX_STATE_DEPTH) return;
    if (value === null || value === undefined) return;

    if (Array.isArray(value)) {
      for (const item of value) {
        this._collectIconNamesFromState(item, names, depth + 1);
      }
      return;
    }

    if (typeof value === 'object') {
      // 收集当前对象的 icon 字段（字符串）
      if (typeof value.icon === 'string') {
        names.add(value.icon);
      }
      // 递归所有字段（覆盖 children、items、subItems 等任意嵌套结构）
      for (const v of Object.values(value)) {
        if (v && typeof v === 'object') {
          this._collectIconNamesFromState(v, names, depth + 1);
        }
      }
    }
  }

  /**
   * 判断值是否为 DataBinding（{ __binding: true, accessPath }）
   */
  private _isBinding(value: any): boolean {
    return value && typeof value === 'object' && value.__binding === true && typeof value.accessPath === 'string';
  }

  /**
   * 从 state 中按 DataBinding 的 accessPath 取实际值
   * accessPath 格式："/menuItems" 或 "/foo/bar"（前导 / 可选）
   */
  private _resolveBindingValue(state: Record<string, any>, binding: any): any {
    const path: string = binding.accessPath || '';
    // 去掉前导 /，按 . 分段取值
    const segments = path.split('/').filter(Boolean);
    let current: any = state;
    for (const seg of segments) {
      if (current == null) return undefined;
      current = current[seg];
    }
    return current;
  }

  /**
   * 调用 icon 映射 API
   *
   * 接口协议（用户提供）：
   *   GET {iconApiUrl}?keyword={names.join(',')}&topK={topK}
   *   返回 Array<{ icons: Array<{ name: string, group?: string[] }> }>
   *   优先取 group 包含"系统图标"的 icon name，否则取第一个 icon name
   *
   * 分批策略：每批 BATCH_SIZE 个 name，并发请求所有批次
   * 返回结果按 names 顺序一一对应（未匹配项为 null）
   *
   * @param apiUrl - 接口基础 URL
   * @param names  - 所有待查询的 A2UI icon name
   * @returns 按 names 顺序对应的英文组件名数组（未匹配为 null）
   */
  protected async _callIconApi(apiUrl: string, names: string[]): Promise<(string | null)[]> {
    const BATCH_SIZE = 6;
    const TOP_K = 2;

    // 将 names 分块
    const batches: string[][] = [];
    for (let i = 0; i < names.length; i += BATCH_SIZE) {
      batches.push(names.slice(i, i + BATCH_SIZE));
    }

    // 并发处理所有批次
    const batchPromises = batches.map(async (batch) => {
      const keyword = encodeURIComponent(batch.join(','));
      const url = `${apiUrl}?keyword=${keyword}&topK=${TOP_K}`;

      try {
        const resp = await fetch(url);
        if (!resp.ok) {
          console.warn(`  [warn] ResolveIcons: 批次请求失败 HTTP ${resp.status}，批次: ${batch.join(',')}`);
          return batch.map(() => null);
        }
        const data = await resp.json();

        if (Array.isArray(data)) {
          return data.map((item: any) => {
            const systemIcon = item.icons?.find((icon: any) =>
              Array.isArray(icon.group) && icon.group.some((g: string) => g.includes('系统图标'))
            );
            return systemIcon?.name || item.icons?.[0]?.name || null;
          });
        } else {
          console.warn(`  [warn] ResolveIcons: 批次返回数据格式错误，批次: ${batch.join(',')}`);
          return batch.map(() => null);
        }
      } catch (err: any) {
        console.error(`  [error] ResolveIcons: 批次请求失败 (${err.message})，批次: ${batch.join(',')}`);
        return batch.map(() => null);
      }
    });

    // 等待所有批次完成并展平结果
    const results = await Promise.all(batchPromises);
    return results.flat();
  }
}

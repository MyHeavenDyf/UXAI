/**
 * Icon → @hui/icon-plus 映射
 *
 * A2UI Icon 组件 → @hui/icon-plus 命名导出组件。
 * 同时导出 resolveIcon / PLACEHOLDER_ICON 供其他映射文件（如 Menu.ts）使用。
 *
 * ## 核心逻辑
 *
 * 1. A2UI Icon 的 props：
 *    - name: string — 图标名称（如 "menu", "home"），需映射到 @hui/icon-plus 的组件名
 *    - shape: "outline" | "solid" — 图标风格，透传给目标组件
 *    - color: string — 颜色（可选），透传给目标组件
 *    - className: string — 样式类名，透传
 *
 * 2. 映射机制：
 *    - 通过 context.iconNameMap 查询 name → 目标组件名（如 "menu" → "IconPlusIcIctMenu"）
 *    - iconNameMap 由 ResolveIcons 步骤在管线执行时填充（调用外部接口获取）
 *    - 未映射的 name 使用占位图标 IconPlusIcPublicTransverseRectangleTemplate
 *
 * 3. 动态 tag/import：
 *    - transform 返回动态的 tag（目标组件名）和 import（@hui/icon-plus）
 *    - ComponentRegistry 允许 transform 返回值覆盖顶层 tag/import
 *
 * 4. 生成代码示例：
 *    ```jsx
 *    import { IconPlusIcIctMenu } from '@hui/icon-plus';
 *    // ...
 *    <IconPlusIcIctMenu type="lined" className="w-5 h-5" />
 *    ```
 */

// ─── 导出常量 ───

/**
 * 占位图标组件名
 *
 * 当 A2UI icon 名称在 iconNameMap 中找不到映射时使用。
 * 该组件应存在于 @hui/icon-plus 库中，作为兜底显示。
 */
export const PLACEHOLDER_ICON = 'IconPlusIcPublicTransverseRectangleTemplate';

// ─── 导出工具函数 ───

/**
 * resolveIcon — 将 A2UI icon 名称转换为 @hui/icon-plus 组件的 CodeGenNode
 *
 * @param iconName     - A2UI 中的 icon 名称（如 "menu", "home"）
 * @param iconNameMap  - icon 名称映射表（由 ResolveIcons 步骤填充）
 * @param props   - 额外 props
 * @returns CodeGenNode（__nodeType: 'component'），可直接嵌入 componentData
 *
 * 设计说明：
 *   - 返回 CodeGenNode 而非字符串，让 StateTransformer._serializeJsxVar
 *     识别 __nodeType 后调用 JsxSerializer.renderNode 渲染为 <IconPlusXxx /> JSX
 *   - importMode: 'named' 告诉 ImportCollector 生成命名导入
 *     `import { IconPlusIcIctMenu } from '@hui/icon-plus'`
 *   - 未映射的 name 使用占位图标 IconPlusIcPublicTransverseRectangleTemplate
 *   - 默认 props
 *
 * 用法（在 mapping transform 中）：
 * ```ts
 * import { resolveIcon } from './Icon';
 *
 * transform(node, { iconNameMap }) {
 *   const iconNode = resolveIcon(node.props.icon, iconNameMap);
 *   // 直接嵌入 componentData，序列化后得到 <IconPlusXxx type="lined" />
 * }
 * ```
 */
export function resolveIcon(
  iconName: string,
  iconNameMap: Record<string, string> | undefined,
  props?: Record<string, any>,
): any {
  const targetIconName = (iconNameMap && iconName && iconNameMap[iconName])
    || PLACEHOLDER_ICON;

    
    // 构造输出 props ───
    // 透传 shape、color、className，删除 name（已转换为组件名）
    const extraProps: Record<string, any> = {};

    if (props) {
      // color 透传
      if (props?.color) {
        extraProps.iconColor = props.color;
      }
  
      // className 透传
      if (props?.className) {
        extraProps.className = props.className;
      }
  
      // shape 透传（覆盖 resolveIcon 默认的 shape: 'outline'）
      if (props?.shape) {
        switch (props.shape) {
          case 'outline': extraProps.type = 'lined'; break;
          case 'fill': extraProps.type = 'filled'; break;
          case 'square': extraProps.type = 'square-bg'; break;
          case 'circle': extraProps.type = 'round-bg'; break;
          default: break;
        }
      }
      // 其他非标准 prop 透传（排除内部字段）
      for (const [key, value] of Object.entries(props)) {
        if (!['name', 'shape', 'color', 'className'].includes(key) && !key.startsWith('__')) {
          extraProps[key] = value;
        }
      }
    }

  return {
    __nodeType: 'component',
    tag: targetIconName,
    import: '@hui/icon-plus',
    importMode: 'named',
    props: {...(extraProps || {}) },
    children: null,
    selfClosing: true,
  };
}

// ─── 组件映射默认导出 ───

export default {
  // 顶层声明占位值，实际由 transform 动态覆盖
  tag: PLACEHOLDER_ICON,
  import: '@hui/icon-plus',
  importMode: 'named',

  /**
   * transform — Icon → @hui/icon-plus 组件
   *
   * context 提供：
   *   - iconNameMap: A2UI name → @hui/icon-plus 组件名映射表
   *   - rawState: A2UI 原始 state（透传）
   *   - resolveNode: 递归解析任意 A2UI 节点（透传）
   */
  transform(node: any, { iconNameMap }: { iconNameMap?: Record<string, string> }) {
    const props = node.props || {};

    // resolveIcon 处理 name → 目标组件名映射，并返回 CodeGenNode
    return resolveIcon(props.name, iconNameMap, props);
  },
};

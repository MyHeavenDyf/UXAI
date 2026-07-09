/**
 * Icon → @nce/icon-plus 映射
 *
 * A2UI Icon → @nce/icon-plus 命名导出组件。
 * 同时导出 resolveIcon / PLACEHOLDER_ICON 供其他映射使用。
 *
 * name → iconNameMap 查表映射，未命中用 PLACEHOLDER_ICON 兜底。
 * shape 映射：outline→lined, fill→filled, square→square-bg, circle→round-bg。
 */

/** 占位图标组件名，iconNameMap 中找不到映射时使用 */
export const PLACEHOLDER_ICON = 'IconPlusIcPublicTransverseRectangleTemplate';

/**
 * resolveIcon — 将 A2UI icon 名称转换为 @nce/icon-plus 组件的 CodeGenNode
 *
 * @param iconName    - A2UI icon 名称
 * @param iconNameMap - 名称映射表（由 ResolveIcons 步骤填充）
 * @param props       - 额外 props
 * @returns CodeGenNode（__nodeType: 'component'）
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
      if (props?.color) {
        extraProps.iconColor = props.color;
      }
      if (props?.className) {
        extraProps.className = props.className;
      }
      if (props?.shape) {
        switch (props.shape) {
          case 'outline': extraProps.type = 'lined'; break;
          case 'fill': extraProps.type = 'filled'; break;
          case 'square': extraProps.type = 'square-bg'; break;
          case 'circle': extraProps.type = 'round-bg'; break;
          default: break;
        }
      }
      // 非标准 prop 透传（排除内部字段）
      for (const [key, value] of Object.entries(props)) {
        if (!['name', 'shape', 'color', 'className'].includes(key) && !key.startsWith('__')) {
          extraProps[key] = value;
        }
      }
    }

  return {
    __nodeType: 'component',
    tag: targetIconName,
    import: '@nce/icon-plus',
    importMode: 'named',
    props: {...(extraProps || {}) },
    children: null,
    selfClosing: true,
  };
}

export default {
  // 占位值，由 transform 动态覆盖
  tag: PLACEHOLDER_ICON,
  import: '@nce/icon-plus',
  importMode: 'named',

  transform(node: any, { iconNameMap }: { iconNameMap?: Record<string, string> }) {
    const props = node.props || {};
    return resolveIcon(props.name, iconNameMap, props);
  },
};

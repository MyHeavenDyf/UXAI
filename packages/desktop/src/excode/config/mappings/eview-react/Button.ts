/**
 * Button → Button / IconButton 映射
 *
 * A2UI Button → eview-react Button 或 IconButton 组件。
 *
 * ## 映射规则
 *
 * - value → text，color → status，size.medium → normal
 * - 色板值（blue/purple/cyan...）→ style.backgroundColor
 * - icon + iconPlacement → leftIcon / rightIcon
 * - 纯图标按钮（有 icon 无 value）→ IconButton
 */
import { resolveIcon } from './Icon';

export default {
  tag: 'Button',
  import: '@nce/eview-react/Button',

  propsMap: {
    value: 'text',
    color: 'status',
  },

  valueMap: {
    status: {
      primary: 'primary',
      danger: 'risk',
      default: 'default',
    },
    size: {
      medium: 'normal',
      // large / small 透传
    },
  },

  defaults: {
  },

  /**
   * transform — props 转换
   */
  transform(node: any, { iconNameMap }: { iconNameMap?: Record<string, string> }) {
    const p = { ...(node.props || {}) };
    const iconMap = iconNameMap || {};

    // 纯图标按钮：有 icon 无 value → IconButton
    if ('icon' in p && !('value' in p)) {
      const iconNode = resolveIcon(p.icon, iconMap);
      return {
        tag: 'IconButton',
        import: '@nce/eview-react/IconButton',
        props: {
          iconName: { __slotNode: iconNode },
          onClick: { __rawExpr: '(e) => {}' },
        },
        children: node.children,
      };
    }

    // ─── 1. icon + iconPlacement → leftIcon / rightIcon ───
    if ('icon' in p) {
      const iconNode = resolveIcon(p.icon, iconMap);
      const placement = p.iconPlacement;
      if (placement === 'end') {
        p.rightIcon = { __slotNode: iconNode };
      } else {
        p.leftIcon = { __slotNode: iconNode };
      }
      delete p.icon;
      delete p.iconPlacement;
    }

    // ─── 2. color 色板值分流 ───
    const palette = new Set([
      'blue', 'purple', 'cyan', 'green', 'magenta',
      'pink', 'red', 'orange', 'yellow', 'volcano',
      'geekblue', 'lime', 'gold',
    ]);

    if ('status' in p && palette.has(p.status)) {
      p.style = { ...(p.style || {}), backgroundColor: p.status };
      delete p.status;
    }

    // ─── 3. 注入 onClick 占位 ───
    p.onClick = { __rawExpr: '(e) => {}' };

    return { props: p, children: node.children };
  },
};
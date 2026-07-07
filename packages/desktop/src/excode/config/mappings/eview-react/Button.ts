/**
 * Button → Button / IconButton 映射
 *
 * A2UI Button → eview-react Button 或 IconButton 组件。
 *
 * ## 映射规则（文字按钮 → Button）
 *
 * 1. value → text（改名）
 * 2. color → status（改名），再分两类：
 *    - 语义色：primary / danger(default→default) → 走 eview-react status
 *    - 色板值：blue/purple/cyan... → 转为 style.backgroundColor
 * 3. size：medium → normal（枚举映射），其余透传
 * 4. icon + iconPlacement → leftIcon / rightIcon
 * 5. disabled 默认 false
 *
 * ## 映射规则（纯图标按钮 → IconButton）
 *
 * 当节点有 icon 属性但无 value 属性时，映射到 IconButton：
 * - tag: 'IconButton', import: '@nce/eview-react/IconButton'
 * - icon → iconName（透传 Lucide icon name）
 * - 不再处理其他 prop（leftIcon/rightIcon/status 等均不适用）
 *
 * 动态覆盖依赖管线对 transform 返回的 tag/import 的支持：
 * ComponentRegistry.transform 中：
 *   tag: result.tag || def.tag
 *   import: result.import || def.import
 */
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
   *
   * 1. 纯图标按钮（有 icon 无 value）→ 返回 IconButton 分支
   * 2. icon + iconPlacement → leftIcon / rightIcon
   * 3. color 色板值分流
   */
  transform(node: any) {
    const p = { ...(node.props || {}) };

    // ─── 纯图标按钮：有 icon 但无 value → IconButton ───
    // A2UI 中 sdbHelpBtn、sdbLogoutBtn 等只有 icon 没有 value，
    // 对应 eview-react 的 IconButton 组件
    if ('icon' in p && !('value' in p)) {
      return {
        tag: 'IconButton',
        import: '@nce/eview-react/IconButton',
        props: {
          iconName: p.icon,
          onClick: { __rawExpr: '(e) => {}' },
        },
        children: node.children,
      };
    }

    // ─── 文字（+可选图标）按钮：保持 Button ───

    // ─── 1. icon + iconPlacement → leftIcon / rightIcon ───
    if ('icon' in p) {
      const placement = p.iconPlacement;
      if (placement === 'end') {
        p.rightIcon = p.icon;
      } else {
        p.leftIcon = p.icon;
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
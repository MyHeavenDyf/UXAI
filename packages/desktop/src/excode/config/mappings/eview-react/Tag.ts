/**
 * Tag → Tag 映射
 *
 * A2UI Tag → eview-react Tag 组件。
 *
 * ## 映射规则
 *
 * 1. icon → iconName（改名）
 * 2. size.medium → normal（枚举映射，small/large 透传）
 * 3. color 枚举映射：
 *    - error → danger（A2UI 用 antd 风命名，eview-react 用 danger）
 *    - processing → primary（A2UI antd 命名，eview-react 用 primary）
 *    - 其他预设（primary/success/warning/danger/caution/default）透传
 *    - HEX 色（#RRGGBB）→ style.--background（CSS 变量，自定义色优先级高于预设）
 * 4. iconName → resolveIcon 转 CodeGenNode + hasIcon 配套开关
 * 5. value 保持为 prop（详见下方"value 处理"说明）
 *
 * ## value 处理（与 docs §3.6.3 的差异）
 *
 * docs §3.6.3 范式 `value → children 文本节点` 仅适用于字面量字符串值。
 * 对于 DataBinding 值（__binding 标记）：
 *   - JsxSerializer._resolveChildren 调用 renderNode，无法渲染裸 binding 对象
 *   - 必须保留为 prop，让 JsxSerializer._generateProps._isBinding 处理
 *
 * 与 Table.ts 中手工 CodeGenNode 一致：
 *   ```
 *   <Tag color={statusTag.color} value={statusTag.text} />
 *   ```
 *
 * ## icon 处理（与 docs §9.4 + Button.ts 一致）
 *
 * 调用 resolveIcon 把 iconName 转为 CodeGenNode（@nce/icon-plus 的命名导出组件），
 * 通过 `__slotNode` 包装嵌入 iconName prop，让 JsxSerializer 渲染为 JSX。
 *
 * 同时设置 hasIcon=true 触发 eview-react Tag 的 icon 显示开关。
 *
 * 与 Button.ts 的 leftIcon/rightIcon 包装模式同构：
 *   ```
 *   // Button.ts
 *   p.leftIcon = { __slotNode: iconNode };
 *
 *   // Tag.ts
 *   outputProps.iconName = { __slotNode: iconNode };
 *   ```
 *
 * ## 实现风格
 *
 * 采用 `outputProps` 增量构造模式（与 Input.ts / Switch.ts 一致）：
 *   - `p` 仅作为输入读取，不做 in-place 变更
 *   - `outputProps` 仅包含显式设置的字段（白名单式输出）
 *   - 避免 transform 中误传 binding 未声明的 prop
 *   - style/color 的合并逻辑在 outputProps 上显式完成，可读性更佳
 */
import { resolveBindingValue } from '../../../src/core/stateUtils';
import { resolveIcon } from './Icon';


/**
 * 从 DataBinding 或字面量中提取实际值
 *
 * 返回 [actualValue, stateKey | null]
 * - actualValue: 实际数组或原始值
 * - stateKey: 如果是从 state 中取的数据，返回用于删除的 path；否则 null
 */
function resolveValue(rawState: any, prop: any): [any, string | null] {
  if (prop?.__binding) {
    const path = prop.accessPath;
    const value = resolveBindingValue(rawState, prop);
    return [value, path];
  }
  return [prop, null];
}

export default {
  tag: "Tag",
  import: "@nce/eview-react/Tag",

  propsMap: {
    icon: "iconName",
  },

  valueMap: {
    size: {
      medium: "normal",
    },
    color: {
      error: "danger", // A2UI antd 风命名 → eview-react 命名
      processing: "primary", // A2UI antd 风命名 → eview-react 命名
      // primary / success / warning / danger / caution / default 透传
    },
  },

  defaults: {},

  /**
   * transform — props 转换
   *
   * 采用 outputProps 增量构造（详见文件头"实现风格"）。
   *
   */
  transform(node: any, { rawState, iconNameMap }: { rawState?: any; iconNameMap?: Record<string, string> }) {
    const p = { ...(node.props || {}) }
    const iconMap = iconNameMap || {}
    const outputProps: Record<string, any> = {}

    // ─── 1. iconName → resolveIcon + __slotNode 包装 + hasIcon 配套开关 ───
    if ("iconName" in p) {
      const iconNode = resolveIcon(p.iconName, iconMap)
      outputProps.iconName = { __slotNode: iconNode }
      outputProps.hasIcon = true
    }

    // ─── 2. style 透传基础值（先初始化，便于后续合并 HEX color） ───
    if (p.style !== undefined) {
      outputProps.style = { ...p.style }
    }

    // ─── 3. color 处理 ───
    // valueMap 已先做枚举映射（error→danger, processing→primary）
    // HEX 色（#RRGGBB 等）→ style.--background（CSS 变量，优先级高于预设色）
    // 其他枚举值（primary/success/warning/danger/caution/default）→ 透传
    if (typeof p.color === "string") {
      outputProps.style = { ...(outputProps.style || {}), "--background": p.color }
    } else if ("color" in p) {
      outputProps.color = p.color
    }

    // ─── 4. size 透传（valueMap 已完成 medium → normal） ───
    if ("size" in p) {
      outputProps.size = p.size
    }

    // ─── 5. className 透传 ───
    if (p.className !== undefined) {
      outputProps.className = p.className
    }

    // ─── 6. value 保持为 prop（JsxSerializer._isBinding 渲染 binding 对象） ───
    if ("value" in p) {
         const [value, valuePath] = resolveValue(rawState, p.value);
      outputProps.value = p.value
    }

    return { props: outputProps, children: null }
  },
}

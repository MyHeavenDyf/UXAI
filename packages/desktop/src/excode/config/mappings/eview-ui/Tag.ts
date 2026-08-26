/**
 * Tag → Tag 映射（eview-ui bespoke）
 *
 * A2UI Tag → eview-ui Tag 组件。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-ui Tag prop | 处理方式 |
 * |-----------|------------------|---------|
 * | value（字面量/DataBinding） | children | value→children 下沉（TextNode） |
 * | color（字面量） | color | 枚举值直接透传（与 eview-react 一致），非枚举→default，#HEX 原样透传 |
 * | color（DataBinding） | color | ComputedValue + transform（运行时校验，同 eview-react） |
 * | icon | — | **丢弃**（eview-ui Tag 无 icon 属性） |
 * | size（large/medium/small） | size（large/normal） | 值映射：medium→normal, small→normal, large→large |
 * | variant（solid/filled/outlined） | className | solid/无→不加 filled（solid 样式）；filled/outlined→追加 `filled` className（outline 样式） |
 * | closable | — | **丢弃**（eview-ui status Tag 不支持关闭按钮） |
 * | closeIcon | — | 丢弃 |
 * | className | className | 透传（与 filled 合并） |
 * | — | — | 无 type prop 输出（eview-ui Tag 默认 type 即 `eui_tag_default`） |
 *
 * ## 与 eview-react 差异
 *
 * - **color 直传**：eview-react 直传 A2UI 枚举，eview-ui 同样直传（eview-ui Tag 原生支持 A2UI 枚举值，
 *   如 `color=pink` 生成 `eui_tag_pink` class）；无需 COLOR_MAP 查表映射
 * - **variant → className `filled`**：eview-react variant→`fill` prop（solid/outline），
 *   eview-ui Tag 无 `fill` prop，通过追加 `filled` className + hui-base.css 覆盖实现 outline 样式
 *   （默认无 filled class = solid；filled class = outline，对应 eview-react 的 `ev_tag_fill`）
 * - **icon 丢弃**：eview-react 映射 iconName+hasIcon，eview-ui Tag 无 icon 属性
 * - **size**：eview-ui 无 'small'，small→normal
 * - **closable 丢弃**：eview-ui Tag 不支持关闭按钮
 * - **无 type prop**：eview-ui Tag 默认 type 生效（`eui_tag_default` class），不显式设置 type
 *
 * 这是 eview-ui 专属 bespoke 映射（非工厂、非复用 eview-react）。import 硬编码 @cloudsop/eview-ui。
 */

import type {
  MappingDef,
  TransformContext,
} from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'
import { Node } from '../../../src/core/node-factory'

// ─── color 枚举校验：A2UI 枚举值直接透传，与 eview-react Tag 一致 ───
const COLOR_ENUM = new Set([
  'default', 'info', 'error', 'alert', 'warning', 'success', 'disabled',
  'green', 'rose', 'pink', 'purple', 'indigo', 'cyan',
])

// ─── size 值映射 ───
const SIZE_MAP: Record<string, string> = {
  small: 'normal',  // eview-ui 无 small，回退 normal
  medium: 'normal',
  large: 'large',
}

// ─── Tag 映射定义 ───

const TagMapping: MappingDef = {
  tag: 'Tag',
  import: '@cloudsop/eview-ui/Tag',

  transform(node: any, _ctx: TransformContext) {
    const props = node.props || {}
    const outputProps: Record<string, PropValue> = {}
    let childrenVal: any = null

    // 显性处理每个 A2UI prop：A2UI Tag 的 props 是封闭集合
    // (value/color/icon/size/variant/closable/closeIcon/className)，不做兜底透传。

    // ─── value → children（双形态） ───
    if ('value' in props) {
      const val = props.value
      if (val && typeof val === 'object' && val.type === 'binding') {
        childrenVal = val
      } else if (typeof val === 'string') {
        childrenVal = val
      }
    }

    // ─── color（枚举直传，双形态） ───
    if (props.color) {
      const c = props.color
      if (typeof c === 'string') {
        // #HEX 原样透传；枚举值直传；非枚举回退 default
        if (c.startsWith('#')) {
          outputProps.color = c
        } else {
          outputProps.color = COLOR_ENUM.has(c) ? c : 'default'
        }
      } else if (c && typeof c === 'object' && c.type === 'binding') {
        // DataBinding → ComputedValue（运行时校验，同 eview-react）
        outputProps.color = Value.computed({
          path: c.path,
          pathType: c.pathType ?? 'absolute',
          accessPath: c.accessPath ?? 'tagColor',
          containsJSX: false,
          transform: (raw: any) => {
            if (typeof raw !== 'string') return 'default'
            if (raw.startsWith('#')) return raw
            return COLOR_ENUM.has(raw) ? raw : 'default'
          },
        })
      } else {
        outputProps.color = 'default'
      }
    } else {
      outputProps.color = 'default'
    }

    // ─── icon — 丢弃（eview-ui Tag 无 icon 属性） ───

    // ─── size 值映射（eview-ui 无 small，small→normal） ───
    if (props.size && typeof props.size === 'string') {
      const mapped = SIZE_MAP[props.size]
      if (mapped) {
        outputProps.size = mapped
      }
    }

    // ─── variant → className `filled` ───
    // A2UI Tag 默认 solid 形态（无 filled class → CSS 走 solid 样式）
    // variant: filled / outlined → 追加 'filled' className，CSS 走 outline/淡底样式
    // 对应 eview-react：fill: 'solid' 无 ev_tag_fill / fill: 'outline' 有 ev_tag_fill
    // 注意：color=default 只有一种形态，不受 variant 影响，不追加 filled
    const classNameParts: string[] = []
    const variant = props.variant
    const isDefaultColor = !props.color || props.color === 'default'
    if (!isDefaultColor && (variant === 'filled' || variant === 'outlined')) {
      classNameParts.push('filled')
    }

    // ─── closable — 丢弃（eview-ui Tag 不支持关闭按钮） ───
    // ─── closeIcon — 丢弃 ───

    // ─── className 透传（与 filled 合并） ───
    if (props.className && typeof props.className === 'string') {
      classNameParts.push(props.className)
    }
    if (classNameParts.length > 0) {
      outputProps.className = classNameParts.join(' ')
    }

    // 不做剩余兜底透传：A2UI Tag 的 props 已逐项显性处理。

    return {
      props: outputProps,
      children: childrenVal !== null ? [Node.text({ value: childrenVal })] : null,
    }
  },
}

export default TagMapping

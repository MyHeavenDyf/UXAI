/**
 * Dropdown → DropDown / PopUpMenu 映射（新架构）
 *
 * A2UI Dropdown 按字面量 menu 项是否含 `children`（子菜单）分两支：
 *   - **无 children** → eview-react `DropDown`（一级下拉，data 数组）
 *   - **有 children** → eview-react `PopUpMenu`（多级下拉，options 含递归 submenus）
 *
 * 分支判定依据是 **menu 项的 `children` 属性**（schema `$defs/MenuItem` 的递归子菜单数组），
 * **不是** Dropdown 元素顶层的 `children`（那个是触发器）。即：menu 数组里**任意一项**带非空
 * `children` 即走 PopUpMenu 分支。
 *
 * ## 判定时机（两条路径）
 *
 * - **字面量 menu**：transform 期（NodeMapper）直接 inspect items 决定分支——数据就在手边，
 *   无需 defer。tag 在 TransformResult 上定死（`result.tag ?? def.tag`）。
 * - **DataBinding menu**：transform 期数据未解析（相对路径更取不到）→ **deferred 到 CV transform**
 *   （state-builder 期，有真实运行时数据）。统一产 `data` CV + 默认 DropDown tag，CV transform 按
 *   `hasChildren(rawData)` 写 `ctx.override` 切 tag/import/renameProps/deleteProps——**绝对+相对路径
 *   同机制**（调用点 1 绝对 / 调用点 2 相对都已接通 override），替掉旧 `resolveAbsoluteStateValue`
 *   workaround（那套只认绝对路径、相对路径 fallback DropDown）。
 *
 * ## override 旁路（binding menu）
 *
 * CV transform 跑时（state-builder，consumeValue / applyScopedCV）按运行时数据：
 *   - **有 children** → `ctx.override = { tag:'PopUpMenu', import, renameProps:{data:'options'},
 *     deleteProps:['position','popupDirection','trigger'] }` + return `convertMenuItemsPopUp`（iconUrl/submenus）。
 *   - **无 children** → `ctx.override = { deleteProps:['direction','hDirection'] }` + return `convertMenuItems`（icon）。
 *
 * placement：binding 无法预判分支 → DropDown 的 `position/popupDirection` 与 PopUpMenu 的
 * `direction/hDirection` **两套都 emit**，override.deleteProps 删非适用那套。trigger 同理
 * （PopUpMenu 时 override 删 trigger）。横向 6 值命不中的那套本就不 emit → fallback 组件默认。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 *-----------|-----------------|---------|
 * | menu（字面量，无 children） | data | label→text、key→value、icon→resolveIcon（DropDown 一级） |
 * | menu（字面量，含 children） | options | label→text、key→value、icon→resolveIcon→**iconUrl**、children→**submenus** 递归（PopUpMenu） |
 * | menu（DataBinding） | data（DropDown）/ options（PopUpMenu） | **ComputedValue**（统一 data CV，transform 期定；CV transform 按 hasChildren 切形态 + override 改名 data→options）；tag 由 override 切 |
 * | placement（DropDown） | position + popupDirection | antd 值→eview-react 拆分映射（仅 6 纵向值） |
 * | placement（PopUpMenu） | direction + hDirection | antd 值→eview-react 拆分映射（仅 6 纵向值；prop 名/枚举与 DropDown 不同） |
 * | trigger（数组） | trigger | 取首项（**仅 DropDown 分支**；PopUpMenu 触发固定 click，override 删） |
 * | children | children | 透传（DropDown / PopUpMenu 均以 children 作触发元素） |
 * | className | className | 透传 |
 *
 * ## placement 映射（纵向 6 值；横向 6 值命不中 → 不 emit → 走组件默认 auto）
 *
 * DropDown 的 `position`(left/right/auto) 是水平对齐、`popupDirection`(top/bottom/auto) 是垂直方向；
 * PopUpMenu 的 `direction`(up/down/auto) 是垂直方向、`hDirection`(left/right/auto) 是水平对齐。
 * 两者都只能表达「纵向弹出 + 水平对齐」那 6 个 antd 值（top/bottom/topLeft/topRight/
 * bottomLeft/bottomRight）。横向弹出的 6 个（left/right/leftTop/leftBottom/rightTop/rightBottom）
 * 在 eview-react 组件层无对应 → fallback 到组件默认（auto）。
 *
 * ## 特殊逻辑
 *
 * - 字面量分支由 `hasNestedChildren(menu)`（任意项含非空 children）判定，transform 期定 tag。
 * - binding 分支由 CV transform 在 state-builder 期按运行时数据判定，写 `ctx.override` 切
 *   tag/import/renameProps/deleteProps（见「override 旁路」）。无需 transform 期 inspect state。
 * - PopUpMenu 的 trigger 固定 click（文档「触发方式固定为 click」），故 PopUpMenu 分支丢弃 trigger
 *   （字面量分支不 emit；binding 分支 emit 后 override 删）。
 * - children 透传：DropDown / PopUpMenu 均以 children 作触发元素，transform 不返回 children →
 *   管线沿用原始 node.children。
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'

// ─── placement 映射表（DropDown：position + popupDirection） ───
const PLACEMENT_MAP: Record<string, { position: string; popupDirection: string }> = {
  bottom:      { position: 'auto', popupDirection: 'bottom' },
  bottomLeft:  { position: 'left', popupDirection: 'bottom' },
  bottomRight: { position: 'right', popupDirection: 'bottom' },
  top:         { position: 'auto', popupDirection: 'top' },
  topLeft:     { position: 'left', popupDirection: 'top' },
  topRight:    { position: 'right', popupDirection: 'top' },
}

// ─── placement 映射表（PopUpMenu：direction + hDirection；枚举值与 DropDown 不同） ───
// 注意：PopUpMenu 的垂直方向枚举是 up/down（DropDown 是 top/bottom）；水平对齐 prop 名是 hDirection（DropDown 是 position）。
const PLACEMENT_MAP_POPUP: Record<string, { direction: string; hDirection: string }> = {
  bottom:      { direction: 'down', hDirection: 'auto' },
  bottomLeft:  { direction: 'down', hDirection: 'left' },
  bottomRight: { direction: 'down', hDirection: 'right' },
  top:         { direction: 'up',   hDirection: 'auto' },
  topLeft:     { direction: 'up',   hDirection: 'left' },
  topRight:    { direction: 'up',   hDirection: 'right' },
}

/** menu 项是否含非空 children 子菜单（任意一项命中即 true） */
function hasNestedChildren(items: any[]): boolean {
  if (!Array.isArray(items)) return false
  return items.some((it: any) => Array.isArray(it.children) && it.children.length > 0)
}

/** 递归转换 menu items → DropDown data（label→text, key→value, icon→resolveIcon；一级，不递归 children） */
function convertMenuItems(
  items: any[],
  rIcon: (name: string) => any,
): any[] {
  if (!Array.isArray(items)) return []
  return items.map((item: any) => {
    const out: Record<string, any> = {
      text: item.label,
      value: item.key,
    }
    if (item.icon) {
      const iconNode = rIcon(item.icon)
      if (iconNode) out.icon = iconNode
    }
    return out
  })
}

/** 递归转换 menu items → PopUpMenu options（label→text, key→value, icon→resolveIcon→iconUrl, children→submenus 递归） */
function convertMenuItemsPopUp(
  items: any[],
  rIcon: (name: string) => any,
): any[] {
  if (!Array.isArray(items)) return []
  return items.map((item: any) => {
    const out: Record<string, any> = {
      text: item.label,
      value: item.key,
    }
    if (item.icon) {
      const iconNode = rIcon(item.icon)
      if (iconNode) out.iconUrl = iconNode   // PopUpMenu OptionType 用 iconUrl（非 DropDown 的 icon）
    }
    if (Array.isArray(item.children) && item.children.length > 0) {
      out.submenus = convertMenuItemsPopUp(item.children, rIcon)   // 递归子菜单（同形）
    }
    return out
  })
}

export function createDropdownMapping(pkg: string): MappingDef {
  return {
    tag: 'DropDown',
    import: `${pkg}/DropDown`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}

      // 显性处理每个 A2UI prop：A2UI Dropdown 的 props 是封闭集合
      // (placement/trigger/menu/className)，不做兜底透传。

      const menuIsBinding = props.menu && typeof props.menu === 'object' && props.menu.type === 'binding'

      // ════════════════════════════════════════════════════════════════
      // DataBinding menu：分支判定 deferred 到 CV transform（state-builder 期，有真实数据）。
      // 统一产 data CV + 默认 DropDown tag；CV transform 按 hasChildren 写 ctx.override 切
      // tag/import/renameProps(data→options)/deleteProps（绝对+相对路径同机制，替掉
      // resolveAbsoluteStateValue workaround——相对路径也能正确切 PopUpMenu）。
      // ════════════════════════════════════════════════════════════════
      if (menuIsBinding) {
        outputProps.data = Value.computed({
          path: props.menu.path,
          pathType: props.menu.pathType ?? 'absolute',
          accessPath: props.menu.accessPath ?? 'dropdownData',
          containsJSX: true,
          transform: (rawData: any, cvCtx?: any) => {
            const rIcon = cvCtx?.resolveIcon ?? ctx.resolveIcon
            const items = Array.isArray(rawData) ? rawData : []
            if (hasNestedChildren(items)) {
              // → PopUpMenu：切 tag/import、data→options、删 DropDown 专属 placement + trigger
              if (cvCtx) cvCtx.override = {
                tag: 'PopUpMenu',
                import: `${pkg}/PopUpMenu`,
                renameProps: { data: 'options' },
                deleteProps: ['position', 'popupDirection', 'trigger'],
              }
              return convertMenuItemsPopUp(items, rIcon)
            }
            // → DropDown：删 PopUpMenu 专属 placement（tag/import/prop 名不变）
            if (cvCtx) cvCtx.override = { deleteProps: ['direction', 'hDirection'] }
            return convertMenuItems(items, rIcon)
          },
        })

        // placement 两套都 emit（binding 无法预判分支；override.deleteProps 删非适用那套）。
        // 横向 6 值命不中的那套本就不 emit → fallback 组件默认 auto。
        if (props.placement) {
          const d = PLACEMENT_MAP[props.placement]
          if (d) {
            outputProps.position = d.position as PropValue
            outputProps.popupDirection = d.popupDirection as PropValue
          }
          const p = PLACEMENT_MAP_POPUP[props.placement]
          if (p) {
            outputProps.direction = p.direction as PropValue
            outputProps.hDirection = p.hDirection as PropValue
          }
        }

        // trigger emit（PopUpMenu 时 override 删；PopUpMenu 触发固定 click）
        if (props.trigger && Array.isArray(props.trigger) && props.trigger.length > 0) {
          outputProps.trigger = props.trigger[0] as PropValue
        }

        if (props.className) outputProps.className = props.className as PropValue

        // tag 不覆盖 → MappingDef.tag=DropDown；override 在 state-builder 切到 PopUpMenu
        return { props: outputProps }
      }

      // ════════════════════════════════════════════════════════════════
      // 字面量 menu：transform 期 inspect 决定分支（数据就在手边，无需 defer）
      // ════════════════════════════════════════════════════════════════
      const usePopUp = Array.isArray(props.menu) && hasNestedChildren(props.menu)

      // ─── 分支 A：字面量含 children → PopUpMenu（多级下拉）───
      if (usePopUp) {
        // menu → options（label→text / key→value / icon→resolveIcon→iconUrl / children→submenus 递归）
        outputProps.options = convertMenuItemsPopUp(props.menu, ctx.resolveIcon) as any

        // placement → direction + hDirection（PopUpMenu prop 名/枚举与 DropDown 不同）
        if (props.placement) {
          const mapped = PLACEMENT_MAP_POPUP[props.placement]
          if (mapped) {
            outputProps.direction = mapped.direction as PropValue
            outputProps.hDirection = mapped.hDirection as PropValue
          }
          // 横向 6 值命不中 → 不 emit → 走组件默认 auto/auto
        }

        // trigger 丢弃：PopUpMenu 触发方式固定 click（文档约定），不透传 A2UI trigger。

        if (props.className) outputProps.className = props.className as PropValue

        // 不返回 children → 管线沿用原始 node.children 作触发元素（PopUpMenu children 必填 = 触发器）。
        return {
          tag: 'PopUpMenu',
          import: `${pkg}/PopUpMenu`,
          props: outputProps,
        }
      }

      // ─── 分支 B：字面量无 children → DropDown（一级下拉）───

      // ─── menu → data ───
      if (Array.isArray(props.menu)) {
        outputProps.data = convertMenuItems(props.menu, ctx.resolveIcon) as any
      }

      // ─── placement → position + popupDirection ───
      if (props.placement) {
        const mapped = PLACEMENT_MAP[props.placement]
        if (mapped) {
          outputProps.position = mapped.position as PropValue
          outputProps.popupDirection = mapped.popupDirection as PropValue
        }
        // 横向 6 值命不中 → 不 emit → 走组件默认 auto
      }

      // ─── trigger（数组）→ trigger（单值）───
      if (props.trigger && Array.isArray(props.trigger) && props.trigger.length > 0) {
        outputProps.trigger = props.trigger[0] as PropValue
      }

      // ─── className ───
      if (props.className) outputProps.className = props.className as PropValue

      // 不做剩余兜底透传：A2UI Dropdown 的 props 已逐项显性处理。
      return {
        props: outputProps,
      }
    },
  }
}

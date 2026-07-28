/**
 * eview-react 组件映射注册入口（新架构）
 *
 * 每个组件映射文件导出一个工厂函数 createXxxMapping(pkg)，接收目标组件库包名
 * 构建 import 路径。本入口声明本地 `pkg`（@nce/eview-react）与 `iconPkg`
 * （@nce/icon-plus，eview-react 配套图标库），调用各工厂装配出 MappingDef 集合。
 *
 * 工厂化使 eview-ui 可复用同一批工厂（仅换 pkg/iconPkg），见 ../eview-ui/index.ts。
 * 工厂定义仍留在此目录（eview-react 为参考实现）；eview-ui 是特例复用。
 */

import { createBadgeMapping } from './Badge'
import { createBreadcrumbMapping } from './Breadcrumb'
import { createButtonMapping } from './Button'
import { createCarouselMapping } from './Carousel'
import { createCheckboxMapping } from './Checkbox'
import { createCheckboxGroupMapping } from './CheckboxGroup'
import { createCollapseMapping } from './Collapse'
import { createCollapseItemMapping } from './CollapseItem'
import { createDatePickerMapping } from './DatePicker'
import { createDividerMapping } from './Divider'
import { createDropdownMapping } from './Dropdown'
import { createIconMapping } from './Icon'
import { createInputMapping } from './Input'
import { createInputNumberMapping } from './InputNumber'
import { createMenuMapping } from './Menu'
import { createProgressMapping } from './Progress'
import { createRadioGroupMapping } from './RadioGroup'
import { createRateMapping } from './Rate'
import { createSegmentedMapping } from './Segmented'
import { createSelectMapping } from './Select'
import { createSliderMapping } from './Slider'
import { createStepsMapping } from './Steps'
import { createSwitchMapping } from './Switch'
import { createTabItemMapping } from './TabItem'
import { createTableMapping } from './Table'
import { createTabsMapping } from './Tabs'
import { createTagMapping } from './Tag'
import { createTextAreaMapping } from './TextArea'
import { createTimePickerMapping } from './TimePicker'
import { createTimelineMapping } from './Timeline'
import { createTreeMapping } from './Tree'
import { createChartMapping } from './Chart'

/** 目标组件库包名（本地常量，传给各工厂） */
const pkg = '@nce/eview-react'

/** eview-react 配套图标库包名（命名导出，供 registerComponents 注入 iconCollection） */
export const iconPkg = '@nce/icon-plus'

// 图表组件统一映射（全部指向 Chart 工厂）
function chartMappings(p: string): Record<string, ReturnType<typeof createChartMapping>> {
  const chart = createChartMapping(p)
  return {
    BarChart: chart,
    LineChart: chart,
    PieChart: chart,
    RadarChart: chart,
    ScatterChart: chart,
    BubbleChart: chart,
    AssembleBubbleChart: chart,
    BulletChart: chart,
    FunnelChart: chart,
    GaugeChart: chart,
    HillChart: chart,
    JadeJueChart: chart,
    ProcessChart: chart,
    CircleProcessChart: chart,
  }
}

export default {
  Badge: createBadgeMapping(pkg),
  Breadcrumb: createBreadcrumbMapping(pkg),
  Button: createButtonMapping(pkg),
  Carousel: createCarouselMapping(pkg),
  Checkbox: createCheckboxMapping(pkg),
  CheckboxGroup: createCheckboxGroupMapping(pkg),
  Collapse: createCollapseMapping(pkg),
  CollapseItem: createCollapseItemMapping(pkg),
  DatePicker: createDatePickerMapping(pkg),
  Divider: createDividerMapping(pkg),
  Dropdown: createDropdownMapping(pkg),
  Icon: createIconMapping(pkg),
  Input: createInputMapping(pkg),
  InputNumber: createInputNumberMapping(pkg),
  Menu: createMenuMapping(pkg),
  Progress: createProgressMapping(pkg),
  RadioGroup: createRadioGroupMapping(pkg),
  Rate: createRateMapping(pkg),
  Segmented: createSegmentedMapping(pkg),
  Select: createSelectMapping(pkg),
  Slider: createSliderMapping(pkg),
  Steps: createStepsMapping(pkg),
  Switch: createSwitchMapping(pkg),
  TabItem: createTabItemMapping(pkg),
  Table: createTableMapping(pkg),
  Tabs: createTabsMapping(pkg),
  Tag: createTagMapping(pkg),
  TextArea: createTextAreaMapping(pkg),
  TimePicker: createTimePickerMapping(pkg),
  Timeline: createTimelineMapping(pkg),
  Tree: createTreeMapping(pkg),
  // 图表组件（14 类统一映射到 Chart）
  ...chartMappings(pkg),
}

/**
 * eview-ui 组件映射注册入口
 *
 * eview-ui 与 eview-react 基本同一套组件库（tag 名一致），仅包名 + 图标库包名不同。
 * **特例复用** eview-react 工厂（换 pkg/iconPkg），分四类：
 *   1. 工厂复用 pkg=@cloudsop/eview-ui（eview-ui 包自带、且**不涉及 icon 属性**的组件）
 *   2. 工厂复用 sharedPkg=@/shared（eview-ui 无、且不涉及 icon：Badge/Tag/Divider/Chart）
 *   3. bespoke（eview-ui 与 eview-react 的 API 差异，独立 default-export MappingDef：DatePicker/Rate/Switch→Toggle/TextArea/Button/Steps/Progress/Dropdown）
 *   4. 本地工厂副本（**涉及 icon 属性**的组件：Input/Menu/TabItem/Timeline/Tree）——
 *      eview-ui 的 icon 相关属性只接 URL、不接 React DOM，与 eview-react 差异显著，故不再复用
 *      eview-react 工厂。当前文件**原样复制**自 eview-react 工厂（行为暂与 eview-react 一致），
 *      待按 icon-URL 差异就地改造。改造前为纯副本，行为零变化。
 *
 * ⚠️ 此复用模式是 eview-ui 特例。未来别的组件库不复用 eview-react，各自独立。
 */

import { createBadgeMapping } from '../eview-react/Badge'
import { createBreadcrumbMapping } from '../eview-react/Breadcrumb'
import Button from './Button'
import { createCarouselMapping } from '../eview-react/Carousel'
import { createChartMapping } from '../eview-react/Chart'
import { ALL_CHART_NAMES } from '../../chartDefaults'
import { createCheckboxMapping } from '../eview-react/Checkbox'
import { createCheckboxGroupMapping } from '../eview-react/CheckboxGroup'
import { createCollapseMapping } from '../eview-react/Collapse'
import { createCollapseItemMapping } from '../eview-react/CollapseItem'
import { createDividerMapping } from '../eview-react/Divider'
import { createDrawerMapping } from '../eview-react/Drawer'
import DatePicker from './DatePicker'
import Dropdown from './Dropdown'
import { createIconMapping } from '../eview-react/Icon'
import { createInputMapping } from './Input'
import { createInputNumberMapping } from '../eview-react/InputNumber'
import { createMenuMapping } from './Menu'
import { createModalMapping } from '../eview-react/Modal'
import { createPaginationMapping } from '../eview-react/Pagination'
import Progress from './Progress'
import { createRadioGroupMapping } from '../eview-react/RadioGroup'
import Rate from './Rate'
import { createSegmentedMapping } from '../eview-react/Segmented'
import { createSelectMapping } from '../eview-react/Select'
import { createSliderMapping } from '../eview-react/Slider'
import Steps from './Steps'
import Switch from './Switch'
import { createTabItemMapping } from './TabItem'
import { createTableMapping } from '../eview-react/Table'
import { createTabsMapping } from '../eview-react/Tabs'
import { createTagMapping } from '../eview-react/Tag'
import TextArea from './TextArea'
import { createTimePickerMapping } from '../eview-react/TimePicker'
import { createTimelineMapping } from './Timeline'
import { createTreeMapping } from './Tree'

const pkg = '@cloudsop/eview-ui'
const sharedPkg = '@/shared'

// 图表组件统一映射（ALL_CHART_NAMES 全集指向 Chart 工厂；无默认的图表不 merge 默认，见 chartDefaults）
function chartMappings(p: string): Record<string, ReturnType<typeof createChartMapping>> {
  const chart = createChartMapping(p)
  return Object.fromEntries(ALL_CHART_NAMES.map((name) => [name, chart]))
}

/** eview-ui 配套图标库包名（供 registerComponents 注入 iconCollection） */
export const iconPkg = '@hui/icon-plus'

export default {
  Badge: createBadgeMapping(sharedPkg),
  Breadcrumb: createBreadcrumbMapping(pkg),
  Button,
  Carousel: createCarouselMapping(pkg),
  Chart: createChartMapping(sharedPkg),
  Checkbox: createCheckboxMapping(pkg),
  CheckboxGroup: createCheckboxGroupMapping(pkg),
  Collapse: createCollapseMapping(pkg),
  CollapseItem: createCollapseItemMapping(pkg),
  DatePicker,
  Divider: createDividerMapping(sharedPkg),
  Drawer: createDrawerMapping(pkg),
  Dropdown,
  Icon: createIconMapping(pkg),
  Input: createInputMapping(pkg),
  InputNumber: createInputNumberMapping(pkg),
  Menu: createMenuMapping(pkg),
  Modal: createModalMapping(pkg),
  Pagination: createPaginationMapping(pkg),
  Progress,
  RadioGroup: createRadioGroupMapping(pkg),
  Rate,
  Segmented: createSegmentedMapping(pkg),
  Select: createSelectMapping(pkg),
  Slider: createSliderMapping(pkg),
  Steps,
  Switch,
  TabItem: createTabItemMapping(pkg),
  Table: createTableMapping(pkg),
  Tabs: createTabsMapping(pkg),
  Tag: createTagMapping(sharedPkg),
  TextArea,
  TimePicker: createTimePickerMapping(pkg),
  Timeline: createTimelineMapping(pkg),
  Tree: createTreeMapping(pkg),
  ...chartMappings(sharedPkg),
}

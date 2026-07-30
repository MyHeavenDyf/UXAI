/**
 * eview-ui 组件映射注册入口
 *
 * eview-ui 与 eview-react 基本同一套组件库（tag 名一致），仅包名 + 图标库包名不同。
 * **特例复用** eview-react 工厂（换 pkg/iconPkg），分三类：
 *   1. 工厂复用 pkg=@cloudsop/eview-ui（eview-ui 包自带，20 个）
 *   2. 工厂复用 sharedPkg=@/shared（eview-ui 无，templates 手动实现，4 个：Badge/Tag/Divider/Chart）
 *   3. bespoke（API 差异，独立 MappingDef，8 个：DatePicker/Rate/Switch→Toggle/TextArea/Button/Steps/Progress/Dropdown）
 *
 * ⚠️ 此复用模式是 eview-ui 特例。未来别的组件库不复用 eview-react，各自独立。
 */

import { createBadgeMapping } from '../eview-react/Badge'
import { createBreadcrumbMapping } from '../eview-react/Breadcrumb'
import Button from './Button'
import { createCarouselMapping } from '../eview-react/Carousel'
import { createChartMapping } from '../eview-react/Chart'
import { createCheckboxMapping } from '../eview-react/Checkbox'
import { createCheckboxGroupMapping } from '../eview-react/CheckboxGroup'
import { createCollapseMapping } from '../eview-react/Collapse'
import { createCollapseItemMapping } from '../eview-react/CollapseItem'
import { createDividerMapping } from '../eview-react/Divider'
import DatePicker from './DatePicker'
import Dropdown from './Dropdown'
import { createIconMapping } from '../eview-react/Icon'
import { createInputMapping } from '../eview-react/Input'
import { createInputNumberMapping } from '../eview-react/InputNumber'
import { createMenuMapping } from '../eview-react/Menu'
import Progress from './Progress'
import { createRadioGroupMapping } from '../eview-react/RadioGroup'
import Rate from './Rate'
import { createSegmentedMapping } from '../eview-react/Segmented'
import { createSelectMapping } from '../eview-react/Select'
import { createSliderMapping } from '../eview-react/Slider'
import Steps from './Steps'
import Switch from './Switch'
import { createTabItemMapping } from '../eview-react/TabItem'
import { createTableMapping } from '../eview-react/Table'
import { createTabsMapping } from '../eview-react/Tabs'
import { createTagMapping } from '../eview-react/Tag'
import TextArea from './TextArea'
import { createTimePickerMapping } from '../eview-react/TimePicker'
import { createTimelineMapping } from '../eview-react/Timeline'
import { createTreeMapping } from '../eview-react/Tree'

const pkg = '@cloudsop/eview-ui'
const sharedPkg = '@/shared'

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
  Dropdown,
  Icon: createIconMapping(pkg),
  Input: createInputMapping(pkg),
  InputNumber: createInputNumberMapping(pkg),
  Menu: createMenuMapping(pkg),
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

/**
 * eview-react 组件映射注册入口（新架构）
 *
 * 手动导入每个组件的映射定义并集中导出。
 * 新组件映射在此注册后即可被管线自动发现。
 */

import { default as Badge } from './Badge'
import { default as Breadcrumb } from './Breadcrumb'
import { default as Button } from './Button'
import { default as Carousel } from './Carousel'
import { default as Checkbox } from './Checkbox'
import { default as CheckboxGroup } from './CheckboxGroup'
import { default as Collapse } from './Collapse'
import { default as CollapseItem } from './CollapseItem'
import { default as DatePicker } from './DatePicker'
import { default as Dropdown } from './Dropdown'
import { default as Icon } from './Icon'
import { default as Divider } from './Divider'
import { default as Menu } from './Menu'
import { default as Segmented } from './Segmented'
import { default as Switch } from './Switch'
import { default as TabItem } from './TabItem'
import { default as Table } from './Table'
import { default as Tabs } from './Tabs'
import { default as Input } from './Input'
import { default as InputNumber } from './InputNumber'
import { default as Progress } from './Progress'
import { default as RadioGroup } from './RadioGroup'
import { default as Rate } from './Rate'
import { default as Select } from './Select'
import { default as Slider } from './Slider'
import { default as Steps } from './Steps'
import { default as Tag } from './Tag'
import { default as TextArea } from './TextArea'
import { default as TimePicker } from './TimePicker'
import { default as Timeline } from './Timeline'
import { default as Tree } from './Tree'
import { default as Chart } from './Chart'

// 图表组件统一映射（全部指向 Chart）
const chartMappings: Record<string, typeof Chart> = {
  BarChart: Chart,
  LineChart: Chart,
  PieChart: Chart,
  RadarChart: Chart,
  ScatterChart: Chart,
  BubbleChart: Chart,
  AssembleBubbleChart: Chart,
  BulletChart: Chart,
  FunnelChart: Chart,
  GaugeChart: Chart,
  HillChart: Chart,
  JadeJueChart: Chart,
  ProcessChart: Chart,
  CircleProcessChart: Chart,
}

export default {
  Badge,
  Breadcrumb,
  Button,
  Carousel,
  Checkbox,
  CheckboxGroup,
  Collapse,
  CollapseItem,
  DatePicker,
  Divider,
  Dropdown,
  Icon,
  Input,
  InputNumber,
  Menu,
  Progress,
  RadioGroup,
  Rate,
  Segmented,
  Select,
  Slider,
  Steps,
  Switch,
  TabItem,
  Table,
  Tabs,
  Tag,
  TextArea,
  TimePicker,
  Timeline,
  Tree,
  // 图表组件（14 类统一映射到 Chart）
  ...chartMappings,
  // 后续组件按字母顺序添加
}
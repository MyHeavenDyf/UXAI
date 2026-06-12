import A2UiCheckbox from "./Checkbox/Checkbox.vue"
import A2UiCheckboxGroup from "./CheckboxGroup/CheckboxGroup.vue"
import A2UiDatePicker from "./DatePicker/DatePicker.vue"
import A2UiInput from "./Input/Input.vue"
import A2UiInputNumber from "./InputNumber/InputNumber.vue"
import A2UiRadioGroup from "./RadioGroup/RadioGroup.vue"
import A2UiSelect from "./Select/Select.vue"
import A2UiSlider from "./Slider/Slider.vue"
import A2UiSwitch from "./Switch/Switch.vue"
import A2UiTextArea from "./TextArea/TextArea.vue"
import A2UiTimePicker from "./TimePicker/TimePicker.vue"

import A2UiButton from "./Button/Button.vue"
import A2UiIcon from "./Icon/Icon.vue"
import A2UiSteps from "./Steps/Steps.vue"

import A2UiDivider from "./Divider/Divider.vue"
import A2UiCollapse from "./Collapse/Collapse.vue"
import A2UiTable from "./Table/Table.vue"
import A2UiTag from "./Tag/Tag.vue"
import A2UiTimeline from "./Timeline/Timeline.vue"
import A2UiTabs from "./Tabs/Tabs.vue"

import A2UiProgress from "./Progress/Progress.vue"
import A2UiBadge from "./Badge/Badge.vue"
import A2UiRate from "./Rate/Rate.vue"
import A2UiBreadcrumb from "./Breadcrumb/Breadcrumb.vue"
import A2UiDropdown from "./Dropdown/Dropdown.vue"
import A2UiMenu from "./Menu/Menu.vue"
import A2UiSegmented from "./Segmented/Segmented.vue"
import A2UiTree from "./Tree/Tree.vue"
import A2UiCarousel from "./Carousel/Carousel.vue"

// import A2UiImage from "./Image/Image.vue"

import A2UiStream from "./Stream/Stream.vue"
import A2UiLink from "./Link/Link.vue"
import A2UiLineChart from "./LineChart/LineChart.vue"
import A2UiBarChart from "./BarChart/BarChart.vue"
import A2UiGaugeChart from "./GaugeChart/GaugeChart.vue"
import A2UiRadarChart from "./RadarChart/RadarChart.vue"
import A2UiProcessChart from "./ProcessChart/ProcessChart.vue"
import A2UiPieChart from "./PieChart/PieChart.vue"
import A2UiBubbleChart from "./BubbleChart/BubbleChart.vue"
import A2UiAssembleBubbleChart from "./AssembleBubbleChart/AssembleBubbleChart.vue"
import A2UiBulletChart from "./BulletChart/BulletChart.vue"
import A2UiFunnelChart from "./FunnelChart/FunnelChart.vue"
import A2UiHillChart from "./HillChart/HillChart.vue"
import A2UiJadeJueChart from "./JadeJueChart/JadeJueChart.vue"
import A2UiScatterChart from "./ScatterChart/ScatterChart.vue"
import A2UiCircleProcessChart from "./CircleProcessChart/CircleProcessChart.vue"

import PatGauge from "../customComponents/PatGauge/PatGauge.vue"
import PatStackedBar from "../customComponents/PatStackedBar/PatStackedBar.vue"

import { ComponentRegistry } from "../renderer"

const catelog = {
  Checkbox: A2UiCheckbox,
  CheckboxGroup: A2UiCheckboxGroup,
  DatePicker: A2UiDatePicker,
  InputNumber: A2UiInputNumber,
  Input: A2UiInput,
  RadioGroup: A2UiRadioGroup,
  Select: A2UiSelect,
  Slider: A2UiSlider,
  Switch: A2UiSwitch,
  TextArea: A2UiTextArea,
  TimePicker: A2UiTimePicker,

  Button: A2UiButton,
  Icon: A2UiIcon,
  Collapse: A2UiCollapse,
  Divider: A2UiDivider,
  Tag: A2UiTag,
  Table: A2UiTable,
  Timeline: A2UiTimeline,
  Tabs: A2UiTabs,
  Progress: A2UiProgress,
  Badge: A2UiBadge,
  Rate: A2UiRate,
  Breadcrumb: A2UiBreadcrumb,
  Dropdown: A2UiDropdown,
  Menu: A2UiMenu,
  Segmented: A2UiSegmented,
  Steps: A2UiSteps,
  Tree: A2UiTree,
  Carousel: A2UiCarousel,

  // Image: A2UiImage,
  Stream: A2UiStream,
  Link: A2UiLink,
  LineChart: A2UiLineChart,
  BarChart: A2UiBarChart,
  GaugeChart: A2UiGaugeChart,
  RadarChart: A2UiRadarChart,
  ProcessChart: A2UiProcessChart,
  PieChart: A2UiPieChart,
  BubbleChart: A2UiBubbleChart,
  AssembleBubbleChart: A2UiAssembleBubbleChart,
  BulletChart: A2UiBulletChart,
  FunnelChart: A2UiFunnelChart,
  HillChart: A2UiHillChart,
  JadeJueChart: A2UiJadeJueChart,
  ScatterChart: A2UiScatterChart,
  CircleProcessChart: A2UiCircleProcessChart,

  PatGauge: PatGauge,
  PatStackedBar: PatStackedBar,
}

function initDefaultCatlog() {
  const instance = ComponentRegistry.getInstance()
  for (const [key, component] of Object.entries(catelog)) {
    instance.register(key, {
      component,
    })
  }
}

export { initDefaultCatlog }

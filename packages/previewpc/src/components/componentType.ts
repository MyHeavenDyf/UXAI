import type { AnyComponentNode, DynamicString, Action, DynamicNumber, DynamicBoolean, DataBinding } from '../renderer';

interface ResolvedCheckbox {
  label?: string | DataBinding;
  checked?: string | DataBinding;
  disabled?: string | DataBinding;
  children?: AnyComponentNode[];
  className?: string;
}
interface CheckboxNode extends AnyComponentNode<ResolvedCheckbox> {
  type: "Checkbox";
}
interface ResolvedCheckboxGroup {
  value: string | DataBinding;
  options: {
    label: string;
    value: string;
  }[] | DataBinding;
  className?: string;
}
interface CheckboxGroupNode extends AnyComponentNode<ResolvedCheckboxGroup> {
  type: "CheckboxGroup";
}

interface ResolvedDatePicker {
  value: string | string[] | DataBinding;
  placeholder?: string | string[] | DataBinding;
  picker?: 'date' | 'week' | 'month' | 'quarter' | 'year';
  range?: DynamicBoolean;
  size?: 'large' | 'medium' | 'small';
  format?: string;
  className?: string;
}
interface DatePickerNode extends AnyComponentNode<ResolvedDatePicker> {
  type: "DatePicker";
}

interface ResolvedInput {
  value: DynamicString;
  placeholder?: DynamicString;
  size?: "large" | "medium" | "small";
  maxLength?: number;
  prefix?: string;
  suffix?: string;
  password?: string;
  className?: string;
}
interface InputNode extends AnyComponentNode<ResolvedInput> {
  type: "Input";
}


interface ResolvedInputNumber {
  value: DynamicNumber;
  placeholder?: DynamicString;
  controls?: boolean;
  min?: number;
  max?: number;
  step?: number;
  size?: "large" | "medium" | "small";
  className?: string;
}
interface InputNumberNode extends AnyComponentNode<ResolvedInputNumber> {
  type: "InputNumber";
}

interface ResolvedRadioGroup {
  value: string | DataBinding;
  options: {
    label: string;
    value: string;
  }[] | DataBinding;
  className?: string;
  size?: "large" | "medium" | "small";
  orientation?: "horizontal" | "vertical";
  optionType?: "default" | "button"
}
interface RadioGroupNode extends AnyComponentNode<ResolvedRadioGroup> {
  type: "RadioGroup";
}

interface ResolvedSelect {
  value: string | number | [] | DataBinding;
  options: {
    label: string;
    value: string;
  }[] | DataBinding;
  placeholder?: DynamicString;
  showSearch?: boolean;
  mode?: "multiple" | "";
  size?: "large" | "medium" | "small";
  className?: string;
}
interface SelectNode extends AnyComponentNode<ResolvedSelect> {
  type: "Select";
}


interface ResolvedSlider {
  value: number | [number, number];
  min?: number;
  max?: number;
  step?: number;
  range?: boolean;
  input?: boolean;
  orientation?: "horizontal" | "vertical";
  marks?: object;
  className?: string;
}
interface SliderNode extends AnyComponentNode<ResolvedSlider> {
  type: "Slider";
}

interface ResolvedSwitch {
  value?: DynamicBoolean;
  size?: "medium" | "small";
  checkedChildren?: string;
  unCheckedChildren?: string;
  checkedChildrenIcon?: DynamicString;
  unCheckedChildrenIcon?: DynamicString;
}
interface SwitchNode extends AnyComponentNode<ResolvedSwitch> {
  type: "Switch";
}

interface ResolvedTextArea {
  value: DynamicString;
  placeholder?: DynamicString;
  size?: "large" | "medium" | "small";
  maxLength?: number;
  autoSize?: boolean;
  className?: string;
}
interface TextAreaNode extends AnyComponentNode<ResolvedTextArea> {
  type: "TextArea";
}


interface ResolvedTimePicker {
  value: string | string[] | DataBinding;
  placeholder?: string | string[] | DataBinding;
  picker?: 'date' | 'week' | 'month' | 'quarter' | 'year';
  secondStep?: number;
  minuteStep?: number;
  hourStep?: number;
  range?: DynamicBoolean;
  size?: 'large' | 'medium' | 'small';
  format?: string;
  className?: string;
}
interface TimePickerNode extends AnyComponentNode<ResolvedTimePicker> {
  type: "TimePicker";
}

interface ResolvedButton {
  action: Action;
  value: DynamicString;
  color?: string;
  size?: "large" | "medium" | "small";
  icon?: string;
  iconPlacement?: "start" | "end";
  shape?: "default" | "circle" | "round";
  types?: "default" | "link";
  className?: string
}
interface ButtonNode extends AnyComponentNode<ResolvedButton> {
  type: "Button";
}


interface ResolvedIcon {
  name: DynamicString;
  shape?: "outline" | "fill" | "square" | "circle";
  color?: string;
  className?: string;
}
interface IconNode extends AnyComponentNode<ResolvedIcon> {
  type: "Icon";
}

interface ResolvedCollapseItem {
  key: DynamicString;
  label?: DynamicString;
  extra?: DynamicString;
  content?: AnyComponentNode;
}
interface ResolvedCollapse {
  activeKey: DynamicString;
  children: CollapseItemNode[];
  accordion?: boolean;
  expandIcon?: string;
  expandIconPlacement?: "start" | "end";
  size?: "large" | "medium" | "small";
  className?: string;
}
interface CollapseItemNode extends AnyComponentNode<ResolvedCollapseItem> {
  type: 'CollapseItem'
}
interface CollapseNode extends AnyComponentNode<ResolvedCollapse> {
  type: 'Collapse',
}

interface ResolvedDivider {
  value?: string | AnyComponentNode;
  orientation?: "horizontal" | "vertical";
  size?: "large" | "medium" | "small";
  titlePlacement?: "start" | "end" | "center";
  variant?: "dashed" | "dotted" | "solid";
  className?: string;
}
interface DividerNode extends AnyComponentNode<ResolvedDivider> {
  type: "Divider";
}

interface RowSelection {
  type: "checkbox" | "radio";
  selectedRowKeys: string[] | DataBinding;
}
interface Expandable {
  expandedRowKeys?: string[] | DataBinding;
}
interface Column {
  title: string;
  dataIndex: string;
  align?: "left" | "right" | "center";
  filters?:   object[];
  fixed?: boolean | ("start" | "end");
  sort?: boolean;
  width?: string | number;
  minWidth?: string | number;
  className?: string;
}
interface ResolvedTableRow {
  id: string;
  component: "TableRow";
  expandedRowRender?: AnyComponentNode[];
  children: AnyComponentNode[];
}
interface ResolvedTable {
  rowKey: string;
  columns: Column[];
  dataSource?: DataBinding;
  pagination?: boolean;
  children: TableRowNode[];
  rowSelection?: RowSelection;
  expandable?: Expandable;
  selectedKeys?: DataBinding;
  rowClassName?: string;
  className?: string;
}
interface TableRowNode extends AnyComponentNode<ResolvedTableRow> {
  type: 'TableRow',
}
interface TableNode extends AnyComponentNode<ResolvedTable> {
  type: 'Table',
}

interface ResolvedTag {
  value: DynamicString;
  color?: string
  icon?: string
  size?: "large" | "medium" | "small";
  variant?: "filled" | "solid" | "outlined";
  closable?: boolean;
  closeIcon?: string;
  className?: string;
}
interface TagNode extends AnyComponentNode<ResolvedTag> {
  type: "Tag";
}

interface ResolvedTimelineItem {
  content: AnyComponentNode;
  title: AnyComponentNode;
  icon?: string;
  color?: string;
  placement?: "start" | "end";
  className?: string;
}
interface ResolvedTimeline {
  children: TimelineItemNode[];
  mode?: "start" | "alternate" | "end";
  orientation?: "vertical" | "horizontal";
  variant?: "filled" | "outlined";
  className?: string;
}
interface TimelineItemNode extends AnyComponentNode<ResolvedTimelineItem> {
  type: "TimelineItem";
}
interface TimelineNode extends AnyComponentNode<ResolvedTimeline> {
  type: "Timeline";
}

interface ResolvedStepItem {
  title:AnyComponentNode,
  content?: AnyComponentNode,
  icon?: string,
  status?: "wait" | "process" | "finish" | "error",
  className?: string;
}
interface ResolvedSteps {
  children: StepItemNode[],
  current?: DynamicNumber,
  types?: "default" | "dot" | "inline" | "navigation" | "panel";
  variant?: "filled" | "outlined";
  orientation?: "horizontal" | "vertical";
  status?: "wait" | "process" | "finish" | "error";
  size?: "large" | "medium" | "small";
  className?: string;
}
interface StepItemNode extends AnyComponentNode<ResolvedStepItem> {
  type: "StepItem";
}
interface StepsNode extends AnyComponentNode<ResolvedSteps> {
  type: "Steps";
}

interface ResolvedTabItem {
  key: DynamicString;
  label?: DynamicString;
  icon?: DynamicString;
  content?: AnyComponentNode;
}
interface ResolvedTabs {
  children?: TabItemNode[];
  activeKey: DynamicString;
  types?: "line" | "card" | "editable-card";
  tabPlacement?: "top" | "end" | "bottom"| "start";
  size?: "large" | "medium" | "small";
  className?: string;
}
interface TabItemNode extends AnyComponentNode<ResolvedTabItem> {
  type: "TabItem";
}
interface TabsNode extends AnyComponentNode<ResolvedTabs> {
  type: "Tabs";
}

interface ResolvedMenuItem {
  key: string | number;
  title: string;
  icon?: string;
  children?: ResolvedMenuItem[];
}
interface ResolvedMenu {
  items: ResolvedMenuItem[] | DataBinding;
  openKeys?: string[] | DataBinding;
  selectedKeys?: string[] | DataBinding;
  mode?: "vertical" | "horizontal";
  inlineCollapsed?: boolean;
  className?: string;
}
interface MenuNode extends AnyComponentNode<ResolvedMenu> {
  type: "Menu";
}

interface ResolvedSegmentedItem {
  label: string;
  value: string | number;
  icon?: string;
}
interface ResolvedSegmented {
  value: string | number | DataBinding;
  options: string[] | number[] |ResolvedSegmentedItem[]| DataBinding;
  block?: boolean;
  orientation?: "vertical" | "horizontal";
  size?: "large" | "medium" | "small";
  className?: string;
}
interface SegmentedNode extends AnyComponentNode<ResolvedSegmented> {
  type: "Segmented";
}

interface ResolvedProgress {
  percent: DynamicNumber;
  showInfo?: boolean;
  status?: "success" | "exception" | "normal" | "active";
  strokeColor?: string;
  size?:  "medium" | "small";
  className?: string;
}
interface ProgressNode extends AnyComponentNode<ResolvedProgress> {
  type: "Progress";
}

interface ResolvedBadge {
  color?: string;
  count?: string | number | DataBinding;
  dot?: boolean;
  offset?: [number, number];
  overflowCount?: number;
  showZero?: boolean;
  status?: "success" | "processing" | "default" | "error" | "warning";
  className?: string;
  children: AnyComponentNode[],
}
interface BadgeNode extends AnyComponentNode<ResolvedBadge> {
  type: "Badge";
}

interface  ResolvedRate{
  count: number | DataBinding;
  value: number | DataBinding;
  allowClear?: boolean;
  disabled?: boolean;
  size?: "large" | "medium" | "small";
  className?: string;
}
interface RateNode extends AnyComponentNode<ResolvedRate> {
  type: "Rate";
}

interface BreadcrumbItem {
  title: string | AnyComponentNode;
  type?: "reference" | "";
  separator?: string;
}
interface ResolvedBreadcrumb {
  items: BreadcrumbItem[] | DataBinding;
  separator: DynamicString;
  className?: string;
}
interface BreadcrumbNode extends AnyComponentNode<ResolvedBreadcrumb> {
  type: "Breadcrumb";
}

interface DropdownItem {
  label: string;
  key: string | number;
  icon?: string;
}
interface ResolvedDropdown {
  children: AnyComponentNode[];
  menu: DropdownItem[] | DataBinding;
  placement?: "bottom" | "bottomLeft" | "bottomRight" | "top" | "topLeft" | "topRight";
  trigger?: "click" | "hover" | "contextMenu";
  className?: string;
}
interface DropdownNode extends AnyComponentNode<ResolvedDropdown> {
  type: "Dropdown";
}

interface ResolvedCarousel {
  arrows?: boolean;
  adaptiveHeight?: boolean;
  dotPlacement?: "top" | "bottom" | "start" | "end";
  children?: AnyComponentNode[];
  className?: string;
}
interface CarouselNode extends AnyComponentNode<ResolvedCarousel> {
  type: "Carousel";
}

interface TreeNode {
  title: string;
  key: string;
  icon?: string;
  children?: TreeNode[];
}
interface ResolvedTree {
  checkable?: boolean;
  defaultExpandedKeys?: string[] | DataBinding;
  defaultSelectedKeys?: string[] | DataBinding;
  options: TreeNode[] | DataBinding;
  className?: string;
}
interface TreeNodeNode extends AnyComponentNode<ResolvedTree> {
  type: "Tree";
}

interface ResolvedImage {
  url: DynamicString;
  fit?: "fill" | "contain" | "cover" | "none";
  aspectRatio?: "square" | "video" | "portrait" | "landscape";
  radius?: "none" | "md" | "lg" | "full";
  alt?: string;
  preview?: boolean;
  className?: string;
}
interface ImageNode extends AnyComponentNode<ResolvedImage> {
  type: "Image";
}

interface ResolvedLink {
  text: DynamicString;
}




interface StreamNode extends AnyComponentNode<AnyComponentNode> {
  type: 'Stream',
  isCommon: boolean;
}

interface LinkNode extends AnyComponentNode<ResolvedLink> {
  type: 'Link',
}



export type {
  CheckboxNode,
  CheckboxGroupNode,
  DatePickerNode,
  InputNode,
  InputNumberNode,
  RadioGroupNode,
  SelectNode,
  SliderNode,
  SwitchNode,
  TextAreaNode,
  TimePickerNode,
  SegmentedNode,

  ButtonNode,
  IconNode,
  MenuNode,
  CollapseNode,
  DividerNode,
  TableNode,
  TagNode,
  TimelineNode,

  StepsNode,
  TabsNode,
  ProgressNode,
  BadgeNode,
  RateNode,
  BreadcrumbNode,
  DropdownNode,

  CarouselNode,
  TreeNodeNode,
  ImageNode,
  StreamNode,
  LinkNode
}
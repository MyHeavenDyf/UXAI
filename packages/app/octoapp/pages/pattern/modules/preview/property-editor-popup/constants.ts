export const TEXT_ELEMENTS = [
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a', 'label', 'li', 'section', 'header', 'footer', 'main', 'nav', 'article', 'aside',
]

export const LABEL_MAP: Record<string, string> = {
  value: '文本内容', color: '颜色', types: '类型', size: '尺寸', shape: '形状',
  icon: '图标', iconPlacement: '图标位置', variant: '样式', status: '状态',
  name: '图标名', orientation: '方向', titlePlacement: '文字位置',
  closable: '可关闭', closeIcon: '关闭图标', count: '数值', dot: '圆点模式',
  showZero: '显示零', overflowCount: '溢出数', placeholder: '占位符',
  disabled: '禁用', readonly: '只读', required: '必填', maxLength: '最大长度',
  min: '最小值', max: '最大值', step: '步长', rows: '行数',
  checked: '选中', label: '标签', key: '键值', className: '样式类',
  activeKey: '激活项', tabPlacement: '标签位置',
  rowKey: '行标识', rowClassName: '行样式类',
  mode: '模式', dotPlacement: '指示点位置', expandIcon: '展开图标',
  expandIconPlacement: '展开图标位置', optionType: '选项样式',
  checkedChildren: '选中文本', unCheckedChildren: '未选文本',
  strokeColor: '描边颜色', picker: '选择器', format: '格式',
  prefix: '前缀图标', suffix: '后缀图标', placement: '位置',
}

type EnumOption = { label: string; value: string }

export const COMPONENT_ENUMS: Record<string, EnumOption[]> = {
  'Button.color': [
    { label: '默认', value: 'default' },
    { label: '成功', value: 'success' },
    { label: '警告', value: 'danger' },
  ],
  'Button.types': [
    { label: '默认', value: 'default' },
    { label: '链接', value: 'link' },
  ],
  'Button.size': [
    { label: '大', value: 'large' },
    { label: '中', value: 'medium' },
    { label: '小', value: 'small' },
  ],
  'Button.iconPlacement': [
    { label: '左侧', value: 'start' },
    { label: '右侧', value: 'end' },
  ],
  'Button.shape': [
    { label: '默认', value: 'default' },
    { label: '圆形', value: 'circle' },
    { label: '圆角', value: 'round' },
  ],
  'Icon.shape': [
    { label: '线框', value: 'outline' },
    { label: '填充', value: 'fill' },
    { label: '方形', value: 'square' },
    { label: '圆形', value: 'circle' },
  ],
  'Icon.color': [
    { label: '默认', value: 'default' },
    { label: '品牌', value: 'brand' },
    { label: '信息', value: 'info' },
    { label: '错误', value: 'error' },
    { label: '告警', value: 'alert' },
    { label: '提醒', value: 'warning' },
    { label: '成功', value: 'success' },
    { label: '失效', value: 'disabled' },
    { label: '玫红', value: 'rose' },
    { label: '粉色', value: 'pink' },
    { label: '紫色', value: 'purple' },
    { label: '靛蓝', value: 'indigo' },
    { label: '青色', value: 'cyan' },
    { label: '绿色', value: 'green' },
  ],
  'Tabs.types': [
    { label: '线型', value: 'line' },
    { label: '卡片', value: 'card' },
    { label: '可编辑卡片', value: 'editable-card' },
  ],
  'Tabs.tabPlacement': [
    { label: '顶部', value: 'top' },
    { label: '右侧', value: 'end' },
    { label: '底部', value: 'bottom' },
    { label: '左侧', value: 'start' },
  ],
  'Tabs.size': [
    { label: '大', value: 'large' },
    { label: '中', value: 'medium' },
    { label: '小', value: 'small' },
  ],
  'Badge.status': [
    { label: '成功', value: 'success' },
    { label: '处理中', value: 'processing' },
    { label: '默认', value: 'default' },
    { label: '错误', value: 'error' },
    { label: '警告', value: 'warning' },
  ],
  'Carousel.dotPlacement': [
    { label: '顶部', value: 'top' },
    { label: '底部', value: 'bottom' },
    { label: '左侧', value: 'start' },
    { label: '右侧', value: 'end' },
  ],
  'Collapse.expandIconPlacement': [
    { label: '左侧', value: 'start' },
    { label: '右侧', value: 'end' },
  ],
  'Collapse.size': [
    { label: '大', value: 'large' },
    { label: '中', value: 'medium' },
    { label: '小', value: 'small' },
  ],
  'Divider.size': [
    { label: '大', value: 'large' },
    { label: '中', value: 'medium' },
    { label: '小', value: 'small' },
  ],
  'Divider.titlePlacement': [
    { label: '左侧', value: 'start' },
    { label: '右侧', value: 'end' },
    { label: '居中', value: 'center' },
  ],
  'Divider.variant': [
    { label: '虚线', value: 'dashed' },
    { label: '点线', value: 'dotted' },
    { label: '实线', value: 'solid' },
  ],
  'Segmented.orientation': [
    { label: '水平', value: 'horizontal' },
    { label: '竖直', value: 'vertical' },
  ],
  'Segmented.size': [
    { label: '大', value: 'large' },
    { label: '中', value: 'medium' },
    { label: '小', value: 'small' },
  ],
  'Tag.size': [
    { label: '大', value: 'large' },
    { label: '中', value: 'medium' },
    { label: '小', value: 'small' },
  ],
  'Tag.variant': [
    { label: '填充', value: 'filled' },
    { label: '实色', value: 'solid' },
    { label: '线框', value: 'outlined' },
  ],
  'Tag.color': [
    { label: '默认', value: 'default' },
    { label: '信息', value: 'info' },
    { label: '错误', value: 'error' },
    { label: '告警', value: 'alert' },
    { label: '提醒', value: 'warning' },
    { label: '成功', value: 'success' },
    { label: '失效', value: 'disabled' },
    { label: '绿色', value: 'green' },
    { label: '玫红', value: 'rose' },
    { label: '粉色', value: 'pink' },
    { label: '紫色', value: 'purple' },
    { label: '靛蓝', value: 'indigo' },
    { label: '青色', value: 'cyan' },
  ],
  'Timeline.mode': [
    { label: '左侧', value: 'start' },
    { label: '交替', value: 'alternate' },
    { label: '右侧', value: 'end' },
  ],
  'Timeline.orientation': [
    { label: '竖直', value: 'vertical' },
    { label: '水平', value: 'horizontal' },
  ],
  'Timeline.variant': [
    { label: '填充', value: 'filled' },
    { label: '线框', value: 'outlined' },
  ],
  'TimelineItem.placement': [
    { label: '左侧', value: 'start' },
    { label: '右侧', value: 'end' },
  ],
  'DatePicker.picker': [
    { label: '日', value: 'date' },
    { label: '周', value: 'week' },
    { label: '月', value: 'month' },
    { label: '季', value: 'quarter' },
    { label: '年', value: 'year' },
  ],
  'DatePicker.size': [
    { label: '大', value: 'large' },
    { label: '中', value: 'medium' },
    { label: '小', value: 'small' },
  ],
  'Input.size': [
    { label: '大', value: 'large' },
    { label: '中', value: 'medium' },
    { label: '小', value: 'small' },
  ],
  'InputNumber.size': [
    { label: '大', value: 'large' },
    { label: '中', value: 'medium' },
    { label: '小', value: 'small' },
  ],
  'RadioGroup.orientation': [
    { label: '水平', value: 'horizontal' },
    { label: '竖直', value: 'vertical' },
  ],
  'RadioGroup.optionType': [
    { label: '默认', value: 'default' },
    { label: '按钮', value: 'button' },
  ],
  'RadioGroup.size': [
    { label: '大', value: 'large' },
    { label: '中', value: 'medium' },
    { label: '小', value: 'small' },
  ],
  'Rate.size': [
    { label: '小', value: 'small' },
    { label: '中', value: 'medium' },
    { label: '大', value: 'large' },
  ],
  'Select.size': [
    { label: '大', value: 'large' },
    { label: '中', value: 'medium' },
    { label: '小', value: 'small' },
  ],
  'Select.mode': [
    { label: '多选', value: 'multiple' },
  ],
  'Slider.orientation': [
    { label: '水平', value: 'horizontal' },
    { label: '竖直', value: 'vertical' },
  ],
  'Switch.size': [
    { label: '中', value: 'medium' },
    { label: '小', value: 'small' },
  ],
  'TextArea.size': [
    { label: '大', value: 'large' },
    { label: '中', value: 'medium' },
    { label: '小', value: 'small' },
  ],
  'TimePicker.size': [
    { label: '大', value: 'large' },
    { label: '中', value: 'medium' },
    { label: '小', value: 'small' },
  ],
  'Dropdown.placement': [
    { label: '下方', value: 'bottom' },
    { label: '左下', value: 'bottomLeft' },
    { label: '右下', value: 'bottomRight' },
    { label: '上方', value: 'top' },
    { label: '左上', value: 'topLeft' },
    { label: '右上', value: 'topRight' },
  ],
  'Menu.mode': [
    { label: '竖直', value: 'vertical' },
    { label: '水平', value: 'horizontal' },
  ],
  'Steps.types': [
    { label: '默认', value: 'default' },
    { label: '圆点', value: 'dot' },
    { label: '内联', value: 'inline' },
    { label: '导航', value: 'navigation' },
    { label: '面板', value: 'panel' },
  ],
  'Steps.variant': [
    { label: '填充', value: 'filled' },
    { label: '线框', value: 'outlined' },
  ],
  'Steps.orientation': [
    { label: '水平', value: 'horizontal' },
    { label: '竖直', value: 'vertical' },
  ],
  'Steps.status': [
    { label: '等待', value: 'wait' },
    { label: '进行中', value: 'process' },
    { label: '完成', value: 'finish' },
    { label: '错误', value: 'error' },
  ],
  'Steps.size': [
    { label: '大', value: 'large' },
    { label: '中', value: 'medium' },
    { label: '小', value: 'small' },
  ],
  'Progress.status': [
    { label: '成功', value: 'success' },
    { label: '异常', value: 'exception' },
    { label: '正常', value: 'normal' },
    { label: '激活', value: 'active' },
  ],
  'Progress.size': [
    { label: '中', value: 'medium' },
    { label: '小', value: 'small' },
  ],
}

const BOOL_FALSE_FIRST = { label: '否', value: 'false' }
const BOOL_TRUE_FIRST = { label: '是', value: 'true' }

const BOOL_PAIR = [BOOL_FALSE_FIRST, BOOL_TRUE_FIRST]

const BOOLEAN_KEYS = ['disabled', 'readonly', 'required', 'closable', 'dot', 'showZero', 'checked'] as const

const BOOL_PROP_COMPONENTS: Record<string, string[]> = {
  Input: ['disabled', 'readonly'],
  InputNumber: ['disabled'],
  TextArea: ['disabled'],
  Select: ['disabled'],
  DatePicker: ['disabled'],
  TimePicker: ['disabled'],
  Switch: ['disabled'],
  Tag: ['closable'],
  Badge: ['dot', 'showZero'],
  Checkbox: ['checked', 'disabled'],
  Radio: ['checked', 'disabled'],
}

for (const [component, keys] of Object.entries(BOOL_PROP_COMPONENTS)) {
  for (const key of keys) {
    COMPONENT_ENUMS[`${component}.${key}`] = BOOL_PAIR
  }
}

const BOOL_PROP_KEY_SET = new Set<string>(BOOLEAN_KEYS)

export { BOOL_PROP_KEY_SET }

export const ENUM_DEFAULTS: Record<string, string> = {
  'Button.size': 'medium',
  'Button.iconPlacement': 'start',
  'Tabs.types': 'line',
  'Icon.shape': 'outline',
}

export const COMPONENT_PROPS: Record<string, string[]> = {
  Button: ['value', 'color', 'types', 'size', 'icon', 'iconPlacement', 'shape', 'className'],
  Icon: ['name', 'shape', 'color', 'className'],
  Image: ['url', 'alt', 'preview', 'className'],
  img: ['url', 'alt', 'preview', 'className'],
  Tabs: ['activeKey', 'types', 'tabPlacement', 'size', 'className'],
  Table: ['rowKey', 'rowClassName', 'className'],
  Badge: ['color', 'status', 'showZero', 'dot', 'className'],
  Carousel: ['dotPlacement', 'className'],
  Collapse: ['expandIcon', 'expandIconPlacement', 'size', 'className'],
  Divider: ['orientation', 'size', 'titlePlacement', 'variant', 'className'],
  Segmented: ['orientation', 'size', 'className'],
  Tag: ['color', 'size', 'variant', 'closable', 'closeIcon', 'className'],
  Timeline: ['mode', 'orientation', 'variant', 'className'],
  TimelineItem: ['placement', 'className'],
  DatePicker: ['picker', 'size', 'format', 'disabled', 'className'],
  Input: ['size', 'prefix', 'suffix', 'disabled', 'readonly', 'className', 'placeholder'],
  InputNumber: ['size', 'disabled', 'className'],
  RadioGroup: ['orientation', 'optionType', 'size', 'className'],
  Rate: ['size', 'className'],
  Select: ['size', 'mode', 'disabled', 'className'],
  Slider: ['orientation', 'className'],
  Switch: ['size', 'checkedChildren', 'unCheckedChildren', 'disabled', 'className'],
  TextArea: ['size', 'disabled', 'className'],
  TimePicker: ['size', 'format', 'disabled', 'className'],
  Dropdown: ['placement', 'className'],
  Menu: ['mode', 'className'],
  Steps: ['types', 'variant', 'orientation', 'status', 'size', 'className'],
  Progress: ['status', 'strokeColor', 'size', 'className'],
  Checkbox: ['checked', 'disabled', 'className'],
  Radio: ['checked', 'disabled', 'className'],
}

export const TW_FONT_SIZES: Record<string, number> = {
  xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30,
  '4xl': 36, '5xl': 48, '6xl': 60, '7xl': 72, '8xl': 96, '9xl': 128,
}

export const TW_FONT_WEIGHTS: Record<string, number> = {
  thin: 100, extralight: 200, light: 300, normal: 400, medium: 500,
  semibold: 600, bold: 700, extrabold: 800, black: 900,
}

export const FW_TO_TW = Object.fromEntries(Object.entries(TW_FONT_WEIGHTS).map(([k, v]) => [v, k])) as Record<number, string>

export const TW_PREFIXES = [
  'p-', 'pt-', 'pr-', 'pb-', 'pl-', 'px-', 'py-',
  'm-', 'mt-', 'mr-', 'mb-', 'ml-', 'mx-', 'my-',
  'w-', 'h-', 'min-w-', 'min-h-', 'max-w-', 'max-h-',
  'text-', 'font-', 'leading-', 'tracking-',
  'rounded-', 'rounded-tl-', 'rounded-tr-', 'rounded-br-', 'rounded-bl-',
  'bg-', 'border-', 'border-t-', 'border-r-', 'border-b-', 'border-l-',
  'shadow-', 'blur-', 'backdrop-blur-',
  'flex', 'flex-col', 'flex-row', 'flex-wrap', 'flex-nowrap',
  'gap-', 'justify-', 'items-', 'opacity-', 'overflow-',
]

export const CSS_STRIP_PREFIX: Record<string, string[]> = {
  'background-color': ['bg-'],
  'background-image': ['bg-'],
  'color': ['text-', 'leading-', 'tracking-', 'font-'],
  'font-size': ['text-', 'leading-', 'tracking-', 'font-'],
  'font-weight': ['font-'],
  'font-family': ['font-'],
  'text-align': ['text-', 'leading-', 'tracking-', 'font-'],
  'line-height': ['text-', 'leading-', 'tracking-', 'font-'],
  'letter-spacing': ['text-', 'leading-', 'tracking-', 'font-'],
  'padding': ['p-', 'pt-', 'pr-', 'pb-', 'pl-', 'px-', 'py-'],
  'padding-top': ['pt-'],
  'padding-right': ['pr-'],
  'padding-bottom': ['pb-'],
  'padding-left': ['pl-'],
  'margin': ['m-', 'mt-', 'mr-', 'mb-', 'ml-', 'mx-', 'my-'],
  'margin-top': ['mt-'],
  'margin-right': ['mr-'],
  'margin-bottom': ['mb-'],
  'margin-left': ['ml-'],
  'border-radius': ['rounded-'],
  'width': ['w-', 'max-w-', 'min-w-'],
  'height': ['h-', 'max-h-', 'min-h-'],
  'overflow': ['overflow-'],
  'opacity': ['opacity-'],
  'display': ['flex', 'flex-col', 'flex-row', 'inline-flex'],
  'flex-direction': ['flex-col', 'flex-row'],
  'gap': ['gap-'],
  'justify-content': ['justify-'],
  'align-items': ['items-'],
  'box-shadow': ['shadow-'],
  'filter': ['blur-'],
  'backdrop-filter': ['backdrop-blur-'],
  'border-style': ['border-'],
  'border-color': ['border-'],
  'border-width': ['border-'],
}

export const CSS_FAMILY_KEYS: Record<string, string[]> = {
  'color': ['font-size', 'text-align', 'line-height', 'letter-spacing'],
  'font-size': ['color', 'text-align', 'line-height', 'letter-spacing'],
  'text-align': ['color', 'font-size', 'line-height', 'letter-spacing'],
  'line-height': ['color', 'font-size', 'text-align', 'letter-spacing'],
  'letter-spacing': ['color', 'font-size', 'text-align', 'line-height'],
  'font-weight': ['font-family'],
  'font-family': ['font-weight'],
  'background-color': ['background-image'],
  'background-image': ['background-color'],
}

export const GRID_POSITIONS = [
  { label: '左上', justify: 'start', align: 'start' },
  { label: '中上', justify: 'center', align: 'start' },
  { label: '右上', justify: 'end', align: 'start' },
  { label: '中左', justify: 'start', align: 'center' },
  { label: '正中', justify: 'center', align: 'center' },
  { label: '中右', justify: 'end', align: 'center' },
  { label: '左下', justify: 'start', align: 'end' },
  { label: '中下', justify: 'center', align: 'end' },
  { label: '右下', justify: 'end', align: 'end' },
]

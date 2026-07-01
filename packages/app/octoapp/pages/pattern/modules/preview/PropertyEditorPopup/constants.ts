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
}

export const COMPONENT_ENUMS: Record<string, string[]> = {
  'Button.color': ['default', 'primary', 'danger', 'success', 'warning', 'info'],
  'Button.types': ['default', 'link'],
  'Button.size': ['large', 'medium', 'small'],
  'Button.iconPlacement': ['start', 'end'],
  'Button.shape': ['default', 'circle', 'round'],
  'Icon.shape': ['outline', 'fill', 'square', 'circle'],
  'Icon.color': ['default', 'primary', 'success', 'warning', 'error', 'inverse'],
}

export const ENUM_DEFAULTS: Record<string, string> = {
  'Button.size': 'medium',
  'Button.iconPlacement': 'start',
}

export const COMPONENT_PROPS: Record<string, string[]> = {
  Button: ['value', 'color', 'types', 'size', 'icon', 'iconPlacement', 'shape', 'className'],
  Icon: ['name', 'shape', 'color', 'className'],
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

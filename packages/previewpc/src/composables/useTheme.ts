import { ref, computed } from 'vue';

const isDark = ref(false);

// 样式文件路径
const LIGHT_STYLE_URL = new URL('../assets/style/hui-base.css', import.meta.url).href;
const DARK_STYLE_URL = new URL('../assets/style/hui-base-dark.css', import.meta.url).href;

// 当前注入的 <link> 标签
let activeStyleLink: HTMLLinkElement | null = null;

function injectStyle(url: string) {
  removeStyle();
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  link.dataset.theme = url.includes('dark') ? 'dark' : 'light';
  document.head.appendChild(link);
  activeStyleLink = link;
}

function removeStyle() {
  if (activeStyleLink && activeStyleLink.parentNode) {
    activeStyleLink.parentNode.removeChild(activeStyleLink);
    activeStyleLink = null;
  }
  const existing = document.querySelector('link[data-theme]');
  if (existing) {
    existing.remove();
  }
}

function toggleTheme() {
  isDark.value = !isDark.value;
  applyTheme();
}

function applyTheme() {
  if (isDark.value) {
    document.body.classList.add('theme-dark');
    injectStyle(DARK_STYLE_URL);
  } else {
    document.body.classList.remove('theme-dark');
    injectStyle(LIGHT_STYLE_URL);
  }
}

// ========== icon 颜色映射（跟随主题切换） ==========

// 亮色：用 -50 系列色值，暗色：用 -30 系列色值
const LIGHT_ICON_COLORS: Record<string, string> = {
  success:   "#09AA71",  // mint-50
  primary:   "#0067D1",  // brand-50
  error:     "#E02128",  // red-50
  warning:   "#FCC800",  // yellow-50
  critical:  "#F4840C",  // orange-50
  default:   "#191919",  // gray-90
  inverse:   "#FFFFFF",
  info:      "#191919",  // gray-90
  neutral:   "#191919",
  normal:    "#191919",
}

const DARK_ICON_COLORS: Record<string, string> = {
  success:   "#63D5A8",  // mint-30
  primary:   "#5CA2E9",  // brand-30
  error:     "#EE696F",  // red-30
  warning:   "#FDE55C",  // yellow-30
  critical:  "#F9B766",  // orange-30
  default:   "#DFDFDF",  // gray-10
  inverse:   "#191919",  // gray-90
  info:      "#DFDFDF",  // gray-10
  neutral:   "#DFDFDF",
  normal:    "#DFDFDF",
}

/** 根据 isDark 返回当前主题下的 icon 颜色映射 */
export const iconColorMap = computed(() => isDark.value ? DARK_ICON_COLORS : LIGHT_ICON_COLORS)

export function initTheme() {
  applyTheme();
}

export function useTheme() {
  return {
    isDark,
    toggleTheme,
    iconColorMap,
  };
}

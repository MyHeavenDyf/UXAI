import { ref } from 'vue';

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

export function initTheme() {
  applyTheme();
}

export function useTheme() {
  return {
    isDark,
    toggleTheme,
  };
}

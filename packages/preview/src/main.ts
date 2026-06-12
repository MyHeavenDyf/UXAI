
import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import App from './App.vue'
import 'element-plus/dist/index.css'
import './style.css'
import { initDefaultCatlog } from './components'
import { initTheme, useTheme } from './composables/useTheme'
import { installVueDomPicker } from '@dom-picker/vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import router from './router'


initDefaultCatlog()
initTheme()
if (window && window.self !== window.top) {
  installVueDomPicker()
}

// 监听来自 chat-project 的主题切换消息
const { toggleTheme } = useTheme()
window.addEventListener('message', (event) => {
  if (event.data?.type === 'TOGGLE_THEME') {
    toggleTheme()
  }
})


const app = createApp(App)

app.use(router)
app.use(ElementPlus, {
  locale: zhCn,
})
app.mount('#app')

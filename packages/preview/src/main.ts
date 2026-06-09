
import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import App from './App.vue'
import 'element-plus/dist/index.css'
import './assets/style/element.css'
import './style.css'
import { initDefaultCatlog } from './components'
import { installVueDomPicker } from '@dom-picker/vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import router from './router'


initDefaultCatlog()
// if (window && window.self !== window.top) {
  installVueDomPicker()
// }


const app = createApp(App)

app.use(router)
app.use(ElementPlus, {
  locale: zhCn,
})
app.mount('#app')

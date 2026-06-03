import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import testFilesPlugin from './vite-plugin-test-files'

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, __dirname + '/..', '')
  return {
    plugins: [
      tailwindcss(),
      vue(),
      testFilesPlugin()
    ],
    server: {
      port: parseInt(rootEnv.VUE_FRONTEND_PORT || '8989'),
    },
  }
})
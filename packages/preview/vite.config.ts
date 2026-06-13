import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import testFilesPlugin from './vite-plugin-test-files'
import { fileURLToPath,URL } from 'url'

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, __dirname + '/..', '')
  return {
    plugins: [
      tailwindcss(),
      vue(),
      testFilesPlugin()
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url))},
      extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json', '.vue'],
    },
    optimizeDeps: {
      exclude: ['@dom-picker/core', '@dom-picker/vue'],
    },
    server: {
      port: parseInt(rootEnv.VUE_FRONTEND_PORT || '8989'),
    },
  }
})
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
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@dom-picker/vue': fileURLToPath(new URL('./dom-picker/dom-picker-vue', import.meta.url)),
        '@dom-picker/core': fileURLToPath(new URL('./dom-picker/dom-picker-core', import.meta.url)),
      },
      extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json', '.vue'],
    },
    server: {
      port: parseInt(rootEnv.VUE_FRONTEND_PORT || '51856'),
    },
    build: {
      outDir: '../previewdist',
      chunkSizeWarningLimit: 5000,
      rollupOptions: {
        onLog(level, log, handler) {
          if (log.code === 'INVALID_ANNOTATION') return
          handler(level, log)
        },
      },
    },
  }
})
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function tildeImportPlugin(): Plugin {
  return {
    name: 'tilde-import',
    resolveId(source) {
      if (source.startsWith('~')) {
        return source.slice(1);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tildeImportPlugin()],
  resolve: {
    alias: [
      {
        find: /^~(.+)/,
        replacement: '$1',
      },
      {
        find: '@',
        replacement: path.resolve(__dirname, 'src'),
      }
    ]
  },
  css: {
    preprocessorOptions: {
      less: {
        javascriptEnabled: true,
        paths: [path.resolve(__dirname, 'node_modules')],
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 4080
  },
});

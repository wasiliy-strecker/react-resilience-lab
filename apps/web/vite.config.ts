import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: '@react-resilience/command-outbox/react',
        replacement: fileURLToPath(
          new URL(
            '../../packages/command-outbox/src/react.ts',
            import.meta.url,
          ),
        ),
      },
      {
        find: '@react-resilience/command-outbox',
        replacement: fileURLToPath(
          new URL(
            '../../packages/command-outbox/src/index.ts',
            import.meta.url,
          ),
        ),
      },
      {
        find: '@react-resilience/contracts',
        replacement: fileURLToPath(
          new URL('../../packages/contracts/src/index.ts', import.meta.url),
        ),
      },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '/health': 'http://127.0.0.1:3001',
    },
  },
})

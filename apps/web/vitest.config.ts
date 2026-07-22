import { mergeConfig } from 'vite'
import { defineConfig } from 'vitest/config'

import viteConfig from './vite.config.js'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      coverage: {
        exclude: ['src/main.tsx', 'src/features/incidents/sample-incidents.ts'],
        provider: 'v8',
        reporter: ['text', 'lcov'],
        thresholds: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  }),
)

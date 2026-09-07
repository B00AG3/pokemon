import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// The test block doubles as the vitest config so one file drives both the
// dev server and the suite. include is scoped to src/ on purpose: contracts/
// holds the hardhat + mocha suite with its own *.test.ts files.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/constants/ladder.ts', 'src/data/ladderCards.ts'],
      thresholds: { lines: 95, functions: 95, branches: 95, statements: 95 },
    },
  },
})

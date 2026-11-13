import { defineConfig } from 'vitest/config'

// LSL_COVERAGE=1 (set by `node run-tests.mjs --coverage`) makes rezless count
// which lines of the .luau scripts ran; its setup file saves the counts per test file.
const coverage = process.env['LSL_COVERAGE'] === '1'

export default defineConfig({
  test: {
    include: ['all-scripts/**/*.test.ts', 'luasitter1/**/*.test.ts', 'luasitter2/**/*.test.ts'],
    testTimeout: 60_000,
    setupFiles: coverage ? ['@rezless/vitest/coverage-setup'] : [],
  },
})

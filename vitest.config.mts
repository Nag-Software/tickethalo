import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.{ts,tsx}'],
    coverage: {
      reporter: ['text', 'html'],
      include: [
        'lib/artist-readiness.ts',
        'lib/artist-roles.ts',
        'lib/booking-spots.ts',
        'lib/checkout/errors.ts',
        'lib/event-filters.ts',
        'lib/marketing/copy.ts',
        'lib/marketing/export-formats.ts',
        'lib/marketing/palette.ts',
        'lib/marketing/slots.ts',
        'lib/marketing/storage.ts',
        'lib/tickets.ts',
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
})

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  packageManager: 'pnpm',
  coverageAnalysis: 'perTest',
  ignoreStatic: true,
  incremental: true,
  reporters: ['clear-text', 'html', 'progress'],
  mutate: [
    'lib/artist-readiness.ts',
    'lib/artist-roles.ts',
    'lib/booking-spots.ts',
    'lib/checkout/errors.ts',
    'lib/event-filters.ts',
    'lib/marketing/copy.ts',
    'lib/marketing/export-formats.ts',
    'lib/marketing/palette.ts',
    'lib/marketing/slots.ts',
    'lib/tickets.ts',
  ],
  thresholds: { high: 90, low: 75, break: 65 },
  concurrency: 2,
  tempDirName: '.stryker-tmp',
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  vitest: { configFile: 'vitest.config.mts' },
}

export default config

import '@testing-library/jest-dom/vitest'

process.env.TZ = 'Europe/Oslo'

// jsdom har ikke ResizeObserver. Radix-checkboxen bruker den i skjemaer
// (størrelsen på det skjulte feltet), så testene får en stille stand-in.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

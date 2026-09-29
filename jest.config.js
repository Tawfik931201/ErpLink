const nextJest = require('next/jest')

// `next/jest` wires SWC + the `@/*` path aliases from tsconfig.json for us,
// so tests compile exactly like the app does (no separate transform config).
const createJestConfig = nextJest({ dir: './' })

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    // Real modules that pull in server-only / env-dependent code. Tests must
    // never open a Supabase connection or boot the in-process queue runner.
    '^@/lib/supabase$': '<rootDir>/tests/mocks/supabase.ts',
  },
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/'],
  collectCoverageFrom: [
    'src/lib/**/*.ts',
    '!src/lib/**/*.d.ts',
  ],
}

module.exports = createJestConfig(customJestConfig)

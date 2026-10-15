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
    //
    // Read the three patterns as a set — `next/jest` hands the tsconfig `paths`
    // to SWC, so an import is rewritten before moduleNameMapper ever sees it,
    // and the rewritten specifier depends on the importing file's location:
    //   `@/lib/supabase`   (unrewritten, e.g. from a test file)
    //   `.../src/lib/supabase`  (absolute, from tsconfig baseUrl resolution)
    //   `../../lib/supabase`    (relative, from a file inside src/)
    //   `./supabase`            (relative, from a file directly in src/lib/)
    // Matching only the alias matched none of them in practice: the mock was
    // never loaded, and a test that reached for `@/lib/supabase` silently built
    // a real client and hit the real database. `.*lib[\\/]supabase$` covers all
    // three. It cannot self-match, because the mock itself is
    // `tests/mocks/supabase.ts` and has no `lib/` segment.
    // The fourth entry covers the `./supabase` shape (2026-10-11: the first
    // test to await a query through a module living directly in src/lib/
    // proved it matched nothing and fell back to a real client).
    '^@/lib/supabase$': '<rootDir>/tests/mocks/supabase.ts',
    '^.*[\\/]src[\\/]lib[\\/]supabase$': '<rootDir>/tests/mocks/supabase.ts',
    '^.*[\\/]lib[\\/]supabase$': '<rootDir>/tests/mocks/supabase.ts',
    '^\\./supabase$': '<rootDir>/tests/mocks/supabase.ts',
  },
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/'],
  collectCoverageFrom: [
    'src/lib/**/*.ts',
    '!src/lib/**/*.d.ts',
  ],
}

module.exports = createJestConfig(customJestConfig)

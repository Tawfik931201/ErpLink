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
    //   `../supabase`           (relative, from a file in src/lib/<subdir>/,
    //                            e.g. src/lib/zid/* — 2026-10-22: the first
    //                            test under src/lib/<subdir>/ proved `./supabase`
    //                            alone matched nothing and fell through to a
    //                            real client + a live query)
    // Matching only the alias matched none of them in practice: the mock was
    // never loaded, and a test that reached for `@/lib/supabase` silently built
    // a real client and hit the real database. The last entry is one regex
    // covering every dot-segment depth (`./`, `../`, `../../`, …) so a deeper
    // src/lib/<a>/<b>/ module cannot fall through again.
    '^@/lib/supabase$': '<rootDir>/tests/mocks/supabase.ts',
    '^.*[\\/]src[\\/]lib[\\/]supabase$': '<rootDir>/tests/mocks/supabase.ts',
    '^.*[\\/]lib[\\/]supabase$': '<rootDir>/tests/mocks/supabase.ts',
    '^(\.{1,2}[\\\\/])+supabase$': '<rootDir>/tests/mocks/supabase.ts',
  },
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/'],
  collectCoverageFrom: [
    'src/lib/**/*.ts',
    '!src/lib/**/*.d.ts',
  ],
}

module.exports = createJestConfig(customJestConfig)

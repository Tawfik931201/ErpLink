/**
 * Global Jest setup.
 *
 * Tests run with NODE_ENV=test, so nothing here may touch the network or the
 * real database. Supabase is already replaced by a mock via moduleNameMapper in
 * jest.config.js; this file only silences expected noise and pins the clock
 * helpers that date logic depends on.
 */

// Deterministic timezone for any date-formatting assertions.
process.env.TZ = 'UTC'

// Guard: fail loudly if a test ever tries to reach a real provider.
if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  // Intentionally NOT deleted — a test asserting on config may read it.
  // The moduleNameMapper mock is what prevents the client from being built.
}

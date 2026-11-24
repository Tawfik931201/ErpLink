/**
 * Legacy fixed-mapping tables are absent from the deployed Supabase schema.
 * They predate Standard Mapping, which is the authoritative settings source.
 *
 * Explicit opt-in only AFTER verifying the three tables and their expected
 * schema exist. This avoids repeated PGRST205 404s during every order event,
 * while retaining a reversible path for older self-hosted installations.
 * No cross-request cache, tenant data, or secrets are involved.
 */
export function legacyFixedMappingTablesEnabled(): boolean {
  return process.env.ENABLE_LEGACY_FIXED_MAPPING_TABLES === 'true'
}

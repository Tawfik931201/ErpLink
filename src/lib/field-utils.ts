/**
 * Convert a human-readable label to a valid Odoo technical name.
 * Rules: lowercase, spaces/Arabic → underscore, remove special chars, prefix with x_
 */
export function sanitizeTechnicalName(raw: string): string {
  let name = raw
    .toLowerCase()
    .trim()
    .replace(/[\u0600-\u06FF\s]+/g, '_')  // Arabic chars + whitespace → underscore
    .replace(/[^a-z0-9_]/g, '_')           // any non-alphanumeric → underscore
    .replace(/_+/g, '_')                   // collapse multiple underscores
    .replace(/^_+|_+$/g, '')              // trim leading/trailing underscores

  if (!name.startsWith('x_')) {
    name = 'x_' + name
  }

  // Odoo field names max 63 chars
  return name.substring(0, 63)
}

/**
 * Convert a human-readable label to a valid ERPNext custom field name.
 * Rules: lowercase, spaces/Arabic → underscore, remove special chars, prefix with custom_
 */
export function sanitizeTechnicalNameErpNext(raw: string): string {
  let name = raw
    .toLowerCase()
    .trim()
    .replace(/[\u0600-\u06FF\s]+/g, '_')  // Arabic chars + whitespace → underscore
    .replace(/[^a-z0-9_]/g, '_')           // any non-alphanumeric → underscore
    .replace(/_+/g, '_')                   // collapse multiple underscores
    .replace(/^_+|_+$/g, '')              // trim leading/trailing underscores

  if (!name.startsWith('custom_')) {
    name = 'custom_' + name
  }

  // Frappe field names max 63 chars
  return name.substring(0, 63)
}


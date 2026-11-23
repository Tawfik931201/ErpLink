/**
 * Odoo 20's execute_kw may serialize a message_post recordset as [messageId].
 * Convert it to the scalar ID expected by mail.message.write() so attachment
 * relation commands never receive nested record IDs.
 */
export function normalizeOdooMessageId(result: unknown): number {
  const id = Array.isArray(result) && result.length === 1 ? result[0] : result
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error('Odoo did not return a valid single chatter message ID')
  }
  return id
}

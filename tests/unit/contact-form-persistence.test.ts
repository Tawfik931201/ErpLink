import { existsSync, readFileSync } from 'fs'
import path from 'path'

/**
 * The contact form used to have exactly one destination (an Odoo helpdesk
 * ticket) and a single `try/catch` around everything, so an Odoo outage or a
 * missing `ODOO_*` variable silently swallowed the message while the visitor saw
 * "failed". The rule now is: the message is written to the database FIRST, and
 * only a total failure of both channels reports an error.
 *
 * These are source pins, not behaviour tests — the action needs Clerk, Odoo and
 * Supabase to run. Each one was checked to fail when the rule is reverted.
 */

const root = path.resolve(__dirname, '../..')
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8')

const action = read('src', 'app', 'actions', 'contact.ts')
const adminActions = read('src', 'app', 'actions', 'contact-messages.ts')
const store = read('src', 'lib', 'contact-messages.ts')

// `executeKw` is always called with a type argument (`executeKw<number[]>(…)`),
// so the search string must not include the opening parenthesis.
const ODOO_CALL = 'executeKw<'

describe('the message is saved to the database before anything external runs', () => {
  const insertAt = action.indexOf('await insertContactMessage(')
  const odooAt = action.indexOf(ODOO_CALL)

  it('finds both calls', () => {
    expect(insertAt).toBeGreaterThan(-1)
    expect(odooAt).toBeGreaterThan(-1)
  })

  it('inserts before the first Odoo call', () => {
    expect(insertAt).toBeLessThan(odooAt)
  })

  it('reports failure only when BOTH channels failed', () => {
    expect(action).toContain('if (!savedId && !ticketId)')
  })

  it('records what happened on the other channels on the saved row', () => {
    expect(action).toContain('await finalizeContactMessage(savedId, {')
    expect(action).toContain('odooTicketId: ticketId')
    expect(action).toContain('emailDelivered: emailed')
  })

  it('throttles before writing, so a script cannot fill the table', () => {
    const limitAt = action.indexOf('checkRateLimit(')
    expect(limitAt).toBeGreaterThan(-1)
    expect(limitAt).toBeLessThan(insertAt)
  })
})

describe('email is opt-in and cannot be required for a submission to succeed', () => {
  const envAt = action.indexOf('process.env.CONTACT_INBOX_EMAIL')
  const gateAt = action.indexOf('if (inbox.length > 0)')
  const sendAt = action.indexOf('await sendEmail(')

  it('reads the opt-in variable and gates the send on it', () => {
    expect(envAt).toBeGreaterThan(-1)
    expect(gateAt).toBeGreaterThan(-1)
    expect(sendAt).toBeGreaterThan(gateAt)
  })

  it('treats an empty variable as "send nothing"', () => {
    // `|| ''` + `filter(Boolean)` is what makes an unset variable a no-op
    // instead of a crash or an attempt against the placeholder SendGrid key.
    expect(action).toContain("(process.env.CONTACT_INBOX_EMAIL || '')")
    expect(action).toContain('.filter(Boolean)')
  })
})

describe('the admin surface re-checks admin on every action', () => {
  it('has at least one guard per exported action', () => {
    const exported = adminActions.match(/export async function /g) ?? []
    const guarded = adminActions.match(/await requireAdmin\(\)/g) ?? []
    expect(exported.length).toBeGreaterThan(0)
    expect(guarded.length).toBe(exported.length)
  })

  it('whitelists the statuses instead of trusting the client', () => {
    expect(adminActions).toContain("const STATUSES: readonly ContactMessageStatus[] = ['new', 'read', 'archived']")
    expect(adminActions).toContain('STATUSES.includes(status)')
  })
})

describe('the storage layer stays bounded and quiet', () => {
  it('clamps the page size so the list can never dump the table', () => {
    expect(store).toContain('Math.min(Math.max(params.limit ?? 50, 1), 200)')
  })

  it('never throws from the badge count', () => {
    const fn = store.slice(store.indexOf('export async function countNewContactMessages'))
    expect(fn.slice(0, 700)).toContain('} catch {')
    expect(fn.slice(0, 700)).toContain('return 0')
  })

  it('does not scope messages to a workspace (a visitor may have no account)', () => {
    expect(store).not.toContain('workspace_id')
  })
})

describe('the migration is paste-ready and reversible-by-status, not by delete', () => {
  const file = path.join(root, 'supabase', 'migrations', '20261025_contact_messages.sql')

  it('exists', () => {
    expect(existsSync(file)).toBe(true)
  })

  it('is idempotent and RLS-enabled like every other migration', () => {
    const sql = readFileSync(file, 'utf8')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.contact_messages')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_contact_messages_status')
  })
})

describe('ordering assertions are not vacuous', () => {
  it('detects a wrong order in a synthetic source', () => {
    const wrong = 'await executeKw<number>(...)\nawait insertContactMessage(...)'
    expect(wrong.indexOf('await insertContactMessage(')).toBeGreaterThan(
      wrong.indexOf(ODOO_CALL),
    )
  })
})

/**
 * The inbox is an Odoo-style list: a header row and basic columns. The message
 * body is a free-text field with no length limit, so it must not ride along with
 * 50 rows that nobody has opened yet — it belongs to the record page.
 */
describe('the list carries basic columns, the body belongs to the record page', () => {
  const listClient = read('src', 'app', '(app)', 'admin', 'messages', 'ContactMessagesClient.tsx')
  const detailClient = read(
    'src',
    'app',
    '(app)',
    'admin',
    'messages',
    '[id]',
    'message-detail-client.tsx',
  )

  const listSelect = store.slice(
    store.indexOf('const LIST_COLUMNS'),
    store.indexOf('const RECORD_COLUMNS'),
  )
  const recordSelect = store.slice(
    store.indexOf('const RECORD_COLUMNS'),
    store.indexOf('const RECORD_COLUMNS') + 160,
  )

  it('does not select the message body for the list', () => {
    expect(listSelect).not.toContain('message')
  })

  it('does select the message body for a single record', () => {
    expect(recordSelect).toContain('message')
  })

  it('renders the body on the record page only', () => {
    expect(listClient).not.toContain('row.message')
    expect(detailClient).toContain('row.message')
  })

  it('opens a record by id, so the id is the URL segment', () => {
    expect(listClient).toContain('router.push(`/admin/messages/${id}`)')
  })

  it('has a per-row action menu with read and archive, and it never navigates', () => {
    expect(listClient).toContain('function RowActions(')
    expect(listClient).toContain('event.stopPropagation()')
    expect(listClient).toContain("onStatus('read')")
    expect(listClient).toContain("onStatus('archived')")
  })

  it('rejects a non-uuid before it can reach the database', () => {
    expect(store).toContain("if (!UUID_RE.test(id)) return { ok: false, row: null, error: 'not_found' }")
  })

  it('the substring checks above would catch a body leaking into the list', () => {
    const bad = "const LIST_COLUMNS = 'id, name, message'"
    expect(bad).toContain('message')
    expect(listSelect).not.toContain('message')
  })
})

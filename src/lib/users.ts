import { currentUser } from '@clerk/nextjs/server'
import { cache } from 'react'

import { supabase } from '@/lib/supabase'
import { accessibleWorkspaceId } from '@/lib/workspace-access'
import { ensureDefaultWorkspace } from '@/lib/workspace-defaults'

export const getOrCreateDbUser = cache(async (userId: string) => {
  // Lean select: this lookup runs on EVERY server action (React-cache dedupes
  // it per request, but the row still travels over the wire each time), so
  // fetch only the columns any caller reads.
  // NOTE: `phone` is deliberately NOT in this list. It exists only in
  // migration 20260805_client_phone_and_archive.sql, which was never applied
  // in some environments — selecting it makes EVERY lookup fail with
  // "column users.phone does not exist" and takes the whole app down
  // (2026-10-10 outage). The live columns were verified 2026-10-10 via REST:
  // id, email, name, active_workspace_id, created_at. Do not add a column
  // here without probing the live table first.
  const LEAN_USER_COLUMNS = 'id,email,name,active_workspace_id,created_at'
  const { data: dbUser } = await supabase
    .from('users')
    .select(LEAN_USER_COLUMNS)
    .eq('id', userId)
    .single()

  if (dbUser) {
    if (!dbUser.active_workspace_id) {
      const activeId = await ensureDefaultWorkspace(userId)
      if (activeId) {
        dbUser.active_workspace_id = activeId
      }
    }
    return { ...dbUser, active_workspace_id: await accessibleWorkspaceId(userId, dbUser.active_workspace_id) }
  }

  const clerkUser = await currentUser()
  const email = clerkUser?.emailAddresses[0]?.emailAddress ?? `${userId}@clerk.user`
  const name = clerkUser
    ? `${clerkUser.firstName ?? ''} ${clerkUser.lastName ?? ''}`.trim()
    : 'Zid Merchant'

  // Race-safe create: the dashboard fires ~9 parallel server actions plus a
  // client-side fetch, so two requests for a brand-new user routinely pass
  // the lookup above together. A plain insert makes the loser fail with a
  // unique violation (409) and the whole page crashes with "Could not create
  // database user". upsert+ignoreDuplicates makes the loser a no-op, and the
  // re-select below returns the winner's row either way.
  const { error: upsertError } = await supabase
    .from('users')
    .upsert(
      [
        {
          id: userId,
          email,
          name: name || 'Zid Merchant',
        },
      ],
      { onConflict: 'id', ignoreDuplicates: true }
    )

  if (upsertError) {
    console.error(
      'Failed to create user in Supabase:',
      upsertError.message,
      '| code:',
      (upsertError as { code?: string }).code,
      '| details:',
      (upsertError as { details?: string }).details,
      '| hint:',
      (upsertError as { hint?: string }).hint
    )
    throw new Error('Could not create database user')
  }

  const { data: createdUser, error: readError } = await supabase
    .from('users')
    .select(LEAN_USER_COLUMNS)
    .eq('id', userId)
    .single()

  if (readError || !createdUser) {
    console.error(
      'Failed to read user after upsert:',
      readError?.message ?? 'no row returned'
    )
    throw new Error('Could not create database user')
  }

  if (!createdUser.active_workspace_id) {
    const activeId = await ensureDefaultWorkspace(userId)
    if (activeId) {
      createdUser.active_workspace_id = activeId
    }
  }

  return { ...createdUser, active_workspace_id: await accessibleWorkspaceId(userId, createdUser.active_workspace_id) }
})

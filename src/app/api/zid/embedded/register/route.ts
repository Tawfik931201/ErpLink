import { auth } from '@clerk/nextjs/server'
import { type NextRequest, NextResponse } from 'next/server'

import { getAppBaseUrl } from '@/lib/app-url'
import { getActiveWorkspaceId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { registerEmbeddedAccess } from '@/lib/zid/embedded'

export async function POST(request: NextRequest) {
  // Same-origin JSON POST; a cross-site form must not rotate the credential.
  if (request.headers.get('origin') !== new URL(getAppBaseUrl(request)).origin) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
  }
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = await getActiveWorkspaceId()
  const { data: workspace } = await supabase.from('workspaces').select('user_id')
    .eq('id', workspaceId).maybeSingle()
  if (!workspaceId || workspace?.user_id !== userId) {
    return NextResponse.json({ error: 'Only the workspace owner can enable Embedded' }, { status: 403 })
  }
  const input = await request.json().catch(() => null)
  if (typeof input?.merchantId !== 'string' || input.merchantId.length > 100 || !input.merchantId) {
    return NextResponse.json({ error: 'Invalid merchant ID' }, { status: 400 })
  }
  try {
    await registerEmbeddedAccess(input.merchantId, workspaceId)
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Embedded setup failed' }, { status: 503 })
  }
}

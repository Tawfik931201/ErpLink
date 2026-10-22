import { auth } from '@clerk/nextjs/server'
import { type NextRequest, NextResponse } from 'next/server'

import { recordAudit } from '@/lib/audit-logs'
import { isAdmin } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

/**
 * POST /api/admin/pipeline-selftest — فحص ذاتي شامل للمسار.
 *
 * ⚠️ شغّله على **مساحة إدارية** (ليست مساحة عميل حقيقي): الفحص يكتب
 * صفوفاً وهمية في `sync_queue` و`webhook_inbox` ثم ينظّفها.
 *
 * الغرض: **لا يوجد عملاء حقيقيين بعد** ⇒ كل عيب في الاستقبال أو الطابور
 * أو التليجرام يبقى مخفياً حتى أول موسم حقيقي. هذا الفحص يشغّل المسار
 * **بالكود الحقيقي** ويعرض تقريراً خطوة بخطوة.
 *
 * Body: { workspaceId, confirm: true }
 */

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId || !isAdmin(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const workspaceId = String(body.workspaceId || '')
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
  }
  if (body.confirm !== true) {
    return NextResponse.json({ error: 'confirm:true required' }, { status: 400 })
  }

  // المساحة يجب أن تكون موجودة (وأنها ليست مساحة عميل في الإنتاج إن أمكن).
  const { data: workspace, error: wsErr } = await supabase
    .from('workspaces')
    .select('id,name,user_id')
    .eq('id', workspaceId)
    .maybeSingle()
  if (wsErr || !workspace) {
    return NextResponse.json({ error: 'workspace not found' }, { status: 404 })
  }

  const { runPipelineSelfTest } = await import('@/lib/pipeline-selftest')
  const report = await runPipelineSelfTest(workspaceId)

  await recordAudit({
    actorId: userId,
    actorRole: 'admin',
    action: 'admin.pipeline_selftest',
    entityType: 'workspace',
    entityId: workspaceId,
    metadata: {
      runId: report.runId,
      success: report.success,
      steps: report.steps.map((s) => ({ name: s.name, passed: s.passed, durationMs: s.durationMs })),
    },
  }).catch(() => {})

  return NextResponse.json({
    success: report.success,
    runId: report.runId,
    totalMs: report.totalMs,
    steps: report.steps,
    notes: report.notes,
    workspace: (workspace as { name?: string }).name ?? workspaceId,
  })
}

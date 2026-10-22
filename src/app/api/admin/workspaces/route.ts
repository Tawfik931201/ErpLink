import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

import { isAdmin } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

/**
 * GET /api/admin/workspaces — قائمة المساحات (للأدمن فقط).
 *
 * تُستخدم في لوحة الأدمن لاختيار مساحة إدارية قبل تشغيل الفحص الذاتي
 * للمسار (`/api/admin/pipeline-selftest`). الاستعلام **خفيف**: المعرّف
 * والاسم فقط.
 */
export async function GET() {
  const { userId } = await auth()
  if (!userId || !isAdmin(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { data, error } = await supabase
      .from('workspaces')
      .select('id,name')
      .order('created_at', { ascending: true })
      .limit(200)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({
      success: true,
      workspaces: (data ?? []).map((w) => ({
        id: (w as { id: string }).id,
        name: (w as { name?: string }).name ?? (w as { id: string }).id,
      })),
    })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load workspaces' },
      { status: 500 }
    )
  }
}

'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'

/**
 * Stops the current user impersonation by deleting the cookie.
 *
 * يبدأ محاكاة العميل من /api/admin/impersonate (خارج هذا الملف) — لا دالة
 * بدء هنا: مسارها كان بلا أي مستهلك ويستخدم مساراً غير موجود (/dashboard).
 */
export async function stopImpersonation(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete('impersonated_user_id')
  revalidatePath('/')
}

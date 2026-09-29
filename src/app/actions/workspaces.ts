'use server'

import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'

import { getActiveUserId } from '@/lib/auth'
import { unregisterSallaWebhooks } from '@/lib/salla-client'
import {
  listShopifyWebhooks,
  registerShopifyWebhook,
  unregisterShopifyWebhookTopic,
  unregisterShopifyWebhooks,
} from '@/lib/shopify-client'
import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser as ensureDbUser } from '@/lib/users'
import { syncWebhooksWithSettings, unregisterAllZidWebhooks } from '@/lib/zid/webhooks'

async function getOrCreateDbUser() {
  const userId = await getActiveUserId()
  if (!userId) throw new Error('Unauthorized')

  return ensureDbUser(userId)
}


export async function getWorkspaces() {
  try {
    const user = await getOrCreateDbUser()
    
    const { data: ownedWorkspaces, error: err1 } = await supabase
      .from('workspaces')
      .select('*, merchant_tokens(merchant_id, name), erp_connections(id)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    const { data: membershipData, error: err2 } = await supabase
      .from('workspace_members')
      .select('*, workspaces(*, merchant_tokens(merchant_id, name), erp_connections(id))')
      .eq('user_id', user.id)

    if (err1 || err2) throw new Error('Failed to fetch workspaces from database')

    const memberWorkspaces = (membershipData || []).map(m => m.workspaces).filter(Boolean)
    
    // Combine and deduplicate
    const allWorkspacesMap = new Map()
    ownedWorkspaces?.forEach(w => allWorkspacesMap.set(w.id, w))
    memberWorkspaces.forEach(w => allWorkspacesMap.set(w.id, w))
    
    const workspaces = Array.from(allWorkspacesMap.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )

    return { success: true, workspaces, activeWorkspaceId: user.active_workspace_id }
  } catch (error: any) {
    console.error('Failed to get workspaces:', error)
    return { success: false, error: error.message || 'Failed to fetch workspaces' }
  }
}

/**
 * Lightweight existence check used by the dashboard layout on every navigation.
 * Uses head+count queries (no row data, no joins) so it is much faster than
 * getWorkspaces(), which loads merchant tokens and ERP connections.
 */
export async function hasAnyWorkspace() {
  try {
    const userId = await getActiveUserId()
    if (!userId) return { success: false, hasWorkspace: false }


    const { count: ownedCount } = await supabase
      .from('workspaces')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)

    if ((ownedCount ?? 0) > 0) return { success: true, hasWorkspace: true }

    const { count: memberCount } = await supabase
      .from('workspace_members')
      .select('workspace_id', { count: 'exact', head: true })
      .eq('user_id', userId)

    return { success: true, hasWorkspace: (memberCount ?? 0) > 0 }
  } catch (error: any) {
    console.error('Failed to check workspaces:', error)
    // Fail open so the dashboard still renders if the check errors out
    return { success: false, hasWorkspace: true }
  }
}

export async function createWorkspace(name: string) {
  try {
    if (!name || name.trim() === '') throw new Error('Workspace name is required')

    const user = await getOrCreateDbUser()

    const { data: workspace, error: createError } = await supabase
      .from('workspaces')
      .insert([{ name: name.trim(), user_id: user.id }])
      .select()
      .single()

    if (createError) throw new Error('Failed to create workspace in database')

    // Automatically set the new workspace as active if the user doesn't have one
    if (!user.active_workspace_id) {
      await supabase
        .from('users')
        .update({ active_workspace_id: workspace.id })
        .eq('id', user.id)
    }

    revalidatePath('/app/settings/workspace')
    return { success: true, workspace }
  } catch (error: any) {
    console.error('Failed to create workspace:', error)
    return { success: false, error: error.message || 'Failed to create workspace' }
  }
}

export async function updateWorkspace(id: string, name: string) {
  try {
    if (!name || name.trim() === '') throw new Error('Workspace name is required')

    const user = await getOrCreateDbUser()

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('user_id')
      .eq('id', id)
      .single()

    if (!workspace) throw new Error('Workspace not found')

    if (workspace.user_id !== user.id) throw new Error('Unauthorized: Only the workspace owner can edit workspace settings')

    const { data: updated, error } = await supabase
      .from('workspaces')
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) throw new Error('Failed to update workspace in database')

    revalidatePath('/app/settings/workspace')
    return { success: true, workspace: updated }
  } catch (error: any) {
    console.error('Failed to update workspace:', error)
    return { success: false, error: error.message || 'Failed to update workspace' }
  }
}

export async function deleteWorkspace(id: string) {
  try {
    const user = await getOrCreateDbUser()

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, user_id')
      .eq('id', id)
      .single()

    if (!workspace || workspace.user_id !== user.id) {
      throw new Error('Workspace not found or unauthorized (Only owners can delete)')
    }

    const { error } = await supabase
      .from('workspaces')
      .delete()
      .eq('id', id)

    if (error) throw new Error('Failed to delete workspace from database')

    // If deleted workspace was the active one, clear active workspace ID or pick another one
    if (user.active_workspace_id === id) {
      const { workspaces } = await getWorkspaces() as any
      const remaining = workspaces?.[0]

      await supabase
        .from('users')
        .update({ active_workspace_id: remaining?.id || null })
        .eq('id', user.id)
    }

    revalidatePath('/app/settings/workspace')
    return { success: true }
  } catch (error: any) {
    console.error('Failed to delete workspace:', error)
    return { success: false, error: error.message || 'Failed to delete workspace' }
  }
}

export async function setActiveWorkspace(id: string) {
  try {
    const user = await getOrCreateDbUser()

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, user_id, workspace_members(user_id)')
      .eq('id', id)
      .single()

    if (!workspace) throw new Error('Workspace not found')

    const isOwner = workspace.user_id === user.id
    const isMember = workspace.workspace_members?.some((m: any) => m.user_id === user.id)

    if (!isOwner && !isMember) throw new Error('Unauthorized')

    const { error } = await supabase
      .from('users')
      .update({ active_workspace_id: id })
      .eq('id', user.id)

    if (error) throw new Error('Failed to update active workspace')

    revalidatePath('/app/dashboard')
    revalidatePath('/app/settings/workspace')
    return { success: true }
  } catch (error: any) {
    console.error('Failed to set active workspace:', error)
    return { success: false, error: error.message || 'Failed to set active workspace' }
  }
}

const getCachedZidToken = unstable_cache(
  async (workspaceId: string) => {
    const { data: token, error } = await supabase
      .from('merchant_tokens')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (error) throw new Error('Failed to query merchant token: ' + error.message)
    return token
  },
  ['zid-token'],
  { revalidate: 30, tags: ['zid-token'] }
)

export async function getActiveWorkspaceZidToken() {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: true, token: null }
    }

    const token = await getCachedZidToken(user.active_workspace_id)
    return { success: true, token }
  } catch (error: any) {
    console.error('Failed to get Zid token:', error)
    return { success: false, error: error.message || 'Failed to fetch Zid token' }
  }
}

export async function disconnectZidStore(merchantId: string) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('No active workspace selected')
    }

    // Unregister this merchant's webhooks from Zid first (best-effort, non-blocking)
    unregisterAllZidWebhooks(merchantId).catch((err) =>
      console.error('[Zid Webhook] Cleanup on disconnect failed:', err)
    )

    const { error } = await supabase
      .from('merchant_tokens')
      .delete()
      .eq('merchant_id', merchantId)
      .eq('workspace_id', user.active_workspace_id)

    if (error) throw new Error('Failed to disconnect Zid store: ' + error.message)

    revalidateTag('zid-token')
    revalidatePath('/app/connect-store')
    revalidatePath('/app/settings/workspace')
    revalidatePath('/app/connect-store')
    return { success: true }
  } catch (error: any) {
    console.error('Failed to disconnect Zid store:', error)
    return { success: false, error: error.message || 'Failed to disconnect Zid store' }
  }
}

export async function updateZidSyncSettings(merchantId: string, settings: any) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('No active workspace selected')
    }

    // Save new settings to DB
    const { error } = await supabase
      .from('merchant_tokens')
      .update({ sync_settings: settings })
      .eq('merchant_id', merchantId)
      .eq('workspace_id', user.active_workspace_id)

    if (error) throw new Error('Failed to update sync settings: ' + error.message)

    // Sync webhooks with Zid (clear old and register currently enabled)
    // We do NOT await this to keep the save action fast; errors are logged server-side
    syncWebhooksWithSettings(merchantId, settings).catch((err) =>
      console.error('[Zid Webhook] syncWebhooksWithSettings failed:', err)
    )

    revalidateTag('zid-token')
    revalidatePath('/app/connect-store')
    return { success: true }
  } catch (error: any) {
    console.error('Failed to update sync settings:', error)
    return { success: false, error: error.message || 'Failed to update sync settings' }
  }
}

const getCachedSallaToken = unstable_cache(
  async (workspaceId: string) => {
    const { data: token, error } = await supabase
      .from('salla_tokens')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (error) throw new Error('Failed to query Salla token: ' + error.message)
    return token
  },
  ['salla-token'],
  { revalidate: 30, tags: ['salla-token'] }
)

export async function getActiveWorkspaceSallaToken() {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: true, token: null }
    }

    const token = await getCachedSallaToken(user.active_workspace_id)
    return { success: true, token }
  } catch (error: any) {
    console.error('Failed to get Salla token:', error)
    return { success: false, error: error.message || 'Failed to fetch Salla token' }
  }
}

export async function disconnectSallaStore(merchantId: string) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('No active workspace selected')
    }

    // Unregister webhooks from Salla before deleting the tokens (needs auth token)
    await unregisterSallaWebhooks(merchantId)

    const { error } = await supabase
      .from('salla_tokens')
      .delete()
      .eq('merchant_id', merchantId)
      .eq('workspace_id', user.active_workspace_id)

    if (error) throw new Error('Failed to disconnect Salla store: ' + error.message)

    revalidateTag('salla-token')
    revalidatePath('/app/connect-store')
    revalidatePath('/app/settings/workspace')
    revalidatePath('/app/connect-store')
    return { success: true }
  } catch (error: any) {
    console.error('Failed to disconnect Salla store:', error)
    return { success: false, error: error.message || 'Failed to disconnect Salla store' }
  }
}

export async function updateSallaSyncSettings(merchantId: string, settings: any) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('No active workspace selected')
    }

    // Save new settings to DB
    const { error } = await supabase
      .from('salla_tokens')
      .update({ sync_settings: settings })
      .eq('merchant_id', merchantId)
      .eq('workspace_id', user.active_workspace_id)

    if (error) throw new Error('Failed to update Salla sync settings: ' + error.message)

    revalidateTag('salla-token')
    revalidatePath('/app/connect-store')
    return { success: true }
  } catch (error: any) {
    console.error('Failed to update Salla sync settings:', error)
    return { success: false, error: error.message || 'Failed to update Salla sync settings' }
  }
}

const getCachedShopifyToken = unstable_cache(
  async (workspaceId: string) => {
    const { data: token, error } = await supabase
      .from('shopify_tokens')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (error) throw new Error('Failed to query Shopify token: ' + error.message)
    return token
  },
  ['shopify-token'],
  { revalidate: 30, tags: ['shopify-token'] }
)

export async function getActiveWorkspaceShopifyToken() {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: true, token: null }
    }

    const token = await getCachedShopifyToken(user.active_workspace_id)
    return { success: true, token }
  } catch (error: any) {
    console.error('Failed to get Shopify token:', error)
    return { success: false, error: error.message || 'Failed to fetch Shopify token' }
  }
}

export async function disconnectShopifyStore(shopDomain: string) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('No active workspace selected')
    }

    // Unregister webhooks from Shopify before deleting the tokens (needs auth token)
    await unregisterShopifyWebhooks(shopDomain)

    const { error } = await supabase
      .from('shopify_tokens')
      .delete()
      .eq('shop_domain', shopDomain)
      .eq('workspace_id', user.active_workspace_id)

    if (error) throw new Error('Failed to disconnect Shopify store: ' + error.message)

    revalidateTag('shopify-token')
    revalidatePath('/app/connect-store')
    revalidatePath('/app/settings/workspace')
    revalidatePath('/app/connect-store')
    return { success: true }
  } catch (error: any) {
    console.error('Failed to disconnect Shopify store:', error)
    return { success: false, error: error.message || 'Failed to disconnect Shopify store' }
  }
}

export async function updateShopifySyncSettings(shopDomain: string, settings: any) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('No active workspace selected')
    }

    // Save new settings to DB first (source of truth for the UI toggles).
    // Topic catalog: src/lib/shopify-topics.ts (SHOPIFY_TOPIC_CATALOG) — must
    // stay in sync with shopify.app.toml + mapping-constants SHOPIFY_EVENTS.
    const { error } = await supabase
      .from('shopify_tokens')
      .update({ sync_settings: settings })
      .eq('shop_domain', shopDomain)
      .eq('workspace_id', user.active_workspace_id)

    if (error) throw new Error('Failed to update Shopify sync settings: ' + error.message)

    // Toggle ON → register a real webhook; OFF → delete it (non-blocking,
    // best-effort so a Shopify API blip never fails the save).
    const { data: tok } = await supabase
      .from('shopify_tokens')
      .select('access_token')
      .eq('shop_domain', shopDomain)
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()
    const accessToken: string | null = (tok as any)?.access_token ?? null
    if (accessToken) {
      for (const [topic, val] of Object.entries(settings as Record<string, any>)) {
        const enabled = (val as any)?.shopify2odoo === true
        if (enabled) {
          registerShopifyWebhook(shopDomain, topic, accessToken).catch((err) =>
            console.error(`[Shopify] toggle ON failed for "${topic}":`, err?.message || err)
          )
        } else {
          unregisterShopifyWebhookTopic(shopDomain, topic).catch((err) =>
            console.error(`[Shopify] toggle OFF failed for "${topic}":`, err?.message || err)
          )
        }
      }
    } else {
      console.warn('[Shopify] No access token found — skipping webhook sync after settings save')
    }

    revalidateTag('shopify-token')
    revalidatePath('/app/connect-store')
    return { success: true }
  } catch (error: any) {
    console.error('Failed to update Shopify sync settings:', error)
    return { success: false, error: error.message || 'Failed to update Shopify sync settings' }
  }
}

/**
 * زر «مزامنة الاشتراكات»: يعيد تسجيل webhooks الناقصة حسب الإعدادات المحفوظة
 * ويحذف الزائدة — لإصلاح أي انحراف بين Shopify والـ DB دون لمس التبديلات.
 */
export async function syncShopifyWebhooks(shopDomain: string) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) throw new Error('No active workspace selected')

    const { data: tok, error } = await supabase
      .from('shopify_tokens')
      .select('access_token, sync_settings')
      .eq('shop_domain', shopDomain)
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()
    if (error || !tok) throw new Error('Shopify store not connected')

    const settings = ((tok as any).sync_settings as Record<string, any>) || {}
    const accessToken = (tok as any).access_token as string
    const existing = await listShopifyWebhooks(shopDomain)
    const existingTopics = new Set(existing.map((w: any) => w.topic))

    let registered = 0
    let removed = 0
    for (const [topic, val] of Object.entries(settings)) {
      const enabled = (val as any)?.shopify2odoo === true
      if (enabled && !existingTopics.has(topic)) {
        const res = await registerShopifyWebhook(shopDomain, topic, accessToken)
        if (res) registered++
      } else if (!enabled && existingTopics.has(topic)) {
        removed += await unregisterShopifyWebhookTopic(shopDomain, topic)
      }
    }

    revalidateTag('shopify-token')
    revalidatePath('/app/connect-store')
    return { success: true, registered, removed }
  } catch (error: any) {
    console.error('Failed to sync Shopify webhooks:', error)
    return { success: false, error: error.message || 'Failed to sync Shopify webhooks' }
  }
}

/**
 * يتحقق أن `merchantId` المطلوب يخص مساحة العمل النشطة للمستخدم الحالي،
 * ويعيده عند التطابق فقط.
 *
 * بدون هذا التحقق، أي متصل (حتى غير مسجّل) كان بإمكانه استدعاء دوال زد
 * بتمرير merchantId الخاص بالعميل، والوصول إلى توكناته وتعديل webhooks متجره.
 * النمط مطابق لـ disconnectZidStore / updateZidSyncSettings المجاورَين.
 *
 * ملاحظة: getAccessToken() يُحدّث التوكن ويكتبه، فالتسريب كان Modification لا قراءة فقط.
 */
async function assertOwnsZidMerchant(merchantId: string): Promise<string> {
  if (!merchantId) {
    throw new Error('Unauthorized')
  }

  const user = await getOrCreateDbUser()
  if (!user.active_workspace_id) {
    throw new Error('No active workspace selected')
  }

  const { data: token, error } = await supabase
    .from('merchant_tokens')
    .select('merchant_id')
    .eq('workspace_id', user.active_workspace_id)
    .eq('merchant_id', merchantId)
    .maybeSingle()

  if (error) {
    throw new Error('Failed to verify Zid store ownership: ' + error.message)
  }

  if (!token) {
    throw new Error('Unauthorized')
  }

  return merchantId
}

/** يبني بيانات الاعتماد لزد بعد التحقق من ملكية المتجر. */
async function getZidCredsForOwnedMerchant(merchantId: string) {
  const { getAccessToken } = await import('@/lib/zid/token')
  const { ZidAPI } = await import('@/lib/zid-client')

  await assertOwnsZidMerchant(merchantId)

  const tokens = await getAccessToken(merchantId)
  return {
    ZidAPI,
    creds: {
      authorization: tokens.authorization || tokens.accessToken,
      managerToken: tokens.accessToken,
    },
  }
}

/** ملخص صحة webhooks زد (يُعرض في store-selector). آمن: يعيد null عند الفشل. */
export async function getZidWebhookHealth(merchantId: string) {
  try {
    const { ZidAPI, creds } = await getZidCredsForOwnedMerchant(merchantId)
    const res = await ZidAPI.webhooks.healthSummary(creds)
    return { success: true, health: res.data ?? null }
  } catch (error: any) {
    console.error('[Zid] health-summary failed:', error?.message || error)
    return { success: false, health: null, error: error?.message || 'Failed to fetch health' }
  }
}

/** زر recoverBroken: يعيد تفعيل webhooks زد المعطلة. */
export async function recoverZidBrokenWebhooks(merchantId: string) {
  try {
    const { ZidAPI, creds } = await getZidCredsForOwnedMerchant(merchantId)
    await ZidAPI.webhooks.recoverBroken(creds)
    return { success: true }
  } catch (error: any) {
    console.error('[Zid] recoverBroken failed:', error?.message || error)
    return { success: false, error: error?.message || 'Failed to recover webhooks' }
  }
}



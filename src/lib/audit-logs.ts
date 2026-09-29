import { supabase } from './supabase'

export type AuditActorRole = 'user' | 'admin' | 'system'

export interface AuditLogInput {
  actorId: string
  actorRole: AuditActorRole
  action: string
  entityType: string
  entityId?: string | null
  metadata?: Record<string, unknown>
}

export async function recordAudit(input: AuditLogInput): Promise<void> {
  try {
    const { error } = await supabase.from('audit_logs').insert([
      {
        actor_id: input.actorId,
        actor_role: input.actorRole,
        action: input.action,
        entity_type: input.entityType,
        entity_id: input.entityId ?? null,
        metadata: input.metadata ?? {},
      },
    ])
    if (error) {
      console.error('[audit] failed to insert:', error.message)
    }
  } catch (err) {
    console.error('[audit] unexpected error:', err)
  }
}

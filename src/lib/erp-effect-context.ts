import { AsyncLocalStorage } from 'async_hooks'
import { createHash, randomUUID } from 'crypto'

import { supabase } from './supabase'

export interface ErpExecutionContext {
  workspaceId: string
  platform: string
  storeId: string
  erpConnectionId: string
  eventId: string
  storeEntityId: string
  rootModel: string
  connectionGeneration?: string
}

const execution = new AsyncLocalStorage<{ context: ErpExecutionContext; ordinal: number; createIdentity?: string; health: { uncertain: boolean } }>()

export function withErpCreateIdentity<T>(identity: string, callback: () => Promise<T>): Promise<T> {
  const state = execution.getStore()
  return state ? execution.run({ ...state, createIdentity: identity }, callback) : callback()
}

export function withErpExecutionContext<T>(context: ErpExecutionContext, callback: () => Promise<T>): Promise<T> {
  if (!context.workspaceId || !context.platform || !context.storeId || !context.erpConnectionId || !context.storeEntityId || !context.rootModel) {
    throw new Error('ERP execution context is incomplete')
  }
  const state = { context, ordinal: 0, health: { uncertain: false } }
  return execution.run(state, async () => {
    try {
      const result = await callback()
      if (state.health.uncertain) throw new ErpEffectUncertainError()
      return result
    } catch (error) {
      if (state.health.uncertain) throw new ErpEffectUncertainError()
      throw error
    }
  })
}

export class ErpEffectUncertainError extends Error {
  readonly code = 'ERP_EFFECT_UNCERTAIN'
  constructor() {
    super('ERP_OUTCOME_UNKNOWN: unknown outcome; reconciliation required before retry')
    this.name = 'ErpEffectUncertainError'
    const state = execution.getStore()
    if (state) state.health.uncertain = true
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]))
  return value
}

/** Reserve BEFORE a remote create. A crash leaves a blocked reservation; it
 * must be reconciled, never treated as a lease expiring into another create. */
export async function runErpCreateEffect<T extends string | number>(
  model: string,
  values: Record<string, unknown>,
  operation: () => Promise<T>,
  confirmedRejection: (error: unknown) => boolean,
  decode: (id: string) => T,
): Promise<T> {
  const state = execution.getStore()
  if (!state) return operation() // Non-queue/manual callers retain existing behavior.
  if (state.health.uncertain) throw new ErpEffectUncertainError()
  const { context } = state
  const ordinal = state.ordinal++
  const identity = state.createIdentity || (model === context.rootModel ? 'root' : ['related', ordinal, stable(values)])
  const operationKey = createHash('sha256').update(JSON.stringify([
    context.workspaceId, context.platform, context.storeId, context.erpConnectionId,
    // Credential rotation changes execution authority, not business identity.
    // The resource baseline separately rejects replacement of this ERP database.
    context.storeEntityId, model, identity,
  ])).digest('hex')
  const id = randomUUID()
  const { error: insertError } = await supabase.from('erp_effects').insert({
    id, operation_key: operationKey, workspace_id: context.workspaceId,
    platform: context.platform, store_id: context.storeId,
    erp_connection_id: context.erpConnectionId, entity_id: context.storeEntityId,
    connection_generation: context.connectionGeneration || '',
    model, status: 'in_progress', remote_id: null,
  })
  let reservationId = id
  if (insertError) {
    if (insertError.code !== '23505') throw new Error('ERP effect reservation unavailable')
    const { data: existing, error } = await supabase.from('erp_effects')
      .select('id,status,remote_id').eq('operation_key', operationKey).eq('workspace_id', context.workspaceId).maybeSingle()
    if (error || !existing) throw new Error('ERP effect reservation unavailable')
    if (existing.status === 'succeeded' && existing.remote_id) return decode(String(existing.remote_id))
    if (existing.status !== 'rejected') throw new ErpEffectUncertainError()
    const { data: reclaimed, error: claimError } = await supabase.from('erp_effects')
      .update({ status: 'in_progress', error_code: null, updated_at: new Date().toISOString() })
      .eq('id', existing.id).eq('workspace_id', context.workspaceId).eq('status', 'rejected').select('id').maybeSingle()
    if (claimError || !reclaimed) throw new ErpEffectUncertainError()
    reservationId = existing.id
  }
  let remoteId: T
  try {
    remoteId = await operation()
  } catch (error) {
    const rejected = confirmedRejection(error)
    try {
      const { data: saved, error: saveError } = await supabase.from('erp_effects').update({
        status: rejected ? 'rejected' : 'uncertain', error_code: rejected ? 'ERP_REJECTED' : 'UNKNOWN_OUTCOME', updated_at: new Date().toISOString(),
      }).eq('id', reservationId).eq('workspace_id', context.workspaceId).select('id').maybeSingle()
      if (saveError || !saved) throw new ErpEffectUncertainError()
    } catch { throw new ErpEffectUncertainError() }
    if (!rejected) throw new ErpEffectUncertainError()
    throw error
  }
  if ((typeof remoteId === 'number' && (!Number.isInteger(remoteId) || remoteId <= 0)) ||
      (typeof remoteId === 'string' && !remoteId.trim()) ||
      !['string', 'number'].includes(typeof remoteId)) throw new ErpEffectUncertainError()
  try {
    const { data: saved, error: saveError } = await supabase.from('erp_effects').update({
      status: 'succeeded', remote_id: String(remoteId), error_code: null, updated_at: new Date().toISOString(),
    }).eq('id', reservationId).eq('workspace_id', context.workspaceId).select('id').maybeSingle()
    if (saveError || !saved) throw new ErpEffectUncertainError()
  } catch { throw new ErpEffectUncertainError() }
  return remoteId
}

import { AsyncLocalStorage } from 'async_hooks'

import type { ZidOrderTokenScope } from '@/lib/zid/order-enrichment'
import type { StoredZidTokens } from '@/lib/zid/types'

export interface SyncRequestContext {
  readonly workspaceId: string
  readonly platform?: string
  readonly storeId?: string
  readonly merchantId?: string
  readonly eventId?: string
  readonly zidTokens: Map<string, StoredZidTokens>
  readonly zidTokenScopes: Map<string, ZidOrderTokenScope | null>
  readonly normalizedStoreIds: Map<string, number>
  readonly verifiedStores: Set<string>
  readonly standardMappingSettings: Map<string, Record<string, unknown> | null>
  readonly settingsStoreKeys: Map<string, string>
}

export interface SyncRequestContextOptions {
  workspaceId: string
  platform?: string
  storeId?: string
  merchantId?: string
  eventId?: string
}

const syncStorage = new AsyncLocalStorage<SyncRequestContext>()

export function getSyncRequestContext(): SyncRequestContext | undefined {
  return syncStorage.getStore()
}

export function createSyncRequestContext(options: SyncRequestContextOptions): SyncRequestContext {
  return {
    workspaceId: options.workspaceId,
    platform: options.platform,
    storeId: options.storeId,
    merchantId: options.merchantId,
    eventId: options.eventId,
    zidTokens: new Map(),
    zidTokenScopes: new Map(),
    normalizedStoreIds: new Map(),
    verifiedStores: new Set(),
    standardMappingSettings: new Map(),
    settingsStoreKeys: new Map(),
  }
}

export function withSyncRequestContext<T>(
  contextOrOptions: SyncRequestContext | SyncRequestContextOptions,
  fn: () => Promise<T>
): Promise<T> {
  const current = getSyncRequestContext()
  // If already running inside an active context with the same workspaceId, preserve it.
  if (current && (!contextOrOptions.workspaceId || current.workspaceId === contextOrOptions.workspaceId)) {
    return fn()
  }

  const context: SyncRequestContext = 'zidTokens' in contextOrOptions
    ? contextOrOptions
    : createSyncRequestContext(contextOrOptions)

  return syncStorage.run(context, fn)
}

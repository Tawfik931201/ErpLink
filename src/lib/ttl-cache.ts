/**
 * In-process TTL cache with single-flight dedupe.
 *
 * Unlike Next's `unstable_cache`, this works identically in dev and prod,
 * survives full page reloads (module scope lives for the process), and
 * coalesces concurrent identical requests into a single upstream call.
 * Use it to memoize slow server-side reads (Odoo XML-RPC, Supabase lookups)
 * so Mapping Center and similar pages render and switch tabs fast.
 *
 * Never store secrets here - only memoized read results.
 */

type CacheEntry<T> = { value: T; expiresAt: number }

export function createTtlCache() {
  const store = new Map<string, CacheEntry<unknown>>()
  const inflight = new Map<string, Promise<unknown>>()

  return {
    /**
     * Return the cached value for `key` when fresh; otherwise run
     * `fetcher` once (shared by all concurrent callers) and cache it.
     */
    async get<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
      const hit = store.get(key)
      if (hit && hit.expiresAt > Date.now()) return hit.value as T

      const running = inflight.get(key)
      if (running) return running as Promise<T>

      const promise = fetcher()
        .then((value) => {
          store.set(key, { value, expiresAt: Date.now() + ttlMs })
          return value
        })
        .finally(() => {
          inflight.delete(key)
        })

      inflight.set(key, promise)
      return promise
    },

    /** Store a value pre-computed outside the cache (e.g. a forced refresh). */
    set<T>(key: string, value: T, ttlMs: number) {
      store.set(key, { value, expiresAt: Date.now() + ttlMs })
    },

    /** Drop a single entry (also cancels in-flight dedupe for it). */
    delete(key: string) {
      store.delete(key)
      inflight.delete(key)
    },

    /** Drop every entry whose key starts with `prefix` (also cancels dedupe). */
    clear(prefix: string) {
      for (const key of [...store.keys()]) {
        if (key.startsWith(prefix)) store.delete(key)
      }
      for (const key of [...inflight.keys()]) {
        if (key.startsWith(prefix)) inflight.delete(key)
      }
    },
  }
}

export const ttlCache = createTtlCache()
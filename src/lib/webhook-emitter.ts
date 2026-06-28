/**
 * webhook-emitter.ts
 *
 * Singleton EventEmitter that bridges the webhook POST handler and the SSE stream.
 * Because Next.js may run route handlers in separate module instances, we attach
 * the emitter to the Node.js `global` object so it is truly shared across all
 * route modules in the same process.
 */

import { EventEmitter } from 'events'

export interface WebhookEventPayload {
  event: string
  store_id: number
  data: Record<string, unknown>
  timestamp: string
  receivedAt: string
}

// Attach to global so it survives hot-module-replacement in dev
const globalWithEmitter = global as typeof global & {
  __zidWebhookEmitter?: EventEmitter
}

if (!globalWithEmitter.__zidWebhookEmitter) {
  const emitter = new EventEmitter()
  emitter.setMaxListeners(100) // support many concurrent SSE clients
  globalWithEmitter.__zidWebhookEmitter = emitter
}

export const webhookEmitter = globalWithEmitter.__zidWebhookEmitter!

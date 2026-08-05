/**
 * Sync Queue Background Runner
 * 
 * Periodically polls the `sync_queue` table in Supabase and processes
 * pending jobs in the background without blocking client requests.
 */

import { processSyncQueue } from './sync-queue'

// Use global variable to survive Hot Module Replacement (HMR) during development
const g = global as any

const RUNNER_INTERVAL_MS = 5000 // Poll every 5 seconds

export function startSyncQueueRunner(): void {
  // Prevent running during production build phase
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  
  // Prevent duplicate runner instances
  if (g.__syncQueueRunnerStarted) {
    return
  }
  g.__syncQueueRunnerStarted = true

  console.info('[SyncQueueRunner] 🚀 Started background Sync Queue Runner')

  g.__syncQueueRunnerInterval = setInterval(async () => {
    // Prevent overlapping execution
    if (g.__syncQueueRunnerProcessing) {
      return
    }

    try {
      g.__syncQueueRunnerProcessing = true
      
      // Process up to 5 items in the queue
      await processSyncQueue(5)
      
    } catch (error) {
      console.error('[SyncQueueRunner] Error in background execution:', error)
    } finally {
      g.__syncQueueRunnerProcessing = false
    }
  }, RUNNER_INTERVAL_MS)
}

export function stopSyncQueueRunner(): void {
  if (g.__syncQueueRunnerInterval) {
    clearInterval(g.__syncQueueRunnerInterval)
    g.__syncQueueRunnerInterval = undefined
    console.info('[SyncQueueRunner] 🛑 Stopped background Sync Queue Runner')
  }
  g.__syncQueueRunnerStarted = false
  g.__syncQueueRunnerProcessing = false
}

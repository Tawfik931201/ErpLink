#!/usr/bin/env node
/**
 * Prints the partner system migration SQL to stdout, pretty-formatted.
 *
 * Why: Supabase migrations are not auto-applied from Next.js to avoid DDL
 * permissions on the client runtime. Run this once per environment:
 *
 *   node scripts/print-partner-migration.mjs > partner-migration.sql
 *
 * Then paste the SQL into the Supabase SQL Editor and run it.
 *
 * Idempotent: every CREATE uses IF NOT EXISTS so re-runs are safe.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const target = resolve(__dirname, '..', 'supabase', 'migrations', '20260711_partner_system.sql')

const sql = readFileSync(target, 'utf8')

process.stdout.write(
  '-- ========================================================================\n' +
  '-- Partner System Migration (idempotent chunk — safe to re-run)               \n' +
  '-- Paste this into Supabase Dashboard → SQL Editor → Run.                   \n' +
  '-- This file generates the companion table/col/RLS bundles for the         \n' +
  '-- /partners landing, the partner onboarding flow, agreements, payouts,    \n' +
  '-- commissions and audit logging.                                          \n' +
  '-- ========================================================================\n\n' +
  sql,
)

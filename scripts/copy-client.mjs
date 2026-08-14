#!/usr/bin/env node
/**
 * Copy the hand-written web client bundle into dist/ so the published package
 * serves it at exports["./client"] (dsh-client-modules serves it under
 * /plugins/evo-memory/client.js). The client is plain JS — no bundling.
 */
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'src', 'client', 'client.js')
const target = join(root, 'dist', 'client.js')
mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)
console.log('[copy-client] dist/client.js updated')

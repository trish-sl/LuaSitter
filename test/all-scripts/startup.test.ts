// Every LuaSitter1 and LuaSitter2 script starts, and survives a sitter sitting,
// touching and standing, without a run-time error. (A run-time error crashes the
// script in rezless and fails the test, as it would stop the script in-world.)
import { describe, it, expect } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { buildFurniture, LS1, LS2 } from '../helpers/furniture.js'

function luauFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) out.push(...luauFiles(p))
    else if (name.endsWith('.luau')) out.push(p)
  }
  return out
}

const LS2_CARD = `MTYPE 0
SITTER 0|Left
SYNC Cuddle|cud_a
ANIM Cuddle|smile|5
{Cuddle}<0.0,0.3,0.5><0.0,0.0,0.0>
SITTER 1|Right
SYNC Cuddle|cud_b
{Cuddle}<0.0,-0.3,0.5><0.0,0.0,0.0>
PROP Ball|ball|0|<0,0,1><0,0,0>`

const LS1_CARD = `SITTER 0
POSE Sit1|cud_a
{Sit1}<0.0,0.0,0.5><0.0,0.0,0.0>`

// Scripts that live outside the furniture: start them on their own.
const STANDALONE = new Set([
  '[LS]helperscript', '[LS]object', '[LS]LockGuard-object', 'LS-update-receiver', 'LS-update-sender',
  'LShelper-script', 'LSprop',
])

async function check(file: string, system: 1 | 2) {
  const name = path.basename(file, '.luau')
  const sitName = system === 2 ? '[LS]sit' : 'LSsit'
  const sources: Record<string, string> = { [sitName]: (system === 2 ? LS2 + '[LS]sit.luau' : LS1 + 'LSsit.luau'), [name]: file }
  const standalone = STANDALONE.has(name)
  const scripts = standalone ? [name] : name === sitName ? [sitName] : [sitName, name]
  if (system === 2 && !standalone) scripts.push('[LS]sit 1')
  const f = await buildFurniture({
    sources: { ...sources, '[LS]sit 1': LS2 + '[LS]sit.luau' },
    scripts,
    prims: 2,
    notecards: {
      LSpos: system === 2 ? LS2_CARD : LS1_CARD,
      '[LS]sequence_settings': 'SEQUENCE Show\nPLAY Cuddle\nWAIT 5',
      '[LS]Xcite_settings': 'Cuddle|0|1|0',
    },
    animations: ['cud_a', 'cud_b', 'smile'],
  })
  f.start()
  if (!standalone) {
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    f.settle(10_000)
    f.stand(alice)
  }
  f.settle(5_000)
  // nothing said on DEBUG_CHANNEL (script errors)
  for (const s of Object.values(f.scripts)) {
    expect(s.chat.filter((c) => c.channel === 2147483647)).toEqual([])
  }
}

describe('every LuaSitter2 script starts without errors', () => {
  for (const file of luauFiles(LS2)) {
    it(path.relative(LS2, file).replace(/\\/g, '/'), async () => { await check(file, 2) })
  }
})

describe('every LuaSitter1 script starts without errors', () => {
  for (const file of luauFiles(LS1)) {
    it(path.relative(LS1, file).replace(/\\/g, '/'), async () => { await check(file, 1) })
  }
})

// LuaSitter2: DUMP ([LS]adjuster) writes the setup as notecard text, names the
// notecard in use, and survives a round trip (dump -> notecard -> dump).
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS } from '../helpers/furniture.js'
import type { Furniture } from '../helpers/furniture.js'

const CARD = `MTYPE 1
SITTER 0|Left
SYNC Cuddle|cud_a
SYNC Talk|talk_a
ANIM Cuddle|smile|5
{Cuddle}<0.000,0.300,0.500><0.0,0.0,0.0>
{Talk}<0.000,0.300,0.500><0.0,0.0,45.0>
SITTER 1|Right
SYNC Cuddle|cud_b
SYNC Talk|talk_b
{Cuddle}<0.000,-0.300,0.500><0.0,0.0,0.0>
{Talk}<0.000,-0.300,0.500><0.0,0.0,-45.0>`

async function furnitureWith(notecards: Record<string, string>) {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]sit', '[LS]sit 1', '[LS]adjuster', '[LS]plugins', '[LS]faces-camera'],
    prims: 2,
    notecards,
    animations: ['cud_a', 'cud_b', 'talk_a', 'talk_b', 'smile'],
  })
  f.start()
  return f
}

/** Run DUMP and return what the owner received, without the "◆" prefix. */
function dump(f: Furniture): string[] {
  const adjuster = f.script('[LS]adjuster')
  const before = adjuster.chat.length
  f.broadcast(90100, '0|[DUMP]|', '00000000-0000-0000-0000-0000000000a1')
  f.settle(30_000)
  return adjuster.chat.slice(before).map((c) => c.text.replace(/^◆/, ''))
}

/** The notecard lines between the COPY BELOW / COPY ABOVE markers. */
function body(lines: string[]): string[] {
  const start = lines.findIndex((l) => l.includes('COPY BELOW INTO'))
  const end = lines.findIndex((l) => l.includes('COPY ABOVE INTO'))
  return lines.slice(start + 1, end).filter((l) => l.trim() !== '')
}

describe('LuaSitter2 DUMP', () => {
  it('names the LSpos notecard when that is the one in use', async () => {
    const out = dump(await furnitureWith({ LSpos: CARD }))
    expect(out.some((l) => l.includes('COPY BELOW INTO "LSpos" NOTECARD'))).toBe(true)
  })

  it('names the AVpos notecard when that is the one in use', async () => {
    const out = dump(await furnitureWith({ AVpos: CARD }))
    expect(out.some((l) => l.includes('COPY BELOW INTO "AVpos" NOTECARD'))).toBe(true)
  })

  it('writes every pose, position and expression', async () => {
    const lines = body(dump(await furnitureWith({ LSpos: CARD })))
    const text = lines.join('\n')
    expect(text).toContain('MTYPE 1')
    expect(text).toContain('SITTER 0|Left')
    expect(text).toContain('SITTER 1|Right')
    expect(text).toContain('SYNC Cuddle|cud_a')
    expect(text).toContain('SYNC Talk|talk_b')
    expect(text).toContain('ANIM Cuddle|smile|5')
    expect(text).toContain('{Talk}<0,-0.3,0.5><0,0,-45>') // AVsitter's compact number format
  })

  it('round-trips: loading a DUMP and dumping again gives the same notecard', async () => {
    const first = body(dump(await furnitureWith({ LSpos: CARD })))
    const second = body(dump(await furnitureWith({ LSpos: first.join('\n') })))
    expect(second).toEqual(first)
  })
})

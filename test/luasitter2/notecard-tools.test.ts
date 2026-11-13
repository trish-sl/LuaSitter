// LuaSitter2: LS-notecard-tools (AVpos-generator, AVpos-shifter, MLP-converter in one script).
// Generate and a channel-5 shift are also tested in setups.test.ts.
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS, OWNER } from '../helpers/furniture.js'
import type { Furniture, Avatar } from '../helpers/furniture.js'

const owner: Avatar = { key: OWNER, name: 'Owner Resident' }

async function tools(notecards: Record<string, string>, opts: { animations?: string[]; prims?: number; name?: string } = {}) {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['LS-notecard-tools'],
    notecards,
    animations: opts.animations ?? ['walk'],
    prims: opts.prims ?? 1,
    ...(opts.name ? { primNames: { 1: opts.name } } : {}),
  })
  f.start()
  return f
}

const readout = (f: Furniture) => f.script('LS-notecard-tools').chat.map((c) => c.text.replace(/^◆/, ''))
const printed = (f: Furniture) => f.printed('LS-notecard-tools').join('\n')
const removed = (f: Furniture) => !f.prims[0]!.inventory.some((i) => i.name === 'LS-notecard-tools')

describe('LuaSitter2 LS-notecard-tools Shift', () => {
  const CARD = [
    'SITTER 0',
    'POSE Sit1|walk',
    'PROP Ball|ballobj|<1,0,0>|<0,0,0>',
    '{Sit1}<0.1,0,0.5><0,0,0>',
  ].join('\n')

  it('rotates every position and rotation by the offset said on channel 6', async () => {
    const f = await tools({ LSpos: CARD })
    f.click(owner, 'Shift')
    expect(printed(f)).toContain('INSTRUCTIONS:')
    f.say(owner, 6, '<0,0,180>')
    f.settle(10_000)
    const out = readout(f).join('\n')
    expect(out).toMatch(/\{Sit1\}<-0\.1,-?0,0\.5><0,0,-?180>/)
    expect(out).toMatch(/PROP Ball\|ballobj\|<-1,-?0,0>\|<0,0,-?180>/)
    expect(out).toContain('COPY ABOVE INTO "LSpos" NOTECARD')
    expect(printed(f)).toContain('Conversion complete, removing script.')
    expect(removed(f)).toBe(true)
  })

  it('moves and rotates with "/5 <position>,<rotation>", and shifts PROP lines', async () => {
    const f = await tools({ LSpos: CARD })
    f.click(owner, 'Shift')
    f.say(owner, 5, '<0,0,1>,<0,0,90>')
    f.settle(10_000)
    expect(printed(f)).toContain('Converting rotations in LSpos by offset: <0.00000, 0.00000, 90.00000>')
    const out = readout(f).join('\n')
    // first moved up 1 m, then turned -90 degrees about z
    expect(out).toMatch(/\{Sit1\}<-?0,-0\.1,1\.5><0,0,-90>/)
    expect(out).toMatch(/PROP Ball\|ballobj\|<-?0,-1,1>\|<0,0,-90>/)
  })

  it('says when the offset is not a vector, and keeps listening', async () => {
    const f = await tools({ LSpos: CARD })
    f.click(owner, 'Shift')
    f.say(owner, 5, 'up a bit')
    f.say(owner, 6, '<0,0,0>')
    expect(printed(f).match(/You didn't enter a vector!/g)).toHaveLength(2)
    f.say(owner, 5, '<0,0,1>')
    f.settle(10_000)
    expect(readout(f).join('\n')).toMatch(/\{Sit1\}<0\.1,0,1\.5>/)
  })

  it('touching a child prim converts the positions for that prim', async () => {
    const f = await tools({ LSpos: CARD }, { prims: 2 })
    f.click(owner, 'Shift')
    f.touch(owner, 2)
    f.settle(10_000)
    expect(printed(f)).toContain('Converting LSpos for use in prim #2')
    expect(readout(f).join('\n')).toContain('POSE Sit1|walk')
    expect(removed(f)).toBe(true)
  })

  it('lets the owner pick a per-sitter notecard to shift', async () => {
    const f = await tools({ LSpos: CARD, 'LSpos sitter 1': 'POSE Lie|walk\n{Lie}<0,0,0.2><0,0,0>', 'LSpos 1': 'POSE Dup|walk' })
    f.click(owner, 'Shift')
    expect(f.lastDialog(owner).buttons).toEqual(['LSpos', 'LSpos sitter 1'])
    f.click(owner, 'LSpos sitter 1')
    expect(printed(f)).toContain('shifting notecard "LSpos sitter 1"')
    f.say(owner, 5, '<0,0,1>')
    f.settle(10_000)
    const out = readout(f).join('\n')
    expect(out).toContain('COPY BELOW INTO "LSpos sitter 1" NOTECARD')
    expect(out).toMatch(/\{Lie\}<0,0,1\.2>/)
    expect(out).not.toContain('Sit1')
  })

  it('without a pose notecard, a copy not made by the owner removes itself', async () => {
    const f = await tools({})
    const item = f.prims[0]!.inventory.find((i) => i.name === 'LS-notecard-tools')!
    ;(item as { creator: string }).creator = '00000000-0000-0000-0000-00000000beef'
    f.click(owner, 'Shift')
    expect(printed(f)).toContain('This script must be placed only in the root prim')
    expect(removed(f)).toBe(true)
  })
})

describe('LuaSitter2 LS-notecard-tools MLP convert', () => {
  const MENUITEMS = [
    'MENU Main | ALL',
    'POSE stand | stand // ignored',
    'POSE hug | hugA | hugB',
    'POSE solo | soloA::0.5',
  ].join('\n')
  const POSITIONS = [
    '{stand} <0,0,0> <0,0,0>',
    '{hug} <1,0,0> <0,0,90> <2,0,0> <0,0,0>',
    '{solo} <0,0,1> <0,0,0>',
  ].join('\n')

  it('converts MLP notecards to LSpos lines, one SITTER section per animator', async () => {
    const f = await tools({ '.MENUITEMS': MENUITEMS, '.POSITIONS': POSITIONS })
    f.click(owner, 'MLP convert')
    f.settle(5_000)
    const out = readout(f).filter((l) => l.trim() !== '')
    expect(out).toEqual([
      '--✄--COPY BELOW INTO LSpos NOTECARD--✄--',
      'SITTER 0',
      'SYNC hug|hugA',
      'POSE solo|soloA',
      '{hug}<1,0,0><0,0,90>',
      '{solo}<0,0,1><0,0,0>',
      'SITTER 1',
      'SYNC hug|hugB',
      '{hug}<2,0,0><0,0,0>',
      '--✄--COPY ABOVE INTO LSpos NOTECARD--✄--',
    ])
    expect(removed(f)).toBe(true)
  })

  it('says when there are no MLP notecards; stays in a Utilities box and shows the menu again on touch', async () => {
    const f = await tools({}, { name: 'Utilities' })
    f.click(owner, 'MLP convert')
    expect(printed(f)).toContain('No MLP notecards found!')
    expect(removed(f)).toBe(false)
    f.touch(owner)
    expect(f.lastDialog(owner).buttons).toEqual(['Generate', 'Shift', 'MLP convert'])
  })
})

describe('LuaSitter2 LS-notecard-tools Generate and menu', () => {
  it('Generate without animations says so and goes back to idle', async () => {
    const f = await tools({}, { animations: [] })
    f.click(owner, 'Generate')
    expect(printed(f)).toContain('No animations found in inventory.')
    expect(removed(f)).toBe(false)
  })

  it('Generate in a Utilities box keeps the script', async () => {
    const f = await tools({}, { name: 'AVsitter Utilities' })
    f.click(owner, 'Generate')
    f.settle(5_000)
    expect(readout(f)).toContain('POSE Anim1|walk')
    expect(removed(f)).toBe(false)
  })

  it('the menu times out after 2 minutes', async () => {
    const f = await tools({})
    f.settle(121_000)
    expect(printed(f)).toContain('menu timed out, touch to show it again.')
  })
})

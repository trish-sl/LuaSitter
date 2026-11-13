// LuaSitter1: notecard names, fast reading and its NAK fallback, sitting, and
// the paged LSselect seat menu.
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS1_SCRIPTS } from '../helpers/furniture.js'
import type { Avatar } from '../helpers/furniture.js'

const NAK = '\n\x15\n'

const card = (pose1: string, pose2: string) => `SITTER 0
POSE ${pose1}|anim1
POSE ${pose2}|anim2
{${pose1}}<0.0,0.0,0.5><0.0,0.0,0.0>
{${pose2}}<0.0,0.0,0.6><0.0,0.0,90.0>`

async function oneSitter(notecards: Record<string, string>, nak = false) {
  const f = await buildFurniture({
    sources: LS1_SCRIPTS,
    scripts: ['LSsit'],
    notecards,
    animations: ['anim1', 'anim2'],
  })
  if (nak) for (const s of Object.values(f.scripts)) s.mock('llGetNotecardLineSync', () => NAK)
  f.start()
  f.settle(5_000)
  return f
}

describe('LuaSitter1 LSsit', () => {
  it('reads AVpos, animates the sitter and shows the pose menu', async () => {
    const f = await oneSitter({ AVpos: card('Sit1', 'Sit2') })
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.playing(alice)).toEqual(['anim1'])
    f.touch(alice)
    const buttons = f.lastDialog(alice).buttons
    expect(buttons).toContain('Sit1')
    expect(buttons).toContain('Sit2')
  })

  it('reads LSpos, and prefers it over AVpos', async () => {
    const f = await oneSitter({ AVpos: card('Old1', 'Old2'), LSpos: card('New1', 'New2') })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    const buttons = f.lastDialog(alice).buttons
    expect(buttons).toContain('New1')
    expect(buttons).not.toContain('Old1')
  })

  it('falls back to the dataserver reader when the fast reader answers NAK', async () => {
    const f = await oneSitter({ AVpos: card('Sit1', 'Sit2') }, true)
    expect(f.script('LSsit').callsOf('llGetNotecardLine').length).toBeGreaterThan(0)
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.playing(alice)).toEqual(['anim1'])
  })

  it('choosing a pose plays its animation', async () => {
    const f = await oneSitter({ LSpos: card('Sit1', 'Sit2') })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    f.click(alice, 'Sit2')
    expect(f.playing(alice)).toEqual(['anim2'])
  })

  it('standing up stops the animation', async () => {
    const f = await oneSitter({ LSpos: card('Sit1', 'Sit2') })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.stand(alice)
    expect(f.playing(alice)).toEqual([])
  })
})

describe('LuaSitter1 LSselect seat menu', () => {
  async function selectFurniture(n: number) {
    const placeholders = ['LSsit']
    const lines: string[] = []
    for (let i = 1; i < n; i++) placeholders.push(`LSsit ${i}`)
    for (let i = 0; i < n; i++) lines.push(`SITTER ${i}|Seat${i}`, 'POSE Sit|anim1')
    const f = await buildFurniture({
      sources: LS1_SCRIPTS,
      scripts: ['LSselect'],
      placeholders,
      notecards: { LSpos: lines.join('\n') },
      animations: ['anim1'],
    })
    f.start()
    const avatars: Avatar[] = []
    for (let i = 0; i < n; i++) {
      const av = f.avatar(`Sitter${i}`)
      avatars.push(av)
      f.sendLinked('LSselect', 90070, String(i), av.key)
    }
    return { f, avatars }
  }

  it('is unchanged with up to 12 seats', async () => {
    const { f, avatars } = await selectFurniture(5)
    f.sendLinked('LSselect', 99899, '', avatars[0]!.key)
    const buttons = f.lastDialog(avatars[0]!).buttons
    expect(buttons).toHaveLength(5)
    expect(buttons).not.toContain('[>>]')
  })

  it('is paged with [<<] / [>>] for 14 seats, and every seat is reachable', async () => {
    const { f, avatars } = await selectFurniture(14)
    const me = avatars[0]!
    f.sendLinked('LSselect', 99899, '', me.key)
    const page1 = f.lastDialog(me).buttons
    expect(page1).toHaveLength(12)
    expect(page1).toContain('[>>]')
    f.click(me, '[>>]')
    const page2 = f.lastDialog(me).buttons
    const seen = new Set([...page1, ...page2].filter((b) => b !== ' ' && !b.startsWith('[')))
    expect(seen.size).toBe(14)
  })

  it('swaps to a free seat on the second page', async () => {
    const { f, avatars } = await selectFurniture(14)
    const me = avatars[0]!
    f.sendLinked('LSselect', 90065, '13', avatars[13]!.key)
    f.sendLinked('LSselect', 99899, '', me.key)
    f.click(me, '[>>]')
    f.click(me, 'Seat13')
    expect(f.linked().find((m) => m.num === 90030)).toEqual({ num: 90030, str: '0', id: '13' })
  })
})

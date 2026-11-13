// LuaSitter2: notecard names (LSpos / AVpos), fast reading and its NAK fallback,
// per-sitter notecards.
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS } from '../helpers/furniture.js'

const NAK = '\n\x15\n'

const card = (pose1: string, pose2: string) => `SITTER 0
POSE ${pose1}|anim1
POSE ${pose2}|anim2
{${pose1}}<0.0,0.0,0.5><0.0,0.0,0.0>
{${pose2}}<0.0,0.0,0.6><0.0,0.0,90.0>`

async function oneSitter(notecards: Record<string, string>) {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]sit'],
    notecards,
    animations: ['anim1', 'anim2', 'anim3'],
  })
  return f
}

describe('LuaSitter2 notecards', () => {
  it('reads an AVpos notecard (AVsitter name)', async () => {
    const f = await oneSitter({ AVpos: card('Sit1', 'Sit2') })
    f.start()
    expect(f.printed('[LS]sit').join('\n')).toContain('Loading AVpos')
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.playing(alice)).toEqual(['anim1'])
    expect(f.lastDialog(alice).buttons).toEqual(['Sit1', 'Sit2', '[ADJUST]'])
  })

  it('reads an LSpos notecard (LuaSitter name)', async () => {
    const f = await oneSitter({ LSpos: card('Relax', 'Lean') })
    f.start()
    expect(f.printed('[LS]sit').join('\n')).toContain('Loading LSpos')
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.lastDialog(alice).buttons).toEqual(['Relax', 'Lean', '[ADJUST]'])
  })

  it('prefers LSpos when both LSpos and AVpos are present', async () => {
    const f = await oneSitter({ AVpos: card('Old1', 'Old2'), LSpos: card('New1', 'New2') })
    f.start()
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.lastDialog(alice).buttons).toEqual(['New1', 'New2', '[ADJUST]'])
  })

  it('falls back to the dataserver reader when the fast reader answers NAK', async () => {
    const f = await oneSitter({ AVpos: card('Sit1', 'Sit2') })
    for (const s of Object.values(f.scripts)) s.mock('llGetNotecardLineSync', () => NAK)
    f.start()
    f.settle(5_000)
    const sit = f.script('[LS]sit')
    expect(sit.callsOf('llGetNotecardLine').length).toBeGreaterThan(0)
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.playing(alice)).toEqual(['anim1'])
    expect(f.lastDialog(alice).buttons).toEqual(['Sit1', 'Sit2', '[ADJUST]'])
  })

  it('choosing a pose plays its animation', async () => {
    const f = await oneSitter({ AVpos: card('Sit1', 'Sit2') })
    f.start()
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    expect(f.playing(alice)).toEqual(['anim2'])
  })
})

describe('LuaSitter2 per-sitter notecards', () => {
  const main = `SITTER 0
POSE Sit1|anim1
{Sit1}<0.0,0.0,0.5><0.0,0.0,0.0>
SITTER 1
POSE Main1|anim2
{Main1}<0.5,0.0,0.5><0.0,0.0,0.0>`

  const own = 'POSE Own1|anim3\n{Own1}<0.5,0.0,0.5><0.0,0.0,0.0>'

  async function twoSitters(extra: Record<string, string>) {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]sit', '[LS]sit 1'],
      prims: 2,
      notecards: { LSpos: main, ...extra },
      animations: ['anim1', 'anim2', 'anim3'],
    })
    f.start()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    return { f, alice, bob }
  }

  it('"LSpos sitter 1" replaces sitter 1\'s section', async () => {
    const { f, alice, bob } = await twoSitters({ 'LSpos sitter 1': own })
    expect(f.playing(alice)).toEqual(['anim1'])
    expect(f.playing(bob)).toEqual(['anim3'])
    f.broadcast(90005, '', bob.key)
    expect(f.lastDialog(bob).buttons).toContain('Own1')
    expect(f.lastDialog(bob).buttons).not.toContain('Main1')
  })

  for (const name of ['LSpos 1', 'AVpos 1']) {
    it(`"${name}" (the name of a duplicate copy) is not read as a per-sitter notecard`, async () => {
      const { f, bob } = await twoSitters({ [name]: own })
      expect(f.playing(bob)).toEqual(['anim2'])
      f.broadcast(90005, '', bob.key)
      expect(f.lastDialog(bob).buttons).not.toContain('Own1')
    })
  }
})

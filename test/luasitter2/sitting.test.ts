// LuaSitter2: sitting, standing, swapping, and the [FACES] button.
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS } from '../helpers/furniture.js'

const COUPLE = `SITTER 0|Left
SYNC Cuddle|cud_a
SYNC Talk|talk_a
{Cuddle}<0.0,0.3,0.5><0.0,0.0,0.0>
{Talk}<0.0,0.3,0.5><0.0,0.0,0.0>
SITTER 1|Right
SYNC Cuddle|cud_b
SYNC Talk|talk_b
{Cuddle}<0.0,-0.3,0.5><0.0,0.0,0.0>
{Talk}<0.0,-0.3,0.5><0.0,0.0,0.0>`

async function couple(extra: string[] = [], card = COUPLE) {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]sit', '[LS]sit 1', ...extra],
    prims: 2,
    notecards: { LSpos: card },
    animations: ['cud_a', 'cud_b', 'talk_a', 'talk_b', 'smile'],
  })
  f.start()
  return f
}

describe('LuaSitter2 sitting', () => {
  it('two sitters each play their side of a SYNC pose', async () => {
    const f = await couple()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    expect(f.playing(alice)).toEqual(['cud_a'])
    expect(f.playing(bob)).toEqual(['cud_b'])
  })

  it('a SYNC pose chosen by one sitter changes both', async () => {
    const f = await couple()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.click(alice, 'Talk')
    expect(f.playing(alice)).toEqual(['talk_a'])
    expect(f.playing(bob)).toEqual(['talk_b'])
  })

  it('[SWAP] swaps the two sitters', async () => {
    const f = await couple()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.click(alice, '[SWAP]')
    expect(f.playing(alice)).toEqual(['cud_b'])
    expect(f.playing(bob)).toEqual(['cud_a'])
  })

  it('link message 90032 swaps sitters and gives them the menu back', async () => {
    const f = await couple()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    const before = f.dialogsFor(bob).length
    f.broadcast(90032, '0', '1')
    expect(f.playing(alice)).toEqual(['cud_b'])
    expect(f.playing(bob)).toEqual(['cud_a'])
    expect(f.dialogsFor(bob).length).toBeGreaterThan(before)
  })

  it('a sitter without a sit-target prim (WARN 0): no script error, both sitters animate and can change pose', async () => {
    // regression: a sitter without a sit-target prim made set_sittarget read a missing link
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]sit', '[LS]sit 1'],
      prims: 2,
      notecards: { LSpos: `WARN 0\n${COUPLE}` },
      animations: ['cud_a', 'cud_b', 'talk_a', 'talk_b'],
    })
    // description "-1": this prim gets no sit target, so sitter 1 has none
    ;(f.prims[1] as unknown as { description: string }).description = '-1'
    f.start()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.touch(alice)
    f.click(alice, 'Talk')
    for (const s of Object.values(f.scripts)) {
      expect(s.chat.filter((c) => c.channel === 2147483647).map((c) => c.text)).toEqual([])
    }
    expect(f.playing(alice)).toEqual(['talk_a'])
    expect(f.playing(bob)).toEqual(['talk_b'])
  })

  it('standing up stops the animation and frees the seat', async () => {
    const f = await couple()
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.playing(alice)).toEqual(['cud_a'])
    f.stand(alice)
    expect(f.playing(alice)).toEqual([])
    expect(f.linked().some((m) => m.num === 90065 && m.id === alice.key)).toBe(true)
  })
})

describe('LuaSitter2 [FACES] button', () => {
  const adjustButtons = async (card: string) => {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]sit'],
      placeholders: ['[LS]faces-camera'],
      notecards: { LSpos: card },
      animations: ['anim1', 'smile'],
    })
    f.start()
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, '[ADJUST]')
    return f.lastDialog(alice).buttons
  }

  it('is shown when the sitter has ANIM lines', async () => {
    const buttons = await adjustButtons('SITTER 0\nPOSE Sit1|anim1\nANIM Sit1|smile|5\n{Sit1}<0,0,0.5><0,0,0>')
    expect(buttons).toContain('[FACES]')
  })

  it('is hidden when there are no ANIM lines', async () => {
    const buttons = await adjustButtons('SITTER 0\nPOSE Sit1|anim1\n{Sit1}<0,0,0.5><0,0,0>')
    expect(buttons).not.toContain('[FACES]')
  })
})

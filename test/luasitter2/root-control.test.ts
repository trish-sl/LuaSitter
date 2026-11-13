// LuaSitter2: [LS]root-control ("Menu Control"): the "Which avatar?" menu for someone
// who touches the furniture (90007 from [LS]root-security), with and without
// [LS]root-RLV in the inventory, "Take Control", "Capture new…" and the listen timeout.
// (The paged menu with more than 12 sitters is in paging.test.ts.)
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS } from '../helpers/furniture.js'
import type { Furniture } from '../helpers/furniture.js'

const CARD = `SITTER 0|A
POSE Sit|anim1
{Sit}<0,0,0.5><0,0,0>
SITTER 1|B
POSE Sit|anim1
{Sit}<0,0,0.5><0,0,0>`

/**
 * [LS]root-control with two seats. With `rlv`, an (inert) "[LS]root-RLV" is in the
 * inventory: [LS]root-control only checks that it is there.
 */
async function furniture(rlv = false): Promise<Furniture> {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]root-control'],
    placeholders: rlv ? ['[LS]root-RLV'] : [],
    notecards: { LSpos: CARD },
    prims: 2,
  })
  f.start()
  return f
}

const touched = (f: Furniture, key: string) => f.sendLinked('[LS]root-control', 90007, '', key)
const sent = (f: Furniture, num: number) => f.linked().filter((m) => m.num === num)

describe('LuaSitter2 [LS]root-control without RLV', () => {
  it('one sitter: touching opens that sitter\'s pose menu for the toucher (90005 "toucher|sitter")', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    const owner = f.avatar('Watcher')
    f.sit(alice)
    touched(f, owner.key)
    expect(sent(f, 90005)).toEqual([{ num: 90005, str: '', id: `${owner.key}|${alice.key}` }])
    expect(f.dialogsFor(owner)).toEqual([])
  })

  it('two sitters: "Which avatar?" lists their names (without "Resident"), and a name opens their menu', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    const watcher = f.avatar('Watcher')
    f.sit(alice)
    f.sit(bob)
    touched(f, watcher.key)
    const d = f.lastDialog(watcher)
    expect(d.message).toContain('Which avatar?')
    expect([...d.buttons].sort()).toEqual(['Alice', 'Bob'])
    f.click(watcher, 'Bob')
    expect(sent(f, 90005).at(-1)).toEqual({ num: 90005, str: '', id: `${watcher.key}|${bob.key}` })
  })

  it('nobody sitting: no menu', async () => {
    const f = await furniture()
    const watcher = f.avatar('Watcher')
    touched(f, watcher.key)
    expect(f.dialogsFor(watcher)).toEqual([])
    expect(sent(f, 90005)).toEqual([])
  })

  it('someone else touching while the menu is held is asked "Take control of the menu?"', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    const first = f.avatar('First')
    const second = f.avatar('Second')
    f.sit(alice)
    f.sit(bob)
    touched(f, first.key) // First holds the menu
    touched(f, second.key)
    const d = f.lastDialog(second)
    expect(d.message).toContain('Take control of the menu?')
    expect(d.message).toContain('Currently controlled by: First Resident')
    expect(d.buttons).toEqual(expect.arrayContaining(['Take Control', '[CANCEL]']))
    const before = f.linked().length
    f.click(second, 'Take Control')
    expect(f.linked().slice(before)).toContainEqual({ num: 90033, str: '', id: '' })
    const told = f.script('[LS]root-control').chat.filter((c) => c.to === first.key).map((c) => c.text)
    expect(told).toEqual(['Second Resident has taken control of the menu.'])
    // Second now gets the avatar menu, and holds the menu
    expect(f.lastDialog(second).message).toContain('Which avatar?')
    touched(f, second.key)
    expect(f.lastDialog(second).message).toContain('Which avatar?')
  })

  it('[CANCEL] in the "Take control" question changes nothing', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    const first = f.avatar('First')
    const second = f.avatar('Second')
    f.sit(alice)
    f.sit(bob)
    touched(f, first.key)
    touched(f, second.key)
    const before = f.linked().length
    const dialogs = f.dialogsFor(second).length
    f.click(second, '[CANCEL]')
    expect(f.linked().slice(before)).toEqual([])
    expect(f.dialogsFor(second)).toHaveLength(dialogs)
    touched(f, first.key) // First still holds it
    expect(f.lastDialog(first).message).toContain('Which avatar?')
  })

  it('the controller is forgotten when everyone has stood up', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    const first = f.avatar('First')
    const second = f.avatar('Second')
    f.sit(alice)
    f.sit(bob)
    touched(f, first.key)
    f.stand(alice)
    f.stand(bob)
    f.script('[LS]root-control').fire('changed', { changes: 0x20 }) // CHANGED_LINK
    f.sit(alice)
    f.sit(bob)
    touched(f, second.key) // no "Take control" question
    expect(f.lastDialog(second).message).toContain('Which avatar?')
  })

  it('the controller who is no longer in the region is not named', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    const second = f.avatar('Second')
    f.sit(alice)
    f.sit(bob)
    touched(f, '00000000-0000-0000-0000-00000000dead') // an avatar who has left
    touched(f, second.key)
    const d = f.lastDialog(second)
    expect(d.message).toContain('Take control of the menu?')
    expect(d.message).not.toContain('Currently controlled by')
  })

  it('the menu stops listening after 120 s', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    const watcher = f.avatar('Watcher')
    f.sit(alice)
    f.sit(bob)
    touched(f, watcher.key)
    const rc = f.script('[LS]root-control')
    const channel = f.lastDialog(watcher).channel
    expect(rc.listens.some((l) => l.channel === channel && l.active)).toBe(true)
    f.settle(117_000) // (touched() already let 1 s pass)
    expect(rc.listens.some((l) => l.channel === channel && l.active)).toBe(true)
    f.settle(3_000)
    expect(rc.listens.some((l) => l.channel === channel && l.active)).toBe(false)
  })

  it('a new menu restarts the 120 s timeout', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    const watcher = f.avatar('Watcher')
    f.sit(alice)
    f.sit(bob)
    touched(f, watcher.key)
    f.settle(100_000)
    touched(f, watcher.key)
    const rc = f.script('[LS]root-control')
    const channel = f.lastDialog(watcher).channel
    f.settle(100_000)
    expect(rc.listens.some((l) => l.channel === channel && l.active)).toBe(true)
  })

  it('is reset when rezzed: the controller is forgotten', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    const first = f.avatar('First')
    const second = f.avatar('Second')
    f.sit(alice)
    f.sit(bob)
    touched(f, first.key)
    f.script('[LS]root-control').fire('on_rez', { start_param: 0 })
    f.settle()
    touched(f, second.key) // no "Take control" question
    expect(f.lastDialog(second).message).toContain('Which avatar?')
  })
})

describe('LuaSitter2 [LS]root-control with [LS]root-RLV', () => {
  it('one sitter: a non-sitter is sent to that sitter\'s RLV menu ("Control...", 90100)', async () => {
    const f = await furniture(true)
    const bob = f.avatar('Bob')
    const alice = f.avatar('Alice')
    f.sit(bob)
    touched(f, alice.key)
    expect(sent(f, 90100)).toEqual([{ num: 90100, str: `x|Control...|${bob.key}`, id: alice.key }])
  })

  it('a sitter who touches gets their own menu (90005)', async () => {
    const f = await furniture(true)
    const bob = f.avatar('Bob')
    f.sit(bob)
    touched(f, bob.key)
    expect(sent(f, 90005)).toEqual([{ num: 90005, str: '', id: bob.key }])
  })

  it('nobody sitting: starts the capture search (90211)', async () => {
    const f = await furniture(true)
    const alice = f.avatar('Alice')
    touched(f, alice.key)
    expect(sent(f, 90211)).toEqual([{ num: 90211, str: '', id: alice.key }])
    expect(f.dialogsFor(alice)).toEqual([])
  })

  it('"RLV ▸ which avatar?" with "Capture new…" while a submissive seat is free', async () => {
    const f = await furniture(true)
    const bob = f.avatar('Bob')
    const alice = f.avatar('Alice')
    f.sendLinked('[LS]root-control', 90206, 'D|S|S', '') // roles of the seats ([LS]root-RLV)
    f.sit(bob)
    touched(f, alice.key)
    const d = f.lastDialog(alice)
    expect(d.message).toContain('RLV ▸ which avatar?')
    expect(d.message).toContain('Capture new… = capture an avatar nearby who wears an RLV relay.')
    expect(d.buttons).toEqual(expect.arrayContaining(['Bob', 'Capture new…']))
    f.click(alice, 'Bob')
    expect(sent(f, 90100).at(-1)).toEqual({ num: 90100, str: `x|Control...|${bob.key}`, id: alice.key })
    touched(f, alice.key)
    f.click(alice, 'Capture new…')
    expect(sent(f, 90211).at(-1)).toEqual({ num: 90211, str: '', id: alice.key })
  })

  it('the upstream button "Capture..." still starts the capture search', async () => {
    const f = await furniture(true)
    const bob = f.avatar('Bob')
    const alice = f.avatar('Alice')
    f.sendLinked('[LS]root-control', 90206, 'D|S|S', '')
    f.sit(bob)
    touched(f, alice.key)
    f.say(alice, f.lastDialog(alice).channel, 'Capture...')
    expect(sent(f, 90211)).toEqual([{ num: 90211, str: '', id: alice.key }])
  })

  it('no "Capture new…" when every seat is taken, or without a submissive role', async () => {
    const f = await furniture(true)
    const bob = f.avatar('Bob')
    const carol = f.avatar('Carol')
    const alice = f.avatar('Alice')
    f.sendLinked('[LS]root-control', 90206, 'D|S', '')
    f.sit(bob)
    f.sit(carol)
    touched(f, alice.key)
    expect(f.lastDialog(alice).buttons).not.toContain('Capture new…')
    expect([...f.lastDialog(alice).buttons].sort()).toEqual(['Bob', 'Carol'])
  })
})

describe('LuaSitter2 [LS]root-control paged menu buttons', () => {
  it('a blank filler button or a page button shows the menu again', async () => {
    const n = 12
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]root-control'],
      placeholders: ['[LS]root-RLV'],
      notecards: { LSpos: 'SITTER 0\nPOSE Sit|anim1' },
      prims: n,
    })
    f.start()
    for (let i = 0; i < n; i++) f.sit(f.avatar(`Guest${i}`), i + 1)
    const controller = f.avatar('Controller')
    f.sendLinked('[LS]root-control', 90206, ['D', ...Array(n).fill('S')].join('|'), '')
    touched(f, controller.key)
    const page1 = f.lastDialog(controller).buttons
    expect(page1).toContain('Capture new…')
    expect(page1).toContain('[<<]')
    f.click(controller, '[<<]') // wraps to the last page
    const last = f.lastDialog(controller).buttons
    expect(last).toContain(' ')
    const shown = f.dialogsFor(controller).length
    f.click(controller, ' ')
    expect(f.dialogsFor(controller)).toHaveLength(shown + 1)
    expect(f.lastDialog(controller).buttons).toEqual(last)
  })
})

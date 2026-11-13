// LuaSitter2: [LS]select, the seat menu: how seats are named (SITTER name, the
// single pose, "Sitter N", per-sitter notecards), TEXT, SELECT 0/1/2 with SYNC
// poses, [ADJUST], the blank filler button, reloading on notecard edits, the
// NAK fallback and AVpos, and closing the listen when everyone has stood up.
// The "[LS]sit N" scripts are placeholders: the tests send [LS]select the link
// messages [LS]sit would send (90070 sat, 90065 stood, 90055 pose, 90009 menu).
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS } from '../helpers/furniture.js'
import type { Avatar, Furniture } from '../helpers/furniture.js'

const NAK = '\n\x15\n'

async function seats(card: string, opts: { sitters?: number; name?: string; extra?: Record<string, string>; nak?: boolean } = {}) {
  const n = opts.sitters ?? 3
  const placeholders = ['[LS]sit']
  for (let i = 1; i < n; i++) placeholders.push(`[LS]sit ${i}`)
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]select'],
    placeholders,
    notecards: { [opts.name ?? 'LSpos']: card, ...(opts.extra ?? {}) },
    animations: ['anim1'],
  })
  if (opts.nak) f.script('[LS]select').mock('llGetNotecardLineSync', () => NAK)
  f.start()
  f.settle(3_000)
  return f
}

/** Sitter `i` is seated (as [LS]sit tells the plugins with 90070). */
function seat(f: Furniture, i: number, av: Avatar) {
  f.sendLinked('[LS]select', 90070, String(i), av.key)
}

function seatMenu(f: Furniture, av: Avatar) {
  f.sendLinked('[LS]select', 90009, '', av.key)
  const d = f.lastDialog(av)
  expect(d.script).toBe('[LS]select')
  return d
}

/** An avatar says a text on the seat menu's channel (an old dialog's button, or a forged answer). */
function answer(f: Furniture, av: Avatar, text: string) {
  const select = f.script('[LS]select')
  const channel = select.listens.find((l) => l.channel < 0)!.channel
  select.deliverChat({ channel, name: av.name, key: av.key, message: text })
  f.settle()
}

const seatButtons = (d: { buttons: string[] }) => d.buttons.filter((b) => b !== ' ' && b !== '[ADJUST]')

describe('LuaSitter2 [LS]select: seat names', () => {
  it('names a seat after its SITTER name, its only pose, or "Sitter N" when it has several poses', async () => {
    const f = await seats(`SITTER 0|Left
POSE Relax|anim1
SITTER 1
POSE Lounging on the sofa with a very long name|anim1
SITTER 2
POSE Sit|anim1
POSE Lean|anim1`)
    const alice = f.avatar('Alice')
    seat(f, 0, alice)
    const d = seatMenu(f, alice)
    // a single pose name is cut to 23 characters
    expect(seatButtons(d).sort()).toEqual(['Left', 'Lounging on the sofa wi', 'Sitter 2'].sort())
    expect(d.message).toContain('[Left]') // the menu names the sitter's own seat
  })

  it('keeps "Sitter N" when the only pose has the name of another seat', async () => {
    const f = await seats(`SITTER 0
POSE Relax|anim1
SITTER 1
POSE Relax|anim1`, { sitters: 2 })
    const alice = f.avatar('Alice')
    seat(f, 0, alice)
    expect(seatButtons(seatMenu(f, alice)).sort()).toEqual(['Relax', 'Sitter 1'])
  })

  it('reads lines written with the ◆ prefix and shows TEXT above the seats', async () => {
    const f = await seats(`◆TEXT Pick a seat\\nany seat
◆SITTER 0|Left
◆POSE Sit|anim1
◆SITTER 1|Right
◆POSE Sit|anim1`, { sitters: 2 })
    const alice = f.avatar('Alice')
    seat(f, 1, alice)
    const d = seatMenu(f, alice)
    expect(seatButtons(d).sort()).toEqual(['Left', 'Right'])
    expect(d.message).toContain('Pick a seat\nany seat\n[Right]')
  })

  it('reads AVpos when there is no LSpos', async () => {
    const f = await seats(`SITTER 0|Front\nPOSE Sit|anim1\nSITTER 1|Back\nPOSE Sit|anim1`, { sitters: 2, name: 'AVpos' })
    const alice = f.avatar('Alice')
    seat(f, 0, alice)
    expect(seatButtons(seatMenu(f, alice)).sort()).toEqual(['Back', 'Front'])
  })

  it('falls back to the dataserver reader when the fast reader answers NAK', async () => {
    const f = await seats(`SITTER 0|Front\nPOSE Sit|anim1\nSITTER 1|Back\nPOSE Sit|anim1`, { sitters: 2, nak: true })
    expect(f.script('[LS]select').callsOf('llGetNotecardLine').length).toBeGreaterThan(0)
    const alice = f.avatar('Alice')
    seat(f, 0, alice)
    expect(seatButtons(seatMenu(f, alice)).sort()).toEqual(['Back', 'Front'])
  })

  it('names a seat from its own "LSpos sitter N" notecard, ignoring that section of LSpos', async () => {
    const f = await seats(`SITTER 0|Left
POSE Sit|anim1
SITTER 1|FromMain
POSE Sit|anim1
SITTER 2|Right
POSE Sit|anim1`, {
      // lines before any SITTER line belong to sitter 1; other sections are ignored
      extra: { 'LSpos sitter 1': `TEXT not shown\nPOSE OwnPose|anim1\nSITTER 2|Ignored\nPOSE Other|anim1` },
    })
    const alice = f.avatar('Alice')
    seat(f, 0, alice)
    const d = seatMenu(f, alice)
    expect(seatButtons(d).sort()).toEqual(['Left', 'OwnPose', 'Right'])
    expect(d.message).not.toContain('not shown')
  })
})

describe('LuaSitter2 [LS]select: choosing a seat', () => {
  const CARD = `SITTER 0|Left
POSE Sit|anim1
SITTER 1|Middle
POSE Sit|anim1
SITTER 2|Right
POSE Sit|anim1`

  const swaps = (f: Furniture) => f.linked().filter((m) => m.num === 90030)

  it('SELECT 0: a sitter in a SYNC pose is not marked ⊘, and choosing that seat swaps', async () => {
    const f = await seats(CARD)
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    seat(f, 0, alice)
    seat(f, 1, bob)
    f.sendLinked('[LS]select', 90055, '1', 'P:Sit|anim1|<0,0,0>|<0,0,0>|0|0') // a solo pose
    expect(seatMenu(f, alice).buttons).toContain('⊘Bob ')
    f.sendLinked('[LS]select', 90055, '1', 'Cuddle|anim1|<0,0,0>|<0,0,0>|0|0') // a SYNC pose
    const d = seatMenu(f, alice)
    expect(d.buttons).not.toContain('⊘Bob ')
    f.click(alice, 'Middle')
    expect(swaps(f)).toEqual([{ num: 90030, str: '0', id: '1' }])
  })

  it('SELECT 0: choosing a seat taken by a solo pose shows the menu again instead of swapping', async () => {
    const f = await seats(CARD)
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    seat(f, 0, alice)
    seat(f, 1, bob)
    // the sitter's name is shown, but the seat name may still come back from an old dialog
    const before = f.dialogsFor(alice).length
    f.sendLinked('[LS]select', 90009, '', alice.key)
    answer(f, alice, 'Middle')
    expect(f.dialogsFor(alice).length).toBe(before + 2)
    expect(swaps(f)).toEqual([])
  })

  it('SELECT 2: occupied seats are marked ⊘ even in a SYNC pose, and cannot be chosen', async () => {
    const f = await seats(`SELECT 2\n${CARD}`)
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    seat(f, 0, alice)
    seat(f, 1, bob)
    f.sendLinked('[LS]select', 90055, '1', 'Cuddle|anim1|<0,0,0>|<0,0,0>|0|0')
    const d = seatMenu(f, alice)
    expect(seatButtons(d).sort()).toEqual(['Left', 'Right', '⊘Bob '])
    const before = f.dialogsFor(alice).length
    f.click(alice, '⊘Bob ')
    expect(f.dialogsFor(alice).length).toBe(before + 1) // the menu again
    expect(swaps(f)).toEqual([])
  })

  it('a seat freed by 90030 / 90065 can be chosen; a sitter who stood up is not marked', async () => {
    const f = await seats(CARD)
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    seat(f, 0, alice)
    seat(f, 1, bob)
    f.sendLinked('[LS]select', 90065, '1', bob.key) // Bob stood up
    expect(seatButtons(seatMenu(f, alice)).sort()).toEqual(['Left', 'Middle', 'Right'])
  })

  it('[ADJUST] asks [LS]sit for the adjust menu (90101)', async () => {
    const f = await seats(CARD)
    const alice = f.avatar('Alice')
    seat(f, 2, alice)
    seatMenu(f, alice)
    f.click(alice, '[ADJUST]')
    expect(f.linked()).toContainEqual({ num: 90101, str: `X|[ADJUST]|${alice.key}`, id: alice.key })
  })

  it('the blank filler button shows the menu again', async () => {
    const f = await seats(CARD) // 3 seats + [ADJUST] + 2 blanks
    const alice = f.avatar('Alice')
    seat(f, 0, alice)
    const d = seatMenu(f, alice)
    expect(d.buttons).toContain(' ')
    const before = f.dialogsFor(alice).length
    f.click(alice, ' ')
    expect(f.dialogsFor(alice).length).toBe(before + 1)
    expect(f.linked().filter((m) => m.num === 90030 || m.num === 90005)).toEqual([])
  })

  it('ignores the menu answers of an avatar who is not seated, and link messages from other prims', async () => {
    const f = await seats(CARD)
    const alice = f.avatar('Alice')
    const eve = f.avatar('Eve')
    seat(f, 0, alice)
    seatMenu(f, alice)
    answer(f, eve, 'Right') // Eve is not seated
    expect(swaps(f)).toEqual([])
    // 90009 from another link number: no menu
    const select = f.script('[LS]select')
    const before = f.dialogsFor(alice).length
    select.fire('link_message', { sender_num: select.host.linkNumber + 5, num: 90009, str: '', id: alice.key })
    f.settle()
    expect(f.dialogsFor(alice).length).toBe(before)
  })
})

describe('LuaSitter2 [LS]select: reloading and listening', () => {
  it('reloads the seat names when LSpos is edited, not when another item changes', async () => {
    const f = await seats(`SITTER 0|Left\nPOSE Sit|anim1\nSITTER 1|Right\nPOSE Sit|anim1`, { sitters: 2 })
    const alice = f.avatar('Alice')
    seat(f, 0, alice)
    f.setItem('extra anim', 'animation')
    // not reset: it still knows Alice is seated
    expect(seatButtons(seatMenu(f, alice)).sort()).toEqual(['Left', 'Right'])
    f.setNotecard('LSpos', `SITTER 0|Port\nPOSE Sit|anim1\nSITTER 1|Starboard\nPOSE Sit|anim1`)
    seat(f, 0, alice) // after a reset, [LS]sit tells it again
    expect(seatButtons(seatMenu(f, alice)).sort()).toEqual(['Port', 'Starboard'])
  })

  it('stops listening to the seat menu when the last sitter stands up', async () => {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]select'],
      placeholders: ['[LS]sit', '[LS]sit 1'],
      prims: 2,
      notecards: { LSpos: `SITTER 0|Left\nPOSE Sit|anim1\nSITTER 1|Right\nPOSE Sit|anim1` },
      animations: ['anim1'],
    })
    f.start()
    const alice = f.avatar('Alice')
    f.sit(alice)
    seat(f, 0, alice)
    seatMenu(f, alice)
    const select = f.script('[LS]select')
    const menuListen = () => select.listens.find((l) => l.channel < 0)!
    expect(menuListen().active).toBe(true)
    f.stand(alice) // CHANGED_LINK, and the last link is a prim again
    expect(menuListen().active).toBe(false)
  })
})

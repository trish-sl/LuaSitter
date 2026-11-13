// LuaSitter2: the pose menu of [LS]sit: submenus, paging of long pose lists,
// BUTTON lines, menu settings (TEXT, MTYPE, AMENU, SWAP), Unicode pose names,
// and the link messages that play poses and give the menu (90000, 90005, 90045, 90050).
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS } from '../helpers/furniture.js'

async function oneSitter(card: string, animations = ['anim1', 'anim2', 'anim3']) {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]sit'],
    notecards: { LSpos: card },
    animations,
  })
  f.start()
  return f
}

async function twoSitters(card: string) {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]sit', '[LS]sit 1'],
    prims: 2,
    notecards: { LSpos: card },
    animations: ['anim1', 'anim2', 'anim3', 'cud_a', 'cud_b'],
  })
  f.start()
  return f
}

const SUBMENUS = `SITTER 0
TOMENU Fun
POSE Sit1|anim1
MENU Fun
POSE Dance|anim2
TOMENU Deeper
MENU Deeper
POSE Spin|anim3
MENU Hidden
POSE Secret|anim3
{Sit1}<0,0,0.5><0,0,0>
{Dance}<0,0,0.5><0,0,0>
{Spin}<0,0,0.5><0,0,0>
{Secret}<0,0,0.5><0,0,0>`

describe('LuaSitter2 submenus (TOMENU / MENU)', () => {
  it('TOMENU opens its submenu, a pose there plays, and [BACK] returns', async () => {
    const f = await oneSitter(SUBMENUS)
    const alice = f.avatar('Alice')
    f.sit(alice)
    const top = f.lastDialog(alice).buttons
    expect(top).toContain('Fun*')
    expect(top).toContain('Sit1')
    expect(top).not.toContain('Dance')
    expect(top).not.toContain('[BACK]') // no [BACK] at the top level without [LS]select

    f.click(alice, 'Fun*')
    const sub = f.lastDialog(alice).buttons
    expect(sub).toContain('Dance')
    expect(sub).toContain('Deeper*')
    expect(sub).toContain('[BACK]')
    expect(sub).not.toContain('Sit1')

    f.click(alice, 'Dance')
    expect(f.playing(alice)).toEqual(['anim2'])
    expect(f.lastDialog(alice).buttons).toContain('Dance') // the menu comes back in the same submenu

    f.click(alice, '[BACK]')
    expect(f.lastDialog(alice).buttons).toContain('Sit1')
  })

  it('a submenu inside a submenu goes back one level at a time', async () => {
    const f = await oneSitter(SUBMENUS)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Fun*')
    f.click(alice, 'Deeper*')
    expect(f.lastDialog(alice).buttons).toContain('Spin')
    f.click(alice, 'Spin')
    expect(f.playing(alice)).toEqual(['anim3'])
    f.click(alice, '[BACK]')
    expect(f.lastDialog(alice).buttons).toContain('Dance')
    f.click(alice, '[BACK]')
    expect(f.lastDialog(alice).buttons).toContain('Sit1')
  })

  it('a MENU without a TOMENU is hidden, but its poses play by link message 90000', async () => {
    const f = await oneSitter(SUBMENUS)
    const alice = f.avatar('Alice')
    f.sit(alice)
    const seen = [...f.lastDialog(alice).buttons]
    f.click(alice, 'Fun*')
    seen.push(...f.lastDialog(alice).buttons)
    expect(seen).not.toContain('Hidden*')
    expect(seen).not.toContain('Secret')
    f.broadcast(90000, 'Secret', alice.key)
    expect(f.playing(alice)).toEqual(['anim3'])
  })
})

describe('LuaSitter2 long pose menus', () => {
  const anims = Array.from({ length: 20 }, (_, i) => `a${i}`)
  const card = ['SITTER 0', ...anims.map((a, i) => `POSE Pose${i}|${a}`), ...anims.map((_, i) => `{Pose${i}}<0,0,0.5><0,0,0>`)].join('\n')

  it('20 poses are paged with [<<] / [>>], every pose is reachable, and pages wrap', async () => {
    const f = await oneSitter(card, anims)
    const alice = f.avatar('Alice')
    f.sit(alice)
    const seen = new Set<string>()
    const first = f.lastDialog(alice).buttons
    expect(first.length).toBeLessThanOrEqual(12)
    expect(first).toContain('[>>]')
    expect(first).toContain('[<<]')
    expect(first).toContain('[ADJUST]')
    let page = first
    for (let i = 0; i < 5; i++) {
      for (const b of page) if (b.startsWith('Pose')) seen.add(b)
      f.click(alice, '[>>]')
      page = f.lastDialog(alice).buttons
      if (JSON.stringify(page) === JSON.stringify(first)) break
    }
    expect(page).toEqual(first) // wrapped around to the first page
    expect(seen.size).toBe(20)
    f.click(alice, '[<<]')
    const last = f.lastDialog(alice).buttons
    expect(last).toContain('Pose19')
    f.click(alice, 'Pose19')
    expect(f.playing(alice)).toEqual(['a19'])
  })
})

describe('LuaSitter2 BUTTON lines', () => {
  const card = `SITTER 0
POSE Sit1|anim1
BUTTON Ring|12345|hello
BUTTON Bell|23456
BUTTON Who|34567|me|<S>
BUTTON Prop
{Sit1}<0,0,0.5><0,0,0>`

  it('sends the link message of the button with its number, string and the sitter', async () => {
    const f = await oneSitter(card)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Ring')
    expect(f.linked()).toContainEqual({ num: 12345, str: 'hello', id: alice.key })
  })

  it('uses the button name when the string is empty', async () => {
    const f = await oneSitter(card)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Bell')
    expect(f.linked()).toContainEqual({ num: 23456, str: 'Bell', id: alice.key })
  })

  it('replaces <S> with the sitter', async () => {
    const f = await oneSitter(card)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Who')
    expect(f.linked()).toContainEqual({ num: 34567, str: 'me', id: alice.key })
  })

  it('defaults to 90200 (rez a prop) without a number', async () => {
    const f = await oneSitter(card)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Prop')
    expect(f.linked()).toContainEqual({ num: 90200, str: 'Prop', id: alice.key })
  })
})

describe('LuaSitter2 menu settings', () => {
  const poses = `SITTER 0
POSE Sit1|anim1
TOMENU More
MENU More
POSE Sit2|anim2
{Sit1}<0,0,0.5><0,0,0>
{Sit2}<0,0,0.5><0,0,0>`

  it('TEXT is shown in the menu', async () => {
    const f = await oneSitter('TEXT Welcome to the bench!\n' + poses)
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.lastDialog(alice).message).toContain('Welcome to the bench!')
  })

  it('MTYPE 0 (default) gives the menu on sit', async () => {
    const f = await oneSitter(poses)
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.dialogsFor(alice).length).toBeGreaterThan(0)
  })

  it('MTYPE 1 gives the menu on touch only', async () => {
    const f = await oneSitter('MTYPE 1\n' + poses)
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.dialogsFor(alice)).toHaveLength(0)
    f.touch(alice)
    expect(f.lastDialog(alice).buttons).toContain('Sit1')
  })

  it('MTYPE 2 does not give the menu back after a pose is chosen', async () => {
    const f = await oneSitter('MTYPE 2\n' + poses)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    const before = f.dialogsFor(alice).length
    f.click(alice, 'More*')
    f.click(alice, 'Sit2')
    expect(f.playing(alice)).toEqual(['anim2'])
    expect(f.dialogsFor(alice)).toHaveLength(before + 1) // the submenu, but no menu after the pose
  })

  it('MTYPE 3 gives no menu on sit or touch, but 90005 still does', async () => {
    const f = await oneSitter('MTYPE 3\n' + poses)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    expect(f.dialogsFor(alice)).toHaveLength(0)
    f.broadcast(90005, '', alice.key)
    expect(f.lastDialog(alice).buttons).toContain('Sit1')
  })

  it('AMENU 0 removes [ADJUST]', async () => {
    const f = await oneSitter('AMENU 0\n' + poses)
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.lastDialog(alice).buttons).not.toContain('[ADJUST]')
  })

  it('AMENU 1 shows [ADJUST] at the top level only', async () => {
    const f = await oneSitter('AMENU 1\n' + poses)
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.lastDialog(alice).buttons).toContain('[ADJUST]')
    f.click(alice, 'More*')
    expect(f.lastDialog(alice).buttons).not.toContain('[ADJUST]')
  })

  it('AMENU 2 (default) shows [ADJUST] in submenus too', async () => {
    const f = await oneSitter(poses)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'More*')
    expect(f.lastDialog(alice).buttons).toContain('[ADJUST]')
  })

  const couple = (settings: string) => `${settings}
SITTER 0
SYNC Cuddle|cud_a
TOMENU More
MENU More
POSE Alone|anim1
SITTER 1
SYNC Cuddle|cud_b
{Cuddle}<0,0.3,0.5><0,0,0>
{Alone}<0,0.3,0.5><0,0,0>`

  it('SWAP 0 removes [SWAP]', async () => {
    const f = await twoSitters(couple('SWAP 0'))
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.sit(f.avatar('Bob'))
    f.touch(alice)
    expect(f.lastDialog(alice).buttons).not.toContain('[SWAP]')
  })

  it('SWAP 1 shows [SWAP] at the top level only', async () => {
    const f = await twoSitters(couple('SWAP 1'))
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.sit(f.avatar('Bob'))
    f.touch(alice)
    expect(f.lastDialog(alice).buttons).toContain('[SWAP]')
    f.click(alice, 'More*')
    expect(f.lastDialog(alice).buttons).not.toContain('[SWAP]')
  })

  it('[SWAP] is shown with one sitter seated when there is a free seat to swap to', async () => {
    const f = await twoSitters(couple(''))
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.lastDialog(alice).buttons).toContain('[SWAP]')
    f.click(alice, '[SWAP]')
    expect(f.playing(alice)).toEqual(['cud_b']) // moved to SITTER 1
  })

  it('[SWAP] is not shown with a single SITTER section', async () => {
    const f = await oneSitter('SITTER 0\nPOSE Sit1|anim1\n{Sit1}<0,0,0.5><0,0,0>')
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.lastDialog(alice).buttons).not.toContain('[SWAP]')
  })
})

describe('LuaSitter2 SYNC exit (ETYPE)', () => {
  const card = (etype: string) => `${etype}
SITTER 0
SYNC Cuddle|cud_a
POSE Alone|anim1
SITTER 1
POSE Stand|anim2
SYNC Cuddle|cud_b
{Cuddle}<0,0.3,0.5><0,0,0>
{Alone}<0,0.3,0.5><0,0,0>
{Stand}<0,-0.3,0.5><0,0,0>
{Cuddle}<0,-0.3,0.5><0,0,0>`

  it('ETYPE 1 (default): leaving a SYNC sends the partner back to their first pose', async () => {
    const f = await twoSitters(card(''))
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    expect(f.playing(bob)).toEqual(['cud_b'])
    f.click(alice, 'Alone')
    expect(f.playing(alice)).toEqual(['anim1'])
    expect(f.playing(bob)).toEqual(['anim2'])
  })

  it('ETYPE 0: the partner keeps the SYNC animation', async () => {
    const f = await twoSitters(card('ETYPE 0'))
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.click(alice, 'Alone')
    expect(f.playing(alice)).toEqual(['anim1'])
    expect(f.playing(bob)).toEqual(['cud_b'])
  })

  it('ETYPE 2: the partner is unseated', async () => {
    const f = await twoSitters(card('ETYPE 2'))
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.click(alice, 'Alone')
    const unsat = Object.values(f.scripts).flatMap((s) => s.callsOf('llUnSit').map((c) => String(c.args[0])))
    expect(unsat).toContain(bob.key)
  })
})

describe('LuaSitter2 pose link messages', () => {
  const card = `SITTER 0|Left
POSE Sit1|anim1
POSE Café ☕|anim2
{Sit1}<0,0,0.5><0,0,0>
{Café ☕}<0,0,0.5><0,0,0>`

  it('a Unicode pose name shows in the menu and plays', async () => {
    const f = await oneSitter(card)
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.lastDialog(alice).buttons).toContain('Café ☕')
    f.click(alice, 'Café ☕')
    expect(f.playing(alice)).toEqual(['anim2'])
  })

  it('90000 plays a pose for the sitter given by avatar key or by sitter number', async () => {
    const f = await oneSitter(card)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.broadcast(90000, 'Café ☕', alice.key)
    expect(f.playing(alice)).toEqual(['anim2'])
    f.broadcast(90000, 'Sit1', '0')
    expect(f.playing(alice)).toEqual(['anim1'])
  })

  it('90000 with an unknown pose changes nothing', async () => {
    const f = await oneSitter(card)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.broadcast(90000, 'Nope', alice.key)
    expect(f.playing(alice)).toEqual(['anim1'])
  })

  it('choosing a pose sends 90050 and 90045 with the sitter, pose and animation', async () => {
    const f = await oneSitter(card)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Café ☕')
    const chosen = f.linked().filter((m) => m.num === 90050).at(-1)!
    expect(chosen.str.split('|').slice(0, 2)).toEqual(['0', 'Café ☕'])
    expect(chosen.id).toBe(alice.key)
    const played = f.linked().filter((m) => m.num === 90045).at(-1)!
    const data = played.str.split('|')
    expect(data[0]).toBe('0')
    expect(data[1]).toBe('Café ☕')
    expect(data[2]).toBe('anim2')
    expect(data[4]).toContain(alice.key)
    expect(played.id).toBe(alice.key)
  })

  it('sitting sends 90060 (welcome) and 90070 (sitter list)', async () => {
    const f = await oneSitter(card)
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.linked().some((m) => m.num === 90060 && m.id === alice.key)).toBe(true)
    expect(f.linked().some((m) => m.num === 90070 && m.str === '0' && m.id === alice.key)).toBe(true)
  })

  it('90005 gives the menu again', async () => {
    const f = await oneSitter(card)
    const alice = f.avatar('Alice')
    f.sit(alice)
    const before = f.dialogsFor(alice).length
    f.broadcast(90005, '', alice.key)
    expect(f.dialogsFor(alice).length).toBe(before + 1)
    expect(f.lastDialog(alice).message).toContain('Left')
  })
})

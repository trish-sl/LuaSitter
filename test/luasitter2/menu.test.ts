// LuaSitter2: [LS]menu, the touch menu of objects without sit scripts: paging,
// "already using the menu", menu security, the [OWNER] prop options ([NEW] prop
// chooser and naming, [SAVE], [CLEAR], [RESET], [DUMP]), MTYPE 3, LMSOURCE,
// reloading on a notecard change, and removing an extra copy.
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS, OWNER } from '../helpers/furniture.js'
import type { Furniture, Avatar } from '../helpers/furniture.js'

const owner: Avatar = { key: OWNER, name: 'Owner Resident' }
const NAK = '\n\x15\n'

const LAMP = `TEXT Lamp controls\\nPick one
BUTTON On|5001
BUTTON Off|5002|off|key-1
TOMENU Colours
MENU Colours
BUTTON Red|5003|red
BUTTON Blue|5003|blue`

async function lamp(card = LAMP, opts: { scripts?: string[]; objects?: Record<string, string[]>; placeholders?: string[]; prims?: number } = {}) {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: opts.scripts ?? ['[LS]menu'],
    notecards: { LSpos: card },
    objects: opts.objects,
    placeholders: opts.placeholders,
    prims: opts.prims,
  })
  f.start()
  return f
}

const menu = (f: Furniture) => f.script('[LS]menu')
/** What the menu said to the owner (DUMP lines), without the ◆ marker. */
const dumped = (f: Furniture) => menu(f).chat.map((c) => c.text.replace(/^◆/, ''))
/** An avatar types a reply on the menu's dialog channel (as if from a dialog button). */
function reply(f: Furniture, av: Avatar, message: string) {
  const d = f.lastDialog(av)
  menu(f).deliverChat({ channel: d.channel, name: av.name, key: av.key, message })
  f.settle()
}

describe('LuaSitter2 [LS]menu menus', () => {
  it('TEXT with \\n shows on two lines, and a BUTTON with a message and key sends them', async () => {
    const f = await lamp()
    const bob = f.avatar('Bob')
    f.touch(bob)
    expect(f.lastDialog(bob).message).toContain('Lamp controls\nPick one')
    f.click(bob, 'Off')
    expect(f.linked()).toContainEqual({ num: 5002, str: 'off', id: 'key-1' })
  })

  it('[BACK] in a submenu returns to the top menu', async () => {
    const f = await lamp()
    const bob = f.avatar('Bob')
    f.touch(bob)
    f.click(bob, 'Colours*')
    expect(f.lastDialog(bob).buttons).toEqual(expect.arrayContaining(['[BACK]', 'Red', 'Blue']))
    f.click(bob, '[BACK]')
    expect(f.lastDialog(bob).buttons).toEqual(expect.arrayContaining(['On', 'Off', 'Colours*']))
    expect(f.lastDialog(bob).buttons).not.toContain('[BACK]')
  })

  it('a long menu is paged with [<<] and [>>], wrapping around', async () => {
    const buttons = Array.from({ length: 14 }, (_, i) => `BUTTON B${i + 1}|6000`).join('\n')
    const f = await lamp(buttons)
    const bob = f.avatar('Bob')
    f.touch(bob)
    const page1 = f.lastDialog(bob).buttons
    expect(page1).toEqual(expect.arrayContaining(['[<<]', '[>>]', 'B1', 'B10']))
    expect(page1).not.toContain('B11')
    f.click(bob, '[>>]')
    const page2 = f.lastDialog(bob).buttons
    expect(page2).toEqual(expect.arrayContaining(['B11', 'B14', '[<<]', '[>>]']))
    expect(page2).not.toContain('B1')
    f.click(bob, '[>>]') // past the last page: back to the first
    expect(f.lastDialog(bob).buttons).toContain('B1')
    f.click(bob, '[<<]') // before the first page: the last
    expect(f.lastDialog(bob).buttons).toContain('B14')
    f.click(bob, '[<<]')
    expect(f.lastDialog(bob).buttons).toContain('B1')
  })

  it('[<<] on the first page goes to the last page when the pages are exactly full', async () => {
    const buttons = Array.from({ length: 20 }, (_, i) => `BUTTON B${i + 1}|6000`).join('\n')
    const f = await lamp(buttons)
    const bob = f.avatar('Bob')
    f.touch(bob)
    f.click(bob, '[<<]')
    const last = f.lastDialog(bob).buttons
    expect(last).toEqual(expect.arrayContaining(['B11', 'B20']))
    expect(last).not.toContain('B10')
  })

  it('reads lines pasted from chat with the ◆ marker of a DUMP', async () => {
    const f = await lamp('[12:00] Lamp: ◆BUTTON On|5001\n◆BUTTON Off|5002')
    const bob = f.avatar('Bob')
    f.touch(bob)
    expect(f.lastDialog(bob).buttons).toEqual(expect.arrayContaining(['On', 'Off']))
    f.click(bob, 'On')
    expect(f.linked()).toContainEqual({ num: 5001, str: 'On', id: bob.key })
  })

  it('a long name is cut to 23 characters, and Unicode names are kept', async () => {
    const f = await lamp('BUTTON Abcdefghijklmnopqrstuvwxyz|6000\nBUTTON Café ☕|6001')
    const bob = f.avatar('Bob')
    f.touch(bob)
    expect(f.lastDialog(bob).buttons).toEqual(expect.arrayContaining(['Abcdefghijklmnopqrstuvw', 'Café ☕']))
    f.click(bob, 'Café ☕')
    expect(f.linked()).toContainEqual({ num: 6001, str: 'Café ☕', id: bob.key })
  })

  it('a second avatar touching within 5 s is told to wait; after 5 s they get the menu', async () => {
    const f = await lamp()
    const bob = f.avatar('Bob')
    const carol = f.avatar('Carol')
    f.touch(bob)
    f.touch(carol)
    const d = f.lastDialog(carol)
    expect(d.message).toContain('Bob is already using the menu.')
    expect(d.buttons).toEqual(['OK'])
    f.settle(6_000)
    f.touch(carol)
    expect(f.lastDialog(carol).buttons).toContain('On')
  })

  it('90004 opens the top menu, 90005 re-shows the current submenu for the same avatar', async () => {
    const f = await lamp()
    const bob = f.avatar('Bob')
    f.broadcast(90005, 'Colours', bob.key)
    expect(f.lastDialog(bob).buttons).toContain('Red')
    f.broadcast(90005, '', bob.key) // no submenu named: the current menu again
    expect(f.lastDialog(bob).buttons).toContain('Red')
    f.broadcast(90004, '', bob.key)
    expect(f.lastDialog(bob).buttons).toContain('On')
  })

  it('90005 without a submenu name gives a different avatar the top menu (FIX of PR #78)', async () => {
    const f = await lamp()
    const bob = f.avatar('Bob')
    const carol = f.avatar('Carol')
    f.broadcast(90005, 'Colours', bob.key)
    f.settle(6_000)
    f.broadcast(90005, '', carol.key)
    expect(f.lastDialog(carol).buttons).toContain('On')
    expect(f.lastDialog(carol).buttons).not.toContain('Red')
  })

  it('link messages from another prim are ignored, unless LMSOURCE 1', async () => {
    const bob = { key: '', name: '' }
    for (const lmsource of [0, 1]) {
      const f = await lamp(`LMSOURCE ${lmsource}\n${LAMP}`, { prims: 2 })
      const b = f.avatar('Bob')
      bob.key = b.key
      const before = f.dialogsFor(b).length
      menu(f).fire('link_message', { sender_num: 2, num: 90004, str: '', id: b.key })
      f.settle()
      expect(f.dialogsFor(b).length - before).toBe(lmsource)
    }
  })

  it('MTYPE 3: touching does not open the menu, and touches pass to the root', async () => {
    const f = await lamp(`MTYPE 3\n${LAMP}`)
    const bob = f.avatar('Bob')
    f.touch(bob)
    expect(f.dialogsFor(bob)).toHaveLength(0)
    expect(menu(f).callsOf('llPassTouches').map((c) => c.args[0])).toEqual([0, 1])
    f.broadcast(90004, '', bob.key) // a link message still opens it
    expect(f.lastDialog(bob).buttons).toContain('On')
  })

  it('reads AVpos when there is no LSpos, also through the dataserver when the fast reader answers NAK', async () => {
    const f = await buildFurniture({ sources: LS2_SCRIPTS, scripts: ['[LS]menu'], notecards: { AVpos: LAMP } })
    menu(f).mock('llGetNotecardLineSync', () => NAK)
    f.start()
    f.settle(3_000)
    expect(menu(f).callsOf('llGetNotecardLine').length).toBeGreaterThan(0)
    const bob = f.avatar('Bob')
    f.touch(bob)
    expect(f.lastDialog(bob).buttons).toEqual(expect.arrayContaining(['On', 'Off', 'Colours*']))
  })

  it('reloads the menu when the notecard is edited', async () => {
    const f = await lamp()
    f.setNotecard('LSpos', 'BUTTON Dim|5009')
    f.settle(2_000)
    const bob = f.avatar('Bob')
    f.touch(bob)
    expect(f.lastDialog(bob).buttons).toContain('Dim')
    expect(f.lastDialog(bob).buttons).not.toContain('On')
  })

  it('an extra copy ("[LS]menu 1") removes itself and tells the owner', async () => {
    const f = await buildFurniture({ sources: LS2_SCRIPTS, scripts: ['[LS]menu', '[LS]menu 1'], notecards: { LSpos: LAMP } })
    f.start()
    expect(f.script('[LS]menu 1').callsOf('llRemoveInventory').map((c) => String(c.args[0]))).toEqual(['[LS]menu 1'])
    expect(f.lastDialog(owner).message).toContain('Use only one copy of this script!')
    expect(f.script('[LS]menu').callsOf('llRemoveInventory')).toHaveLength(0)
  })

  it('removes itself when a sit script is added later', async () => {
    const f = await lamp()
    // a sit script dropped in: llGetInventoryType("[LS]sit") answers INVENTORY_SCRIPT (10)
    menu(f).mock('llGetInventoryType', (_ctx, args) => (args[0] === '[LS]sit' ? 10 : args[0] === 'LSpos' ? 7 : -1))
    menu(f).fire('changed', { changes: 0x1 })
    f.settle()
    expect(menu(f).callsOf('llRemoveInventory').map((c) => String(c.args[0]))).toContain('[LS]menu')
  })
})

describe('LuaSitter2 [LS]menu security', () => {
  it('the owner sets OWNER ONLY with [SECURITY]; others are refused, the owner still gets the menu', async () => {
    const f = await lamp(LAMP, { scripts: ['[LS]menu', '[LS]plugins'] })
    const bob = f.avatar('Bob')
    f.touch(owner)
    f.click(owner, '[OWNER]')
    f.click(owner, '[SECURITY]')
    expect(f.lastDialog(owner).message).toContain('Who is allowed to control this menu?')
    f.click(owner, 'OWNER ONLY')
    expect(f.printed('[LS]menu').join('\n')).toContain('Menu access set to: OWNER ONLY')
    expect(f.lastDialog(owner).message).toContain('Prop options') // back in the options menu
    f.settle(6_000)
    f.touch(bob)
    expect(f.lastDialog(bob).message).toContain('Sorry, the owner has set this menu to: OWNER ONLY')
    f.touch(owner)
    expect(f.lastDialog(owner).buttons).toContain('On')
  })

  it('GROUP ONLY lets in avatars of the same group, without a prop script the menu reopens', async () => {
    const f = await lamp()
    const bob = f.avatar('Bob')
    const carol = f.avatar('Carol')
    f.touch(owner)
    reply(f, owner, '[SECURITY]')
    reply(f, owner, 'GROUP ONLY')
    expect(f.lastDialog(owner).buttons).toContain('On') // no prop script: the menu again
    menu(f).mock('llSameGroup', (_ctx, args) => Number(String(args[0]) === bob.key))
    f.settle(6_000)
    f.touch(carol)
    expect(f.lastDialog(carol).message).toContain('GROUP ONLY')
    f.settle(6_000)
    f.touch(bob)
    expect(f.lastDialog(bob).buttons).toContain('On')
  })

  it('[SECURITY], [OWNER] and access levels from others are refused', async () => {
    const f = await lamp(LAMP, { scripts: ['[LS]menu', '[LS]plugins'] })
    const bob = f.avatar('Bob')
    f.touch(bob)
    reply(f, bob, '[SECURITY]')
    reply(f, bob, '[OWNER]')
    const told = menu(f).chat.filter((c) => c.to === bob.key).map((c) => c.text)
    expect(told).toEqual(['Sorry, only the owner can use this.', 'Sorry, only the owner can use this.'])
    expect(f.lastDialog(bob).buttons).toContain('On') // [OWNER] refused: the menu again
    reply(f, bob, 'OWNER ONLY')
    expect(f.printed('[LS]menu').join('\n')).not.toContain('Menu access set to')
  })
})

describe('LuaSitter2 [LS]menu prop options ([OWNER])', () => {
  const props = { ball: ['[LS]object'], cube: ['[LS]object'] }

  it('[OWNER] only appears with a prop script ([LS]plugins or the LSL [AV]prop)', async () => {
    const alone = await lamp()
    alone.touch(owner)
    expect(alone.lastDialog(owner).buttons).not.toContain('[OWNER]')
    const mixed = await lamp(LAMP, { placeholders: ['[AV]prop'] })
    mixed.touch(owner)
    expect(mixed.lastDialog(owner).buttons).toContain('[OWNER]')
    mixed.click(owner, '[OWNER]')
    expect(mixed.lastDialog(owner).buttons).toEqual(expect.arrayContaining(['[NEW]', '[DUMP]', '[SAVE]', '[CLEAR]', '[SECURITY]', '[RESET]']))
  })

  it('[NEW] and [DUMP] are hidden when the prop script is not copy and transfer', async () => {
    const f = await lamp(LAMP, { scripts: ['[LS]menu', '[LS]plugins'] })
    menu(f).mock('llGetInventoryPermMask', () => 0x8000) // copy only
    f.touch(owner)
    f.click(owner, '[OWNER]')
    const d = f.lastDialog(owner)
    expect(d.buttons).not.toContain('[NEW]')
    expect(d.buttons).not.toContain('[DUMP]')
    expect(d.buttons).toContain('[SAVE]')
  })

  it('[NEW]: choose a prop from the inventory, name its button, and it is added to the menu (90173)', async () => {
    const f = await lamp(LAMP, { scripts: ['[LS]menu', '[LS]plugins'], objects: props })
    f.touch(owner)
    f.click(owner, '[OWNER]')
    f.click(owner, '[NEW]')
    const chooser = f.lastDialog(owner)
    expect(chooser.message).toContain('(Page 1/1)')
    expect(chooser.message).toContain('1.ball')
    expect(chooser.message).toContain('2.cube')
    expect(f.linked()).toContainEqual({ num: 90200, str: '', id: '' }) // props cleared first
    f.click(owner, '2')
    expect(f.lastDialog(owner).message).toContain('Please type a button name for your prop\nProp: cube')
    reply(f, owner, '') // an empty name asks again
    expect(f.lastDialog(owner).message).toContain('Prop: cube')
    reply(f, owner, 'My Cube')
    expect(f.linked()).toContainEqual({ num: 90173, str: 'My Cube', id: 'cube' })
    expect(f.lastDialog(owner).message).toContain('Prop options')
    f.click(owner, '[BACK]')
    expect(f.lastDialog(owner).buttons).toContain('My Cube')
    f.click(owner, 'My Cube')
    expect(f.linked()).toContainEqual({ num: 90200, str: 'My Cube', id: OWNER })
  })

  it('a prop added from a submenu keeps the submenu (FIX: the index was not shifted)', async () => {
    const f = await lamp(LAMP, { scripts: ['[LS]menu', '[LS]plugins'], objects: props })
    f.touch(owner)
    f.click(owner, 'Colours*')
    f.click(owner, '[OWNER]')
    f.click(owner, '[NEW]')
    f.click(owner, '1')
    reply(f, owner, 'Ball')
    reply(f, owner, '[>>]') // any reply that only re-shows the current menu
    const d = f.lastDialog(owner)
    expect(d.buttons).toEqual(expect.arrayContaining(['Red', 'Blue']))
  })

  it('a prop that is not copy for the next owner is refused', async () => {
    const f = await lamp(LAMP, { scripts: ['[LS]menu', '[LS]plugins'], objects: props })
    f.touch(owner)
    f.click(owner, '[OWNER]')
    f.click(owner, '[NEW]')
    f.click(owner, '1')
    menu(f).mock('llGetInventoryPermMask', () => 0x2000 | 0x4000) // transfer and modify, no copy
    reply(f, owner, 'Ball')
    expect(menu(f).chat.map((c) => c.text)).toContain("Could not add prop 'ball'. Props and their content must be COPY-OK for NEXT owner.")
    expect(f.linked().filter((m) => m.num === 90173)).toHaveLength(0)
  })

  it('the prop chooser pages long inventories and shortens long names', async () => {
    const objects: Record<string, string[]> = {}
    for (let i = 1; i <= 11; i++) objects[`prop${String(i).padStart(2, '0')}`] = ['[LS]object']
    objects['a prop with a very long name that goes on and on and on, far beyond sixty-five characters'] = ['[LS]object']
    const f = await lamp(LAMP, { scripts: ['[LS]menu', '[LS]plugins'], objects })
    f.touch(owner)
    f.click(owner, '[OWNER]')
    f.click(owner, '[NEW]')
    const page1 = f.lastDialog(owner)
    expect(page1.message).toContain('(Page 1/2)')
    expect(page1.message).toMatch(/1\.a prop with a very long name.*\.\.\n/)
    expect(page1.message).not.toContain('sixty-five characters')
    expect(page1.buttons).toEqual(expect.arrayContaining(['1', '9', '[BACK]', '[<<]', '[>>]']))
    f.click(owner, '[>>]')
    const page2 = f.lastDialog(owner)
    expect(page2.message).toContain('(Page 2/2)')
    expect(page2.message).toContain('1.prop09')
    expect(page2.buttons).toContain(' ') // filler buttons on a short page
    f.click(owner, '[>>]')
    expect(f.lastDialog(owner).message).toContain('(Page 1/2)')
    f.click(owner, '[<<]')
    expect(f.lastDialog(owner).message).toContain('(Page 2/2)')
    f.click(owner, '3')
    expect(f.lastDialog(owner).message).toContain('Prop: prop11')
  })

  /** Owner: [OWNER] > [NEW] with these prop names; the numbered lines of the chooser. */
  async function chooserLines(names: string[]) {
    const objects: Record<string, string[]> = {}
    for (const n of names) objects[n] = ['[LS]object']
    const f = await lamp(LAMP, { scripts: ['[LS]menu', '[LS]plugins'], objects })
    f.touch(owner)
    f.click(owner, '[OWNER]')
    f.click(owner, '[NEW]')
    return { f, lines: f.lastDialog(owner).message.split('\n').filter((l) => /^\d\./.test(l)) }
  }

  it('the prop chooser shortens names to 44 characters when they are long together', async () => {
    // 7 names of 60 characters: over 412 together, so each is cut to 44 characters and ".."
    const { lines } = await chooserLines(Array.from({ length: 7 }, (_, i) => `prop ${i + 1} ${'x'.repeat(53)}`))
    expect(lines).toHaveLength(7)
    expect(lines[0]).toBe(`1.prop 1 ${'x'.repeat(37)}..`)
  })

  // FIX (also upstream AVsitter): with 9 names of about 50 characters the chooser text
  // was over llDialog's 512-byte limit even after shortening to 44 characters, so the
  // owner got no chooser at all. The names are now shortened to fit.
  it('the prop chooser shows 9 long names within the 512-byte dialog limit', async () => {
    const { f, lines } = await chooserLines(Array.from({ length: 9 }, (_, i) => `prop ${i + 1} with a rather long name, fifty characters`))
    expect(menu(f).chat.map((c) => c.text)).not.toContain('llDialog: message too long, must be less than 512 characters')
    expect(lines).toHaveLength(9)
    expect(new TextEncoder().encode(f.lastDialog(owner).message).length).toBeLessThan(512)
    expect(lines[0]).toMatch(/^1\.prop 1 with a rather long name.*\.\.$/)
  })

  it('the prop chooser says so when there are no props', async () => {
    const f = await lamp(LAMP, { scripts: ['[LS]menu', '[LS]plugins'] })
    f.touch(owner)
    f.click(owner, '[OWNER]')
    f.click(owner, '[NEW]')
    const d = f.lastDialog(owner)
    expect(d.message).toContain('No items of required type in the prim inventory.')
    expect(d.buttons).toEqual(['[BACK]'])
  })

  it('[SAVE] sends 90101 and shows the options again; [CLEAR] clears the props', async () => {
    const f = await lamp(LAMP, { scripts: ['[LS]menu', '[LS]plugins'] })
    f.touch(owner)
    f.click(owner, '[OWNER]')
    f.click(owner, '[SAVE]')
    expect(f.linked()).toContainEqual({ num: 90101, str: '0|[SAVE]', id: '' })
    expect(f.lastDialog(owner).message).toContain('Prop options')
    const cleared = f.linked().filter((m) => m.num === 90200 && m.str === '').length
    f.click(owner, '[CLEAR]')
    expect(f.linked().filter((m) => m.num === 90200 && m.str === '').length).toBe(cleared + 1)
    expect(f.printed('[LS]menu').join('\n')).toContain('Props have been cleared!')
    expect(f.lastDialog(owner).buttons).toContain('On')
  })

  it('[RESET] clears the props, then resets the prop script and itself 1 s later', async () => {
    const f = await lamp(LAMP, { scripts: ['[LS]menu', '[LS]plugins'] })
    f.touch(owner)
    f.click(owner, '[OWNER]')
    f.script('[LS]menu').answerDialog('[RESET]', { name: owner.name })
    f.advance(500)
    expect(menu(f).callsOf('llResetOtherScript')).toHaveLength(0)
    f.settle(1_000)
    expect(menu(f).callsOf('llResetOtherScript').map((c) => String(c.args[0]))).toEqual(['[LS]plugins'])
    expect(f.linked()).toContainEqual({ num: 90200, str: '', id: '' })
  })

  it('[DUMP] writes TEXT, MENU, TOMENU and BUTTON lines (90200 left out), then asks the props', async () => {
    const f = await lamp(`${LAMP}\nBUTTON Ball`, { scripts: ['[LS]menu', '[LS]plugins'] })
    f.touch(owner)
    f.click(owner, '[OWNER]')
    f.click(owner, '[DUMP]')
    f.settle(5_000)
    const out = dumped(f).filter((t) => t.trim() !== '')
    expect(out).toEqual([
      '--✄--COPY BELOW INTO "LSpos" NOTECARD--✄--',
      'TEXT Lamp controls\\nPick one',
      'BUTTON On|5001',
      `BUTTON Off|5002|off|key-1`,
      'TOMENU Colours',
      'MENU Colours',
      'BUTTON Red|5003|red',
      'BUTTON Blue|5003|blue',
      'BUTTON Ball',
      '--✄--COPY ABOVE INTO "LSpos" NOTECARD--✄--',
    ])
    expect(menu(f).chat.every((c) => c.to === OWNER)).toBe(true)
  })

  it('the menu listen is closed 120 s after the last dialog', async () => {
    const f = await lamp()
    const bob = f.avatar('Bob')
    f.touch(bob)
    const removed = () => menu(f).callsOf('llListenRemove').length
    const open = removed()
    f.settle(118_000)
    expect(removed()).toBe(open)
    f.settle(3_000)
    expect(removed()).toBe(open + 1)
    expect(menu(f).listens.filter((l) => l.active)).toHaveLength(0)
  })
})

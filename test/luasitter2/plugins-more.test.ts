// LuaSitter2: more of [LS]plugins: prop permission checks and WARN, missing props,
// PROP3 (kept until removed by a "remprop_" BUTTON), DUMP of PROP lines, swapping,
// menu mode (with [LS]menu, no sit script), a new chat channel on rez; sequences
// (WHISPER, SOUND and its preloading, DEBUG, sounds on/off, ◀◀, ▶, [BACK], a
// sequence without WAIT, WAIT 0); favourites (duplicates, missing, paging, [BACK]).
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS } from '../helpers/furniture.js'
import type { Furniture, Avatar } from '../helpers/furniture.js'

const POSES = `SITTER 0
POSE Sit1|anim1
POSE Sit2|anim2
POSE Sit3|anim3
{Sit1}<0,0,0.5><0,0,0>
{Sit2}<0,0,0.5><0,0,0>
{Sit3}<0,0,0.5><0,0,0>`

const PROPS = { ball: ['[LS]object'], cube: ['[LS]object'] }

async function furniture(card: string, opts: { notecards?: Record<string, string>; scripts?: string[]; sitters?: number; sounds?: boolean } = {}) {
  const sitters = opts.sitters ?? 1
  const sits = ['[LS]sit']
  for (let i = 1; i < sitters; i++) sits.push(`[LS]sit ${i}`)
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: opts.scripts ?? [...sits, '[LS]plugins'],
    prims: sitters,
    notecards: { LSpos: card, ...(opts.notecards ?? {}) },
    animations: ['anim1', 'anim2', 'anim3'],
    objects: PROPS,
  })
  f.start()
  return f
}

const plugins = (f: Furniture) => f.script('[LS]plugins')
const said = (f: Furniture) => plugins(f).chat.filter((c) => c.channel === 0).map((c) => c.text)
const names = (f: Furniture) => f.rezzed().map((l) => l.prims[0]!.name).sort()

describe('LuaSitter2 [LS]plugins props', () => {
  it('a missing prop object is reported', async () => {
    const f = await furniture(`${POSES}\nPROP Sit2|nothing|G1|<0,0,1>|<0,0,0>`)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    expect(said(f)).toContain("Could not find prop 'nothing'.")
    expect(f.rezzed()).toHaveLength(0)
  })

  it('a prop that is not copy for the next owner is not rezzed', async () => {
    const f = await furniture(`${POSES}\nPROP Sit2|ball|G1|<0,0,1>|<0,0,0>`)
    plugins(f).mock('llGetInventoryPermMask', () => 0x2000 | 0x4000) // transfer and modify
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    expect(said(f)).toContain("Can't rez 'ball'. Props and their content must be COPY-OK  for NEXT owner")
    expect(f.rezzed()).toHaveLength(0)
  })

  it('an attachment prop must be copy and transfer', async () => {
    const f = await furniture(`${POSES}\nPROP1 Sit2|ball|G1|<0,0,1>|<0,0,0>|chest`)
    plugins(f).mock('llGetInventoryPermMask', () => 0x8000) // copy only
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    expect(said(f)).toContain("Can't rez 'ball'. Attachment props and their content must be COPY-TRANSFER  for NEXT owner")
  })

  it('WARN 2 checks the owner\'s permissions, WARN 3 none', async () => {
    const two = await furniture(`WARN 2\n${POSES}\nPROP Sit2|ball|G1|<0,0,1>|<0,0,0>`)
    const masks: number[] = []
    plugins(two).mock('llGetInventoryPermMask', (_ctx, args) => { masks.push(args[1] as number); return 0 })
    const alice = two.avatar('Alice')
    two.sit(alice)
    two.click(alice, 'Sit2')
    expect(masks).toEqual([4, 1]) // MASK_NEXT, then MASK_OWNER
    expect(said(two)).toContain("Can't rez 'ball'. Props and their content must be COPY-OK")

    const three = await furniture(`WARN 3\n${POSES}\nPROP Sit2|ball|G1|<0,0,1>|<0,0,0>`)
    plugins(three).mock('llGetInventoryPermMask', () => 0)
    const bob = three.avatar('Bob')
    three.sit(bob)
    three.click(bob, 'Sit2')
    expect(names(three)).toEqual(['ball'])
  })

  it('a PROP3 stays when the pose changes and the sitter stands, until a "remprop_" BUTTON removes it', async () => {
    const card = `${POSES}\nPROP3 Sit2|ball|G1|<0,0,1>|<0,0,0>\nBUTTON Remove ball|90200|remprop_Sit2`
    const f = await furniture(card)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    expect(names(f)).toEqual(['ball'])
    f.click(alice, 'Sit1')
    f.settle(3_000)
    expect(names(f)).toEqual(['ball'])
    f.click(alice, 'Remove ball')
    f.settle(3_000)
    expect(names(f)).toEqual([])
  })

  it('a BUTTON without a prop removes the props of that sitter', async () => {
    const card = `${POSES}\nBUTTON Ball|90200\nBUTTON Nothing|90200\nPROP Ball|ball|G1|<0,0,1>|<0,0,0>`
    const f = await furniture(card)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Ball')
    expect(names(f)).toEqual(['ball'])
    f.click(alice, 'Nothing')
    f.settle(3_000)
    expect(names(f)).toEqual([])
  })

  it('a 90220 BUTTON rezzes the prop without giving the menu back', async () => {
    const f = await furniture(`${POSES}\nBUTTON Ball|90220\nPROP Ball|ball|G1|<0,0,1>|<0,0,0>`)
    const alice = f.avatar('Alice')
    f.sit(alice)
    const before = f.dialogsFor(alice).length
    f.click(alice, 'Ball')
    expect(names(f)).toEqual(['ball'])
    expect(f.dialogsFor(alice).length).toBe(before)
  })

  it('DUMP writes the PROP lines of the sitter, with type and attach point', async () => {
    const card = `${POSES}\nPROP Sit2|ball|G1|<0,0,1>|<0,0,0>\nPROP1 Sit3|cube|G2|<0,0.5,1>|<0,0,90>|right hand`
    const f = await furniture(card)
    f.sendLinked('[LS]plugins', 90020, '0', '[LS]plugins')
    f.settle(2_000)
    const out = f.linked().filter((m) => m.num === 90022 || m.num === 90021).map((m) => `${m.num} ${m.str}`)
    expect(out).toEqual([
      '90022 PROP Sit2|ball|G1|<0.00000, 0.00000, 1.00000>|<0.00000, 0.00000, 0.00000>|',
      '90022 PROP1 Sit3|cube|G2|<0.00000, 0.50000, 1.00000>|<0.00000, 0.00000, 90.00000>|right hand',
      '90021 0',
    ])
  })

  it('swapping sitters (90030) removes the props of both', async () => {
    const card = `SITTER 0\nSYNC S|anim1\nSYNC T|anim2\n{S}<0,0,0.5><0,0,0>\n{T}<0,0,0.5><0,0,0>\nPROP T|ball|G1|<0,0,1>|<0,0,0>\nSITTER 1\nSYNC S|anim1\nSYNC T|anim2\n{S}<1,0,0.5><0,0,0>\n{T}<1,0,0.5><0,0,0>\nPROP T|cube|G1|<1,0,1>|<0,0,0>`
    const f = await furniture(card, { sitters: 2 })
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.click(alice, 'T')
    expect(names(f)).toEqual(['ball', 'cube'])
    f.sendLinked('[LS]plugins', 90030, '0', '1')
    f.settle(3_000)
    expect(names(f)).toEqual([])
  })

  it('a PROP3 stays when its sitter stands, and is removed when the last sitter leaves', async () => {
    const card = `SITTER 0
SYNC S|anim1
SYNC T|anim2
{S}<0,0,0.5><0,0,0>
{T}<0,0,0.5><0,0,0>
PROP3 T|ball|G1|<0,0,1>|<0,0,0>
SITTER 1
SYNC S|anim1
SYNC T|anim2
{S}<1,0,0.5><0,0,0>
{T}<1,0,0.5><0,0,0>`
    const f = await furniture(card, { sitters: 2 })
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.click(alice, 'T')
    expect(names(f)).toEqual(['ball'])
    f.stand(alice)
    f.settle(3_000)
    expect(names(f)).toEqual(['ball'])
    f.stand(bob) // nobody seated: CHANGED_LINK removes every prop
    f.settle(3_000)
    expect(names(f)).toEqual([])
  })

  it('takes a new prop channel when the furniture is rezzed', async () => {
    const f = await furniture(`${POSES}\nPROP Sit2|ball|G1|<0,0,1>|<0,0,0>`)
    const frands = plugins(f).callsOf('llFrand').length
    plugins(f).fire('on_rez', { start_param: 0 })
    f.settle()
    expect(plugins(f).callsOf('llFrand').length).toBe(frands + 1)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    expect(names(f)).toEqual(['ball'])
    f.click(alice, 'Sit1') // the new channel still reaches the prop
    f.settle(3_000)
    expect(names(f)).toEqual([])
  })

  it('the adjuster adds a prop to the current pose of sitter 1 (90171)', async () => {
    const card = `SITTER 0\nSYNC S|anim1\n{S}<0,0,0.5><0,0,0>\nSITTER 1\nSYNC S|anim2\n{S}<1,0,0.5><0,0,0>`
    const f = await furniture(card, { sitters: 2 })
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.sendLinked('[LS]plugins', 90171, '1', 'cube')
    expect(said(f)).toEqual(expect.arrayContaining(["PROP added: 'cube' to 'S' for SITTER 1", 'Position your prop and click [SAVE].']))
    expect(names(f)).toEqual(['cube'])
  })
})

describe('LuaSitter2 [LS]plugins with [LS]menu (no sit script)', () => {
  const MENU = `BUTTON Ball\nBUTTON Cube\nBUTTON Off\nPROP Ball|ball|G1|<0,0,1>|<0,0,0>\nPROP Cube|cube|G1|<0,0,1>|<0,0,0>`

  it('a BUTTON rezzes its prop, a prop of the same group replaces it, a BUTTON without a prop removes all', async () => {
    const f = await furniture(MENU, { scripts: ['[LS]menu', '[LS]plugins'] })
    const bob = f.avatar('Bob')
    f.touch(bob)
    f.click(bob, 'Ball')
    expect(names(f)).toEqual(['ball'])
    f.click(bob, 'Cube')
    f.settle(3_000)
    expect(names(f)).toEqual(['cube'])
    f.click(bob, 'Off')
    f.settle(3_000)
    expect(names(f)).toEqual([])
  })

  it('a prop added with the menu\'s [NEW] (90173) is rezzed and announced', async () => {
    const f = await furniture(MENU, { scripts: ['[LS]menu', '[LS]plugins'] })
    f.sendLinked('[LS]plugins', 90173, 'My Ball', 'ball')
    expect(said(f)).toEqual(expect.arrayContaining(["PROP added: 'ball' to 'My Ball'", 'Position your prop and click [SAVE].']))
    expect(names(f)).toEqual(['ball'])
  })
})

describe('LuaSitter2 [LS]plugins sequences', () => {
  const card = `${POSES}\nSEQUENCE Scene\nBUTTON Sounds|90205`

  async function scene(steps: string) {
    const f = await furniture(card, { notecards: { '[LS]sequence_settings': `SEQUENCE Scene\n${steps}` } })
    const alice = f.avatar('Alice')
    f.sit(alice)
    return { f, alice }
  }

  it('WHISPER says the text quietly, with sitter names; an empty seat is "nobody"', async () => {
    const f = await furniture(`SITTER 0\nSYNC S|anim1\n{S}<0,0,0.5><0,0,0>\nSEQUENCE Scene\nSITTER 1\nSYNC S|anim2\n{S}<1,0,0.5><0,0,0>`, {
      sitters: 2,
      notecards: { '[LS]sequence_settings': 'SEQUENCE Scene\nWHISPER /0 and /1\nWAIT 10' },
    })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Scene')
    const w = plugins(f).chat.find((c) => c.text === 'Alice and nobody')
    expect(w?.type).toBe('whisper')
  })

  it('SOUND plays a sound at its volume, and the next sound is preloaded during a long WAIT', async () => {
    const { f, alice } = await scene('SOUND bell|0.5\nWAIT 3\nSAY next\nSOUND gong|1\nWAIT 10')
    f.click(alice, 'Scene')
    const p = plugins(f)
    expect(p.callsOf('llPlaySound').map((c) => [String(c.args[0]), c.args[1]])).toEqual([['bell', 0.5]])
    expect(p.callsOf('llPreloadSound').map((c) => String(c.args[0]))).toEqual(['gong'])
    f.settle(3_000)
    expect(p.callsOf('llPlaySound').map((c) => String(c.args[0]))).toEqual(['bell', 'gong'])
  })

  it('a 90205 BUTTON switches the sounds off and on', async () => {
    const { f, alice } = await scene('SOUND bell|1\nWAIT 5\nLOOP')
    f.click(alice, 'Sounds')
    expect(said(f)).toContain('Sounds OFF')
    expect(plugins(f).callsOf('llStopSound').length).toBeGreaterThan(0)
    f.broadcast(90005, '', alice.key)
    f.click(alice, 'Scene')
    expect(plugins(f).callsOf('llPlaySound')).toHaveLength(0)
    f.broadcast(90205, '', alice.key)
    expect(said(f)).toContain('Sounds ON')
    f.settle(6_000)
    expect(plugins(f).callsOf('llPlaySound').length).toBeGreaterThan(0)
  })

  it('DEBUG 2 whispers what the sequence does', async () => {
    const { f, alice } = await scene('PLAY Sit2\nWAIT 5')
    f.setNotecard('[LS]sequence_settings', 'DEBUG 2\nSEQUENCE Scene\nPLAY Sit2\nWAIT 5')
    f.settle(2_000)
    f.broadcast(90005, '', alice.key)
    f.click(alice, 'Scene')
    f.settle(6_000)
    const w = plugins(f).chat.filter((c) => c.type === 'whisper').map((c) => c.text)
    expect(w).toEqual(expect.arrayContaining(["Sequence 'Scene' Started!", 'Playing pose Sit2', 'Waiting for 5.000000 seconds', "Sequence 'Scene' Ended!"]))
  })

  it('◀◀ goes back to the previous pose, ▶ resumes after a pause, [BACK] gives the pose menu', async () => {
    const { f, alice } = await scene('PLAY Sit1\nWAIT 10\nPLAY Sit2\nWAIT 10\nPLAY Sit3\nWAIT 10')
    f.click(alice, 'Scene')
    f.click(alice, '▶▶')
    f.click(alice, '▶▶')
    f.settle(1_000)
    expect(f.playing(alice)).toEqual(['anim3'])
    f.click(alice, '◀◀')
    f.settle(1_000)
    expect(f.playing(alice)).toEqual(['anim2'])
    f.click(alice, '▮▮')
    expect(f.lastDialog(alice).buttons).toContain('▶')
    f.settle(20_000)
    expect(f.playing(alice)).toEqual(['anim2'])
    f.click(alice, '▶')
    f.settle(1_000)
    expect(f.playing(alice)).toEqual(['anim3'])
    f.click(alice, '[BACK]')
    expect(f.lastDialog(alice).script).toBe('[LS]sit')
  })

  it('a sequence without WAIT shows no controls and gives the pose menu back', async () => {
    const { f, alice } = await scene('SAY Hi\nSAY there')
    f.click(alice, 'Scene')
    expect(said(f)).toEqual(expect.arrayContaining(['Hi', 'there']))
    expect(f.lastDialog(alice).script).toBe('[LS]sit')
  })

  it('WAIT 0 stops the sequence there; LOOP as the last step starts it again', async () => {
    const stop = await scene('SAY one\nWAIT 0\nSAY two')
    stop.f.click(stop.alice, 'Scene')
    stop.f.settle(5_000)
    expect(said(stop.f)).toContain('one')
    expect(said(stop.f)).not.toContain('two')

    const loop = await scene('SAY again\nWAIT 2\nLOOP')
    loop.f.click(loop.alice, 'Scene')
    loop.f.settle(5_000)
    expect(said(loop.f).filter((t) => t === 'again').length).toBeGreaterThanOrEqual(3)
  })

  it('standing up stops the sequence and its sound', async () => {
    const { f, alice } = await scene('SOUND bell|1\nSAY tick\nWAIT 2\nLOOP')
    f.click(alice, 'Scene')
    f.stand(alice)
    const ticks = said(f).filter((t) => t === 'tick').length
    f.settle(6_000)
    expect(said(f).filter((t) => t === 'tick').length).toBe(ticks)
    expect(plugins(f).callsOf('llStopSound').length).toBeGreaterThan(0)
  })

  it('removing the sequence notecard reloads the plugin without sequences', async () => {
    const { f } = await scene('SAY hi\nWAIT 5')
    f.setNotecard('[LS]sequence_settings', null)
    f.settle(2_000)
    expect(f.printed('[LS]plugins').filter((t) => t.includes('Sequences Ready'))).toHaveLength(1)
  })
})

describe('LuaSitter2 [LS]plugins favourites', () => {
  const card = `${POSES}\nBUTTON Add Fav|90401\nBUTTON Del Fav|90402\nBUTTON Favorites...|90403`
  const told = (f: Furniture, av: Avatar) => plugins(f).chat.filter((c) => c.to === av.key).map((c) => c.text)

  it('says when a pose is already a favourite, is not one, or there are none', async () => {
    const f = await furniture(card)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Favorites...')
    f.click(alice, 'Del Fav')
    f.click(alice, 'Add Fav')
    f.click(alice, 'Add Fav')
    expect(told(f, alice)).toEqual([
      'No favs found for this seat',
      'This pose is not in the favs for this seat',
      'Sit1 added to favs',
      'This pose is already in the favs for this seat',
    ])
  })

  it('removing the last favourite leaves none', async () => {
    const f = await furniture(card)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Add Fav')
    f.click(alice, 'Del Fav')
    f.click(alice, 'Favorites...')
    expect(told(f, alice).at(-1)).toBe('No favs found for this seat')
  })

  it('a long favourites list is paged, sorted, and [BACK] gives the pose menu', async () => {
    const many = Array.from({ length: 12 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`)
    const poses = many.map((p) => `POSE ${p}|anim1`).join('\n')
    const f = await furniture(`SITTER 0\n${poses}\nBUTTON Add Fav|90401\nBUTTON Favorites...|90403`)
    const alice = f.avatar('Alice')
    f.sit(alice)
    // add every pose: play it by link message, then 90401
    for (const p of [...many].reverse()) {
      f.broadcast(90000, p, alice.key)
      f.broadcast(90401, '', alice.key)
    }
    f.broadcast(90403, '', alice.key)
    const page1 = f.lastDialog(alice)
    expect(page1.script).toBe('[LS]plugins')
    expect(page1.buttons).toEqual(expect.arrayContaining(['P01', 'P09', '[<<]', '[>>]', '[BACK]']))
    expect(page1.buttons).not.toContain('P10')
    f.click(alice, '[>>]')
    expect(f.lastDialog(alice).buttons).toEqual(expect.arrayContaining(['P10', 'P12']))
    f.click(alice, '[>>]')
    expect(f.lastDialog(alice).buttons).toContain('P01')
    f.click(alice, '[<<]') // before the first page: the last page (FIX)
    expect(f.lastDialog(alice).buttons).toContain('P12')
    f.click(alice, 'P11')
    expect(f.linked()).toContainEqual({ num: 90008, str: 'P11', id: alice.key })
    f.click(alice, '[BACK]')
    expect(f.lastDialog(alice).script).toBe('[LS]sit')
  })

  it('favourites belong to the seat: after a swap the other seat has none', async () => {
    const card2 = `SITTER 0\nSYNC S|anim1\nSYNC T|anim2\n{S}<0,0,0.5><0,0,0>\n{T}<0,0,0.5><0,0,0>\nBUTTON Add Fav|90401\nBUTTON Favorites...|90403\nSITTER 1\nSYNC S|anim1\nSYNC T|anim2\n{S}<1,0,0.5><0,0,0>\n{T}<1,0,0.5><0,0,0>`
    const f = await furniture(card2, { sitters: 2 })
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.broadcast(90000, 'T', alice.key)
    f.broadcast(90401, '', alice.key)
    f.broadcast(90030, '0', '1')
    f.broadcast(90403, '', alice.key)
    expect(told(f, alice).at(-1)).toBe('No favs found for this seat')
  })
})

describe('LuaSitter2 [LS]plugins reloading and edge cases', () => {
  const NAK = '\n\x15\n'

  it('reads props and sequences through the dataserver when the fast reader answers NAK', async () => {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]sit', '[LS]plugins'],
      notecards: { LSpos: `${POSES}\nSEQUENCE Scene\nPROP Sit2|ball|G1|<0,0,1>|<0,0,0>`, '[LS]sequence_settings': 'SEQUENCE Scene\nSAY hello\nWAIT 10' },
      animations: ['anim1', 'anim2', 'anim3'],
      objects: PROPS,
    })
    plugins(f).mock('llGetNotecardLineSync', () => NAK)
    f.start()
    f.settle(5_000)
    expect(plugins(f).callsOf('llGetNotecardLine').length).toBeGreaterThan(0)
    const ready = f.printed('[LS]plugins').join('\n')
    expect(ready).toContain('1 Props Ready')
    expect(ready).toContain('1 Sequences Ready')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    expect(names(f)).toEqual(['ball'])
  })

  it('editing the pose notecard removes the props and reloads', async () => {
    const f = await furniture(`${POSES}\nPROP Sit2|ball|G1|<0,0,1>|<0,0,0>`)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    expect(names(f)).toEqual(['ball'])
    f.setNotecard('LSpos', `${POSES}\nPROP Sit2|cube|G1|<0,0,1>|<0,0,0>`)
    f.settle(3_000)
    expect(names(f)).toEqual([])
    expect(f.printed('[LS]plugins').filter((t) => t.includes('Props Ready'))).toHaveLength(2)
  })

  it('a prop rezzed before the furniture is rezzed again keeps no listen on the old channel', async () => {
    const f = await furniture(`${POSES}\nPROP Sit2|ball|G1|<0,0,1>|<0,0,0>`)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    expect(plugins(f).listens.filter((l) => l.active)).toHaveLength(1)
    plugins(f).fire('on_rez', { start_param: 0 })
    f.settle()
    expect(plugins(f).listens.filter((l) => l.active)).toHaveLength(0)
  })

  it('LOOP in the middle loops back to that line after the last step', async () => {
    const f = await furniture(`${POSES}\nSEQUENCE Scene`, { notecards: { '[LS]sequence_settings': 'SEQUENCE Scene\nSAY intro\nLOOP\nSAY verse\nWAIT 2' } })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Scene')
    f.settle(5_000)
    const out = said(f)
    expect(out.filter((t) => t === 'intro')).toHaveLength(1)
    expect(out.filter((t) => t === 'verse').length).toBeGreaterThanOrEqual(2)
  })

  it('swapping sitters stops a running sequence', async () => {
    const card = `SITTER 0\nSYNC S|anim1\n{S}<0,0,0.5><0,0,0>\nSEQUENCE Scene\nSITTER 1\nSYNC S|anim2\n{S}<1,0,0.5><0,0,0>`
    const f = await furniture(card, { sitters: 2, notecards: { '[LS]sequence_settings': 'SEQUENCE Scene\nSAY tick\nWAIT 2\nLOOP' } })
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.click(alice, 'Scene')
    f.broadcast(90030, '0', '1')
    const ticks = said(f).filter((t) => t === 'tick').length
    f.settle(6_000)
    expect(said(f).filter((t) => t === 'tick').length).toBe(ticks)
  })

  it('favourite buttons from someone not seated do nothing but give the menu back', async () => {
    const f = await furniture(`${POSES}\nBUTTON Add Fav|90401`)
    const bob = f.avatar('Bob')
    f.broadcast(90401, '', bob.key)
    f.broadcast(90402, '', bob.key)
    expect(plugins(f).chat.filter((c) => c.to === bob.key)).toHaveLength(0)
    expect(f.linked().filter((m) => m.num === 90005 && m.id === bob.key)).toHaveLength(2)
  })

  it('"Memory full" stops adding favourites', async () => {
    const f = await furniture(`${POSES}\nBUTTON Add Fav|90401`)
    const alice = f.avatar('Alice')
    f.sit(alice)
    plugins(f).mock('llGetUsedMemory', () => 1_000_000)
    plugins(f).mock('llGetMemoryLimit', () => 1_000_000)
    f.click(alice, 'Add Fav')
    expect(plugins(f).chat.filter((c) => c.to === alice.key).map((c) => c.text)).toEqual(['Memory full'])
  })
})

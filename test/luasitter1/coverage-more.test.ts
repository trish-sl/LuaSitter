// LuaSitter1: more cases of LSroot-security (the [SECURITY] cycle, GROUP ONLY, refused
// touches), LSsittarget-add (several extra prims, the root prim, messages it ignores),
// LShelper-script (the hover text of a seated or multi-prim helper, POS beyond the
// 10 m move limit, LSL number casts, touches) and LSselect (the NAK fallback, ◆
// lines, seat names that clash or are out of range, no notecard, 90075, blank page
// buttons, inventory and link changes), LSsit (pose changes within 0.5 s, two LOOP
// marks, a full last menu page, the 0.35 m sit target nudge, [SWAP] in a SYNC and
// past taken seats, 89999, 90170 before a submenu, the 10-adjustment limit, [BACK]
// to the LSselect seat menu).
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS1_SCRIPTS, LS1, OWNER } from '../helpers/furniture.js'
import type { Avatar, Furniture } from '../helpers/furniture.js'
import type { Script } from '@rezless/vitest'

const owner: Avatar = { key: OWNER, name: 'Owner Resident' }
const NAK = '\n\x15\n'
const sources = {
  ...LS1_SCRIPTS,
  'LShelper-script': LS1 + 'LShelper-script.luau',
  'LSsittarget-add': LS1 + 'LSsittarget-add.luau',
}

// ---------------------------------------------------------------------------
// LSroot-security
// ---------------------------------------------------------------------------
describe('LuaSitter1 LSroot-security, more', () => {
  async function secured() {
    const f = await buildFurniture({
      sources,
      scripts: ['LSroot-security'],
      childScripts: { 2: ['LSsit', 'LSsit 1'] },
      contentsLink: 2,
      prims: 3,
      notecards: { LSpos: `MTYPE 1\nSITTER 0\nPOSE Sit1|anim1\nBUTTON [SECURITY]|1\n{Sit1}<0,0,0.5><0,0,0>\nSITTER 1\nPOSE Sit1|anim1\n{Sit1}<1,0,0.5><0,0,0>` },
      animations: ['anim1'],
    })
    f.start()
    f.settle(5_000)
    return f
  }
  const sec = (f: Furniture) => f.script('LSroot-security')
  const ims = (f: Furniture) => sec(f).callsOf('llInstantMessage').map((c) => [String(c.args[0]), String(c.args[1])])
  const unsat = (f: Furniture) => sec(f).callsOf('llUnSit').map((c) => String(c.args[0]))
  const menusFor = (f: Furniture, av: Avatar) => f.linked().filter((m) => m.num === 90005 && m.id === av.key).length

  async function setTo(f: Furniture, times: number) {
    f.sit(owner, 2)
    for (let i = 0; i < times; i++) {
      f.touch(owner, 1)
      f.click(owner, '[SECURITY]')
    }
  }

  it('[SECURITY] cycles ALL > OWNER ONLY > GROUP ONLY > ALL, announced with link message 0', async () => {
    const f = await secured()
    await setTo(f, 3)
    expect(f.linked().filter((m) => m.num === 0).map((m) => m.str)).toEqual(['OWNER ONLY', 'GROUP ONLY', 'ALL'])
    expect(ims(f).map((m) => m[1])).toEqual(['Security set to: OWNER ONLY', 'Security set to: GROUP ONLY', 'Security set to: ALL'])
    // back to ALL: anyone may use the menu
    const alice = f.avatar('Alice')
    f.touch(alice, 1)
    expect(menusFor(f, alice)).toBe(1)
  })

  it('OWNER ONLY: a touch from someone else is refused with a message, no menu', async () => {
    const f = await secured()
    await setTo(f, 1)
    const alice = f.avatar('Alice')
    f.touch(alice, 1)
    expect(ims(f)).toContainEqual([alice.key, 'Sorry, the owner of this object has set the menu to: OWNER ONLY'])
    expect(menusFor(f, alice)).toBe(0)
    f.touch(owner, 1)
    expect(menusFor(f, owner)).toBeGreaterThan(0)
  })

  it('GROUP ONLY: group members may touch and sit, others are refused and unseated', async () => {
    const f = await secured()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    sec(f).mock('llSameGroup', (_ctx, args) => (String(args[0]).toLowerCase() === alice.key ? 1 : 0))
    await setTo(f, 2)
    f.touch(alice, 1)
    expect(menusFor(f, alice)).toBe(1)
    f.touch(bob, 1)
    expect(menusFor(f, bob)).toBe(0)
    expect(ims(f)).toContainEqual([bob.key, 'Sorry, the owner of this object has set the menu to: GROUP ONLY'])
    f.stand(owner)
    f.sit(alice)
    f.sit(bob)
    f.settle(6_000)
    expect(unsat(f)).toEqual([bob.key])
  })

  it('an inventory change does not check the sitters again', async () => {
    const f = await secured()
    const alice = f.avatar('Alice')
    f.sit(owner, 2)
    f.sit(alice)
    f.touch(owner, 1)
    f.click(owner, '[SECURITY]') // OWNER ONLY: Alice is already seated, nothing happens yet
    sec(f).fire('changed', { changes: 0x1 }) // CHANGED_INVENTORY
    f.settle(5_000)
    expect(unsat(f)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// LSsittarget-add
// ---------------------------------------------------------------------------
const CARD3 = `SITTER 0
POSE Sit1|anim1
{Sit1}<0,0,0.5><0,0,0>
SITTER 1
POSE Sit1|anim1
{Sit1}<1,0,0.5><0,0,0>
SITTER 2
POSE Sit1|anim1
{Sit1}<2,0,0.7><0,0,90>`

describe('LuaSitter1 LSsittarget-add, more', () => {
  it('with two extra prims, the first takes sitter 1\'s sit target and the second sitter 2\'s', async () => {
    const f = await buildFurniture({
      sources,
      scripts: ['LSsit', 'LSsit 1', 'LSsit 2'],
      childScripts: { 3: ['LSsittarget-add'], 4: ['LSsittarget-add 1'] },
      prims: 4,
      notecards: { LSpos: CARD3 },
      animations: ['anim1'],
    })
    f.start()
    f.settle(5_000)
    // rezless starts the scripts one after the other, so the prim 4 script missed the
    // announcement of prim 3 (in Second Life they start together): announce it again.
    // Prim 3 heard prim 4's: a repeated announcement does not register it twice.
    f.script('LSsittarget-add 1').fire('link_message', { sender_num: 3, num: 90190, str: 'starget', id: '' })
    f.script('LSsittarget-add').fire('link_message', { sender_num: 4, num: 90190, str: 'starget', id: '' })
    f.setNotecard('LSpos', CARD3)
    f.settle(5_000)
    const t3 = f.prims[2]!.params.sitTarget
    const t4 = f.prims[3]!.params.sitTarget
    expect(t3.offset.x).toBeCloseTo(1, 3)
    expect(t3.offset.z).toBeCloseTo(0.1, 3)
    expect(t4.offset.x).toBeCloseTo(2, 3)
    expect(t4.offset.z).toBeCloseTo(0.3, 3) // 0.7 - 0.4
    expect(t4.rotation.z).toBeCloseTo(Math.SQRT1_2, 4) // 90° about z
    expect(t4.rotation.s).toBeCloseTo(Math.SQRT1_2, 4)
  })

  it('in the root prim (sit scripts in a child prim), it takes sitter 1\'s sit target', async () => {
    const f = await buildFurniture({
      sources,
      scripts: ['LSsittarget-add'],
      childScripts: { 2: ['LSsit', 'LSsit 1'] },
      contentsLink: 2,
      prims: 2,
      notecards: { LSpos: CARD3.split('SITTER 2')[0]! },
      animations: ['anim1'],
    })
    f.start()
    f.settle(5_000)
    f.setNotecard('LSpos', CARD3.split('SITTER 2')[0]!)
    f.settle(5_000)
    const t = f.prims[0]!.params.sitTarget
    expect(t.enabled).toBe(true)
    expect(t.offset.x).toBeCloseTo(1, 3)
    expect(t.offset.z).toBeCloseTo(0.1, 3)
  })

  it('ignores 90180 from its own prim and for other sitters; an unreadable pose gives the default target', async () => {
    const f = await buildFurniture({
      sources,
      scripts: ['LSsit', 'LSsit 1'],
      childScripts: { 2: ['LSsittarget-add'] },
      prims: 2,
      notecards: { LSpos: CARD3.split('SITTER 2')[0]! },
      animations: ['anim1'],
    })
    f.start()
    f.settle(5_000)
    const s = f.script('LSsittarget-add')
    const targets = () => s.callsOf('llSitTarget').length
    const before = targets()
    s.fire('link_message', { sender_num: 2, num: 90180, str: '1', id: '<5,0,0>|<0,0,0>' }) // own prim
    s.fire('link_message', { sender_num: 1, num: 90180, str: '2', id: '<5,0,0>|<0,0,0>' }) // sitter 2: not this prim's
    f.settle()
    expect(targets()).toBe(before)
    // an unreadable position counts as ZERO_VECTOR, as an LSL (vector) cast
    s.fire('link_message', { sender_num: 1, num: 90180, str: '1', id: 'junk' })
    f.settle()
    expect(targets()).toBe(before + 1)
    const off = f.prims[1]!.params.sitTarget.offset
    expect([off.x, off.y].map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0])
    expect(off.z).toBeCloseTo(-0.4, 3)
  })
})

// ---------------------------------------------------------------------------
// LShelper-script
// ---------------------------------------------------------------------------
const HCARD = `SITTER 0
POSE Sit1|anim1
{Sit1}<0,0,0.5><0,0,0>`

describe('LuaSitter1 LShelper-script, more', () => {
  async function oneHelper() {
    const f = await buildFurniture({
      sources,
      scripts: ['LSsit', 'LSadjuster'],
      notecards: { LSpos: HCARD },
      animations: ['anim1'],
      objects: { LShelper: ['LShelper-script'] },
    })
    f.start()
    f.settle(5_000)
    f.sit(owner)
    f.touch(owner)
    f.click(owner, '[ADJUST]')
    f.click(owner, '[HELPER]')
    f.settle(3_000)
    return f
  }
  const helperObject = (f: Furniture) => f.rezzed().find((l) => l.prims[0]!.name.startsWith('LShelper'))!
  const helper = (f: Furniture): Script => helperObject(f).allScripts()[0]!
  const channelOf = (s: Script) => s.listens.find((l) => l.active)!.channel
  function tell(f: Furniture, s: Script, message: string) {
    s.deliverChat({ channel: channelOf(s), name: 'Furniture', key: f.prims[0]!.key, message })
    f.settle()
  }
  const hoverTexts = (s: Script) => s.callsOf('llSetLinkPrimitiveParamsFast')
    .filter((c) => (c.args[1] as unknown[])[0] === 26) // PRIM_TEXT
    .map((c) => ({ link: c.args[0] as number, text: (c.args[1] as unknown[])[1] as string }))

  it('a helper of several prims shows its hover text on link 2, raised; with an avatar on it, on itself', async () => {
    const f = await oneHelper()
    const s = helper(f)
    const alice = f.avatar('Alice')
    // a two-prim helper: link 2 is a prim
    s.mock('llGetNumberOfPrims', () => 2)
    tell(f, s, 'POS|0|<128, 128, 26>|<0, 0, 0, 1>')
    expect(hoverTexts(s).at(-1)).toEqual({ link: 2, text: 'SITTER 0\n▽\n \n \n \n \n \n \n \n \n ' })
    // a one-prim helper with an avatar sitting on it: link 2 is the avatar
    s.mock('llGetLinkKey', (_ctx, args) => (args[0] === 2 ? alice.key : f.prims[0]!.key))
    tell(f, s, 'POS|0|<128, 128, 26.5>|<0, 0, 0, 1>')
    expect(hoverTexts(s).at(-1)).toEqual({ link: 0, text: 'SITTER 0\n▽' })
  })

  it('POS repeats the move in 10 m steps when one move does not reach the place', async () => {
    const f = await oneHelper()
    const s = helper(f)
    // in Second Life a prim moves at most 10 m per PRIM_POSITION: pretend it stayed put
    s.mock('llGetPos', () => ({ x: 128, y: 128, z: 25.5 }))
    tell(f, s, 'POS|0|<128, 153, 25.5>|<0, 0, 0, 1>')
    const rules = s.callsOf('llSetLinkPrimitiveParamsFast').map((c) => c.args[1] as unknown[]).at(-2)!
    // 25 m: three PRIM_POSITION (6) rules
    expect(rules.filter((r) => r === 6)).toHaveLength(3)
    expect(rules).toHaveLength(6)
  })

  it('reads numbers and vectors as LSL casts: hex sitter numbers, unreadable POS values', async () => {
    const f = await oneHelper()
    const s = helper(f)
    tell(f, s, 'POS|0|junk|junk')
    const rules = s.callsOf('llSetLinkPrimitiveParamsFast').map((c) => c.args[1] as unknown[])
      .filter((r) => r[0] === 6 && r[2] === 8).at(-1)! // PRIM_POSITION, ..., PRIM_ROTATION
    expect(rules[1]).toEqual({ x: 0, y: 0, z: 0 }) // ZERO_VECTOR
    expect(rules[3]).toEqual({ x: 0, y: 0, z: 0, s: 1 }) // ZERO_ROTATION
    tell(f, s, 'DONE|0x1') // sitter 1: not this helper
    expect(s.dead).toBe(false)
    tell(f, s, 'DONE|0x0')
    expect(s.dead).toBe(true)
  })

  it('a touch from someone else while an avatar sits on it is ignored; a refused permission stops nothing', async () => {
    const f = await oneHelper()
    const s = helper(f)
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    const wa = f.world.avatars.find((a) => a.key === alice.key)!
    if (!f.world.sitAvatar(wa, helperObject(f).prims[0]!)) throw new Error('rezless refused the sit')
    f.settle(2_000)
    const said = s.chat.length
    helperObject(f).touch(1, { avatar: { key: bob.key, name: bob.name } })
    f.settle()
    expect(s.chat.slice(said)).toEqual([])
    helperObject(f).touch(1, { avatar: { key: alice.key, name: alice.name } })
    f.settle()
    expect(s.chat.slice(said).map((c) => c.text)).toEqual([`MENU|0|${alice.key}`])
    s.fire('run_time_permissions', { perm: 0 })
    f.settle()
    expect(s.callsOf('llStopAnimation')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// LSselect
// ---------------------------------------------------------------------------
const SCARD = `SITTER 0|Left
POSE Sit1|anim1
{Sit1}<0,0.5,0.5><0,0,0>
SITTER 1
POSE Sit2|anim1
{Sit2}<0,-0.5,0.5><0,0,0>`

describe('LuaSitter1 LSselect, more', () => {
  async function sofa(notecards: Record<string, string> | null, opts: { nak?: boolean; seats?: number } = {}) {
    const n = opts.seats ?? 2
    const f = await buildFurniture({
      sources: LS1_SCRIPTS,
      scripts: ['LSselect'],
      placeholders: ['LSsit', ...Array.from({ length: n - 1 }, (_, i) => `LSsit ${i + 1}`)],
      notecards: notecards ?? {},
      animations: ['anim1'],
    })
    if (opts.nak) f.script('LSselect').mock('llGetNotecardLineSync', () => NAK)
    f.start()
    f.settle(3_000)
    return f
  }
  const sel = (f: Furniture) => f.script('LSselect')
  /** Seat avatars by link message, as LSsit does (90070). */
  function seat(f: Furniture, ...avs: Avatar[]) {
    avs.forEach((av, i) => f.sendLinked('LSselect', 90070, String(i), av.key))
  }
  function seatMenu(f: Furniture, av: Avatar) {
    f.sendLinked('LSselect', 99899, '', av.key)
    const d = f.lastDialog(av)
    expect(d.script).toBe('LSselect')
    return d.buttons
  }

  it('reads the notecard with the dataserver when the sync reader answers NAK', async () => {
    const f = await sofa({ LSpos: SCARD }, { nak: true })
    expect(f.printed('LSselect')).toContain('LSselect:Ready')
    // an answer to another query is ignored
    sel(f).fire('dataserver', { queryid: '00000000-0000-0000-0000-00000000beef', data: 'SITTER 1|Bogus' })
    f.settle()
    const alice = f.avatar('Alice')
    seat(f, alice)
    expect(seatMenu(f, alice)).toEqual(['Left', 'Sit2'])
  })

  it('reads DUMP lines (◆) and casts numbers like LSL, hex included', async () => {
    const f = await sofa({ LSpos: '◆SELECT 0x1\n◆SITTER 0|Left\n◆SITTER 1|Right' })
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    seat(f, alice, bob)
    // SELECT 1: Alice's seat keeps its name for Bob
    expect(seatMenu(f, bob)).toEqual(['Left', 'Right'])
  })

  it('a seat name already used, or a SITTER number without a sit script, is ignored', async () => {
    const card = `SITTER 0|Seat
POSE Sit1|anim1
SITTER 1|Seat
POSE Seat|anim1
POSE Second|anim1
SITTER 5|Far
POSE Far|anim1`
    const f = await sofa({ LSpos: card })
    const alice = f.avatar('Alice')
    seat(f, alice)
    // sitter 1: the name "Seat" is taken, and so is its first pose's, so its second pose
    // names it; SITTER 5 has no LSsit 5
    expect(seatMenu(f, alice)).toEqual(['Seat', 'Second'])
  })

  it('without a notecard the seats are called "SITTER N"', async () => {
    const f = await sofa(null)
    expect(f.printed('LSselect')).toEqual(['LSselect:Reading LSpos'])
    const alice = f.avatar('Alice')
    seat(f, alice)
    expect(seatMenu(f, alice)).toEqual(['SITTER 0', 'SITTER 1'])
  })

  it('90075 frees a seat; 90045 / 90065 for an avatar not seated change nothing', async () => {
    const f = await sofa({ LSpos: SCARD })
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    seat(f, alice, bob)
    f.sendLinked('LSselect', 90045, 'S:Hug|x', f.avatar('Carol').key)
    f.sendLinked('LSselect', 90065, '', f.avatar('Carol').key)
    expect(seatMenu(f, bob)).toEqual(['⊘Alice ', 'Sit2'])
    f.sendLinked('LSselect', 90075, '0', '')
    expect(seatMenu(f, bob)).toEqual(['Left', 'Sit2'])
  })

  it('the blank filler button of a paged seat menu shows the same page again', async () => {
    const lines: string[] = []
    for (let i = 0; i < 13; i++) lines.push(`SITTER ${i}|Seat${i}`, 'POSE Sit|anim1')
    const f = await sofa({ LSpos: lines.join('\n') }, { seats: 13 })
    const me = f.avatar('Me')
    seat(f, me)
    seatMenu(f, me)
    f.click(me, '[>>]') // page 2: Seat10..Seat12 and fillers
    const page = f.lastDialog(me).buttons
    expect(page).toContain(' ')
    expect(page).toContain('Seat12')
    f.click(me, ' ')
    expect(f.lastDialog(me).buttons).toEqual(page)
    expect(f.linked().filter((m) => m.num === 90030)).toHaveLength(0)
  })

  it('an inventory change that is not the notecard does not reload; a link change keeps the menu open while someone sits', async () => {
    const f = await sofa({ LSpos: SCARD })
    f.setItem('anim2', 'animation')
    expect(f.printed('LSselect').filter((l) => l === 'LSselect:Reading LSpos')).toHaveLength(1)
    const alice = f.avatar('Alice')
    seat(f, alice)
    seatMenu(f, alice)
    const listen = () => sel(f).listens.find((l) => l.channel === f.lastDialog(alice).channel)!
    expect(listen().active).toBe(true)
    // the last link is an avatar: the listen stays open
    sel(f).mock('llGetAgentSize', () => ({ x: 0.5, y: 0.5, z: 1.8 }))
    sel(f).fire('changed', { changes: 0x20 }) // CHANGED_LINK
    f.settle()
    expect(listen().active).toBe(true)
    sel(f).mock('llGetAgentSize', () => ({ x: 0, y: 0, z: 0 }))
    sel(f).fire('changed', { changes: 0x20 })
    f.settle()
    expect(listen().active).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// LSsit
// ---------------------------------------------------------------------------
describe('LuaSitter1 LSsit, more', () => {
  const CARD = `SITTER 0
POSE A|anim1
POSE B|anim2
POSE C|anim3
{A}<0,0,0.5><0,0,0>
{B}<0,0,0.5><0,0,0>
{C}<0,0,0.5><0,0,0>`

  async function chair(card: string, opts: { scripts?: string[]; prims?: number; memory?: number } = {}) {
    const f = await buildFurniture({
      sources: LS1_SCRIPTS,
      scripts: opts.scripts ?? ['LSsit'],
      prims: opts.prims ?? 1,
      notecards: { LSpos: card },
      animations: ['anim1', 'anim2', 'anim3'],
    })
    if (opts.memory !== undefined) f.script('LSsit').mock('llGetFreeMemory', () => opts.memory!)
    f.start()
    f.settle(5_000)
    return f
  }
  const stopped = (f: Furniture, script = 'LSsit') => f.script(script).callsOf('llStopAnimation').map((c) => String(c.args[0]))
  const placedZ = (f: Furniture) => {
    const rules = f.script('LSsit').callsOf('llSetLinkPrimitiveParamsFast').at(-1)!.args[1] as unknown[]
    return Math.round((rules[3] as { z: number }).z * 1000) / 1000
  }

  it('a third pose within 0.5 s stops the first one at once', async () => {
    const f = await chair(CARD)
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.playing(alice)).toEqual(['anim1'])
    const s = f.script('LSsit')
    s.fire('link_message', { sender_num: 0, num: 90000, str: 'B', id: '' })
    f.advance(100)
    expect(stopped(f)).not.toContain('anim1')
    s.fire('link_message', { sender_num: 0, num: 90000, str: 'C', id: '' })
    f.advance(100)
    expect(stopped(f)).toContain('anim1') // A stopped with no wait
    f.settle(1_000)
    expect(f.playing(alice)).toEqual(['anim3'])
  })

  it('going back to a pose within 0.5 s keeps its animation playing', async () => {
    const f = await chair(CARD)
    const alice = f.avatar('Alice')
    f.sit(alice)
    const s = f.script('LSsit')
    s.fire('link_message', { sender_num: 0, num: 90000, str: 'B', id: '' })
    f.advance(100)
    s.fire('link_message', { sender_num: 0, num: 90000, str: 'A', id: '' })
    f.settle(1_000)
    expect(f.playing(alice)).toEqual(['anim1'])
    expect(stopped(f)).not.toContain('anim1')
  })

  it('MTYPE 2 with two LOOP marks: a section ending at a LOOP mark goes back to its start', async () => {
    const f = await chair(`MTYPE 2
SITTER 0
POSE A|anim1
LOOP
POSE B|anim2
POSE C|anim3
LOOP
POSE D|anim1
{A}<0,0,0.5><0,0,0>
{B}<0,0,0.5><0,0,0>
{C}<0,0,0.5><0,0,0>
{D}<0,0,0.5><0,0,0>`)
    const alice = f.avatar('Alice')
    f.sit(alice)
    const pose = () => f.linked().filter((m) => m.num === 90045).at(-1)!.str.split('|')[0]
    f.sendLinked('LSsit', 90000, 'B', '')
    f.touch(alice)
    expect(pose()).toBe('C')
    f.touch(alice) // the second LOOP mark: back to the first pose after the first one
    expect(pose()).toBe('B')
  })

  it('[PAGE-] from the first page goes to the last, also when the last page is full', async () => {
    const poses = Array.from({ length: 18 }, (_, i) => `P${i + 1}`)
    const card = 'SITTER 0\n' + poses.map((p) => `POSE ${p}|anim1`).join('\n')
    const f = await chair(card)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    expect(f.lastDialog(alice).buttons).toContain('P9') // 9 per page: 2 full pages
    f.click(alice, '[PAGE-]')
    const last = f.lastDialog(alice).buttons
    expect(last).toEqual(expect.arrayContaining(['P10', 'P18']))
    expect(last).not.toContain('P9')
  })

  it('a first pose at x = 0.35 m moves the sit target 1 mm (a sit target at x 0.35 is ignored in-world)', async () => {
    const f = await chair('SITTER 0\nPOSE A|anim1\n{A}<0.35,0,0.5><0,0,0>')
    const off = f.prims[0]!.params.sitTarget.offset
    expect(off.x).toBeCloseTo(0.351, 4)
    expect(off.z).toBeCloseTo(0.15, 4)
  })

  it('alone in a SYNC pose, [SWAP] moves to the next seat', async () => {
    const card = 'SITTER 0\nPOSE A|anim1\nSYNC Hug|anim2\nSITTER 1\nPOSE A|anim1\nSYNC Hug|anim3'
    const f = await chair(card, { scripts: ['LSsit', 'LSsit 1'], prims: 2 })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    f.click(alice, 'Hug')
    f.touch(alice)
    f.click(alice, '[SWAP]')
    expect(f.linked()).toContainEqual({ num: 90030, str: '0', id: '1' })
  })

  it('three seats: [SWAP] in a SYNC goes to the next sitter, skipping empty seats; from a POSE to the next free seat', async () => {
    const card = [0, 1, 2].map((i) => `SITTER ${i}\nPOSE A|anim1\nSYNC Hug|anim2`).join('\n')
    const f = await chair(card, { scripts: ['LSsit', 'LSsit 1', 'LSsit 2'], prims: 3 })
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    const carol = f.avatar('Carol')
    f.sit(alice)
    f.sit(bob)
    // from a POSE: seat 1 is taken, seat 2 is free
    f.touch(alice)
    f.click(alice, '[SWAP]')
    expect(f.linked()).toContainEqual({ num: 90030, str: '0', id: '2' })
    f.settle(2_000)
    // now Alice is in seat 2 and Bob in seat 1; Carol takes seat 0, Bob leaves
    f.sit(carol)
    f.stand(bob)
    f.settle(2_000)
    f.touch(carol)
    f.click(carol, 'Hug')
    f.touch(carol)
    const swaps = f.linked().filter((m) => m.num === 90030).length
    f.click(carol, '[SWAP]')
    // seat 1 is empty: the swap partner is Alice in seat 2
    expect(f.linked().filter((m) => m.num === 90030).slice(swaps)).toEqual([{ num: 90030, str: '0', id: '2' }])
  })

  it('89999 hands the menu of a sitter to another avatar, whose choices pose the sitter', async () => {
    const f = await chair(CARD)
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.broadcast(89999, bob.key, alice.key)
    const d = f.lastDialog(bob)
    expect(d.script).toBe('LSsit')
    expect(d.buttons).toEqual(expect.arrayContaining(['A', 'B', 'C']))
    f.click(bob, 'B')
    f.settle(1_000)
    expect(f.playing(alice)).toEqual(['anim2'])
  })

  it('a pose added with 90170 goes before the submenus, into the menu shown, and plays', async () => {
    const f = await chair(`SITTER 0
POSE A|anim1
TOMENU More
MENU More
POSE B|anim2
{A}<0,0,0.5><0,0,0>
{B}<0,0,0.5><0,0,0>`)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.sendLinked('LSsit', 90170, '0', 'New|anim3')
    f.settle(1_000)
    expect(f.playing(alice)).toEqual(['anim3'])
    f.touch(alice)
    expect(f.lastDialog(alice).buttons).toEqual(expect.arrayContaining(['A', 'More*', 'New']))
    f.click(alice, 'More*')
    expect(f.lastDialog(alice).buttons).not.toContain('New')
  })

  it('remembers at most 10 personal adjustments when memory is low: the oldest is forgotten', async () => {
    const poses = Array.from({ length: 11 }, (_, i) => `P${i + 1}`)
    const card = 'SITTER 0\n' + poses.map((p) => `POSE ${p}|anim1`).join('\n') + '\n' + poses.map((p) => `{${p}}<0,0,0.5><0,0,0>`).join('\n')
    const f = await chair(card, { memory: 0 })
    const alice = f.avatar('Alice')
    f.sit(alice)
    for (const p of poses) {
      f.touch(alice)
      f.click(alice, p)
      f.click(alice, '[ADJUST]')
      f.click(alice, 'Z+')
      f.click(alice, '[SAVE]')
    }
    f.touch(alice)
    f.click(alice, 'P2')
    expect(placedZ(f)).toBe(0.55) // kept
    f.click(alice, 'P1')
    expect(placedZ(f)).toBe(0.5) // the oldest, forgotten
  })
})

describe('LuaSitter1 LSsit with LSselect, more', () => {
  it('in a seat with one pose, [BACK] in the adjust menu returns to the seat menu', async () => {
    const f = await buildFurniture({
      sources: LS1_SCRIPTS,
      scripts: ['LSsit', 'LSsit 1', 'LSselect'],
      prims: 2,
      notecards: { LSpos: 'SITTER 0|Left\nPOSE A|anim1\nSITTER 1|Right\nPOSE A|anim1' },
      animations: ['anim1'],
    })
    f.start()
    f.settle(5_000)
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.lastDialog(alice).script).toBe('LSselect')
    f.click(alice, '[ADJUST]')
    expect(f.lastDialog(alice).message).toBe('\nPersonal Adjust:')
    f.click(alice, '[BACK]')
    expect(f.lastDialog(alice).script).toBe('LSselect')
    expect(f.lastDialog(alice).buttons).toEqual(expect.arrayContaining(['Left', 'Right']))
  })
})

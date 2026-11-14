// LuaSitter2: [LS]chains (LockGuard V2 and LockMeister chains set up by the
// "[LS]chains_settings" notecard, for every sitter, with on/off link messages).
// Covers both protocols, the CHAIN lookup order, several sitters, on/off/toggle
// (90240/90241/90242 and TOGGLE numbers), stand / swap / seat change, PROPS with
// [LS]LockGuard-object, reloading, the NAK reader, the notecard report and no notecard.
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { buildFurniture, LS2_SCRIPTS, LS2, notecardFile } from '../helpers/furniture.js'
import type { Furniture, Avatar } from '../helpers/furniture.js'

const LG = -9119
const LM = -8888
const COMM = -57841689
const NAK = '\n\x15\n'
const CARD_NAME = '[LS]chains_settings'
const LG_OBJECT_FILE = path.normalize(LS2 + 'Plugins/LScontrol/LockGuard/[LS]LockGuard-object.luau')
const EXAMPLE = notecardFile(LS2 + 'Plugins/LScontrol/Chains/[LS]chains_settings.notecard')
const LG_DEFAULT = 'size 0.12 0.12 life 1 gravity 0.3 texture d7277e78-06f4-58ae-9f7c-7499e50de18a'

const POSITIONS = `SITTER 0
POSE arms|anim1
POSE cross|anim2
POSE free|anim3
{arms}<0,0,0.5><0,0,0>
{cross}<0,0,0.5><0,0,0>
{free}<0,0,0.5><0,0,0>`

/** Prims: 1 Furniture, 2 ring1, 3 ring2, 4 ring10, 5 "post ring4 left". */
const PRIMS = { 2: 'ring1', 3: 'ring2', 4: 'ring10', 5: 'post ring4 left' }

interface Opts {
  nak?: boolean
  placeholders?: string[]
  plugins?: boolean
  lspos?: string
  props?: Record<string, string[]>
  primNames?: Record<number, string>
}

/** [LS]sit + [LS]chains (with the settings card, or none when `card` is null). */
async function build(card: string | null, opts: Opts = {}) {
  const notecards: Record<string, string> = { LSpos: opts.lspos ?? POSITIONS }
  if (card !== null) notecards[CARD_NAME] = card
  const f = await buildFurniture({
    sources: { ...LS2_SCRIPTS, '[LS]LockGuard-object': LG_OBJECT_FILE },
    scripts: ['[LS]sit', ...(opts.plugins ? ['[LS]plugins'] : []), '[LS]chains'],
    prims: 5,
    primNames: opts.primNames ?? PRIMS,
    notecards,
    animations: ['anim1', 'anim2', 'anim3'],
    placeholders: opts.placeholders,
    objects: opts.props,
  })
  if (opts.nak) f.script('[LS]chains').mock('llGetNotecardLineSync', () => NAK)
  f.start()
  return f
}

const chains = (f: Furniture) => f.script('[LS]chains')
const said = (f: Furniture, channel = LG) => chains(f).chat.filter((c) => c.channel === channel).map((c) => c.text)
const printed = (f: Furniture) => f.printed('[LS]chains')
const key = (f: Furniture, link: number) => f.prims[link - 1]!.key

/** What was said after `from` chat lines on the LockGuard channel. */
function since(f: Furniture, from: number, channel = LG) {
  return said(f, channel).slice(from)
}

/** [LS]sit tells the plugins a pose is played (90045) for a sitter number. */
function pose(f: Furniture, sc: number, name: string, av: Avatar) {
  f.sendLinked('[LS]chains', 90045, `${sc}|${name}|anim1|0|${av.key}||0`, av.key)
}
function standUp(f: Furniture, sc: number, av: Avatar) {
  f.sendLinked('[LS]chains', 90065, String(sc), av.key)
}
/** A link message from a script in another prim (menus, plugins). */
function fromPrim(f: Furniture, link: number, num: number, str: string, id: string) {
  chains(f).fire('link_message', { sender_num: link, num, str, id })
  f.settle()
}

const link = (av: Avatar, cuff: string, ringKey: string, params = LG_DEFAULT) =>
  `lockguard ${av.key} ${cuff} link ${ringKey}${params ? ' ' + params : ''}`
const unlink = (av: Avatar, cuff: string) => `lockguard ${av.key} ${cuff} unlink`

/** Particle systems set: [link, target key or "" when cleared]. */
function particles(f: Furniture): [number, string][] {
  return chains(f).callsOf('llLinkParticleSystem').map((c) => {
    const rules = c.args[1] as unknown[]
    for (let i = 0; i < rules.length; i += 2) if (rules[i] === 20) return [c.args[0] as number, String(rules[i + 1])]
    return [c.args[0] as number, '']
  })
}
function rulesOf(f: Furniture, n: number): unknown[] {
  return chains(f).callsOf('llLinkParticleSystem')[n]!.args[1] as unknown[]
}
function rule(rules: unknown[], code: number): unknown {
  for (let i = 0; i < rules.length; i += 2) if (rules[i] === code) return rules[i + 1]
  return undefined
}
const lmListening = (f: Furniture) => chains(f).listens.some((l) => l.channel === LM && l.active)

describe('LuaSitter2 [LS]chains without a notecard', () => {
  it('tells the owner once and chains nothing', async () => {
    const f = await build(null)
    expect(printed(f)).toEqual([expect.stringContaining('no "[LS]chains_settings" notecard')])
    const alice = f.avatar('Alice')
    f.sit(alice)
    pose(f, 0, 'arms', alice)
    expect(said(f)).toEqual([])
    f.setItem('anim4', 'animation') // another inventory change: no second hint
    expect(printed(f)).toHaveLength(1)
  })
})

describe('LuaSitter2 [LS]chains LockGuard', () => {
  const CARD = `STYLE lockguard|size 0.08 0.08 life 0.6 gravity 0.6
CHAIN arms|*|rightwrist,ring1,leftwrist,ring2
CHAIN cross|*|rightwrist,ring1,leftankle,ring4`

  it('links the cuffs of the pose with the STYLE parameters, and unlinks them on stand', async () => {
    const f = await build(CARD)
    const alice = f.avatar('Alice')
    f.sit(alice) // first pose: arms
    const p = 'size 0.08 0.08 life 0.6 gravity 0.6'
    expect(said(f)).toEqual([link(alice, 'rightwrist', key(f, 2), p), link(alice, 'leftwrist', key(f, 3), p)])
    expect(printed(f)).toEqual([]) // nothing wrong in the notecard
    const before = said(f).length
    f.stand(alice)
    expect(since(f, before).sort()).toEqual([unlink(alice, 'leftwrist'), unlink(alice, 'rightwrist')])
  })

  it('changing pose unlinks only the cuffs the new pose does not use; a pose without chains unlinks all', async () => {
    const f = await build(CARD)
    const alice = f.avatar('Alice')
    f.sit(alice)
    let before = said(f).length
    f.click(alice, 'cross') // ring4: the prim "post ring4 left" (the name contains it)
    expect(since(f, before)).toEqual([
      unlink(alice, 'leftwrist'),
      link(alice, 'rightwrist', key(f, 2), 'size 0.08 0.08 life 0.6 gravity 0.6'),
      link(alice, 'leftankle', key(f, 5), 'size 0.08 0.08 life 0.6 gravity 0.6'),
    ])
    before = said(f).length
    f.click(alice, 'free')
    expect(since(f, before).sort()).toEqual([unlink(alice, 'leftankle'), unlink(alice, 'rightwrist')])
  })

  it('without STYLE uses the [LS]LockGuard default parameters; "STYLE lockguard" alone leaves the cuff defaults', async () => {
    const f = await build('CHAIN *|*|rightwrist,ring1')
    const alice = f.avatar('Alice')
    pose(f, 0, 'arms', alice)
    expect(said(f)).toEqual([link(alice, 'rightwrist', key(f, 2))])
    const g = await build('STYLE lockguard\nCHAIN *|*|rightwrist,ring1')
    const bob = g.avatar('Bob')
    pose(g, 0, 'arms', bob)
    expect(said(g)).toEqual([`lockguard ${bob.key} rightwrist link ${key(g, 2)}`])
  })

  it('a ring named exactly wins over a prim whose name only contains it; avatars are never rings', async () => {
    const f = await build('CHAIN *|*|a,ring1,b,Ringo')
    const ringo = f.avatar('Ringo')
    f.sit(ringo)
    const all = said(f).join('\n')
    expect(all).toContain(`a link ${key(f, 2)} `) // ring1, not ring10
    expect(all).not.toContain(`link ${ringo.key}`)
  })
})

describe('LuaSitter2 [LS]chains lookup and sitters', () => {
  const CARD = `CHAIN arms|1|a,ring1
CHAIN arms|*|b,ring1
CHAIN *|1|c,ring1
CHAIN *|*|d,ring1
CHAIN free|*|none
CHAIN cross|0|`

  it('pose|sitter, pose|*, *|sitter, *|*; "none" or an empty list means no chains', async () => {
    const f = await build(CARD)
    const [a, b] = [f.avatar('Alice'), f.avatar('Bob')]
    const cuff = (av: Avatar) => said(f).filter((t) => t.startsWith(`lockguard ${av.key} `) && t.includes(' link ')).at(-1)!.split(' ')[2]
    pose(f, 1, 'arms', b)
    expect(cuff(b)).toBe('a')
    pose(f, 0, 'arms', a)
    expect(cuff(a)).toBe('b')
    pose(f, 1, 'other', b)
    expect(cuff(b)).toBe('c')
    pose(f, 0, 'other', a)
    expect(cuff(a)).toBe('d')
    let before = said(f).length
    pose(f, 0, 'free', a)
    expect(since(f, before)).toEqual([unlink(a, 'd')])
    pose(f, 0, 'other', a)
    before = said(f).length
    pose(f, 0, 'cross', a)
    expect(since(f, before)).toEqual([unlink(a, 'd')])
  })

  it('each sitter has their own chains; a stand only unchains that sitter', async () => {
    const f = await build(CARD)
    const [a, b] = [f.avatar('Alice'), f.avatar('Bob')]
    pose(f, 0, 'other', a)
    pose(f, 1, 'other', b)
    const before = said(f).length
    standUp(f, 1, b)
    expect(since(f, before)).toEqual([unlink(b, 'c')])
    standUp(f, 0, b) // not Bob's seat: nothing
    expect(since(f, before)).toHaveLength(1)
  })

  it('a new avatar in a seat: the old one is unchained first', async () => {
    const f = await build(CARD)
    const [a, b] = [f.avatar('Alice'), f.avatar('Bob')]
    pose(f, 0, 'other', a)
    const before = said(f).length
    pose(f, 0, 'other', b)
    expect(since(f, before)).toEqual([unlink(a, 'd'), link(b, 'd', key(f, 2))])
  })

  it('an avatar moving to another seat (90045 for another sitter number) is unchained there', async () => {
    const f = await build(CARD)
    const a = f.avatar('Alice')
    pose(f, 0, 'other', a)
    const before = said(f).length
    pose(f, 1, 'other', a)
    expect(since(f, before)).toEqual([unlink(a, 'd'), link(a, 'c', key(f, 2))])
    // the old seat's 90065 comes late: the new seat keeps its chains
    standUp(f, 0, a)
    expect(since(f, before)).toHaveLength(2)
  })

  it('a swap (90030 or 90032) unchains both seats, and the next 90045 chains again', async () => {
    for (const num of [90030, 90032]) {
      const f = await build(CARD)
      const [a, b] = [f.avatar('Alice'), f.avatar('Bob')]
      pose(f, 0, 'other', a)
      pose(f, 1, 'other', b)
      const before = said(f).length
      f.sendLinked('[LS]chains', num, '0', '1')
      expect(since(f, before).sort()).toEqual([unlink(a, 'd'), unlink(b, 'c')])
      pose(f, 0, 'other', b)
      expect(said(f).at(-1)).toBe(link(b, 'd', key(f, 2)))
    }
  })

  it('ignores sitter messages from scripts in other prims', async () => {
    const f = await build(CARD)
    const a = f.avatar('Alice')
    fromPrim(f, 2, 90045, `0|other|anim1|0|${a.key}`, a.key)
    expect(said(f)).toEqual([])
    pose(f, 0, 'other', a)
    fromPrim(f, 2, 90065, '0', a.key)
    fromPrim(f, 2, 90030, '0', '1')
    expect(said(f)).toHaveLength(1)
    fromPrim(f, 1, 90045, `0|other|anim1|0|`, '') // not an avatar key
    expect(said(f)).toHaveLength(1)
  })

  it('clears everything when nobody sits any more (CHANGED_LINK)', async () => {
    const f = await build(CARD)
    const a = f.avatar('Alice')
    f.sit(a)
    chains(f).fire('changed', { changes: 0x20 }) // still sitting: nothing
    f.settle()
    const before = said(f).length
    f.seated.splice(0) // the avatar is no longer a link
    chains(f).fire('changed', { changes: 0x20 })
    f.settle()
    expect(since(f, before)).toEqual([unlink(a, 'b')])
  })
})

describe('LuaSitter2 [LS]chains on / off', () => {
  const CARD = `CHAIN arms|*|rightwrist,ring1
CHAIN cross|*|leftwrist,ring2
TOGGLE 98|99
TOGGLE ||97`

  async function two() {
    const f = await build(CARD)
    const [a, b] = [f.avatar('Alice'), f.avatar('Bob')]
    pose(f, 0, 'arms', a)
    pose(f, 1, 'arms', b)
    return { f, a, b }
  }

  it('90241 unchains the sitter named in id; 90240 chains their CURRENT pose at once', async () => {
    const { f, a, b } = await two()
    let before = said(f).length
    fromPrim(f, 3, 90241, 'Chains Off', a.key) // from a menu in another prim
    expect(since(f, before)).toEqual([unlink(a, 'rightwrist')])
    // while off the pose is still followed, but nothing is chained
    pose(f, 0, 'cross', a)
    expect(since(f, before)).toHaveLength(1)
    before = said(f).length
    f.sendLinked('[LS]chains', 90240, 'Chains On', a.key)
    expect(since(f, before)).toEqual([link(a, 'leftwrist', key(f, 3))])
    // on again: no repeat
    f.sendLinked('[LS]chains', 90240, '', a.key)
    expect(since(f, before)).toHaveLength(1)
    // Bob was never touched
    expect(said(f).filter((t) => t.startsWith(`lockguard ${b.key} `) && t.endsWith('unlink'))).toEqual([])
  })

  it('"controller|sitter" (BUTTON when someone else controls the menu) switches the sitter', async () => {
    const { f, a, b } = await two()
    const before = said(f).length
    f.sendLinked('[LS]chains', 90241, 'Chains Off', `${a.key}|${b.key}`)
    expect(since(f, before)).toEqual([unlink(b, 'rightwrist')])
  })

  it('an id that is no chained sitter switches every sitter; toggle switches off when any is on', async () => {
    const { f, a, b } = await two()
    let before = said(f).length
    f.sendLinked('[LS]chains', 90241, '', a.key) // Alice off
    f.sendLinked('[LS]chains', 90242, '', '') // Bob is on: everyone off
    expect(since(f, before)).toEqual([unlink(a, 'rightwrist'), unlink(b, 'rightwrist')])
    before = said(f).length
    f.sendLinked('[LS]chains', 90242, '', f.avatar('Carol').key) // all off: everyone on
    expect(since(f, before)).toEqual([link(a, 'rightwrist', key(f, 2)), link(b, 'rightwrist', key(f, 2))])
  })

  it('TOGGLE numbers (98 on, 99 off, 97 toggle) work like 90240 / 90241 / 90242, from any prim', async () => {
    const { f, a } = await two()
    let before = said(f).length
    fromPrim(f, 4, 99, '', a.key)
    expect(since(f, before)).toEqual([unlink(a, 'rightwrist')])
    fromPrim(f, 1, 98, '', a.key)
    expect(since(f, before)).toEqual([unlink(a, 'rightwrist'), link(a, 'rightwrist', key(f, 2))])
    before = said(f).length
    fromPrim(f, 2, 97, '', a.key)
    fromPrim(f, 2, 97, '', a.key)
    expect(since(f, before)).toEqual([unlink(a, 'rightwrist'), link(a, 'rightwrist', key(f, 2))])
  })

  it('off, a pose without chains, then on: nothing to chain; the next chained pose is chained', async () => {
    const { f, a } = await two()
    f.sendLinked('[LS]chains', 90241, '', a.key)
    pose(f, 0, 'free', a)
    const before = said(f).length
    f.sendLinked('[LS]chains', 90240, '', a.key)
    expect(since(f, before)).toEqual([])
    pose(f, 0, 'cross', a)
    expect(since(f, before)).toEqual([link(a, 'leftwrist', key(f, 3))])
  })

  it('off survives a seat change, and is reset when the avatar stands up', async () => {
    const { f, a } = await two()
    f.sendLinked('[LS]chains', 90241, '', a.key)
    const before = said(f).length
    pose(f, 2, 'arms', a) // moves to seat 2: still off
    expect(since(f, before)).toEqual([])
    standUp(f, 2, a)
    pose(f, 0, 'arms', a) // sits again: on
    expect(since(f, before)).toEqual([link(a, 'rightwrist', key(f, 2))])
  })

  it('without the TOGGLE line 98 does nothing', async () => {
    const f = await build('CHAIN arms|*|rightwrist,ring1')
    const a = f.avatar('Alice')
    pose(f, 0, 'arms', a)
    f.sendLinked('[LS]chains', 99, '', a.key)
    expect(said(f)).toHaveLength(1)
  })
})

describe('LuaSitter2 [LS]chains LockMeister', () => {
  const CARD = `STYLE lockmeister|size 0.2 0.3 life 2 gravity 0.5 color 1 0 0 texture abc
CHAIN arms|*|rcuff,ring1,lcuff,ring2
CHAIN cross|*|rcuff,ring1`

  it('asks the cuffs, draws from the ring prim with the STYLE settings on LMV1, then moves to the LMV2 point', async () => {
    const f = await build(CARD)
    const a = f.avatar('Alice')
    f.sit(a)
    expect(said(f, LM)).toEqual([`${a.key}rcuff`, `${a.key}lcuff`])
    expect(said(f, LG)).toEqual([])
    f.say(a, LM, `${a.key}rcuff ok`)
    expect(particles(f)).toEqual([[2, a.key]])
    const r = rulesOf(f, 0)
    const scale = rule(r, 5) as { x: number; y: number; z: number } // PSYS_PART_START_SCALE
    expect([scale.x, scale.y, scale.z].map((v) => Math.round(v * 1000) / 1000)).toEqual([0.2, 0.3, 0])
    expect(rule(r, 1)).toEqual({ x: 1, y: 0, z: 0 }) // PSYS_PART_START_COLOR
    expect(rule(r, 7)).toBe(2) // PSYS_PART_MAX_AGE
    expect(rule(r, 12)).toBe('abc') // PSYS_SRC_TEXTURE
    expect(rule(r, 8)).toEqual({ x: 0, y: 0, z: -0.5 }) // PSYS_SRC_ACCEL
    expect(said(f, LM).at(-1)).toBe(`${a.key}|LMV2|RequestPoint|rcuff`)
    const t1 = '00000000-0000-0000-0000-0000000c0ff1'
    f.say(a, LM, `${a.key}|LMV2|ReplyPoint|rcuff|${t1}`)
    expect(particles(f).at(-1)).toEqual([2, t1])
    expect(lmListening(f)).toBe(true) // lcuff has not answered
    f.say(a, LM, `${a.key}|LMV2|ReplyPoint|lcuff|00000000-0000-0000-0000-0000000c0ff2`)
    expect(lmListening(f)).toBe(false) // every cuff answered LMV2
  })

  it('ignores wrong answers: another avatar\'s cuff, another target, a cuff not asked, repeats, bad LMV2', async () => {
    const f = await build(CARD)
    const a = f.avatar('Alice')
    const b = f.avatar('Bob')
    pose(f, 0, 'arms', a)
    f.say(b, LM, `${a.key}rcuff ok`)
    f.say(a, LM, `${b.key}rcuff ok`)
    f.say(a, LM, `${a.key}nose ok`)
    f.say(a, LM, `${a.key}|LMV2|ReplyPoint|rcuff|not-a-key`)
    f.say(a, LM, `${a.key}|LMV1|ReplyPoint|rcuff|00000000-0000-0000-0000-0000000c0ff1`)
    f.say(a, LM, `${a.key}|LMV2|ReplyPoint|nose|00000000-0000-0000-0000-0000000c0ff1`)
    expect(particles(f)).toEqual([])
    f.say(a, LM, `${a.key}lcuff ok`)
    f.say(a, LM, `${a.key}lcuff ok`)
    expect(particles(f)).toEqual([[3, a.key]])
  })

  it('a new pose clears the chains and asks again; stand clears; off clears and on asks again', async () => {
    const f = await build(CARD)
    const a = f.avatar('Alice')
    pose(f, 0, 'arms', a)
    f.say(a, LM, `${a.key}rcuff ok`)
    pose(f, 0, 'cross', a)
    expect(particles(f).slice(1).sort()).toEqual([[2, ''], [3, '']])
    f.say(a, LM, `${a.key}rcuff ok`)
    let n = particles(f).length
    f.sendLinked('[LS]chains', 90241, '', a.key)
    expect(particles(f).slice(n)).toEqual([[2, '']])
    const asked = said(f, LM).length
    f.sendLinked('[LS]chains', 90240, '', a.key)
    expect(said(f, LM).slice(asked)).toEqual([`${a.key}rcuff`])
    f.say(a, LM, `${a.key}rcuff ok`)
    n = particles(f).length
    standUp(f, 0, a)
    expect(particles(f).slice(n)).toEqual([[2, '']])
    expect(lmListening(f)).toBe(false)
  })

  it('two sitters on the same ring prim: the last pose takes it, and the first sitter no longer clears it', async () => {
    const f = await build(CARD)
    const [a, b] = [f.avatar('Alice'), f.avatar('Bob')]
    pose(f, 0, 'arms', a)
    f.say(a, LM, `${a.key}rcuff ok`)
    f.say(a, LM, `${a.key}lcuff ok`)
    pose(f, 1, 'cross', b) // ring1 too
    expect(particles(f).slice(2)).toEqual([[2, '']]) // Alice's chain on ring1 is removed
    f.say(b, LM, `${b.key}rcuff ok`)
    expect(particles(f).at(-1)).toEqual([2, b.key])
    f.say(a, LM, `${a.key}|LMV2|ReplyPoint|rcuff|00000000-0000-0000-0000-0000000c0ff1`) // ring1 is Bob's now
    const n = particles(f).length
    standUp(f, 0, a)
    expect(particles(f).slice(n)).toEqual([[3, '']]) // only ring2
  })

  it('stops listening 10 s after the last answer', async () => {
    const f = await build(CARD)
    const a = f.avatar('Alice')
    pose(f, 0, 'arms', a)
    f.settle(6_000)
    f.say(a, LM, `${a.key}rcuff ok`)
    f.settle(7_000)
    expect(lmListening(f)).toBe(true)
    f.settle(4_000)
    expect(lmListening(f)).toBe(false)
  })

  it('a LockMeister pose with "none" clears the chains and does not ask', async () => {
    const f = await build(`${CARD}
CHAIN free|*|none|lockmeister`)
    const a = f.avatar('Alice')
    pose(f, 0, 'cross', a)
    f.say(a, LM, `${a.key}rcuff ok`)
    pose(f, 0, 'free', a)
    expect(particles(f)).toEqual([[2, a.key], [2, '']])
    expect(said(f, LM)).toHaveLength(2) // rcuff, and its LMV2 request
    expect(lmListening(f)).toBe(false)
  })

  it('a pose whose rings are all missing does not listen', async () => {
    const f = await build('STYLE lockmeister\nCHAIN *|*|rcuff,nowhere')
    const a = f.avatar('Alice')
    pose(f, 0, 'arms', a)
    expect(said(f, LM)).toEqual([])
    expect(lmListening(f)).toBe(false)
  })

  it('the 4th CHAIN field chooses the protocol of one line; switching pose switches protocol', async () => {
    const f = await build(`STYLE lockguard|life 1
STYLE lockmeister|life 2
CHAIN arms|*|rcuff,ring1|lockmeister
CHAIN cross|*|rightwrist,ring1`)
    const a = f.avatar('Alice')
    pose(f, 0, 'arms', a)
    expect(said(f, LM)).toEqual([`${a.key}rcuff`])
    expect(said(f, LG)).toEqual([])
    f.say(a, LM, `${a.key}rcuff ok`)
    pose(f, 0, 'cross', a)
    expect(particles(f).at(-1)).toEqual([2, ''])
    expect(said(f, LG)).toEqual([link(a, 'rightwrist', key(f, 2), 'life 1')])
    pose(f, 0, 'arms', a)
    expect(said(f, LG).at(-1)).toBe(unlink(a, 'rightwrist'))
  })

  it('the first STYLE line sets the default protocol', async () => {
    const f = await build(`STYLE lockmeister
STYLE lockguard|life 1
CHAIN *|*|rcuff,ring1|
CHAIN cross|*|rightwrist,ring1|lockguard`)
    const a = f.avatar('Alice')
    pose(f, 0, 'arms', a)
    expect(said(f, LM)).toEqual([`${a.key}rcuff`])
    pose(f, 0, 'cross', a)
    expect(said(f, LG)).toEqual([link(a, 'rightwrist', key(f, 2), 'life 1')])
  })
})

describe('LuaSitter2 [LS]chains PROPS', () => {
  const LSPOS = `${POSITIONS}\nPROP arms|ring1|G1|<0,0,1>|<0,0,0>`

  it('rings of a prop rezzed by [LS]plugins ([LS]LockGuard-object inside) get the chains', async () => {
    const f = await build('PROPS 1\nCHAIN arms|*|rightwrist,ring1,leftwrist,ringX', {
      plugins: true,
      lspos: LSPOS,
      props: { ring1: ['[LS]object', '[LS]LockGuard-object'] },
    })
    expect(printed(f)).toEqual([]) // with PROPS, LockGuard rings are not checked against the linkset
    const a = f.avatar('Alice')
    f.sit(a)
    f.settle(3_000)
    const prop = f.rezzed().find((l) => l.prims[0]!.name === 'ring1')!
    expect(prop).toBeDefined()
    expect(chains(f).chat.filter((c) => c.channel === COMM).map((c) => [c.text, c.to])).toEqual([['INFORM', prop.prims[0]!.key]])
    // first the linked prim ring1 (the prop had not answered yet), then the prop's ring1
    expect(said(f).filter((t) => t.includes(' link ')).at(-1)).toBe(link(a, 'rightwrist', prop.prims[0]!.key))
    expect(chains(f).listens.some((l) => l.channel === COMM && l.active)).toBe(false)
    // DEREZ forgets the prop: the next pose uses the linked prim again
    f.sendLinked('[LS]chains', 90500, `DEREZ|0|arms|ring1|G1|${prop.prims[0]!.key}`, a.key)
    pose(f, 0, 'arms', a)
    expect(said(f).at(-1)).toBe(link(a, 'rightwrist', key(f, 2)))
  })

  it('without PROPS, 90500 is ignored; the props listen gives up after 30 s', async () => {
    const g = await build('CHAIN arms|*|a,ring1')
    g.sendLinked('[LS]chains', 90500, 'REZ|0|arms|ring1|G1|00000000-0000-0000-0000-0000000aaaa1', '')
    expect(chains(g).chat.filter((c) => c.channel === COMM)).toEqual([])
    const f = await build('PROPS 1\nCHAIN arms|*|a,ring1')
    f.sendLinked('[LS]chains', 90500, 'REZ|0|arms|ring1|G1|00000000-0000-0000-0000-0000000aaaa1', '')
    f.sendLinked('[LS]chains', 90500, 'REZ|0|arms|ring1|G1|not-a-key', '')
    expect(chains(f).chat.filter((c) => c.channel === COMM)).toHaveLength(1)
    expect(chains(f).listens.some((l) => l.channel === COMM && l.active)).toBe(true)
    f.settle(31_000)
    expect(chains(f).listens.some((l) => l.channel === COMM && l.active)).toBe(false)
  })

  it('rings of the sitter\'s own prop win over another sitter\'s prop', async () => {
    const f = await build('PROPS 1\nCHAIN *|*|a,ringP')
    const s = chains(f)
    const [p0, p1] = ['00000000-0000-0000-0000-0000000aaaa0', '00000000-0000-0000-0000-0000000aaaa1']
    const [k0, k1] = ['00000000-0000-0000-0000-0000000bbbb0', '00000000-0000-0000-0000-0000000bbbb1']
    f.sendLinked('[LS]chains', 90500, `REZ|0|x|prop0|G|${p0}`, '')
    f.sendLinked('[LS]chains', 90500, `REZ|1|x|prop1|G|${p1}`, '')
    f.linkset.deliverChat({ channel: COMM, name: 'prop1', key: p1, message: 'NOISE' }) // not an answer
    f.linkset.deliverChat({ channel: COMM, name: 'prop0', key: p0, message: `ATTACHPOINTS|ringP|${k0}` })
    f.linkset.deliverChat({ channel: COMM, name: 'prop1', key: p1, message: `ATTACHPOINTS|ringP|${k1}` })
    f.settle()
    const b = f.avatar('Bob')
    pose(f, 1, 'arms', b)
    expect(said(f).at(-1)).toBe(link(b, 'a', k1))
    const a = f.avatar('Alice')
    pose(f, 0, 'arms', a)
    expect(said(f).at(-1)).toBe(link(a, 'a', k0))
    expect(s.listens.some((l) => l.channel === COMM && l.active)).toBe(false)
    // a sitter with no prop of their own uses any prop
    const c = f.avatar('Carol')
    pose(f, 2, 'arms', c)
    expect(said(f).at(-1)).toMatch(new RegExp(`^lockguard ${c.key} a link 00000000-0000-0000-0000-0000000bbbb[01] `))
  })
})

describe('LuaSitter2 [LS]chains notecard', () => {
  it('reads the example notecard without problems', async () => {
    const f = await build(EXAMPLE, { primNames: { 2: 'ring1', 3: 'ring2', 4: 'ring3', 5: 'ring4' } })
    expect(printed(f)).toEqual([])
    const a = f.avatar('Alice')
    pose(f, 0, 'Kneel', a)
    const p = 'size 0.08 0.08 life 0.6 gravity 0.6 texture d7277e78-06f4-58ae-9f7c-7499e50de18a'
    expect(said(f)).toEqual([link(a, 'leftwrist', key(f, 2), p), link(a, 'rightwrist', key(f, 3), p)])
    pose(f, 0, 'Rest', a)
    pose(f, 0, 'Other', a)
    expect(said(f).slice(2)).toEqual([
      unlink(a, 'leftwrist'), unlink(a, 'rightwrist'),
      link(a, 'leftankle', key(f, 4), p), link(a, 'rightankle', key(f, 5), p),
    ])
    f.sendLinked('[LS]chains', 99, '', a.key)
    expect(said(f).slice(6)).toEqual([unlink(a, 'leftankle'), unlink(a, 'rightankle')])
  })

  it('comments (# and //, also after a line), blank lines and lower-case commands', async () => {
    const f = await build(`#####################
// [LS]chains settings

chain arms|*|rightwrist,ring1 // the right wrist
# CHAIN cross|*|leftwrist,ring2`)
    expect(printed(f)).toEqual([])
    const a = f.avatar('Alice')
    pose(f, 0, 'arms', a)
    pose(f, 0, 'cross', a)
    expect(said(f)).toEqual([link(a, 'rightwrist', key(f, 2)), unlink(a, 'rightwrist')]) // cross is commented out
  })

  it('reports the problems once, with line numbers, to the owner; good lines still work', async () => {
    const f = await build(`CHIAN arms|*|a,ring1
CHAIN arms
CHAIN arms|x|a,ring1
CHAIN arms|*|a,ring1,b
CHAIN arms|*|a,,b,ring1
CHAIN arms|*|a,ring1|chains
CHAIN arms|*|a,ring9
CHAIN arms|*|a,ring1
STYLE rope
STYLE lockmeister|size 1 sparkle 2
TOGGLE 90100|5
TOGGLE x
TOGGLE
CHAIN cross|*|a,ring1,b,ring1|lockmeister
CHAIN cross|1|a,ring9`, { placeholders: ['[LS]LockGuard'] })
    const out = printed(f)
    expect(out).toHaveLength(1)
    const lines = out[0]!.split('\n')
    expect(lines[0]).toBe('[LS]chains: please check "[LS]chains_settings":')
    expect(lines[1]).toBe('"[LS]LockGuard" is in this prim too: use it or [LS]chains for the same cuffs, not both.')
    expect(lines[2]).toBe('line 1: unknown command "CHIAN" (STYLE, CHAIN, TOGGLE or PROPS)')
    expect(lines[3]).toMatch(/^line 2: expected CHAIN pose\|sitter\|cuff,ring/)
    expect(lines[4]).toMatch(/^line 3: expected CHAIN/)
    expect(lines[5]).toBe('line 4: cuffs and rings must come in pairs: cuff,ring,cuff,ring...')
    expect(lines[6]).toBe('line 5: an empty cuff or ring name in "a,,b,ring1"')
    expect(lines[7]).toBe('line 6: the 4th field must be lockguard or lockmeister')
    expect(lines[8]).toBe('line 7: no prim named "ring9" in the linkset (rings in props need PROPS 1)')
    expect(lines[9]).toBe('... and 7 more.') // at most 8 problems are listed
    expect(lines).toHaveLength(10)
    // the good line 7 is used (its ring is missing: nothing to link)
    const a = f.avatar('Alice')
    pose(f, 1, 'cross', a)
    expect(said(f)).toEqual([]) // cross|1 -> ring9 is missing too
  })

  it('reports STYLE, TOGGLE and LockMeister problems', async () => {
    const f = await build(`STYLE rope
STYLE lockmeister|size 1 sparkle 2
TOGGLE 90100|5
TOGGLE x
TOGGLE 1|2|3|4
CHAIN cross|*|a,ring1,b,ring1|lockmeister
CHAIN arms|*|a,ringZ|lockmeister
CHAIN arms|*|b,ring1`)
    const lines = printed(f)[0]!.split('\n').slice(1)
    expect(lines).toEqual([
      'line 1: STYLE must be lockguard or lockmeister',
      'line 2: STYLE lockmeister: "size" is not size x y, life s, gravity g, color r g b or texture t (rest of the line ignored)',
      'line 3: TOGGLE: "90100" is not a link number outside 90000-90500 (90240/90241/90242 work without TOGGLE)',
      'line 4: TOGGLE: "x" is not a link number outside 90000-90500 (90240/90241/90242 work without TOGGLE)',
      'line 5: expected TOGGLE on|off or TOGGLE on|off|toggle (link numbers)',
      'line 6: LockMeister draws one chain per ring prim; "ring1" is used twice',
      'line 7: no prim named "ringZ" in the linkset',
      'line 8: CHAIN arms|* is already on line 7 (this line is ignored)',
    ])
  })

  it('reads through the dataserver when the fast reader answers NAK', async () => {
    const f = await build('CHAIN arms|*|rightwrist,ring1\nCHAIN cross|*|leftwrist,ring2', { nak: true })
    const a = f.avatar('Alice')
    pose(f, 0, 'cross', a)
    expect(said(f)).toEqual([link(a, 'leftwrist', key(f, 3))])
  })

  it('reloads when the notecard changes: unchains, then chains the current poses with the new settings', async () => {
    const f = await build('CHAIN arms|*|rightwrist,ring1')
    const a = f.avatar('Alice')
    pose(f, 0, 'arms', a)
    f.sendLinked('[LS]chains', 90241, '', a.key) // Alice off: stays off after the reload
    const b = f.avatar('Bob')
    pose(f, 1, 'arms', b)
    let before = said(f).length
    f.setNotecard(CARD_NAME, 'STYLE lockguard|life 5\nCHAIN arms|*|leftwrist,ring2')
    expect(since(f, before)).toEqual([unlink(b, 'rightwrist'), link(b, 'leftwrist', key(f, 3), 'life 5')])
    f.setItem('anim4', 'animation') // another item: no reload
    expect(since(f, before)).toHaveLength(2)
    before = said(f).length
    f.setNotecard(CARD_NAME, null) // removed: unchain, and the hint
    expect(since(f, before)).toEqual([unlink(b, 'leftwrist')])
    expect(printed(f).at(-1)).toContain('no "[LS]chains_settings" notecard')
    pose(f, 1, 'arms', b)
    expect(since(f, before)).toHaveLength(1)
  })
  it('two quick notecard changes with the dataserver reader (NAK): the settings are read again', async () => {
    const f = await build('CHAIN arms|*|rightwrist,ring1', { nak: true })
    const s = chains(f)
    // two saves without time passing in between
    s.mock('llGetInventoryKey', () => '44444444-0000-0000-0000-000000000001')
    s.fire('changed', { changes: 0x1 })
    s.mock('llGetInventoryKey', () => '44444444-0000-0000-0000-000000000002')
    s.fire('changed', { changes: 0x1 })
    f.settle(2_000)
    const a = f.avatar('Alice')
    pose(f, 0, 'arms', a)
    expect(said(f)).toEqual([link(a, 'rightwrist', key(f, 2))])
    expect(printed(f)).toEqual([])
  })
})

describe('LuaSitter2 [LS]chains more', () => {
  it('notecard edits while the dataserver reader still reads: older loads stop, only the newest is used', async () => {
    const f = await build('CHAIN arms|*|rightwrist,ring1', { nak: true })
    const s = chains(f)
    // the dataserver lines are answered by hand: each request gets the next key
    const keys = Array.from({ length: 6 }, (_, i) => `99999999-0000-0000-0000-00000000000${i + 1}`)
    let asked = 0
    s.mock('llGetNotecardLine', () => keys[asked++]!)
    for (const sig of ['1', '2', '3']) {
      s.mock('llGetInventoryKey', () => `44444444-0000-0000-0000-00000000000${sig}`)
      s.fire('changed', { changes: 0x1 }) // three saves: loads 2, 3 and 4, each waiting for its first line
    }
    expect(asked).toBe(3)
    // an answer to another request: ignored by every reader
    s.fire('dataserver', { queryid: '77777777-0000-0000-0000-000000000001', data: 'CHAIN free|*|leftwrist,ring2' })
    // load 2 gets its line after load 4 started: it stops reading
    s.fire('dataserver', { queryid: keys[0], data: 'CHAIN cross|*|leftwrist,ring2' })
    // load 3 reaches the end after load 4 started: it doesn't finish
    s.fire('dataserver', { queryid: keys[1], data: '\n\n\n' })
    expect(asked).toBe(3)
    // load 4 reads its notecard to the end
    s.fire('dataserver', { queryid: keys[2], data: 'CHAIN arms|*|rightwrist,ring1' })
    expect(asked).toBe(4)
    s.fire('dataserver', { queryid: keys[3], data: '\n\n\n' })
    f.settle()
    expect(printed(f)).toEqual([])
    const a = f.avatar('Alice')
    pose(f, 0, 'arms', a)
    expect(said(f)).toEqual([link(a, 'rightwrist', key(f, 2))])
    pose(f, 0, 'cross', a) // load 2's line was not kept
    pose(f, 0, 'free', a) // nor the stray answer
    expect(said(f)).toEqual([link(a, 'rightwrist', key(f, 2)), unlink(a, 'rightwrist')])
  })

  it('PROPS: a prop rezzed again keeps its new listen past the first 30 s; other 90500 events and repeated ring names', async () => {
    const f = await build('PROPS 1\nCHAIN arms|*|a,ringP\nCHAIN free|*|none')
    const s = chains(f)
    const p0 = '00000000-0000-0000-0000-0000000aaaa0'
    const [k0, k1] = ['00000000-0000-0000-0000-0000000bbbb0', '00000000-0000-0000-0000-0000000bbbb1']
    const listening = () => s.listens.some((l) => l.channel === COMM && l.active)
    f.sendLinked('[LS]chains', 90500, `REZ|0|x|prop0|G|${p0}`, '')
    f.settle(20_000)
    f.sendLinked('[LS]chains', 90500, `REZ|0|x|prop0|G|${p0}`, '') // rezzed again: a new listen and give-up timer
    f.sendLinked('[LS]chains', 90500, `MOVED|0|x|prop0|G|${p0}`, '') // not REZ or DEREZ: ignored
    f.settle(15_000) // the first timer is due: it leaves the new listen open
    expect(listening()).toBe(true)
    expect(s.chat.filter((c) => c.channel === COMM).map((c) => c.text)).toEqual(['INFORM', 'INFORM'])
    const a = f.avatar('Alice')
    const b = f.avatar('Bob')
    pose(f, 0, 'arms', a) // no ring yet: nothing linked, the cuff waits
    pose(f, 1, 'free', b) // a sitter without chains
    expect(said(f)).toEqual([])
    // the same ring name twice: the first one is used
    f.linkset.deliverChat({ channel: COMM, name: 'prop0', key: p0, message: `ATTACHPOINTS|ringP|${k0}|ringP|${k1}` })
    f.settle()
    expect(said(f)).toEqual([link(a, 'a', k0)])
    expect(listening()).toBe(false)
  })

  it('STYLE lockmeister color with fewer than three numbers is a problem', async () => {
    const f = await build('STYLE lockmeister|life 2 color 1 0\nCHAIN arms|*|rcuff,ring1')
    expect(printed(f)).toEqual([
      expect.stringContaining('line 1: STYLE lockmeister: "color" is not size x y, life s, gravity g, color r g b or texture t (rest of the line ignored)'),
    ])
  })

  it('in a one-prim object the ring can be the prim itself', async () => {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]chains'],
      notecards: { [CARD_NAME]: 'CHAIN arms|*|rightwrist,Furniture\nCHAIN cross|*|leftwrist,ring1' },
    })
    f.start()
    expect(printed(f)).toEqual([
      expect.stringContaining('line 2: no prim named "ring1" in the linkset'),
    ])
    const a = f.avatar('Alice')
    pose(f, 0, 'arms', a)
    expect(said(f)).toEqual([link(a, 'rightwrist', key(f, 1))])
  })
})

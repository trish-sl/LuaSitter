// LuaSitter1 LShelper-script, the script inside the LShelper object that LSadjuster
// rezzes in helper mode: its name, colour, size and hover text per sitter, moving
// on POS (also farther than 10 m), DONE / DONEA (standing its avatar up first),
// renumbering on SWAP, chat from other owners ignored, the sit animation stopped,
// the 7-day self-delete, and a helper rezzed by hand (instructions only).
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS1_SCRIPTS, LS1, OWNER } from '../helpers/furniture.js'
import type { Avatar, Furniture } from '../helpers/furniture.js'
import type { Script } from '@rezless/vitest'

const owner: Avatar = { key: OWNER, name: 'Owner Resident' }
const sources = { ...LS1_SCRIPTS, 'LShelper-script': LS1 + 'LShelper-script.luau' }
const CARD = `SITTER 0
POSE Sit1|anim1
SYNC Hug|anim1
{Sit1}<0,0,0.5><0,0,0>
{Hug}<0,0,0.5><0,0,0>
SITTER 1
POSE Sit1|anim1
SYNC Hug|anim2
{Sit1}<1,0,0.5><0,0,0>
{Hug}<1,0,0.5><0,0,0>`
const INSTRUCTIONS = 'Please see instructions for using the LShelper.'

/** Furniture in helper mode with a SYNC: two helpers, "LShelper 0" and "LShelper 1". */
async function twoHelpers() {
  const f = await buildFurniture({
    sources,
    scripts: ['LSsit', 'LSsit 1', 'LSadjuster'],
    prims: 2,
    notecards: { LSpos: CARD },
    animations: ['anim1', 'anim2'],
    objects: { LShelper: ['LShelper-script'] },
  })
  f.start()
  f.settle(5_000)
  f.sit(owner)
  f.touch(owner)
  f.click(owner, 'Hug')
  f.touch(owner)
  f.click(owner, '[ADJUST]')
  f.click(owner, '[HELPER]')
  f.settle(3_000)
  return f
}

const helperObject = (f: Furniture, n: number) => f.rezzed().find((l) => l.prims[0]!.name === `LShelper ${n}`)!
const helperScript = (f: Furniture, n: number): Script => helperObject(f, n).allScripts()[0]!
const channelOf = (s: Script) => s.listens.find((l) => l.active)!.channel

/** Chat on the adjuster channel, as from the furniture (same owner) or another sender. */
function tell(f: Furniture, s: Script, message: string, from = f.prims[0]!.key) {
  s.deliverChat({ channel: channelOf(s), name: 'Furniture', key: from, message })
  f.settle()
}

function sitOn(f: Furniture, av: Avatar, n: number) {
  const wa = f.world.avatars.find((a) => a.key === av.key)!
  if (!f.world.sitAvatar(wa, helperObject(f, n).prims[0]!)) throw new Error('rezless refused the sit')
  f.settle(2_000)
}

describe('LuaSitter1 LShelper-script rezzed by LSadjuster', () => {
  it('names, colours and sizes itself after its sitter number, with a hover text', async () => {
    const f = await twoHelpers()
    const h1 = helperObject(f, 1).prims[0]!
    // 1 cm smaller per sitter number. (A helper not made by the script's creator keeps
    // its own size, here rezless' default 0.5 m; the original helper is 0.2 x 0.2 x 3.5 m.)
    expect(h1.params.size.z).toBeCloseTo(0.49, 5)
    expect(helperObject(f, 0).prims[0]!.params.size.z).toBeCloseTo(0.5, 5)
    expect(h1.params.faces[0]!.color).toEqual({ x: 0.5, y: 1, z: 1 }) // the second colour
    expect(h1.params.faces[0]!.alpha).toBeCloseTo(0.4, 5)
    const text = helperScript(f, 1).callsOf('llSetLinkPrimitiveParamsFast')
      .map((c) => c.args[1] as unknown[]).filter((r) => r[0] === 26) // PRIM_TEXT
      .at(-1)!
    expect(text[1]).toBe('SITTER 1\n▽\n ')
    expect(helperScript(f, 0).chat.map((c) => c.text)).toContain('REG|0')
  })

  it('POS moves it to the position and rotation given, also farther than 10 m', async () => {
    const f = await twoHelpers()
    const s = helperScript(f, 0)
    tell(f, s, 'POS|0|<128, 150, 25.5>|<0, 0, 0.70711, 0.70711>')
    const prim = helperObject(f, 0).prims[0]!
    expect(prim.params.position).toEqual({ x: 128, y: 150, z: 25.5 })
    expect(prim.params.rotation.z).toBeCloseTo(0.70711, 4)
    expect(helperObject(f, 1).prims[0]!.params.position).toEqual({ x: 129, y: 128, z: 25.5 }) // the other stays
  })

  it('DONE removes only the helper with that number; DONEA removes every helper', async () => {
    const f = await twoHelpers()
    const s = helperScript(f, 0)
    tell(f, s, 'DONE|1')
    expect(s.dead).toBe(false)
    tell(f, s, 'DONE|0')
    expect(s.dead).toBe(true)
    const s1 = helperScript(f, 1)
    tell(f, s1, 'DONEA')
    expect(f.rezzed()).toHaveLength(0)
  })

  it('ignores commands from objects of other owners', async () => {
    const f = await twoHelpers()
    const s = helperScript(f, 0)
    tell(f, s, 'DONEA', f.avatar('Mallory').key)
    expect(s.dead).toBe(false)
    tell(f, s, 'POS|0|<130, 130, 30>|<0, 0, 0, 1>', f.avatar('Mallory').key)
    expect(helperObject(f, 0).prims[0]!.params.position).toEqual({ x: 128, y: 128, z: 25.5 })
  })

  it('SWAP gives the two helpers each other\'s number', async () => {
    const f = await twoHelpers()
    const h0 = helperObject(f, 0)
    const h1 = helperObject(f, 1)
    tell(f, h0.allScripts()[0]!, 'SWAP|1|0')
    tell(f, h1.allScripts()[0]!, 'SWAP|1|0')
    expect(h0.prims[0]!.name).toBe('LShelper 1')
    expect(h1.prims[0]!.name).toBe('LShelper 0')
    expect(h1.allScripts()[0]!.chat.map((c) => c.text)).toContain('REG|0') // registers again
  })

  it('an avatar sitting on it is reported (ANIMA) and its sit animation is stopped', async () => {
    const f = await twoHelpers()
    const alice = f.avatar('Alice')
    sitOn(f, alice, 1)
    const s = helperScript(f, 1)
    expect(s.chat.map((c) => c.text)).toContain(`ANIMA|1|${alice.key}`)
    expect(s.permissionRequests.at(-1)!.agent).toBe(alice.key)
    s.grantPermissions()
    f.settle()
    expect(s.callsOf('llStopAnimation').map((c) => String(c.args[0]))).toContain('sit')
  })

  it('DONEA with an avatar on it stops the avatar\'s animations and reports GETUP first', async () => {
    const f = await twoHelpers()
    const alice = f.avatar('Alice')
    sitOn(f, alice, 1)
    const s = helperScript(f, 1)
    // llGetAnimationList gives uuids, which rezless (unlike Second Life) refuses in
    // llStopAnimation: give them as strings
    s.mock('llGetAnimationList', (_ctx, args) => s.getPlayingAnimations(String(args[0])).map(String))
    s.grantPermissions()
    f.settle()
    f.script('LSsit 1').grantPermissions() // the adjuster gave her sitter 1's pose
    f.settle(2_000)
    expect(f.playing(alice)).toEqual(['anim2'])
    tell(f, s, 'DONEA')
    expect(s.chat.map((c) => c.text)).toContain(`GETUP|1|${alice.key}`)
    expect(s.callsOf('llStopAnimation').map((c) => String(c.args[0]))).toContain(f.itemKey('anim2'))
    expect(s.dead).toBe(true)
  })

  it('deletes itself after 7 days', async () => {
    const f = await twoHelpers()
    const s = helperScript(f, 0)
    f.advance(600_000_000) // nearly 7 days (604800 s)
    expect(s.dead).toBe(false)
    f.advance(10_000_000)
    expect(s.dead).toBe(true)
  })
})

describe('LuaSitter1 LShelper-script rezzed by hand', () => {
  async function handRezzed() {
    const f = await buildFurniture({ sources, scripts: ['LShelper-script'] })
    f.start()
    f.script('LShelper-script').fire('on_rez', { start_param: 0 })
    f.settle()
    return f
  }

  it('touching it gives the instructions', async () => {
    const f = await handRezzed()
    const alice = f.avatar('Alice')
    f.touch(alice)
    f.settle(2_000)
    expect(f.script('LShelper-script').callsOf('llInstantMessage').map((c) => c.args.map(String))).toEqual([[alice.key, INSTRUCTIONS]])
  })

  it('an avatar sitting on it gets the instructions and is unseated', async () => {
    const f = await handRezzed()
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.settle(3_000)
    const s = f.script('LShelper-script')
    expect(s.callsOf('llInstantMessage').map((c) => String(c.args[1]))).toEqual([INSTRUCTIONS])
    expect(s.callsOf('llUnSit').map((c) => String(c.args[0]))).toEqual([alice.key])
  })

  it('shrinks to a ball when it is the original helper (made by the script\'s creator)', async () => {
    const f = await buildFurniture({ sources, scripts: ['LShelper-script'] })
    const s = f.script('LShelper-script')
    // in rezless the prim and the script have different creators: give them the same one
    s.mock('llGetObjectDetails', () => [OWNER])
    s.mock('llGetInventoryCreator', () => OWNER)
    f.start()
    s.fire('on_rez', { start_param: 0 })
    f.settle()
    const size = f.prims[0]!.params.size
    expect([size.x, size.y, size.z].map((v) => Math.round(v * 1000) / 1000)).toEqual([0.2, 0.2, 0.2])
  })

  it('warns its creator when it is not set to "Anyone Can Move"', async () => {
    const f = await buildFurniture({ sources, scripts: ['LShelper-script'] })
    const s = f.script('LShelper-script')
    s.mock('llGetObjectPermMask', () => 0)
    s.mock('llGetInventoryCreator', () => OWNER)
    f.start()
    expect(f.printed('LShelper-script')).toContain("WARNING! LShelper should be set to 'Anyone Can Move'")
  })
})

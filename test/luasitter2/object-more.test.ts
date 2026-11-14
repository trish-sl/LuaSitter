// LuaSitter2: more of [LS]object, the script inside props: attaching through the
// experience, the "enable the experience" hint (NAG), saving prop positions
// (PROPSEARCH / SAVEPROP with [LS]plugins), ATTACHTO for an absent avatar, a worn
// prop detached when its wearer stands (REM_WORN) or when another attachment takes
// its point (LOCAT), unseating avatars sitting on a removed prop, the watchdog of a
// worn prop, and a prop rezzed again.
// Also: attaching through the experience (accepted now or before), what a prop
// ignores (touches, ATTACHTO / LOCAT / REM_* not meant for it), a prop rezzed by
// hand, with a start parameter that is not from LuaSitter, by an attached rezzer, or
// with the script in a child prim, and sittable props keeping their click action.
import { describe, it, expect } from 'vitest'
import { Experience } from '@rezless/vitest'
import type { Script } from '@rezless/vitest'
import { buildFurniture, LS2_SCRIPTS, OWNER } from '../helpers/furniture.js'
import type { Furniture } from '../helpers/furniture.js'

const POSES = `SITTER 0
POSE Sit1|anim1
POSE Sit2|anim2
{Sit1}<0,0,0.5><0,0,0>
{Sit2}<0,0,0.5><0,0,0>`

const XP_ERROR_NOT_PERMITTED_LAND = 17
const PERMISSION_ATTACH = 0x20
const OBJECT_ATTACHED_POINT = 19

async function furniture(propLine: string) {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]sit', '[LS]plugins'],
    notecards: { LSpos: `${POSES}\n${propLine}` },
    animations: ['anim1', 'anim2'],
    objects: { ball: ['[LS]object'] },
  })
  f.start()
  return f
}

function propScript(f: Furniture): Script {
  const prop = f.rezzed()[0]
  if (!prop) throw new Error('no prop rezzed')
  return prop.allScripts()[0]!
}

/** Prop events reported to plugins by link message 90500: "CMD|sitter|pose|object|group|key". */
const propEvents = (f: Furniture) => f.linked().filter((m) => m.num === 90500).map((m) => m.str.split('|')[0])
/** What the prop said on its channel. */
const propSaid = (s: Script) => s.chat.map((c) => c.text)

/** Alice sits and chooses Sit2, which rezzes a PROP1 that she accepts through the permission fallback. */
async function wornProp() {
  const f = await furniture('PROP1 Sit2|ball|G1|<0,0,1>|<0,0,0>|chest')
  const alice = f.avatar('Alice')
  f.sit(alice)
  f.click(alice, 'Sit2')
  const obj = propScript(f)
  obj.grantPermissions()
  f.settle()
  return { f, alice, obj, prop: f.rezzed()[0]! }
}

describe('LuaSitter2 [LS]object attaching', () => {
  it('when the land does not allow the experience, the owner wearing the prop is told how to enable it (NAG)', async () => {
    // only the furniture's owner is told: a temporary attachment then still has the same owner
    const f = await furniture('PROP1 Sit2|ball|G1|<0,0,1>|<0,0,0>|chest')
    const alice = { key: OWNER, name: 'Owner Resident' }
    f.sit(alice)
    f.click(alice, 'Sit2')
    const obj = propScript(f)
    obj.mock('llGetExperienceDetails', () => ['LuaSitter XP', OWNER, '00000000-0000-0000-0000-0000000000e1', XP_ERROR_NOT_PERMITTED_LAND, 'not permitted', '00000000-0000-0000-0000-000000000000'])
    // rezless has no experience for the prop and denies at once; deny again as land without the experience does
    obj.fire('experience_permissions_denied', { agent_id: alice.key, reason: XP_ERROR_NOT_PERMITTED_LAND })
    f.settle()
    obj.grantPermissions()
    f.settle()
    expect(propSaid(obj)).toContain('NAG|LuaSitter XP')
    const told = f.script('[LS]plugins').chat.filter((c) => c.to === OWNER).map((c) => c.text)
    expect(told).toEqual(["To enable auto-attachments, please enable the experience 'LuaSitter XP' by Code Violet in 'About Land'."])
  })

  it('ATTACHTO an avatar that is not in the region derezzes the prop', async () => {
    const f = await furniture('PROP1 Sit2|ball|G1|<0,0,1>|<0,0,0>|chest')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    const prop = f.rezzed()[0]!
    const obj = propScript(f)
    const chan = obj.listens.find((l) => l.active)!.channel
    obj.deliverChat({ channel: chan, name: 'Furniture', key: f.prims[0]!.key, message: `ATTACHTO|00000000-0000-0000-0000-00000000dead|${prop.prims[0]!.key}` })
    f.settle()
    expect(prop.dead).toBe(true)
    expect(propSaid(obj).at(-1)).toMatch(/^DEREZ\|/)
  })

  it('a worn prop is detached when its wearer stands up (REM_WORN)', async () => {
    const { f, alice, obj, prop } = await wornProp()
    expect(prop.attachment?.avatar).toBe(alice.key)
    f.stand(alice)
    const req = obj.permissionRequests.at(-1)!
    if (!req.answered) obj.grantPermissions()
    f.settle(2_000)
    expect(prop.attachment ?? null).toBeNull()
    expect(propEvents(f)).toContain('DETACHED')
  })

  it('a worn prop gives its point to another LuaSitter prop attached there (LOCAT)', async () => {
    const { f, obj, prop } = await wornProp()
    const owner = String(prop.attachment!.avatar)
    const asked = obj.permissionRequests.length
    obj.deliverChat({ channel: -2907539, name: 'other prop', key: owner, message: 'LOCAT|1' })
    f.settle()
    expect(obj.permissionRequests.length).toBe(asked + 1)
    expect(obj.permissionRequests.at(-1)).toMatchObject({ permissions: PERMISSION_ATTACH })
    obj.deliverChat({ channel: -2907539, name: 'other prop', key: owner, message: 'LOCAT|5' }) // another point: kept
    f.settle()
    expect(obj.permissionRequests.length).toBe(asked + 1)
  })

  it('a worn prop asks to detach when the furniture is gone (watchdog)', async () => {
    const { f, obj, prop } = await wornProp()
    const asked = obj.permissionRequests.length
    f.linkset.remove()
    prop.advanceTime(11_000)
    expect(prop.dead).toBeFalsy()
    expect(obj.permissionRequests.length).toBeGreaterThan(asked)
    expect(obj.permissionRequests.at(-1)).toMatchObject({ permissions: PERMISSION_ATTACH })
  })
})

describe('LuaSitter2 [LS]object rezzed props', () => {
  it('[SAVE] asks the props where they are (PROPSEARCH), and their new position is saved', async () => {
    const f = await furniture('PROP Sit2|ball|G1|<0,0,1>|<0,0,0>')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    const prop = f.rezzed()[0]!
    const p = prop.prims[0]!.params.position
    prop.prims[0]!.params.position = { x: p.x + 0.5, y: p.y, z: p.z }
    f.broadcast(90101, '0|[SAVE]', OWNER)
    f.settle()
    expect(propSaid(propScript(f))).toContain('SAVEPROP|0')
    const said = f.script('[LS]plugins').chat.filter((c) => c.channel === 0).map((c) => c.text)
    expect(said).toContain('PROP Saved to memory, SITTER 0: PROP Sit2|ball|G1|<0.50000, 0.00000, 1.00000>|<0.00000, 0.00000, 0.00000>|')
    // the saved position is used from now on (and dumped)
    f.sendLinked('[LS]plugins', 90020, '0', '[LS]plugins')
    f.settle(2_000)
    expect(f.linked().filter((m) => m.num === 90022).map((m) => m.str)).toEqual(['PROP Sit2|ball|G1|<0.50000, 0.00000, 1.00000>|<0.00000, 0.00000, 0.00000>|'])
  })

  it('avatars sitting on a removed prop are unseated first, and it derezzes 1 s later', async () => {
    const f = await furniture('PROP Sit2|ball|G1|<0,0,1>|<0,0,0>')
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.click(alice, 'Sit2')
    const prop = f.rezzed()[0]!
    const obj = propScript(f)
    // Bob sits on the prop: in Second Life he becomes its link 2 (rezless does not model that)
    let bobOn = true
    obj.mock('llGetNumberOfPrims', () => (bobOn ? 2 : 1))
    obj.mock('llGetLinkKey', (_ctx, args) => (args[0] === 2 && bobOn ? bob.key : prop.prims[0]!.key))
    obj.mock('llUnSit', () => { bobOn = false })
    const chan = obj.listens.find((l) => l.active)!.channel
    obj.deliverChat({ channel: chan, name: 'Furniture', key: f.prims[0]!.key, message: 'REM_ALL' })
    expect(bobOn).toBe(false)
    expect(prop.dead).toBeFalsy()
    f.settle(1_100)
    expect(prop.dead).toBe(true)
  })

  it('a prop rezzed again (taken and rezzed) starts over on its channel', async () => {
    const f = await furniture('PROP Sit2|ball|G1|<0,0,1>|<0,0,0>')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    const obj = propScript(f)
    const rez = () => propSaid(obj).filter((t) => t.startsWith('REZ|')).length
    expect(rez()).toBe(1)
    obj.fire('on_rez', { start_param: 0 })
    f.settle()
    expect(rez()).toBe(2)
    expect(obj.listens.filter((l) => l.active)).toHaveLength(1) // the old listen was closed
  })
})

/** Gives a rezzed prop's script an experience (the harness rezzes props without one). */
function withExperience(s: Script, xp: Experience) {
  ;(s as unknown as { state: { experience: Experience | null } }).state.experience = xp
}

describe('LuaSitter2 [LS]object through the experience', () => {
  it('PROP2: the toucher accepts the experience and the prop attaches without a permission dialog', async () => {
    const f = await furniture('PROP2 Sit2|ball|G1|<0,0,1>|<0,0,0>|left hand')
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.click(alice, 'Sit2')
    const prop = f.rezzed()[0]!
    const obj = propScript(f)
    withExperience(obj, new Experience({ name: 'LuaSitter XP' }))
    prop.touch(1, { avatar: { key: bob.key, name: bob.name } })
    f.settle()
    expect(obj.experienceRequests.map((r) => r.agent)).toEqual([bob.key])
    obj.grantExperiencePermissions()
    f.settle()
    expect(prop.attachment?.avatar).toBe(bob.key)
    expect(prop.attachment?.point).toBe(5) // ATTACH_LHAND
    expect(obj.permissionRequests).toHaveLength(0) // no fallback dialog
    expect(propEvents(f)).toEqual(['REZ', 'ATTACHED'])
    expect(propSaid(obj)).toContain('LOCAT|5') // tells other LuaSitter props on that point
    expect(propSaid(obj).some((t) => t.startsWith('NAG|'))).toBe(false)
  })

  it('PROP2: an avatar who accepted the experience before is attached at once', async () => {
    const f = await furniture('PROP2 Sit2|ball|G1|<0,0,1>|<0,0,0>|left hand')
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.click(alice, 'Sit2')
    const prop = f.rezzed()[0]!
    const obj = propScript(f)
    withExperience(obj, new Experience({ name: 'LuaSitter XP', agents: [bob.key] }))
    prop.touch(1, { avatar: { key: bob.key, name: bob.name } })
    f.settle()
    expect(prop.attachment?.avatar).toBe(bob.key)
    expect(obj.permissionRequests).toHaveLength(0)
  })

  it('touching a PROP (not an attachment prop) or a worn prop asks nobody', async () => {
    const f = await furniture('PROP Sit2|ball|G1|<0,0,1>|<0,0,0>')
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.click(alice, 'Sit2')
    const prop = f.rezzed()[0]!
    const obj = propScript(f)
    prop.touch(1, { avatar: { key: bob.key, name: bob.name } })
    f.settle()
    expect(obj.callsOf('llRequestExperiencePermissions')).toHaveLength(0)
    expect(obj.permissionRequests).toHaveLength(0)

    const w = await wornProp()
    const asked = w.obj.callsOf('llRequestExperiencePermissions').length
    w.prop.touch(1, { avatar: { key: bob.key, name: bob.name } })
    w.f.settle()
    expect(w.obj.callsOf('llRequestExperiencePermissions')).toHaveLength(asked)
  })

  it('no NAG when the experience details do not say the land refuses it', async () => {
    const f = await furniture('PROP1 Sit2|ball|G1|<0,0,1>|<0,0,0>|chest')
    const owner = { key: OWNER, name: 'Owner Resident' }
    f.sit(owner)
    f.click(owner, 'Sit2')
    const obj = propScript(f)
    obj.mock('llGetExperienceDetails', () => [])
    obj.fire('experience_permissions_denied', { agent_id: owner.key, reason: XP_ERROR_NOT_PERMITTED_LAND })
    f.settle()
    obj.grantPermissions()
    f.settle()
    expect(f.rezzed()[0]!.attachment?.avatar).toBe(OWNER)
    expect(propSaid(obj)).toContain('ATTACHED|0')
    expect(propSaid(obj).some((t) => t.startsWith('NAG|'))).toBe(false)
  })

  it('no NAG for a sitter who is not the owner (the temporary attachment changes the owner)', async () => {
    const f = await furniture('PROP1 Sit2|ball|G1|<0,0,1>|<0,0,0>|chest')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    const obj = propScript(f)
    obj.mock('llGetExperienceDetails', () => ['LuaSitter XP', OWNER, '00000000-0000-0000-0000-0000000000e1', XP_ERROR_NOT_PERMITTED_LAND, 'not permitted', '00000000-0000-0000-0000-000000000000'])
    obj.fire('experience_permissions_denied', { agent_id: alice.key, reason: XP_ERROR_NOT_PERMITTED_LAND })
    f.settle()
    obj.grantPermissions()
    f.settle()
    expect(f.rezzed()[0]!.attachment?.avatar).toBe(alice.key)
    expect(propSaid(obj).some((t) => t.startsWith('NAG|'))).toBe(false)
  })
})

describe('LuaSitter2 [LS]object messages not meant for it', () => {
  const chanOf = (obj: Script) => obj.listens.find((l) => l.active && l.channel !== -2907539)!.channel

  it('ATTACHTO to a PROP2 (it waits for a touch) or without a target is ignored', async () => {
    const f = await furniture('PROP2 Sit2|ball|G1|<0,0,1>|<0,0,0>|left hand')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    const prop = f.rezzed()[0]!
    const obj = propScript(f)
    const from = { channel: chanOf(obj), name: 'Furniture', key: f.prims[0]!.key }
    obj.deliverChat({ ...from, message: `ATTACHTO|${alice.key}|${prop.prims[0]!.key}` })
    obj.deliverChat({ ...from, message: 'ATTACHTO' })
    f.settle()
    expect(obj.callsOf('llRequestExperiencePermissions')).toHaveLength(0)
    expect(prop.dead).toBeFalsy()
  })

  it('PROP1: ATTACHTO for another prop is ignored; to something that is not an avatar it derezzes', async () => {
    const f = await furniture('PROP1 Sit2|ball|G1|<0,0,1>|<0,0,0>|chest')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    const prop = f.rezzed()[0]!
    const obj = propScript(f)
    const asked = obj.callsOf('llRequestExperiencePermissions').length
    const from = { channel: chanOf(obj), name: 'Furniture', key: f.prims[0]!.key }
    obj.deliverChat({ ...from, message: `ATTACHTO|${alice.key}|00000000-0000-0000-0000-00000000beef` })
    obj.deliverChat({ ...from, message: 'ATTACHTO' })
    f.settle()
    expect(obj.callsOf('llRequestExperiencePermissions')).toHaveLength(asked)
    expect(prop.dead).toBeFalsy()
    obj.deliverChat({ ...from, message: `ATTACHTO|not a key|${prop.prims[0]!.key}` })
    f.settle()
    expect(prop.dead).toBe(true)
    expect(propSaid(obj).at(-1)).toMatch(/^DEREZ\|/)
  })

  it('a worn prop ignores LOCAT from another owner, REM_WORN for someone else, REM_WORLD and REM_INDEX of other props', async () => {
    const { f, obj, prop } = await wornProp()
    const bob = f.avatar('Bob')
    const asked = obj.permissionRequests.length
    obj.deliverChat({ channel: -2907539, name: 'Bob prop', key: bob.key, message: 'LOCAT|1' })
    const from = { channel: chanOf(obj), name: 'Furniture', key: f.prims[0]!.key }
    obj.deliverChat({ ...from, message: `REM_WORN|${bob.key}` })
    obj.deliverChat({ ...from, message: 'REM_WORLD|0' }) // only for props that are not worn
    obj.deliverChat({ ...from, message: 'REM_INDEX|7' })
    f.settle()
    expect(obj.permissionRequests).toHaveLength(asked)
    expect(prop.attachment).toBeTruthy()
    expect(prop.dead).toBeFalsy()
  })

  it('a worn prop does not start over when it gets on_rez', async () => {
    const { f, obj } = await wornProp()
    obj.fire('on_rez', { start_param: 0 })
    f.settle()
    expect(propSaid(obj).filter((t) => t.startsWith('REZ|'))).toHaveLength(1)
  })

  it('a prop taken and rezzed again by hand (start parameter 0) stops listening and has no watchdog', async () => {
    const f = await furniture('PROP Sit2|ball|G1|<0,0,1>|<0,0,0>')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    const prop = f.rezzed()[0]!
    const obj = propScript(f)
    obj.mock('llGetStartParameter', () => 0)
    obj.fire('on_rez', { start_param: 0 })
    f.settle()
    expect(propSaid(obj).filter((t) => t.startsWith('REZ|'))).toHaveLength(1)
    expect(obj.listens.filter((l) => l.active)).toHaveLength(0)
    f.linkset.remove()
    prop.advanceTime(25_000)
    expect(prop.dead).toBeFalsy()
  })
})

describe('LuaSitter2 [LS]object rezzed outside LuaSitter', () => {
  /** An object with [LS]object (and maybe placeholder scripts), rezzed with `start`. */
  async function loose(start: number, opts: { placeholders?: string[]; mock?: (s: Script) => void } = {}) {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]object'],
      primNames: { 1: 'ball' },
      placeholders: opts.placeholders,
    })
    const s = f.script('[LS]object')
    s.mock('llGetStartParameter', () => start)
    opts.mock?.(s)
    f.start()
    s.fire('on_rez', { start_param: start })
    f.settle()
    return { f, s }
  }

  it('rezzed by hand (start parameter 0) it does nothing at all', async () => {
    const { f, s } = await loose(0)
    const alice = f.avatar('Alice')
    f.touch(alice)
    s.fire('attach', { avatar: alice.key })
    s.fire('run_time_permissions', { perm: PERMISSION_ATTACH })
    s.fire('experience_permissions', { agent_id: alice.key })
    s.fire('experience_permissions_denied', { agent_id: alice.key, reason: XP_ERROR_NOT_PERMITTED_LAND })
    f.settle(30_000)
    expect(s.chat).toEqual([])
    expect(s.listens).toEqual([])
    expect(s.permissionRequests).toEqual([])
    expect(s.callsOf('llSetClickAction')).toEqual([])
    expect(s.callsOf('llRequestExperiencePermissions')).toEqual([])
    expect(s.callsOf('llAttachToAvatarTemp')).toEqual([])
    expect(f.linkset.dead).toBeFalsy()
  })

  it('a start parameter not made by LuaSitter: no channel, no REZ, ATTACHED not said, touch switched off', async () => {
    const { f, s } = await loose(5)
    const alice = f.avatar('Alice')
    expect(s.chat).toEqual([])
    expect(s.listens).toEqual([])
    expect(s.callsOf('llSetClickAction').map((c) => c.args[0])).toEqual([-1])
    f.touch(alice) // prop type 0: not an attachment
    s.fire('attach', { avatar: alice.key })
    f.settle()
    expect(s.callsOf('llRequestExperiencePermissions')).toEqual([])
    expect(s.chat).toEqual([])
  })

  it('a sittable prop ([LS]sit or [AV]sitA inside) keeps its click action', async () => {
    for (const sitScript of ['[LS]sit', '[AV]sitA']) {
      const { s } = await loose(-77701000, { placeholders: [sitScript] })
      expect(s.chat.map((c) => c.text)).toEqual(['REZ|1'])
      expect(s.callsOf('llSetClickAction')).toEqual([])
    }
    const { s } = await loose(-77701000)
    expect(s.callsOf('llSetClickAction').map((c) => c.args[0])).toEqual([-1])
  })

  it('[LS]object in a child prim of the prop does not report (only the root prim does)', async () => {
    const { s } = await loose(-77701000, { mock: (x) => x.mock('llGetLinkNumber', () => 2) })
    expect(s.chat).toEqual([])
    expect(s.listens).toEqual([])
  })

  it('a prop rezzed by an attached rezzer (a HUD) has no "rezzer gone" watchdog', async () => {
    const hud = '00000000-0000-0000-0000-0000000000d1' // no such object here: llGetObjectMass gives 0
    const details = (point: number | null) => (x: Script) => x.mock('llGetObjectDetails', (_ctx, args) =>
      (args[1] as number[])[0] === OBJECT_ATTACHED_POINT ? (point === null ? [] : [point]) : [hud])
    const fromHud = await loose(-77701000, { mock: details(35) })
    fromHud.f.settle(25_000)
    expect(fromHud.f.linkset.dead).toBeFalsy()
    // without an attach point the rezzer is watched: it is gone, so the prop says DEREZ and dies
    const gone = await loose(-77701000, { mock: details(null) })
    gone.f.settle(11_000)
    expect(gone.f.linkset.dead).toBe(true)
    expect(gone.s.chat.map((c) => c.text)).toEqual(['REZ|1', 'DEREZ|1'])
  })

  it('a rezzer key that cannot be read counts as gone', async () => {
    const { f, s } = await loose(-77701000, { mock: (x) => x.mock('llGetObjectDetails', () => []) })
    f.settle(11_000)
    expect(f.linkset.dead).toBe(true)
    expect(s.chat.map((c) => c.text).at(-1)).toBe('DEREZ|1')
  })
})

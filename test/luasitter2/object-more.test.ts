// LuaSitter2: more of [LS]object, the script inside props: attaching through the
// experience, the "enable the experience" hint (NAG), saving prop positions
// (PROPSEARCH / SAVEPROP with [LS]plugins), ATTACHTO for an absent avatar, a worn
// prop detached when its wearer stands (REM_WORN) or when another attachment takes
// its point (LOCAT), unseating avatars sitting on a removed prop, the watchdog of a
// worn prop, and a prop rezzed again.
import { describe, it, expect } from 'vitest'
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

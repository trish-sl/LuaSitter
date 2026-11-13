// LuaSitter2: [LS]object, the script inside props: attaching PROP1 / PROP2 props
// (experience, falling back to a permission request), removal of worn props,
// unseating avatars sitting on a prop, and the "rezzer gone" watchdog.
import { describe, it, expect } from 'vitest'
import type { Script } from '@rezless/vitest'
import { buildFurniture, LS2_SCRIPTS } from '../helpers/furniture.js'
import type { Furniture } from '../helpers/furniture.js'

const POSES = `SITTER 0
POSE Sit1|anim1
POSE Sit2|anim2
{Sit1}<0,0,0.5><0,0,0>
{Sit2}<0,0,0.5><0,0,0>`

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

/** The [LS]object script of the (first) rezzed prop. */
function propScript(f: Furniture): Script {
  const prop = f.rezzed()[0]
  if (!prop) throw new Error('no prop rezzed')
  return prop.allScripts()[0]!
}

/** Prop events reported to plugins by link message 90500: "CMD|sitter|pose|object|group|key". */
const propEvents = (f: Furniture) => f.linked().filter((m) => m.num === 90500).map((m) => m.str.split('|')[0])

describe('LuaSitter2 [LS]object attach props', () => {
  it('PROP1 attaches to the sitter (permission fallback without an experience)', async () => {
    const f = await furniture('PROP1 Sit2|ball|G1|<0,0,1>|<0,0,0>|chest')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    const obj = propScript(f)
    // asked the experience first, then fell back to a permission request to the sitter
    expect(obj.callsOf('llRequestExperiencePermissions').at(-1)!.args[0]).toBe(alice.key)
    const req = obj.permissionRequests.at(-1)!
    expect(req.agent).toBe(alice.key)
    obj.grantPermissions()
    f.settle()
    expect(f.rezzed()[0]!.attachment?.avatar).toBe(alice.key)
    expect(f.rezzed()[0]!.attachment?.point).toBe(1) // ATTACH_CHEST
    expect(propEvents(f)).toEqual(['REZ', 'ATTACHED'])
  })

  it('a worn PROP1 is detached when the pose changes', async () => {
    const f = await furniture('PROP1 Sit2|ball|G1|<0,0,1>|<0,0,0>|chest')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    const obj = propScript(f)
    obj.grantPermissions()
    f.settle()
    f.click(alice, 'Sit1')
    // a worn prop asks its wearer for the attach permission again, then detaches
    const req = obj.permissionRequests.at(-1)!
    if (!req.answered) obj.grantPermissions()
    f.settle(2_000)
    expect(f.rezzed()[0]?.attachment ?? null).toBeNull()
    expect(propEvents(f)).toContain('DETACHED')
  })

  it('denying the attach permission derezzes the prop', async () => {
    const f = await furniture('PROP1 Sit2|ball|G1|<0,0,1>|<0,0,0>|chest')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    const obj = propScript(f)
    obj.grantPermissions(0)
    f.settle()
    expect(f.rezzed()).toHaveLength(0)
    expect(propEvents(f)).toContain('DEREZ')
  })

  it('PR #32: gives up after 120 s without an answer to the permission request', async () => {
    const f = await furniture('PROP1 Sit2|ball|G1|<0,0,1>|<0,0,0>|chest')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    f.settle(60_000)
    expect(f.rezzed()).toHaveLength(1)
    f.settle(61_000)
    expect(f.rezzed()).toHaveLength(0)
    expect(propEvents(f)).toContain('DEREZ')
  })

  it('PROP2 attaches to whoever touches it', async () => {
    const f = await furniture('PROP2 Sit2|ball|G1|<0,0,1>|<0,0,0>|left hand')
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.click(alice, 'Sit2')
    const prop = f.rezzed()[0]!
    const obj = propScript(f)
    expect(obj.permissionRequests).toHaveLength(0) // nothing until touched
    prop.touch(1, { avatar: { key: bob.key, name: bob.name } })
    f.settle()
    expect(obj.permissionRequests.at(-1)!.agent).toBe(bob.key)
    obj.grantPermissions()
    f.settle()
    expect(prop.attachment?.avatar).toBe(bob.key)
    expect(prop.attachment?.point).toBe(5) // ATTACH_LHAND
  })
})

describe('LuaSitter2 [LS]object rezzed props', () => {
  it('the prop derezzes itself when the furniture is gone (watchdog)', async () => {
    const f = await furniture('PROP Sit2|ball|G1|<0,0,1>|<0,0,0>')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    expect(f.rezzed()).toHaveLength(1)
    const prop = f.rezzed()[0]!
    const said: string[] = []
    const obj = propScript(f)
    f.linkset.remove()
    prop.advanceTime(11_000)
    for (const c of obj.chat) said.push(c.text)
    expect(said.some((t) => t.startsWith('DEREZ|'))).toBe(true)
    expect(prop.dead).toBe(true)
  })
})

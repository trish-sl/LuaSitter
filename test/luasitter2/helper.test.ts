// LuaSitter2: [LS]helperscript, the script in the helper object that [LS]adjuster
// rezzes: label and name, moving to the pose, the MENU / DONE / SWAP messages,
// moving the helper to an avatar ("/5 <key>"), sitting on it (refused, or the old
// helper method), the start parameter 0 (rezzed by hand) and the one-day timeout.
import { describe, it, expect } from 'vitest'
import type { Script } from '@rezless/vitest'
import { buildFurniture, LS2_SCRIPTS, OWNER } from '../helpers/furniture.js'
import type { Furniture, Avatar } from '../helpers/furniture.js'

const owner: Avatar = { key: OWNER, name: 'Owner Resident' }
const PRIM_SIZE = 7

const ONE = 'SITTER 0\nPOSE Sit1|anim1\n{Sit1}<0,0,0.5><0,0,0>'
const TWO = 'SITTER 0\nSYNC S|anim1\n{S}<0,0.5,0.5><0,0,0>\nSITTER 1\nSYNC S|anim1\n{S}<0,-0.5,0.5><0,0,90>'

async function workshop(card = ONE, sitters = 1, helperName = '[LS]helper') {
  const scripts = ['[LS]sit']
  for (let i = 1; i < sitters; i++) scripts.push(`[LS]sit ${i}`)
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: [...scripts, '[LS]adjuster'],
    prims: sitters,
    notecards: { LSpos: card },
    animations: ['anim1', 'anim2'],
    objects: { [helperName]: ['[LS]helperscript'] },
  })
  f.start()
  f.sit(owner)
  return f
}

function helperMode(f: Furniture) {
  f.click(owner, '[ADJUST]')
  f.click(owner, '[HELPER]')
  f.settle(3_000)
}

const helpers = (f: Furniture) => f.rezzed()
const helperScript = (f: Furniture, i = 0): Script => helpers(f)[i]!.allScripts()[0]!
/** What a helper said on its comm channel (REG, MOVED, MENU, ANIMA, GETUP). */
const helperSaid = (s: Script) => s.chat.map((c) => c.text)

describe('LuaSitter2 [LS]helperscript', () => {
  it('a helper is labelled with its sitter and goes to the pose position', async () => {
    const f = await workshop(TWO, 2)
    const bob = f.avatar('Bob')
    f.sit(bob)
    helperMode(f)
    const names = helpers(f).map((h) => h.prims[0]!.name).sort()
    expect(names).toEqual(['[LS]helper 0', '[LS]helper 1'])
    const h0 = helpers(f).find((h) => h.prims[0]!.name === '[LS]helper 0')!
    const s0 = h0.allScripts()[0]!
    expect(s0.text?.text).toBe('SITTER 0\n▽')
    expect(helperSaid(s0)[0]).toBe('REG|0')
    const p = h0.prims[0]!.params.position
    expect([p.x, p.y, p.z].map((v) => Math.round(v * 100) / 100)).toEqual([128, 128.5, 25.5])
    // sitter 1's label is lower down, so two labels at one spot can be read
    const s1 = helpers(f).find((h) => h.prims[0]!.name === '[LS]helper 1')!.allScripts()[0]!
    expect(s1.text?.text).toBe('SITTER 1\n▽\n \n ')
  })

  it('the helper of a one-prim furniture is labelled PRIM', async () => {
    const f = await workshop()
    helperMode(f)
    expect(helperScript(f).text?.text).toBe('PRIM 0\n▽')
  })

  it('touching the helper opens the adjust menu for the owner', async () => {
    const f = await workshop()
    helperMode(f)
    const before = f.dialogsFor(owner).length
    helpers(f)[0]!.touch(1, { avatar: { key: owner.key, name: owner.name } })
    f.settle()
    expect(helperSaid(helperScript(f))).toContain(`MENU|0|${owner.key}`)
    expect(f.dialogsFor(owner).length).toBeGreaterThan(before)
    expect(f.lastDialog(owner).buttons).toContain('[NEW]')
  })

  it('the helper reports a move only when it was moved', async () => {
    const f = await workshop()
    helperMode(f)
    const s = helperScript(f)
    const moved = () => helperSaid(s).filter((t) => t.startsWith('MOVED|'))
    f.settle(2_000)
    const n = moved().length
    f.settle(2_000)
    expect(moved().length).toBe(n)
    const prim = helpers(f)[0]!.prims[0]!
    prim.params.position = { ...prim.params.position, x: prim.params.position.x + 0.5 }
    f.settle(500)
    expect(moved().length).toBe(n + 1)
    expect(moved().at(-1)).toMatch(/^MOVED\|0\|<128\.50000, 128\.00000, 25\.50000>\|/)
  })

  it('"/5 <avatar key>" from the sitter moves the helper to that avatar, when near', async () => {
    const f = await workshop()
    helperMode(f)
    const bob = f.avatar('Bob')
    const wb = f.world.avatars.find((a) => a.key === bob.key)!
    wb.position = { x: 130, y: 129, z: 25 }
    const s = helperScript(f)
    s.deliverChat({ channel: 5, name: owner.name, key: owner.key, message: bob.key })
    f.settle()
    const p = helpers(f)[0]!.prims[0]!.params.position
    expect([p.x, p.y, p.z]).toEqual([130, 129, 25])
  })

  it('"/5 <avatar key>": too far away, or not found', async () => {
    const f = await workshop()
    helperMode(f)
    const bob = f.avatar('Bob')
    f.world.avatars.find((a) => a.key === bob.key)!.position = { x: 200, y: 200, z: 25 }
    const s = helperScript(f)
    s.deliverChat({ channel: 5, name: owner.name, key: owner.key, message: bob.key })
    s.deliverChat({ channel: 5, name: owner.name, key: owner.key, message: '00000000-0000-0000-0000-00000000dead' })
    s.deliverChat({ channel: 5, name: owner.name, key: owner.key, message: 'not a key' })
    f.settle()
    expect(s.chat.filter((c) => c.to === owner.key).map((c) => c.text)).toEqual(['Avatar too far away.', 'Avatar not found nearby.'])
  })

  it('"/5 <avatar key>" from someone else than the sitter is ignored', async () => {
    const f = await workshop()
    helperMode(f)
    const bob = f.avatar('Bob')
    f.world.avatars.find((a) => a.key === bob.key)!.position = { x: 129, y: 128, z: 25 }
    const s = helperScript(f)
    const before = { ...helpers(f)[0]!.prims[0]!.params.position }
    s.deliverChat({ channel: 5, name: bob.name, key: bob.key, message: bob.key })
    f.settle()
    expect(helpers(f)[0]!.prims[0]!.params.position).toEqual(before)
  })

  it('SWAP renames the helpers of the two sitters', async () => {
    const f = await workshop(TWO, 2)
    helperMode(f)
    const named = (n: string) => helpers(f).find((h) => h.prims[0]!.name === n)!
    const h0 = named('[LS]helper 0')
    const h1 = named('[LS]helper 1')
    const furnitureKey = f.prims[0]!.key
    for (const h of [h0, h1]) {
      const s = h.allScripts()[0]!
      const chan = s.listens.find((l) => l.channel !== 5)!.channel
      s.deliverChat({ channel: chan, name: 'Furniture', key: furnitureKey, message: 'SWAP|5|6' }) // not these helpers
      s.deliverChat({ channel: chan, name: 'Furniture', key: furnitureKey, message: 'SWAP|0|1' })
    }
    f.settle()
    expect(h0.prims[0]!.name).toBe('[LS]helper 1')
    expect(h1.prims[0]!.name).toBe('[LS]helper 0')
    expect(helperSaid(h0.allScripts()[0]!).at(-1)).toBe('REG|1')
    expect(h0.allScripts()[0]!.text?.text).toBe('SITTER 1\n▽\n \n ')
  })

  it('DONE for its sitter removes the helper; DONE for another sitter does not', async () => {
    const f = await workshop(TWO, 2)
    helperMode(f)
    const h0 = helpers(f).find((h) => h.prims[0]!.name === '[LS]helper 0')!
    const s = h0.allScripts()[0]!
    const chan = s.listens.find((l) => l.channel !== 5)!.channel
    s.deliverChat({ channel: chan, name: 'Furniture', key: f.prims[0]!.key, message: 'DONE|1' })
    f.settle()
    expect(h0.dead).toBeFalsy()
    s.deliverChat({ channel: chan, name: 'Furniture', key: f.prims[0]!.key, message: 'DONE|0' })
    f.settle()
    expect(h0.dead).toBe(true)
  })

  it('messages from objects of another owner are ignored', async () => {
    const f = await workshop()
    helperMode(f)
    const s = helperScript(f)
    const chan = s.listens.find((l) => l.channel !== 5)!.channel
    const bob = f.avatar('Bob')
    s.deliverChat({ channel: chan, name: 'Bob', key: bob.key, message: 'DONEA' })
    f.settle()
    expect(helpers(f)).toHaveLength(1)
  })

  it('sitting on the helper is refused, with a hint, unless the old helper method is on', async () => {
    const f = await workshop()
    helperMode(f)
    const bob = f.avatar('Bob')
    const wb = f.world.avatars.find((a) => a.key === bob.key)!
    const prim = helpers(f)[0]!.prims[0]!
    expect(f.world.sitAvatar(wb, prim)).toBeTruthy()
    f.settle()
    const s = helperScript(f)
    expect(s.callsOf('llUnSit').map((c) => String(c.args[0]))).toEqual([bob.key])
    expect(s.dialogs.at(-1)!.message).toContain('Do not sit on the helper with LuaSitter unless you have enabled the old helper mode.')
  })

  it('a legacy "[AV]helper" keeps its name', async () => {
    const f = await workshop(ONE, 1, '[AV]helper')
    helperMode(f)
    expect(helpers(f).map((h) => h.prims[0]!.name)).toEqual(['[AV]helper 0'])
  })
})

describe('LuaSitter2 [LS]helperscript old helper method (HELPER 1)', () => {
  async function oldMethod() {
    const f = await workshop(`HELPER 1\n${ONE}`)
    // with HELPER 1 the sitter is unseated: helper mode is started by "/5 helper" before that
    f.click(owner, '[ADJUST]')
    f.click(owner, '[HELPER]')
    f.settle(3_000)
    return f
  }

  it('[HELPER] unseats the sitters, and the helper can be sat on', async () => {
    const f = await oldMethod()
    expect(f.script('[LS]adjuster').callsOf('llUnSit').map((c) => String(c.args[0]))).toContain(owner.key)
    const s = helperScript(f)
    // POS|n|pos|rot|1|key: the old method makes the helper sit-on-click
    expect(s.callsOf('llSetClickAction').map((c) => c.args[0])).toContain(1) // CLICK_ACTION_SIT
  })

  it('sitting on the helper animates the sitter (ANIMA), standing up stops it (GETUP)', async () => {
    const f = await oldMethod()
    const s = helperScript(f)
    const prim = helpers(f)[0]!.prims[0]!
    const wo = f.world.avatars.find((a) => a.key === owner.key)!
    if (wo.sittingOn) f.world.standAvatar(wo)
    f.settle()
    expect(f.world.sitAvatar(wo, prim)).toBeTruthy()
    f.settle()
    expect(s.permissionRequests.at(-1)!.agent).toBe(owner.key)
    s.grantPermissions()
    f.settle()
    expect(s.callsOf('llStopAnimation').map((c) => String(c.args[0]))).toContain('sit')
    expect(helperSaid(s)).toContain(`ANIMA|${owner.key}`)
    expect(f.linked()).toContainEqual({ num: 90075, str: '0', id: owner.key })
    f.world.standAvatar(wo)
    f.settle()
    expect(helperSaid(s)).toContain('GETUP')
    expect(f.linked().some((m) => m.num === 90076 && m.str === '0')).toBe(true)
  })

  it('ending helper mode with someone on the helper stops their animations and stands them up first', async () => {
    const f = await oldMethod()
    const s = helperScript(f)
    const h = helpers(f)[0]!
    const wo = f.world.avatars.find((a) => a.key === owner.key)!
    if (wo.sittingOn) f.world.standAvatar(wo)
    f.settle()
    f.world.sitAvatar(wo, h.prims[0]!)
    f.settle()
    s.grantPermissions()
    f.settle()
    s.setAnimationState(owner.key, 'Sitting')
    // the helper stops the uuids from llGetAnimationList: Second Life's ll.StopAnimation takes
    // a string or a uuid, rezless only a string, so the list is given as strings here
    s.mock('llGetAnimationList', () => ['sit_generic'])
    const stopped: string[] = []
    s.mock('llStopAnimation', (_ctx, args) => { stopped.push(String(args[0])) })
    const chan = s.listens.find((l) => l.channel !== 5 && l.channel !== -2907539)!.channel
    s.deliverChat({ channel: chan, name: 'Furniture', key: f.prims[0]!.key, message: 'DONEA' })
    f.settle()
    expect(stopped).toEqual(['sit_generic'])
    expect(helperSaid(s).at(-1)).toBe('GETUP')
    expect(h.dead).toBe(true)
  })
})

describe('LuaSitter2 [LS]helperscript rezzed by hand', () => {
  it('with start parameter 0 (rezzed by hand) it clears its label, shrinks to a ball and stops reporting moves', async () => {
    const f = await workshop()
    helperMode(f)
    const h = helpers(f)[0]!
    const s = h.allScripts()[0]!
    // an original helper: its script made by the object's creator (rezless leaves the item creator empty)
    s.mock('llGetInventoryCreator', () => OWNER)
    s.fire('on_rez', { start_param: 0 })
    f.settle()
    expect(s.text?.text).toBe('')
    const size = s.callsOf('llSetLinkPrimitiveParamsFast').at(-1)!.args[1] as unknown[]
    expect(size[0]).toBe(PRIM_SIZE)
    const v = size[1] as { x: number; y: number; z: number }
    expect([v.x, v.y, v.z].map((n) => Math.round(n * 1000) / 1000)).toEqual([0.2, 0.2, 0.2])
    const moved = () => helperSaid(s).filter((t) => t.startsWith('MOVED|')).length
    const n = moved()
    const prim = h.prims[0]!
    prim.params.position = { ...prim.params.position, x: prim.params.position.x + 1 }
    f.settle(1_000)
    expect(moved()).toBe(n)
  })
})

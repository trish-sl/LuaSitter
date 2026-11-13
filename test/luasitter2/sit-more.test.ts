// LuaSitter2: more of [LS]sit: animation sequences in a POSE line, Softer/Harder
// speed variants, ADJUST and BRAND lines, Position/Rotation steps of the personal
// adjust menu, gender (POSE ...|M / F first poses, SET -1 seats by gender), prim
// descriptions choosing sit targets, DFLT, the hip fix animation, KFM, a sitter
// name from its own "LSpos sitter N" card, and the plugin link messages
// 90005 (submenu), 90011, 90033, 90075 / 90076, 90203, 90298.
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS, OWNER, REGION } from '../helpers/furniture.js'
import type { Avatar, Furniture } from '../helpers/furniture.js'

const PRIM_TEXT = 26
const PRIM_ROT_LOCAL = 29
const KFM_COMMAND = 0
const KFM_CMD_PLAY = 0
const KFM_CMD_PAUSE = 2

async function chair(card: string, opts: { animations?: string[]; scripts?: string[]; placeholders?: string[]; prims?: number; notecards?: Record<string, string> } = {}) {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: opts.scripts ?? ['[LS]sit'],
    placeholders: opts.placeholders,
    prims: opts.prims,
    notecards: { LSpos: card, ...(opts.notecards ?? {}) },
    animations: opts.animations ?? ['anim1', 'anim2', 'anim3'],
  })
  f.start()
  return f
}

let genderCounter = 0
/** An avatar with a male (1) or female (0) body shape (OBJECT_BODY_SHAPE_TYPE). */
function gendered(f: Furniture, name: string, male: boolean): Avatar {
  genderCounter += 1
  const key = `00000000-0000-0000-0000-00000000f${genderCounter.toString(16).padStart(3, '0')}`
  f.world.addAvatar({ region: REGION, key, username: `${name.toLowerCase()}.resident`, name: `${name} Resident`, visualParams: { 80: male ? 1 : 0 } })
  return { key, name: `${name} Resident` }
}

/** The last local rotation [LS]sit gave its sitter, as a quaternion. */
function lastRotation(f: Furniture, script = '[LS]sit'): unknown {
  const calls = f.script(script).callsOf('llSetLinkPrimitiveParamsFast')
  for (let i = calls.length - 1; i >= 0; i--) {
    const rules = calls[i]!.args[1] as unknown[]
    const at = rules.indexOf(PRIM_ROT_LOCAL)
    if (at >= 0) return JSON.stringify(rules[at + 1])
  }
  return null
}

describe('LuaSitter2 [LS]sit: animations', () => {
  it('a POSE with an animation sequence plays each animation for its time, then starts over', async () => {
    const f = await chair('SITTER 0\nPOSE Walk|anim1|2|anim2|3\n{Walk}<0,0,0.5><0,0,0>')
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.playing(alice)).toEqual(['anim1'])
    // anim2 starts 2 s after anim1, which stops 1 s later
    f.settle(3_000)
    expect(f.playing(alice)).toEqual(['anim2'])
    // 3 s later anim1 again
    f.settle(3_000)
    expect(f.playing(alice)).toEqual(['anim1'])
  })

  it('Softer / Harder play the "-" and "+" variants of the animation, and the menu says so', async () => {
    const f = await chair('SITTER 0\nTOMENU Dances\nMENU Dances|V\nPOSE Slow|anim1\n{Slow}<0,0,0.5><0,0,0>', {
      animations: ['anim1', 'anim1+', 'anim1-'],
    })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Dances*')
    f.click(alice, 'Slow')
    const menu = f.lastDialog(alice)
    expect(menu.buttons).toEqual(expect.arrayContaining(['<< Softer', 'Harder >>', 'Slow']))
    expect(menu.buttons).toContain(' ') // a V menu is padded, so the buttons don't move
    f.click(alice, 'Harder >>')
    f.settle(1_000)
    expect(f.playing(alice)).toEqual(['anim1+'])
    expect(f.lastDialog(alice).message).toContain('[Slow, Hard]')
    f.click(alice, '<< Softer')
    f.click(alice, '<< Softer')
    f.settle(1_000)
    expect(f.playing(alice)).toEqual(['anim1-'])
    expect(f.lastDialog(alice).message).toContain('[Slow, Soft]')
    f.click(alice, '<< Softer') // already the softest
    f.settle(1_000)
    expect(f.playing(alice)).toEqual(['anim1-'])
  })

  it('plays the hip fix animation LShipfix, else AVhipfix, when a sitter sits', async () => {
    const card = 'SITTER 0\nPOSE Sit|anim1\n{Sit}<0,0,0.5><0,0,0>'
    const ls = await chair(card, { animations: ['anim1', 'LShipfix', 'AVhipfix'] })
    const alice = ls.avatar('Alice')
    ls.sit(alice)
    expect(ls.playing(alice).sort()).toEqual(['LShipfix', 'anim1'])

    const av = await chair(card, { animations: ['anim1', 'AVhipfix'] })
    const bob = av.avatar('Bob')
    av.sit(bob)
    expect(av.playing(bob).sort()).toEqual(['AVhipfix', 'anim1'])
  })

  it('90075 animates an avatar for an old-style helper, 90076 stops it', async () => {
    const f = await chair('SITTER 0\nPOSE Sit|anim1\n{Sit}<0,0,0.5><0,0,0>')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.sendLinked('[LS]sit', 90076, '0', '')
    expect(f.playing(alice)).toEqual([])
    expect(f.linked()).toContainEqual({ num: 90065, str: '0', id: alice.key })
    f.sendLinked('[LS]sit', 90075, '0', alice.key)
    expect(f.script('[LS]sit').permissionRequests.at(-1)!.agent).toBe(alice.key)
  })
})

describe('LuaSitter2 [LS]sit: menus', () => {
  it('BRAND replaces the menu title', async () => {
    const f = await chair('BRAND Cosy Chair\nSITTER 0\nPOSE Sit|anim1\nPOSE Lean|anim2\n{Sit}<0,0,0.5><0,0,0>\n{Lean}<0,0,0.5><0,0,0>')
    const alice = f.avatar('Alice')
    f.sit(alice)
    const d = f.lastDialog(alice)
    expect(d.message.startsWith('Cosy Chair\n\n')).toBe(true)
    expect(d.message).not.toContain('LuaSitter')
  })

  it('ADJUST buttons appear in the adjust menu and send their link message', async () => {
    const f = await chair('ADJUST Lights|90500|Music|90501\nSITTER 0\nPOSE Sit|anim1\n{Sit}<0,0,0.5><0,0,0>')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, '[ADJUST]')
    const d = f.lastDialog(alice)
    expect(d.message).toContain('Adjust:')
    expect(d.buttons).toEqual(expect.arrayContaining(['[BACK]', 'Lights', 'Music', '[POSE]']))
    f.click(alice, 'Music')
    expect(f.linked()).toContainEqual({ num: 90501, str: 'Music', id: alice.key })
    // [POSE] opens the personal adjust menu
    f.touch(alice)
    f.click(alice, '[ADJUST]')
    f.click(alice, '[POSE]')
    expect(f.lastDialog(alice).message).toContain('Personal adjustment:')
  })

  it('90203 (a texture plugin) adds [TEXTURE] to the adjust menu', async () => {
    const f = await chair('SITTER 0\nPOSE Sit|anim1\n{Sit}<0,0,0.5><0,0,0>')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.sendLinked('[LS]sit', 90203, '', '')
    f.click(alice, '[ADJUST]')
    expect(f.lastDialog(alice).buttons).toEqual(expect.arrayContaining(['[BACK]', '[TEXTURE]', '[POSE]']))
    f.click(alice, '[TEXTURE]')
    expect(f.linked()).toContainEqual({ num: 90100, str: `0|[TEXTURE]|${alice.key}|0`, id: alice.key })
  })

  it('90005 with a submenu name opens that submenu', async () => {
    const f = await chair('SITTER 0\nPOSE Sit|anim1\nMENU Dances\nPOSE Slow|anim2\nPOSE Fast|anim3\n{Sit}<0,0,0.5><0,0,0>')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.sendLinked('[LS]sit', 90005, 'Dances', alice.key)
    expect(f.lastDialog(alice).buttons).toEqual(expect.arrayContaining(['[BACK]', 'Slow', 'Fast']))
    expect(f.lastDialog(alice).buttons).not.toContain('Sit')
  })

  it('90033 closes the menus: a click on an open menu does nothing', async () => {
    const f = await chair('SITTER 0\nPOSE Sit|anim1\nPOSE Lean|anim2\n{Sit}<0,0,0.5><0,0,0>\n{Lean}<0,0,0.5><0,0,0>')
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.script('[LS]sit').listens.length).toBeGreaterThan(0)
    f.sendLinked('[LS]sit', 90033, '', '')
    expect(f.script('[LS]sit').listens).toEqual([])
  })

  it('a sitter\'s own "LSpos sitter N" card gives the name shown in its menu', async () => {
    const card = 'SITTER 0|Left\nPOSE Sit|anim1\n{Sit}<0,0.3,0.5><0,0,0>\nSITTER 1|Right\nPOSE Sit|anim1\n{Sit}<0,-0.3,0.5><0,0,0>'
    const f = await chair(card, {
      scripts: ['[LS]sit', '[LS]sit 1'],
      prims: 2,
      notecards: { 'LSpos sitter 1': 'SITTER 1|Captain\nPOSE Own|anim2\nPOSE Own2|anim3\n{Own}<0,-0.3,0.5><0,0,0>' },
    })
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    expect(f.playing(bob)).toEqual(['anim2'])
    const d = f.lastDialog(bob)
    expect(d.message).toContain('[Captain]')
    expect(d.buttons).toEqual(expect.arrayContaining(['Own', 'Own2']))
  })
})

describe('LuaSitter2 [LS]sit: personal adjust', () => {
  it('Position / Rotation switches what X+ ... Z- change, and the step button cycles the step', async () => {
    const f = await chair('SITTER 0\nPOSE Sit|anim1\n{Sit}<0,0,0.5><0,0,0>')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, '[ADJUST]')
    let d = f.lastDialog(alice)
    expect(d.buttons).toEqual(expect.arrayContaining(['Position', '0.05m']))
    f.click(alice, '0.05m')
    expect(f.lastDialog(alice).buttons).toContain('0.25m')
    f.click(alice, '0.25m')
    expect(f.lastDialog(alice).buttons).toContain('0.01m')
    f.click(alice, 'Position')
    d = f.lastDialog(alice)
    expect(d.buttons).toEqual(expect.arrayContaining(['Rotation', '1°']))
    const before = lastRotation(f)
    f.click(alice, 'Z+')
    expect(lastRotation(f)).not.toBe(before)
    f.click(alice, '1°')
    expect(f.lastDialog(alice).buttons).toContain('5°')
    f.click(alice, 'Rotation')
    expect(f.lastDialog(alice).buttons).toEqual(expect.arrayContaining(['Position', '0.05m']))
  })

  it('with [LS]commands, the keys menu shows Rotation too', async () => {
    const f = await chair('SITTER 0\nPOSE Sit|anim1\n{Sit}<0,0,0.5><0,0,0>', { scripts: ['[LS]sit', '[LS]commands'] })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, '[ADJUST]')
    f.click(alice, 'Position')
    expect(f.lastDialog(alice).buttons).toEqual(expect.arrayContaining(['Rotation', '5°', 'Keys']))
  })
})

describe('LuaSitter2 [LS]sit: gender', () => {
  const CARD = `SITTER 0
POSE Sit|anim1
POSE ManSit|anim2|M
POSE LadySit|anim3|F
{Sit}<0,0,0.5><0,0,0>
{ManSit}<0,0,0.5><0,0,0>
{LadySit}<0,0,0.5><0,0,0>`

  it('a POSE marked M or F is the first pose for a male or female sitter', async () => {
    const f = await chair(CARD)
    const him = gendered(f, 'Him', true)
    f.sit(him)
    expect(f.playing(him)).toEqual(['anim2'])
    f.stand(him)
    const her = gendered(f, 'Her', false)
    f.sit(her)
    expect(f.playing(her)).toEqual(['anim3'])
  })

  it('by default (SET -1) seats each sitter on the seat of their gender, whatever the order they sit in', async () => {
    const f = await chair(`
SITTER 0|Him|M
POSE Sit|anim1
{Sit}<0,0.3,0.5><0,0,0>
SITTER 1|Her|F
POSE Sit|anim2
{Sit}<0,-0.3,0.5><0,0,0>`, { scripts: ['[LS]sit', '[LS]sit 1'], prims: 2 })
    const her = gendered(f, 'Her', false)
    const him = gendered(f, 'Him', true)
    f.sit(her) // sits first, but the F seat is sitter 1
    expect(f.playing(her)).toEqual(['anim2'])
    expect(f.linked()).toContainEqual({ num: 90060, str: '1', id: her.key })
    f.sit(him)
    expect(f.playing(him)).toEqual(['anim1'])
    expect(f.linked()).toContainEqual({ num: 90060, str: '0', id: him.key })
  })

  it('by default (SET -1), without a seat of their gender: the first free seat with no gender', async () => {
    const f = await chair(`
SITTER 0|Her|F
POSE Sit|anim1
{Sit}<0,0.3,0.5><0,0,0>
SITTER 1|Anyone
POSE Sit|anim2
{Sit}<0,-0.3,0.5><0,0,0>`, { scripts: ['[LS]sit', '[LS]sit 1'], prims: 2 })
    const him = gendered(f, 'Him', true)
    f.sit(him)
    expect(f.playing(him)).toEqual(['anim2'])
  })
})

describe('LuaSitter2 [LS]sit: sit targets', () => {
  const COUPLE = `SITTER 0
POSE Sit|anim1
{Sit}<0,0.3,0.5><0,0,0>
SITTER 1
POSE Sit|anim2
{Sit}<0,-0.3,0.5><0,0,0>`

  it('with SET 0, prim descriptions "0-SITTER" choose which prim holds each sitter\'s sit target', async () => {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]sit', '[LS]sit 1'],
      prims: 3,
      notecards: { LSpos: `SET 0\n${COUPLE}` },
      animations: ['anim1', 'anim2'],
    })
    ;(f.prims[1] as unknown as { description: string }).description = 'seat#0-1' // link 2: sitter 1 (after "#")
    ;(f.prims[2] as unknown as { description: string }).description = '0-0' // link 3: sitter 0
    f.start()
    const target = (script: string) => f.script(script).callsOf('llLinkSitTarget').at(-1)!.args[0]
    expect(target('[LS]sit')).toBe(3)
    expect(target('[LS]sit 1')).toBe(2)
    const alice = f.avatar('Alice')
    f.sit(alice, 3)
    expect(f.playing(alice)).toEqual(['anim1'])
  })

  it('90298 (/5 targets) shows "SET-SITTER" over each sit target prim for 5 seconds', async () => {
    const f = await chair(COUPLE, { scripts: ['[LS]sit', '[LS]sit 1'], prims: 2, animations: ['anim1', 'anim2'] })
    f.broadcast(90298, '', '')
    const texts = (script: string) => f.script(script).callsOf('llSetLinkPrimitiveParamsFast')
      .filter((c) => (c.args[1] as unknown[])[0] === PRIM_TEXT)
      .map((c) => [c.args[0], (c.args[1] as unknown[])[1]])
    // SET is -1 by default
    expect(texts('[LS]sit')).toEqual([[1, '-1-0']])
    expect(texts('[LS]sit 1')).toEqual([[2, '-1-1']])
    f.settle(5_000)
    expect(texts('[LS]sit').at(-1)).toEqual([1, ''])
  })

  it('90011 sets the camera of the sit prim', async () => {
    const f = await chair(COUPLE, { animations: ['anim1', 'anim2'] })
    f.sendLinked('[LS]sit', 90011, '<0,0,2>', '<1,0,0>')
    const call = f.script('[LS]sit').callsOf('llSetLinkCamera').at(-1)!
    expect(JSON.stringify(call.args.slice(1))).toBe(JSON.stringify([{ x: 0, y: 0, z: 2 }, { x: 1, y: 0, z: 0 }]))
  })

  it('warns the owner when there are fewer prims than sitters, unless WARN 0', async () => {
    const owner = { key: OWNER, name: 'Owner Resident' }
    const warning = "There aren't enough prims for required SitTargets."
    const f = await chair(COUPLE, { scripts: ['[LS]sit', '[LS]sit 1'], prims: 1, animations: ['anim1', 'anim2'] })
    expect(f.dialogsFor(owner).some((d) => d.message.includes(warning))).toBe(true)
    // when someone sits, the owner is warned again instead of the sitter getting the menu (as AVsitter)
    const alice = f.avatar('Alice')
    const before = f.dialogsFor(owner).length
    f.sit(alice)
    expect(f.dialogsFor(owner).length).toBeGreaterThan(before)
    expect(f.dialogsFor(alice)).toEqual([])

    const quiet = await chair(`WARN 0\n${COUPLE}`, { scripts: ['[LS]sit', '[LS]sit 1'], prims: 1, animations: ['anim1', 'anim2'] })
    expect(quiet.dialogsFor(owner).some((d) => d.message.includes(warning))).toBe(false)
  })
})

describe('LuaSitter2 [LS]sit: DFLT and keyframed motion', () => {
  const CARD = (settings: string) => `${settings}
SITTER 0
POSE Sit1|anim1
POSE Sit2|anim2
{Sit1}<0,0,0.5><0,0,0>
{Sit2}<0,0,0.6><0,0,0>`

  it('by default the next sitter gets the first pose; with DFLT 0, the last pose', async () => {
    const keep = await chair(CARD('DFLT 0'))
    const alice = keep.avatar('Alice')
    const bob = keep.avatar('Bob')
    keep.sit(alice)
    keep.click(alice, 'Sit2')
    keep.stand(alice)
    keep.sit(bob)
    expect(keep.playing(bob)).toEqual(['anim2'])

    const dflt = await chair(CARD(''))
    const carol = dflt.avatar('Carol')
    const dave = dflt.avatar('Dave')
    dflt.sit(carol)
    dflt.click(carol, 'Sit2')
    dflt.stand(carol)
    dflt.sit(dave)
    expect(dflt.playing(dave)).toEqual(['anim1'])
  })

  it('KFM 1 pauses the keyframed motion while the sitter is moved, then plays it again', async () => {
    const f = await chair(CARD('KFM 1'))
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    f.settle(1_000)
    const kfm = f.script('[LS]sit').callsOf('llSetKeyframedMotion').map((c) => (c.args[1] as number[])[1])
    expect(kfm.length).toBeGreaterThanOrEqual(2)
    expect(kfm.at(-2)).toBe(KFM_CMD_PAUSE)
    expect(kfm.at(-1)).toBe(KFM_CMD_PLAY)
    expect((f.script('[LS]sit').callsOf('llSetKeyframedMotion').at(-1)!.args[1] as number[])[0]).toBe(KFM_COMMAND)
  })

  it('KFM 2 waits 0.4 s before pausing the motion', async () => {
    const f = await chair(CARD('KFM 2'))
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.settle(1_000)
    const calls = () => f.script('[LS]sit').callsOf('llSetKeyframedMotion').length
    const before = calls()
    f.sendLinked('[LS]sit', 90057, '0', '<0,0,0.7>|<0,0,0>') // the helper moved
    // sendLinked settles 1 s: the pause (after 0.4 s) and the play (0.2 s later) have run
    expect(calls()).toBe(before + 2)
  })
})

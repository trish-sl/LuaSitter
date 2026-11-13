// LuaSitter2: the [LS]commands plugin: chat commands from sitters (for gestures),
// arrow-key pose adjusting ("Keys" in the adjust menu), and the rules that keep
// commands within what the menus allow (root-security, RLV seats, AMENU, SWAP).
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS, OWNER } from '../helpers/furniture.js'
import type { Furniture, Avatar } from '../helpers/furniture.js'

const CONTROL_FWD = 0x1
const CONTROL_LEFT = 0x4
const CONTROL_UP = 0x10
const CONTROL_ROT_LEFT = 0x100

const COUPLE = (settings = '') => `${settings}
SITTER 0
POSE Sit1|anim1
POSE Sit2|anim2
POSE Sit3|anim3
{Sit1}<0,0.3,0.5><0,0,0>
{Sit2}<0,0.3,0.5><0,0,0>
{Sit3}<0,0.3,0.5><0,0,0>
SITTER 1
POSE Sit1|anim1
POSE Sit2|anim2
POSE Sit3|anim3
{Sit1}<0,-0.3,0.5><0,0,0>
{Sit2}<0,-0.3,0.5><0,0,0>
{Sit3}<0,-0.3,0.5><0,0,0>`

async function furniture(settings = '', extra: string[] = ['[LS]commands']) {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]sit', '[LS]sit 1', ...extra],
    prims: 2,
    notecards: { LSpos: COUPLE(settings) },
    animations: ['anim1', 'anim2', 'anim3'],
  })
  f.start()
  return f
}

const told = (f: Furniture, av: Avatar) =>
  f.script('[LS]commands').chat.filter((c) => c.to?.toLowerCase() === av.key).map((c) => c.text)

/** Where [LS]sit last placed its sitter (llSetLinkPrimitiveParamsFast position). */
function lastPlacement(f: Furniture, script = '[LS]sit'): string {
  const calls = f.script(script).callsOf('llSetLinkPrimitiveParamsFast')
  return JSON.stringify(calls.at(-1)?.args ?? null)
}

describe('LuaSitter2 [LS]commands: chat commands', () => {
  it('without the plugin nothing listens and the adjust menu is unchanged', async () => {
    const f = await furniture('', [])
    const alice = f.avatar('Alice')
    f.sit(alice)
    for (const s of Object.values(f.scripts)) {
      expect(s.listens.filter((l) => l.channel === 1888)).toEqual([])
    }
    f.click(alice, '[ADJUST]')
    expect(f.lastDialog(alice).buttons).toContain('[SAVE ALL]')
    expect(f.lastDialog(alice).buttons).not.toContain('Keys')
  })

  it('"menu" gives the sitter the pose menu; only seated sitters are heard', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    const before = f.dialogsFor(alice).length
    f.say(alice, 1888, 'menu')
    expect(f.dialogsFor(alice).length).toBe(before + 1)
    expect(f.lastDialog(alice).buttons).toContain('Sit2')
    f.say(bob, 1888, 'menu') // not sitting
    expect(f.dialogsFor(bob)).toHaveLength(0)
  })

  it('"next" and "prev" step through the poses of the menu, wrapping around', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.playing(alice)).toEqual(['anim1'])
    f.say(alice, 1888, 'next')
    f.settle(1_000)
    expect(f.playing(alice)).toEqual(['anim2'])
    f.say(alice, 1888, 'prev')
    f.say(alice, 1888, 'prev')
    f.settle(1_000)
    expect(f.playing(alice)).toEqual(['anim3'])
  })

  it('"adjust" opens the personal adjust menu, "swap" swaps the sitters', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.say(alice, 1888, 'adjust')
    expect(f.lastDialog(alice).message).toContain('Personal adjustment:')
    f.say(alice, 1888, 'swap')
    f.settle(2_000)
    expect(f.linked()).toContainEqual({ num: 90030, str: '0', id: '1' })
  })

  it('"help" lists the commands; unknown and unavailable commands say so', async () => {
    const f = await furniture('AMENU 0\nSWAP 0')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.say(alice, 1888, 'help')
    f.say(alice, 1888, 'dance')
    f.say(alice, 1888, 'adjust')
    f.say(alice, 1888, 'rlv')
    const text = told(f, alice).join('\n')
    expect(text).toContain('Commands on channel 1888: menu, adjust, keys, swap, next, prev, rlv, help.')
    expect(text).toContain('Unknown command "dance"')
    expect(text).toContain('"adjust" is not available here.')
    expect(text).toContain('"rlv" is not available here.')
  })

  it('COMMANDS sets the channel, COMMANDS 0 turns the commands off', async () => {
    const f = await furniture('COMMANDS 77')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.say(alice, 1888, 'next')
    f.say(alice, 77, 'next')
    f.settle(1_000)
    expect(f.playing(alice)).toEqual(['anim2'])

    const off = await furniture('COMMANDS 0')
    const bob = off.avatar('Bob')
    off.sit(bob)
    expect(off.script('[LS]commands').listens).toHaveLength(0)
  })

  it('opens one listen per seated sitter, filtered on their key, and closes it when they stand', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    const open = () => f.script('[LS]commands').listens.filter((l) => l.channel === 1888 && l.active !== false)
    expect(open().map((l) => String(l.key).toLowerCase()).sort()).toEqual([alice.key, bob.key].sort())
    f.stand(alice)
    expect(open().map((l) => String(l.key).toLowerCase())).toEqual([bob.key])
  })

  it('answers the DUMP chain with its COMMANDS line', async () => {
    const f = await furniture('COMMANDS 77')
    f.sendLinked('[LS]commands', 90020, '0', '[LS]commands')
    expect(f.linked()).toContainEqual({ num: 90022, str: 'COMMANDS 77', id: '0' })
    expect(f.linked()).toContainEqual({ num: 90021, str: '0', id: '[LS]commands' })
  })
})

describe('LuaSitter2 [LS]commands: keys', () => {
  async function adjusting() {
    const f = await furniture()
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, '[ADJUST]')
    return { f, alice }
  }

  it('the adjust menu has "Keys" instead of [SAVE ALL]; [SAVE] then asks which', async () => {
    const { f, alice } = await adjusting()
    const d = f.lastDialog(alice)
    expect(d.buttons).toContain('Keys')
    expect(d.buttons).not.toContain('[SAVE ALL]')
    f.click(alice, '[SAVE]')
    expect(f.lastDialog(alice).buttons).toEqual(expect.arrayContaining(['[THIS POSE]', '[ALL POSES]']))
    f.click(alice, '[THIS POSE]')
    expect(f.script('[LS]sit').chat.map((c) => c.text)).toContain('Personal position saved for this pose.')
  })

  it('Keys takes the arrow keys: each press moves the pose one step; Keys again gives them back', async () => {
    const { f, alice } = await adjusting()
    f.click(alice, 'Keys')
    const cmd = f.script('[LS]commands')
    expect(cmd.controls).not.toBeNull()
    expect(f.lastDialog(alice).message).toContain('Personal adjustment:') // the menu stays open
    const before = lastPlacement(f)
    cmd.sendControl(CONTROL_FWD)
    cmd.sendControl(0)
    f.settle(500)
    expect(f.linked()).toContainEqual({ num: 90018, str: 'fwd', id: alice.key })
    const after = lastPlacement(f)
    expect(after).not.toBe(before)
    cmd.sendControl(CONTROL_UP | CONTROL_ROT_LEFT)
    cmd.sendControl(0)
    f.settle(500)
    expect(f.linked()).toContainEqual({ num: 90018, str: 'left|up', id: alice.key })
    f.click(alice, 'Keys')
    expect(cmd.controls).toBeNull()
    expect(told(f, alice)).toContain('Keys off.')
  })

  it('a held key repeats a few times per second; the seated left/right arrows count as left/right', async () => {
    const { f, alice } = await adjusting()
    f.click(alice, 'Keys')
    const cmd = f.script('[LS]commands')
    cmd.sendControl(CONTROL_ROT_LEFT)
    f.settle(100)
    const moves = () => f.linked().filter((m) => m.num === 90018).length
    expect(moves()).toBe(1)
    expect(f.linked().filter((m) => m.num === 90018).at(-1)!.str).toBe('left')
  })

  it('Shift+Left/Right (strafe) turn the pose; keys always move by the smallest step (0.01 m, 1°)', async () => {
    const { f, alice } = await adjusting()
    f.click(alice, 'Keys')
    const cmd = f.script('[LS]commands')
    cmd.sendControl(CONTROL_LEFT) // Shift+Left while seated
    cmd.sendControl(0)
    f.settle(500)
    expect(f.linked().filter((m) => m.num === 90018).at(-1)!.str).toBe('turnleft')
    // [LS]sit: placement = [link, [PRIM_ROT_LOCAL, rot, PRIM_POS_LOCAL, pos]]
    const placed = () => (f.script('[LS]sit').callsOf('llSetLinkPrimitiveParamsFast').at(-1)!.args[1] as unknown[])
    const rot = placed()[1] as { z: number }
    expect(rot.z).toBeCloseTo(Math.sin((1 * Math.PI) / 180 / 2), 4) // turned 1° around Z
    const pos0 = placed()[3] as { x: number }
    f.broadcast(90018, 'fwd', alice.key) // the menu step is 0.05 m, the key moves 0.01 m
    f.settle(300)
    expect((placed()[3] as { x: number }).x - pos0.x).toBeCloseTo(0.01, 5)
    f.broadcast(90018, 'turnright', alice.key)
    f.settle(300)
    expect((placed()[1] as { z: number }).z).toBeCloseTo(0, 4) // turned back
  })

  it('keys are given back after 60 s without a key, and on [BACK]', async () => {
    const { f, alice } = await adjusting()
    f.click(alice, 'Keys')
    const cmd = f.script('[LS]commands')
    f.settle(61_000)
    expect(cmd.controls).toBeNull()
    expect(told(f, alice)).toContain('Keys off (no key pressed for 60 s).')
    f.say(alice, 1888, 'keys') // the command works too
    expect(cmd.controls).not.toBeNull()
    f.say(alice, 1888, 'adjust')
    f.click(alice, '[BACK]')
    expect(cmd.controls).toBeNull()
  })
})

describe('LuaSitter2 [LS]commands: rules', () => {
  it('with [LS]root-security, a sitter without menu access is refused; "menu" works like a touch', async () => {
    const f = await furniture('', ['[LS]commands', '[LS]root-security'])
    const owner: Avatar = { key: OWNER, name: 'Owner Resident' }
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.say(alice, 1888, 'next')
    f.settle(1_000)
    expect(f.playing(alice)).toEqual(['anim2']) // default access: everyone
    expect(f.linked().some((m) => m.num === 90013 && m.str === 'next')).toBe(true)
    // the owner sets Menu access to OWNER
    f.sit(owner)
    f.touch(owner)
    f.click(owner, '[ADJUST]')
    f.click(owner, '[SECURITY]')
    f.click(owner, 'Menu')
    f.click(owner, 'OWNER')
    f.say(alice, 1888, 'next')
    f.settle(1_000)
    expect(f.playing(alice)).toEqual(['anim2'])
    expect(f.lastDialog(alice).message).toContain('Sorry, Menu access is set to')
  })

  it('in RLV furniture only a dominant seat may use commands other than "menu"', async () => {
    const f = await furniture('ROLES D|S', ['[LS]commands', '[LS]root-RLV', '[LS]root-control', '[LS]root-security'])
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice) // captured (ONSIT CAPTURE): moved to the S seat, sitter 1
    f.settle(3_000)
    f.sit(bob) // the D seat, sitter 0
    f.settle(3_000)
    expect(f.linked()).toContainEqual({ num: 90070, str: '1', id: alice.key })
    f.say(alice, 1888, 'next')
    expect(told(f, alice)).toContain('"next" is not available here.')
    f.say(bob, 1888, 'rlv')
    expect(f.linked().some((m) => m.num === 90100 && m.str === `0|Control...|${bob.key}`)).toBe(true)
  })
})

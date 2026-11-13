// LuaSitter2: more of the [LS]commands plugin: the "keys" command, held keys,
// keys given back when the sitter stands, "swap" with [LS]select / without a
// second seat / with ONSIT ASK, settings read from AVpos, ◆ lines and the NAK
// fallback, reloading when the notecard is edited, and messages it must ignore.
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS } from '../helpers/furniture.js'
import type { Furniture, Avatar } from '../helpers/furniture.js'

const NAK = '\n\x15\n'
const CONTROL_FWD = 0x1
const CONTROL_DOWN = 0x20

const SITTER = (n: number) => `SITTER ${n}
POSE Sit1|anim1
POSE Sit2|anim2
{Sit1}<0,0.3,0.5><0,0,0>
{Sit2}<0,0.3,0.5><0,0,0>`

async function furniture(settings = '', opts: { sitters?: number; extra?: string[]; name?: string; nak?: boolean } = {}) {
  const n = opts.sitters ?? 2
  const scripts = ['[LS]sit']
  const sections: string[] = []
  for (let i = 0; i < n; i++) {
    if (i > 0) scripts.push(`[LS]sit ${i}`)
    sections.push(SITTER(i))
  }
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: [...scripts, '[LS]commands', ...(opts.extra ?? [])],
    prims: n,
    notecards: { [opts.name ?? 'LSpos']: `${settings}\n${sections.join('\n')}` },
    animations: ['anim1', 'anim2'],
  })
  if (opts.nak) f.script('[LS]commands').mock('llGetNotecardLineSync', () => NAK)
  f.start()
  f.settle(2_000)
  return f
}

const told = (f: Furniture, av: Avatar) =>
  f.script('[LS]commands').chat.filter((c) => c.to?.toLowerCase() === av.key).map((c) => c.text)

const moves = (f: Furniture) => f.linked().filter((m) => m.num === 90018)

describe('LuaSitter2 [LS]commands: keys', () => {
  it('"keys" takes the arrow keys, and "keys" again gives them back', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    f.sit(alice)
    const cmd = f.script('[LS]commands')
    f.say(alice, 1888, 'keys')
    expect(cmd.controls).not.toBeNull()
    expect(told(f, alice).at(-1)).toMatch(/^Keys on: arrows and PgUp\/PgDn move your pose/)
    f.say(alice, 1888, 'keys')
    expect(cmd.controls).toBeNull()
    expect(told(f, alice).at(-1)).toBe('Keys off.')
  })

  it('a key held down moves the pose again after 0.3 s, not before', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.say(alice, 1888, 'keys')
    const cmd = f.script('[LS]commands')
    cmd.sendControl(CONTROL_DOWN) // pressed
    expect(moves(f)).toHaveLength(1)
    // still held (level set, no edge): too soon
    cmd.fire('control', { id: alice.key, level: CONTROL_DOWN, edge: 0 })
    expect(moves(f)).toHaveLength(1)
    f.settle(400)
    cmd.fire('control', { id: alice.key, level: CONTROL_DOWN, edge: 0 })
    expect(moves(f)).toHaveLength(2)
    expect(moves(f).at(-1)).toEqual({ num: 90018, str: 'down', id: alice.key })
    // released (level 0): nothing
    f.settle(400)
    cmd.fire('control', { id: alice.key, level: 0, edge: 0 })
    expect(moves(f)).toHaveLength(2)
  })

  it('ignores keys from another avatar, and keys before they are taken', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    const cmd = f.script('[LS]commands')
    cmd.fire('control', { id: alice.key, level: CONTROL_FWD, edge: CONTROL_FWD }) // keys not taken yet
    f.say(alice, 1888, 'keys')
    cmd.fire('control', { id: bob.key, level: CONTROL_FWD, edge: CONTROL_FWD })
    expect(moves(f)).toEqual([])
  })

  it('gives the keys back when their sitter stands up', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.say(alice, 1888, 'keys')
    const cmd = f.script('[LS]commands')
    expect(cmd.controls).not.toBeNull()
    f.stand(alice)
    expect(cmd.controls).toBeNull()
    expect(cmd.listens.filter((l) => l.channel === 1888)).toEqual([])
  })
})

describe('LuaSitter2 [LS]commands: swap', () => {
  it('with [LS]select, "swap" opens the seat menu', async () => {
    const f = await furniture('', { extra: ['[LS]select'] })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.say(alice, 1888, 'swap')
    expect(f.linked()).toContainEqual({ num: 90009, str: alice.key, id: alice.key })
    expect(f.lastDialog(alice).script).toBe('[LS]select')
  })

  it('"swap" is not available with one seat, or with ONSIT ASK', async () => {
    const one = await furniture('', { sitters: 1 })
    const alice = one.avatar('Alice')
    one.sit(alice)
    one.say(alice, 1888, 'swap')
    expect(told(one, alice)).toContain('"swap" is not available here.')

    const ask = await furniture('ONSIT ASK')
    const bob = ask.avatar('Bob')
    ask.sit(bob)
    ask.say(bob, 1888, 'swap')
    expect(told(ask, bob)).toContain('"swap" is not available here.')
    expect(ask.linked().some((m) => m.num === 90101 && m.str.includes('[SWAP]'))).toBe(false)
  })
})

describe('LuaSitter2 [LS]commands: settings', () => {
  const dumpLine = (f: Furniture) => {
    f.sendLinked('[LS]commands', 90020, '0', '[LS]commands')
    return f.linked().filter((m) => m.num === 90022).map((m) => m.str)
  }

  it('reads COMMANDS from AVpos when there is no LSpos', async () => {
    const f = await furniture('COMMANDS 42', { name: 'AVpos' })
    expect(dumpLine(f)).toEqual(['COMMANDS 42'])
  })

  it('reads lines with the ◆ prefix, and a COMMANDS line without a number means channel 1888', async () => {
    const f = await furniture('◆COMMANDS')
    expect(dumpLine(f)).toEqual(['COMMANDS 1888'])
    const g = await furniture('◆COMMANDS 9')
    expect(dumpLine(g)).toEqual(['COMMANDS 9'])
  })

  it('falls back to the dataserver reader when the fast reader answers NAK', async () => {
    const f = await furniture('COMMANDS 77', { nak: true })
    expect(f.script('[LS]commands').callsOf('llGetNotecardLine').length).toBeGreaterThan(0)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.say(alice, 77, 'next')
    f.settle(1_000)
    expect(f.playing(alice)).toEqual(['anim2'])
  })

  it('reads the notecard again when it is edited, not when another item changes', async () => {
    const f = await furniture('COMMANDS 77')
    f.setItem('anim3', 'animation')
    expect(dumpLine(f)).toEqual(['COMMANDS 77'])
    f.setNotecard('LSpos', `COMMANDS 55\n${SITTER(0)}\n${SITTER(1)}`)
    expect(dumpLine(f).at(-1)).toBe('COMMANDS 55')
  })

  it('ignores a command allowed back (90016) for someone who is not seated', async () => {
    const f = await furniture()
    const eve = f.avatar('Eve')
    f.sendLinked('[LS]commands', 90016, 'next', eve.key)
    expect(f.linked().some((m) => m.num === 90017)).toBe(false)
    expect(told(f, eve)).toEqual([])
  })
})

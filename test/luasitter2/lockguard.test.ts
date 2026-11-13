// LuaSitter2: [LS]LockGuard (LockGuard V2 chains) and [LS]LockGuard-object (ring prims
// in props). Basic link / unlink is in chains-updater.test.ts; this file covers missing
// rings, sitter changes, link messages from other prims, and the USES_PROPS setup with a
// ring prop rezzed by [LS]plugins.
//
// USES_PROPS, SITTER and POSES are settings a builder edits at the top of the script.
// The tests that need other settings load the real script with those lines changed.
// The changed copy gets a file name that does not exist on disk, so the coverage report
// leaves it out (a copy with other settings is a different file for coverage): the lines
// only those settings run stay uncovered in the report for the real script.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadScript } from '@rezless/vitest'
import { buildFurniture, LS2_SCRIPTS, LS2, OWNER } from '../helpers/furniture.js'
import type { Furniture } from '../helpers/furniture.js'

const LOCKGUARD = -9119
const COMM = -57841689
const LG_FILE = path.normalize(LS2_SCRIPTS['[LS]LockGuard']!)
const LG_OBJECT_FILE = path.normalize(LS2 + 'Plugins/LScontrol/LockGuard/[LS]LockGuard-object.luau')

const CARD = `SITTER 0
POSE arms|anim1
POSE cross|anim2
POSE free|anim3
{arms}<0,0,0.5><0,0,0>
{cross}<0,0,0.5><0,0,0>
{free}<0,0,0.5><0,0,0>`

/** The real script source with some setting lines replaced (each must exist once; the line count stays). */
function withSettings(file: string, changes: [string, string][]): string {
  let text = readFileSync(file, 'utf8')
  const lines = text.split('\n').length
  for (const [from, to] of changes) {
    if (text.split(from).length !== 2) throw new Error(`setting line not found once: ${from}`)
    text = text.replace(from, to)
  }
  if (text.split('\n').length !== lines) throw new Error('the line count changed')
  return text
}

const said = (f: Furniture, channel = LOCKGUARD) =>
  f.script('[LS]LockGuard').chat.filter((c) => c.channel === channel).map((c) => c.text)

/** [LS]sit + [LS]LockGuard (default settings), prims ring1 and ring2 (no ring3 / ring4). */
async function chained() {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]sit', '[LS]LockGuard'],
    prims: 3,
    primNames: { 2: 'ring1', 3: 'ring2' },
    notecards: { LSpos: CARD },
    animations: ['anim1', 'anim2', 'anim3'],
  })
  f.start()
  return f
}

describe('LuaSitter2 [LS]LockGuard (rings linked to the furniture)', () => {
  it('a pose that names a missing ring prim links only the cuffs whose ring exists', async () => {
    const f = await chained()
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'cross') // rightwrist ring1, leftwrist ring2, rightankle ring3, leftankle ring4
    const links = said(f).filter((t) => t.includes(' link '))
    const ring1 = f.prims[1]!.key
    expect(links.at(-2)).toMatch(new RegExp(`^lockguard ${alice.key} rightwrist link ${ring1} size 0.12`))
    expect(links.at(-1)).toMatch(new RegExp(`^lockguard ${alice.key} leftwrist link ${f.prims[2]!.key} `))
    expect(said(f).join('\n')).not.toContain('ankle link')
  })

  it('changing between two chained poses unlinks only the cuffs the new pose does not use', async () => {
    const f = await chained()
    const alice = f.avatar('Alice')
    f.sit(alice) // arms: rightwrist, leftwrist
    const before = said(f).length
    f.click(alice, 'cross') // keeps both wrists, adds the ankles (no rings for them)
    const now = said(f).slice(before)
    expect(now.filter((t) => t.endsWith(' unlink'))).toEqual([])
    f.click(alice, 'arms') // the ankles are dropped
    const back = said(f).slice(before + now.length)
    expect(back.filter((t) => t.endsWith(' unlink')).sort()).toEqual([
      `lockguard ${alice.key} leftankle unlink`,
      `lockguard ${alice.key} rightankle unlink`,
    ])
  })

  it('unlinks the chains when its sitter moves to another SITTER (90045 for another sitter number)', async () => {
    const f = await chained()
    const alice = f.avatar('Alice')
    f.sit(alice)
    const before = said(f).length
    f.sendLinked('[LS]LockGuard', 90045, '1|free|anim3|0|' + alice.key, alice.key)
    expect(said(f).slice(before).sort()).toEqual([
      `lockguard ${alice.key} leftwrist unlink`,
      `lockguard ${alice.key} rightwrist unlink`,
    ])
    // the chains are not unlinked twice when that sitter then stands
    f.sendLinked('[LS]LockGuard', 90065, '0', alice.key)
    expect(said(f).slice(before)).toHaveLength(2)
  })

  it('a new sitter in the seat: the old sitter\'s chains are unlinked first', async () => {
    const f = await chained()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    const before = said(f).length
    f.sendLinked('[LS]LockGuard', 90045, '0|arms|anim1|0|' + bob.key, bob.key)
    const now = said(f).slice(before)
    expect(now.slice(0, 2).sort()).toEqual([
      `lockguard ${alice.key} leftwrist unlink`,
      `lockguard ${alice.key} rightwrist unlink`,
    ])
    expect(now.slice(2).every((t) => t.startsWith(`lockguard ${bob.key} `) && t.includes(' link '))).toBe(true)
    expect(now).toHaveLength(4)
  })

  it('ignores 90045 / 90065 for another sitter number or avatar', async () => {
    const f = await chained()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    const before = said(f).length
    f.sendLinked('[LS]LockGuard', 90045, '1|arms|anim1|0|', bob.key) // another sitter, another avatar
    f.sendLinked('[LS]LockGuard', 90065, '1', bob.key) // someone else stands
    expect(said(f).slice(before)).toEqual([])
  })

  it('ignores link messages from scripts in other prims', async () => {
    const f = await chained()
    const alice = f.avatar('Alice')
    f.sit(alice)
    const before = said(f).length
    const lg = f.script('[LS]LockGuard')
    lg.fire('link_message', { sender_num: 2, num: 90065, str: '0', id: alice.key })
    f.settle()
    expect(said(f).slice(before)).toEqual([])
    f.sendLinked('[LS]LockGuard', 90065, '0', alice.key)
    expect(said(f).slice(before)).toHaveLength(2)
  })
})

describe('LuaSitter2 [LS]LockGuard with other settings', () => {
  /** Furniture with [LS]sit (and [LS]plugins); [LS]LockGuard loaded from `source` into the root prim. */
  async function custom(source: string, opts: { plugins?: boolean; props?: Record<string, string[]>; card?: string; prims?: number } = {}) {
    const f = await buildFurniture({
      sources: { ...LS2_SCRIPTS, '[LS]LockGuard-object': LG_OBJECT_FILE },
      scripts: ['[LS]sit', ...(opts.plugins ? ['[LS]plugins'] : [])],
      prims: opts.prims ?? 1,
      primNames: { 2: 'ring1', 3: 'ring2' },
      notecards: { LSpos: opts.card ?? CARD },
      animations: ['anim1', 'anim2', 'anim3'],
      objects: opts.props,
    })
    const filename = LG_FILE.replace(/\.luau$/, ' (settings changed by lockguard.test.ts).luau')
    const lg = await loadScript({ source, filename, host: f.prims[0]!, scriptName: '[LS]LockGuard', owner: OWNER })
    ;(f.scripts as Record<string, typeof lg>)['[LS]LockGuard'] = lg
    lg.start()
    f.start()
    return f
  }

  it('POSES "*" gives the chains of every pose not listed; SITTER -1 chains every sitter', async () => {
    const source = withSettings(LG_FILE, [
      ['local SITTER = 0\n', 'local SITTER = -1\n'],
      ['    ["upside"] = "rightwrist,ring2,leftwrist,ring1,leftankle,ring1,rightankle,ring2",',
        '    ["*"] = "leftankle,ring1",'],
    ])
    const f = await custom(source, { prims: 3 })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'free') // not in POSES
    expect(said(f).at(-1)).toMatch(new RegExp(`^lockguard ${alice.key} leftankle link ${f.prims[1]!.key} `))
    // with SITTER -1, a pose for SITTER 3 is chained too
    const bob = f.avatar('Bob')
    f.sendLinked('[LS]LockGuard', 90045, '3|arms|anim1|0|', bob.key)
    expect(said(f).at(-1)).toMatch(new RegExp(`^lockguard ${bob.key} leftwrist link `))
  })

  it('USES_PROPS: the rings of a prop rezzed by [LS]plugins ([LS]LockGuard-object inside) get the chains', async () => {
    const source = withSettings(LG_FILE, [['local USES_PROPS = false\n', 'local USES_PROPS = true\n']])
    const card = `${CARD}\nPROP arms|ring1|G1|<0,0,1>|<0,0,0>`
    const f = await custom(source, { plugins: true, card, props: { ring1: ['[LS]object', '[LS]LockGuard-object'] } })
    const alice = f.avatar('Alice')
    f.sit(alice) // arms: rezzes the prop "ring1"
    f.settle(3_000)
    const prop = f.rezzed().find((l) => l.prims[0]!.name === 'ring1')
    expect(prop).toBeDefined()
    // the furniture asked the prop for its rings, and the prop answered
    const lg = f.script('[LS]LockGuard')
    expect(lg.chat.filter((c) => c.channel === COMM).map((c) => [c.text, c.to])).toEqual([['INFORM', prop!.prims[0]!.key]])
    const answer = prop!.allScripts().find((s) => s.scriptName === '[LS]LockGuard-object')!
      .chat.filter((c) => c.channel === COMM).map((c) => c.text)
    expect(answer[0]).toMatch(new RegExp(`^ATTACHPOINTS\\|ring1\\|${prop!.prims[0]!.key}`))
    // the right wrist is chained to the prop's ring1; there is no ring2 in the prop
    const links = said(f).filter((t) => t.includes(' link '))
    expect(links).toHaveLength(1)
    expect(links[0]).toMatch(new RegExp(`^lockguard ${alice.key} rightwrist link ${prop!.prims[0]!.key} `))
  })
})

describe('LuaSitter2 [LS]LockGuard-object', () => {
  /** A prop with [LS]LockGuard-object, rezzed (on_rez) with a start parameter. */
  async function prop(startParameter: number, primName = 'ring1') {
    const f = await buildFurniture({
      sources: { '[LS]LockGuard-object': LG_OBJECT_FILE },
      scripts: ['[LS]LockGuard-object'],
      primNames: { 1: primName },
    })
    const s = f.script('[LS]LockGuard-object')
    s.mock('llGetStartParameter', () => startParameter)
    f.start()
    s.fire('on_rez', { start_param: startParameter })
    return { f, s }
  }
  const inform = (f: Furniture) =>
    f.linkset.deliverChat({ channel: COMM, name: 'Furniture', key: '00000000-0000-0000-0000-00000000f001', message: 'INFORM' })

  it('answers INFORM once with its ring prims', async () => {
    const { f, s } = await prop(-1234)
    inform(f)
    f.settle()
    const answers = s.chat.filter((c) => c.channel === COMM).map((c) => c.text)
    expect(answers).toHaveLength(1)
    expect(answers[0]).toMatch(new RegExp(`^ATTACHPOINTS\\|ring1\\|${f.prims[0]!.key}`))
    inform(f) // the listen is closed after the answer
    f.settle()
    expect(s.chat.filter((c) => c.channel === COMM)).toHaveLength(1)
  })

  it('a prop whose prims are not rings answers with no ring', async () => {
    const { f, s } = await prop(-1234, 'Chair')
    inform(f)
    f.settle()
    expect(s.chat.filter((c) => c.channel === COMM).map((c) => c.text)).toEqual(['ATTACHPOINTS'])
  })

  it('does not listen when rezzed by hand (start parameter 0)', async () => {
    const { f, s } = await prop(0)
    inform(f)
    f.settle()
    expect(s.chat.filter((c) => c.channel === COMM)).toEqual([])
  })

  it('does not report a sitting avatar whose name contains "ring" (FIX)', async () => {
    const { f, s } = await prop(-1234)
    const ringo = f.avatar('Ringo')
    f.sit(ringo)
    // ringo is link 2 of the prop (the harness mocks the avatar as a link)
    s.mock('llGetLinkName', (_ctx, args) => (args[0] === 2 ? ringo.name : 'ring1'))
    inform(f)
    f.settle()
    const answer = s.chat.filter((c) => c.channel === COMM).map((c) => c.text)[0]!
    expect(answer).not.toContain(ringo.key)
    expect(answer).toContain('ring1')
  })
})

// LuaSitter2: [LS]LockMeister (LockMeister V1 / V2 chains). The first LMV1 answer is in
// chains-updater.test.ts; this file covers LMV2 replies, answers that must be ignored,
// the 10 s listen timeout, and clearing the chains (stand, swap, new pose).
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS } from '../helpers/furniture.js'
import type { Furniture, Avatar } from '../helpers/furniture.js'

const LM = -8888

const CARD = `SITTER 0
POSE arms|anim1
POSE free|anim2
{arms}<0,0,0.5><0,0,0>
{free}<0,0,0.5><0,0,0>
SITTER 1
POSE Sit|anim2
{Sit}<0,0,0.5><0,0,0>`

/** [LS]sit (two seats) + [LS]LockMeister; prims ring1 (link 2) and ring2 (link 3). */
async function chained() {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]sit', '[LS]sit 1', '[LS]LockMeister'],
    prims: 3,
    primNames: { 2: 'ring1', 3: 'ring2' },
    notecards: { LSpos: CARD },
    animations: ['anim1', 'anim2'],
  })
  f.start()
  const alice = f.avatar('Alice')
  f.sit(alice, 1) // SITTER 0, pose "arms": rcuff -> ring1, lcuff -> ring2
  return { f, alice, lm: f.script('[LS]LockMeister') }
}

/** Particle systems set by the plugin: [link, target key or "" when cleared]. */
function particles(f: Furniture): [number, string][] {
  return f.script('[LS]LockMeister').callsOf('llLinkParticleSystem').map((c) => {
    const rules = c.args[1] as unknown[]
    const i = rules.findIndex((r) => r === 20) // PSYS_SRC_TARGET_KEY
    return [c.args[0] as number, i >= 0 ? String(rules[i + 1]) : '']
  })
}

const listening = (f: Furniture) => f.script('[LS]LockMeister').listens.some((l) => l.channel === LM && l.active)
const asked = (f: Furniture) => f.script('[LS]LockMeister').chat.filter((c) => c.channel === LM).map((c) => c.text)
const reply = (f: Furniture, from: Avatar, text: string) => f.say(from, LM, text)

describe('LuaSitter2 [LS]LockMeister LMV2', () => {
  it('an LMV2 ReplyPoint moves the chain to the target the cuff names', async () => {
    const { f, alice } = await chained()
    reply(f, alice, `${alice.key}rcuff ok`)
    const target = '00000000-0000-0000-0000-0000000c0ff1'
    reply(f, alice, `${alice.key}|LMV2|ReplyPoint|rcuff|${target}`)
    expect(particles(f)).toEqual([[2, alice.key], [2, target]])
    expect(listening(f)).toBe(true) // the left cuff has not answered yet
  })

  it('stops listening once every cuff has answered LMV2', async () => {
    const { f, alice } = await chained()
    reply(f, alice, `${alice.key}|LMV2|ReplyPoint|rcuff|00000000-0000-0000-0000-0000000c0ff1`)
    reply(f, alice, `${alice.key}|LMV2|ReplyPoint|lcuff|00000000-0000-0000-0000-0000000c0ff2`)
    expect(particles(f)).toEqual([[2, '00000000-0000-0000-0000-0000000c0ff1'], [3, '00000000-0000-0000-0000-0000000c0ff2']])
    expect(listening(f)).toBe(false)
  })

  it('ignores LMV2 replies that are wrong, repeated, for another cuff or without a valid target', async () => {
    const { f, alice } = await chained()
    const t = '00000000-0000-0000-0000-0000000c0ff1'
    reply(f, alice, `${alice.key}|LMV2|RequestPoint|rcuff|${t}`) // not a reply
    reply(f, alice, `${alice.key}|LMV1|ReplyPoint|rcuff|${t}`) // wrong header
    reply(f, alice, `${alice.key}|LMV2|ReplyPoint|nose|${t}`) // no emitter for "nose"
    reply(f, alice, `${alice.key}|LMV2|ReplyPoint|rcuff|not-a-key`)
    reply(f, alice, `${alice.key}|LMV2|ReplyPoint|rcuff|00000000-0000-0000-0000-000000000000`)
    reply(f, alice, `${alice.key}x|LMV2|ReplyPoint|rcuff|${t}`) // the first field is not the avatar
    expect(particles(f)).toEqual([])
    reply(f, alice, `${alice.key}|LMV2|ReplyPoint|rcuff|${t}`)
    reply(f, alice, `${alice.key}|LMV2|ReplyPoint|rcuff|00000000-0000-0000-0000-0000000c0ff2`) // already set
    expect(particles(f)).toEqual([[2, t]])
    // an LMV1 "ok" after the LMV2 reply does not draw the chain again
    reply(f, alice, `${alice.key}rcuff ok`)
    expect(particles(f)).toEqual([[2, t]])
  })
})

describe('LuaSitter2 [LS]LockMeister ignores', () => {
  it('answers from attachments of another avatar, or for another avatar', async () => {
    const { f, alice } = await chained()
    const bob = f.avatar('Bob')
    reply(f, bob, `${alice.key}rcuff ok`) // Bob's cuff (owner is Bob)
    reply(f, alice, `${bob.key}rcuff ok`) // not for Alice
    expect(particles(f)).toEqual([])
  })

  it('an LMV1 answer for a cuff the pose does not use, or a second answer for the same cuff', async () => {
    const { f, alice } = await chained()
    reply(f, alice, `${alice.key}nose ok`)
    expect(particles(f)).toEqual([])
    reply(f, alice, `${alice.key}lcuff ok`)
    reply(f, alice, `${alice.key}lcuff ok`)
    expect(particles(f)).toEqual([[3, alice.key]])
    expect(asked(f).filter((t) => t.endsWith('|LMV2|RequestPoint|lcuff'))).toHaveLength(1)
  })

  it('a pose of another SITTER, and a pose not in POSES (nothing asked, no listen)', async () => {
    const { f, alice } = await chained()
    const bob = f.avatar('Bob')
    f.settle(11_000) // the first listen times out
    const before = asked(f).length
    f.sendLinked('[LS]LockMeister', 90045, '1|Sit|anim2|0|', bob.key)
    expect(asked(f).slice(before)).toEqual([])
    f.click(alice, 'free')
    expect(asked(f).slice(before)).toEqual([])
    expect(listening(f)).toBe(false)
  })

  it('link messages from scripts in other prims', async () => {
    const { f, alice, lm } = await chained()
    reply(f, alice, `${alice.key}rcuff ok`)
    lm.fire('link_message', { sender_num: 2, num: 90065, str: '0', id: alice.key })
    f.settle()
    expect(particles(f)).toEqual([[2, alice.key]]) // not cleared
  })

  it('answers when nobody is chained', async () => {
    const { f, alice } = await chained()
    f.stand(alice)
    const before = particles(f).length
    reply(f, alice, `${alice.key}rcuff ok`)
    expect(particles(f).slice(before)).toEqual([])
  })
})

describe('LuaSitter2 [LS]LockMeister clearing the chains', () => {
  it('the sitter standing up clears every emitter and stops listening; someone else standing does not', async () => {
    const { f, alice } = await chained()
    reply(f, alice, `${alice.key}rcuff ok`)
    f.sendLinked('[LS]LockMeister', 90065, '1', f.avatar('Bob').key)
    expect(particles(f)).toEqual([[2, alice.key]])
    f.stand(alice)
    expect(particles(f).slice(1).sort()).toEqual([[2, ''], [3, '']])
    expect(listening(f)).toBe(false)
  })

  it('a new pose clears the old chains and asks the cuffs again', async () => {
    const { f, alice } = await chained()
    reply(f, alice, `${alice.key}rcuff ok`)
    const before = asked(f).length
    f.sendLinked('[LS]LockMeister', 90045, '0|arms|anim1|0|', alice.key)
    expect(particles(f).slice(1).sort()).toEqual([[2, ''], [3, '']])
    expect(asked(f).slice(before)).toEqual([`${alice.key}rcuff`, `${alice.key}lcuff`])
  })

  it('a swap involving its SITTER (90030, and 90032 as well) clears the chains', async () => {
    for (const num of [90030, 90032]) {
      const { f, alice } = await chained()
      reply(f, alice, `${alice.key}rcuff ok`)
      f.sendLinked('[LS]LockMeister', num, '1', '2') // other sitters: nothing
      expect(particles(f)).toEqual([[2, alice.key]])
      f.sendLinked('[LS]LockMeister', num, '1', '0')
      expect(particles(f).slice(1).sort()).toEqual([[2, ''], [3, '']])
      // a second swap: nobody chained any more, nothing to clear
      f.sendLinked('[LS]LockMeister', num, '0', '1')
      expect(particles(f)).toHaveLength(3)
    }
  })

  it('stops listening 10 s after the last answer', async () => {
    const { f, alice } = await chained()
    f.settle(6_000)
    reply(f, alice, `${alice.key}rcuff ok`) // extends the time to answer
    f.settle(7_000)
    expect(listening(f)).toBe(true)
    f.settle(4_000)
    expect(listening(f)).toBe(false)
    reply(f, alice, `${alice.key}lcuff ok`)
    expect(particles(f)).toEqual([[2, alice.key]])
  })
})

// LuaSitter2: [LS]root-RLV beyond rlv.test.ts: capture by menu (the relay search,
// "Capture new…", "Capture"), the relay check, the Restrict and Un/Dress menus, timelock
// Stop / Start / Hide / Show, hover text, touches (90012) and link messages from other
// scripts, relay pings and RECAPTURE, the PR #149 pose restore, and settings lines.
//
// No RLV relay is simulated: the tests check the relay commands the furniture says, and
// answer them the way a relay worn by the avatar would (the answer comes from the
// avatar's key; for an avatar, llGetOwnerKey returns the avatar itself).
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS, OWNER } from '../helpers/furniture.js'
import type { Furniture, Avatar } from '../helpers/furniture.js'

const RELAY_CHANNEL = -1812221819
const NAK = '\n\x15\n'

const SEAT = (n: number) => `SITTER ${n}
POSE Wait|wait
POSE Dom1|dom
POSE Sub1|sub
POSE Other|other
{Wait}<0,0.3,0.5><0,0,0>
{Dom1}<0,0.3,0.5><0,0,0>
{Sub1}<0,0.3,0.5><0,0,0>
{Other}<0,0.3,0.5><0,0,0>`

/** A pose notecard with RLV settings and one SITTER section per role. */
const card = (settings: string, seats = 2) =>
  [settings, ...Array.from({ length: seats }, (_, i) => SEAT(i))].join('\n')

interface Options {
  seats?: number
  extra?: string[]
  /** Read the notecard with the dataserver reader (the fast reader answers NAK). */
  nak?: boolean
  scripts?: string[]
  /** Name of the pose notecard (default LSpos). */
  cardName?: string
}

/**
 * [LS]sit per seat, [LS]root-RLV, [LS]root-control and [LS]root-security (touches go
 * through it, as in every RLV build). The avatars stand 2 m from the furniture, in
 * range of the relay search (20 m).
 */
async function furniture(settings: string, opts: Options = {}) {
  const seats = opts.seats ?? 2
  const sits = ['[LS]sit', ...Array.from({ length: seats - 1 }, (_, i) => `[LS]sit ${i + 1}`)]
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: opts.scripts ?? [...sits, '[LS]root-RLV', '[LS]root-control', '[LS]root-security', ...(opts.extra ?? [])],
    prims: seats,
    notecards: { [opts.cardName ?? 'LSpos']: card(settings, seats) },
    animations: ['wait', 'dom', 'sub', 'other'],
  })
  if (opts.nak) f.script('[LS]root-RLV').mock('llGetNotecardLineSync', () => NAK)
  f.start()
  return f
}

/** Place every avatar of the world next to the furniture (the sensor finds them). */
function near(f: Furniture) {
  for (const a of f.world.avatars) a.position = { x: 128, y: 130, z: 25 }
}

/** RLV relay commands said by the furniture to an avatar (the part after "RLV,<key>,"). */
function relayed(f: Furniture, av: Avatar): string[] {
  return f.script('[LS]root-RLV').chat
    .filter((c) => c.channel === RELAY_CHANNEL && c.text.startsWith(`RLV,${av.key},`))
    .map((c) => c.text.slice(`RLV,${av.key},`.length))
}

/** The channel of the last relay command to an avatar matching `re` (with a "(\d+)" group). */
function channelOf(f: Furniture, av: Avatar, re: RegExp): number {
  const m = relayed(f, av).map((c) => re.exec(c)).filter(Boolean).at(-1)
  if (!m) throw new Error(`no ${re} sent to ${av.name}`)
  return Number(m[1])
}

/** The avatar's relay answers the capture check (@getstatus), which confirms the capture. */
function relayConfirms(f: Furniture, av: Avatar) {
  f.say(av, channelOf(f, av, /^@getstatus=(-?\d+)$/), '/unsit')
  f.settle(2_000)
}

/** The avatar's relay answers the "is there a relay?" check (@versionnew) of the RLV menu. */
function relayIsThere(f: Furniture, av: Avatar) {
  f.say(av, channelOf(f, av, /^@versionnew=(-?\d+)$/), 'RestrainedLove viewer v3.4.3')
}

const rlvDialogs = (f: Furniture, av: Avatar) => f.dialogsFor(av).filter((d) => d.script === '[LS]root-RLV')
const lastRlv = (f: Furniture, av: Avatar) => {
  const d = rlvDialogs(f, av).at(-1)
  if (!d) throw new Error(`no [LS]root-RLV dialog for ${av.name}`)
  return d
}
/** Answer the last [LS]root-RLV dialog of an avatar (even if another script's dialog came later). */
function answer(f: Furniture, av: Avatar, button: string) {
  const d = lastRlv(f, av)
  if (!d.buttons.includes(button)) throw new Error(`button "${button}" not in ${JSON.stringify(d.buttons)}`)
  f.say(av, d.channel, button)
}
/** An avatar's attachment says something on a channel, without letting time pass (unlike f.say). */
function hear(f: Furniture, av: Avatar, channel: number, message: string) {
  for (const s of Object.values(f.scripts)) {
    ;(s as unknown as { matchChatListens(o: object): boolean })
      .matchChatListens({ channel, name: av.name, key: av.key, message })
  }
}
const saidLocal = (f: Furniture) => f.script('[LS]root-RLV').chat.filter((c) => c.channel === 0).map((c) => c.text)
const hover = (f: Furniture) => f.script('[LS]root-RLV').callsOf('llSetText').map((c) => String(c.args[0])).at(-1) ?? ''

/** Bob sits and is captured (ONSIT CAPTURE, in the S seat); Alice sits in the D seat and opens Bob's RLV menu. */
async function aliceControlsBob(settings = 'ROLES D|S', opts: Options = {}) {
  const f = await furniture(settings, opts)
  const bob = f.avatar('Bob')
  const alice = f.avatar('Alice')
  f.sit(bob)
  f.settle(5_000)
  relayConfirms(f, bob)
  f.sit(alice)
  f.settle(3_000)
  const open = () => {
    f.broadcast(90100, `0|Control...|${bob.key}`, alice.key) // "RLV ▸" in Alice's pose menu, with Bob's menu
    f.settle(3_000) // no answer to the relay check: the menu comes after 2 s
  }
  open()
  return { f, bob, alice, open }
}

describe('LuaSitter2 [LS]root-RLV settings lines', () => {
  it('reads the notecard with the dataserver reader when the fast reader answers NAK', async () => {
    const f = await furniture('ROLES D|S\nONCAPTURE @unsit=n|@tplm=n', { nak: true })
    f.settle(3_000)
    expect(f.script('[LS]root-RLV').callsOf('llGetNotecardLine').length).toBeGreaterThan(0)
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(5_000)
    expect(relayed(f, bob)).toContain('@unsit=n|@tplm=n')
  })

  it('a line pasted from a DUMP (chat prefix up to "◆") is read', async () => {
    const f = await furniture('ROLES D|S\n[12:00] Furniture: ◆ONCAPTURE @fly=n')
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(5_000)
    expect(relayed(f, bob)).toContain('@fly=n')
  })

  it('BRAND names the RLV menus', async () => {
    const { f, alice } = await aliceControlsBob('ROLES D|S\nBRAND Dungeon Deluxe')
    expect(lastRlv(f, alice).message.startsWith('Dungeon Deluxe 3.0-lua1\n\nRLV ▸ Bob')).toBe(true)
  })

  it('HTEXT 0 sends the hover text to other scripts (90207) instead of showing it', async () => {
    const f = await furniture('ROLES D|S\nHTEXT 0')
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(5_000)
    relayConfirms(f, bob)
    const sent = f.linked().filter((m) => m.num === 90207)
    expect(sent.at(-1)!.str).toContain('Captive:\n"Bob Resident"')
    expect(sent.at(-1)!.id).toBe('<0.00000, 1.00000, 0.00000>') // green: keys available
    // only the empty text set at start, before the notecard was read
    expect(f.script('[LS]root-RLV').callsOf('llSetText').map((c) => c.args[0])).toEqual([''])
  })

  it('HTEXT 3 lifts the hover text by two lines', async () => {
    const f = await furniture('ROLES D|S\nHTEXT 3')
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(5_000)
    relayConfirms(f, bob)
    expect(hover(f).endsWith('Keys available\n \n ')).toBe(true)
  })

  it('reloads the settings when the pose notecard changes', async () => {
    const f = await furniture('ROLES D|S\nONSIT NONE')
    f.setNotecard('LSpos', card('ROLES D|S\nONSIT CAPTURE\nONCAPTURE @unsit=n|@edit=n'))
    f.settle(3_000)
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(5_000)
    expect(relayed(f, bob)).toContain('@unsit=n|@edit=n')
  })

  it('a second copy ("[LS]root-RLV 1") removes itself and tells the owner', async () => {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]root-RLV 1'],
      notecards: { LSpos: card('ROLES D|S') },
    })
    f.start()
    const s = f.script('[LS]root-RLV 1')
    expect(s.callsOf('llRemoveInventory').map((c) => c.args[0])).toEqual(['[LS]root-RLV 1'])
    const d = f.dialogsFor({ key: OWNER, name: 'Owner Resident' }).at(-1)!
    expect(d.message).toContain('[LS]root-RLV 1 ==Script Removed==')
    expect(d.message).toContain('Use only one copy of this script!')
    expect(s.callsOf('llInstantMessage')).toHaveLength(1)
  })

  it('DUMP (90020): only sitter 0 gets the settings lines; another script\'s 90020 is ignored', async () => {
    const f = await furniture('ROLES D|S\nTIMELOCK 5\nRLV 1\nSUBCONTROL 1\nHTEXT 2\nRECAPTURE 1\nONTOUCH ASK\nONRELEASE @clear')
    const before = f.linked().length
    f.sendLinked('[LS]root-RLV', 90020, '1', '[LS]root-RLV')
    f.sendLinked('[LS]root-RLV', 90020, '0', '[LS]faces-camera')
    expect(f.linked().slice(before).filter((m) => m.num === 90021 || m.num === 90022)).toEqual([
      { num: 90021, str: '1', id: '[LS]root-RLV' },
    ])
    f.sendLinked('[LS]root-RLV', 90020, '0', '[LS]root-RLV')
    const lines = f.linked().filter((m) => m.num === 90022).map((m) => m.str)
    expect(lines).toEqual(['TIMELOCK 5', 'RLV 1', 'SUBCONTROL 1', 'HTEXT 2', 'RECAPTURE 1', 'ONTOUCH ASK', 'ONRELEASE @clear'])
  })
})

describe('LuaSitter2 [LS]root-RLV menu of one avatar', () => {
  /** Alice sits in the D seat, Bob in the S seat, nobody captured (ONSIT NONE); Alice opens Bob's menu. */
  async function notCaptured(settings = 'ROLES D|S\nONSIT NONE') {
    const f = await furniture(settings)
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice, 1)
    f.sit(bob, 2)
    f.settle(3_000)
    f.broadcast(90100, `0|Control...|${bob.key}`, alice.key)
    return { f, alice, bob }
  }

  it('asks Bob\'s relay first; without an answer in 2 s: "No RLV relay found"', async () => {
    const { f, alice, bob } = await notCaptured()
    expect(relayed(f, bob).at(-1)).toMatch(/^@versionnew=\d+$/)
    expect(rlvDialogs(f, alice)).toEqual([])
    f.settle(2_000)
    const d = lastRlv(f, alice)
    expect(d.message).toContain('RLV ▸ Bob Resident\nNo RLV relay found for Bob Resident.')
    expect(d.buttons).not.toContain('Capture')
  })

  it('when the relay answers: "Not captured." and Capture, which captures Bob and locks the menu for Alice', async () => {
    const { f, alice, bob } = await notCaptured()
    relayIsThere(f, bob)
    const d = lastRlv(f, alice)
    expect(d.message).toContain('RLV ▸ Bob Resident\nNot captured.')
    expect(d.message).toContain('Capture = hold Bob Resident here with RLV')
    expect(d.buttons).toEqual(expect.arrayContaining(['[BACK]', 'Capture', '◂ Poses']))
    expect(d.buttons).not.toContain('[STOP]') // Alice sits: no [STOP] here
    const before = relayed(f, bob).length
    answer(f, alice, 'Capture')
    expect(relayed(f, bob).slice(before)).toEqual(expect.arrayContaining(['@unsit=n', expect.stringMatching(/^@getstatus=\d+$/)]))
    relayConfirms(f, bob)
    expect(saidLocal(f)).toContain('Bob Resident was captured!')
    expect(hover(f)).toContain('Locked by:\n"Alice Resident"')
    expect(f.script('[LS]root-RLV').callsOf('llSetText').at(-1)!.args[1]).toEqual({ x: 1, y: 0, z: 0 }) // red
  })

  it('the menu of someone in a dominant seat says they have not chosen the submissive role', async () => {
    const f = await furniture('ROLES D|S\nONSIT NONE')
    const bob = f.avatar('Bob')
    const carol = f.avatar('Carol')
    f.sit(bob, 1) // the D seat
    f.settle(3_000)
    f.broadcast(90100, `0|Control...|${bob.key}`, carol.key)
    relayIsThere(f, bob)
    const d = lastRlv(f, carol)
    expect(d.message).toContain('Bob Resident has not chosen the submissive role.')
    expect(d.buttons).not.toContain('Capture')
  })

  it('a submissive cannot open the RLV menu', async () => {
    const { f, bob } = await aliceControlsBob()
    f.broadcast(90100, `0|Control...|${bob.key}`, bob.key)
    expect(lastRlv(f, bob).message).toContain('Sorry, submissives can\'t access this.')
    expect(lastRlv(f, bob).buttons).toEqual(['OK'])
  })

  it('[BACK] gives a sitting controller their pose menu (90005), a non-sitter the avatar menu (90007)', async () => {
    const { f, alice } = await aliceControlsBob()
    answer(f, alice, '[BACK]')
    expect(f.linked()).toContainEqual({ num: 90005, str: '', id: alice.key })
    const f2 = await furniture('ROLES D|S|S', { seats: 3 }) // a free S seat: [BACK] to the avatar menu
    const bob = f2.avatar('Bob')
    const carol = f2.avatar('Carol')
    f2.sit(bob)
    f2.settle(5_000)
    relayConfirms(f2, bob)
    f2.broadcast(90100, `0|Control...|${bob.key}`, carol.key)
    f2.settle(3_000)
    const before = f2.linked().length
    answer(f2, carol, '[BACK]')
    expect(f2.linked().slice(before)).toContainEqual({ num: 90007, str: '', id: carol.key })
  })

  it('Lock menu / Unlock menu say so in chat and colour the hover text', async () => {
    const { f, alice } = await aliceControlsBob()
    answer(f, alice, 'Lock menu')
    expect(saidLocal(f)).toContain('Alice Resident takes the keys.')
    expect(hover(f)).toContain('Locked by:\n"Alice Resident"')
    answer(f, alice, 'Unlock menu')
    expect(saidLocal(f)).toContain('Alice Resident relinquishes the keys.')
    expect(hover(f)).toContain('Keys available')
  })

  it('a locked menu: someone else gets "this item is locked by Alice Resident"', async () => {
    const { f, alice, bob } = await aliceControlsBob()
    f.say(alice, lastRlv(f, alice).channel, 'Take Keys') // the upstream name
    const carol = f.avatar('Carol')
    f.broadcast(90100, `0|Control...|${bob.key}`, carol.key)
    expect(lastRlv(f, carol).message).toContain('Sorry, this item is locked by Alice Resident.')
    // the dominant sitter still gets the menu when touching
    const before = f.linked().length
    f.sendLinked('[LS]root-RLV', 90012, '1', alice.key)
    expect(f.linked().slice(before)).toContainEqual({ num: 90007, str: '', id: alice.key })
  })

  it('Release frees Bob: "was released", the ONRELEASE commands, !release, and Bob stands up', async () => {
    const { f, alice, bob } = await aliceControlsBob()
    const before = relayed(f, bob).length
    answer(f, alice, 'Release')
    expect(saidLocal(f)).toContain('Bob Resident was released.')
    expect(relayed(f, bob).slice(before)).toEqual(['@unsit=force', '!release'])
    expect(f.script('[LS]root-RLV').callsOf('llUnSit').map((c) => String(c.args[0]))).toContain(bob.key)
    expect(hover(f)).toBe('')
  })

  it('a controller who does not sit gets [STOP] (release everyone, all stand)', async () => {
    const f = await furniture('ROLES D|S')
    const bob = f.avatar('Bob')
    const carol = f.avatar('Carol')
    f.sit(bob)
    f.settle(5_000)
    relayConfirms(f, bob)
    // Carol touches: [LS]root-security -> 90012 -> 90007 -> [LS]root-control (one sitter) -> 90100
    f.touch(carol)
    f.settle(3_000)
    const d = lastRlv(f, carol)
    expect(d.message).toContain('[STOP] = release everyone, all stand')
    answer(f, carol, '[STOP]')
    expect(saidLocal(f)).toContain('Bob Resident was released.')
    expect(f.script('[LS]root-RLV').callsOf('llUnSit').map((c) => String(c.args[0]))).toContain(bob.key)
  })

  it('"Which submissive?" lists the captives when there are several (ONSIT CAPIFSUB)', async () => {
    const f = await furniture('ROLES D|S|S\nONSIT CAPIFSUB\nDOMPOSE Dom1', { seats: 3 })
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    const carol = f.avatar('Carol')
    f.sit(alice, 1) // D seat: not captured, plays DOMPOSE, gets the menu
    f.settle(3_000)
    expect(relayed(f, alice)).toEqual([])
    expect(f.playing(alice)).toEqual(['dom'])
    f.sit(bob, 2)
    f.settle(3_000)
    relayConfirms(f, bob)
    f.sit(carol, 3)
    f.settle(3_000)
    relayConfirms(f, carol)
    f.broadcast(90100, `0|Control...|${alice.key}`, alice.key) // "RLV ▸" in Alice's own menu
    const d = lastRlv(f, alice)
    expect(d.message).toContain('RLV ▸ which submissive?')
    expect([...d.buttons].sort()).toEqual(['Bob', 'Carol'])
    answer(f, alice, 'Carol')
    f.settle(3_000)
    expect(lastRlv(f, alice).message).toContain('RLV ▸ Carol Resident\nCaptured.')
  })

  it('no submissive sitting: says so, and offers "Capture new…" for the free seat', async () => {
    const f = await furniture('ROLES D|S\nONSIT CAPIFSUB')
    const alice = f.avatar('Alice')
    f.sit(alice, 1)
    f.settle(3_000)
    f.broadcast(90100, `0|Control...|${alice.key}`, alice.key)
    const d = lastRlv(f, alice)
    expect(d.message).toContain('RLV ▸ there are no submissives sitting.')
    expect(d.message).toContain('Capture new… = capture an avatar nearby who wears an RLV relay.')
    expect(d.buttons).toContain('Capture new…')
    near(f)
    answer(f, alice, 'Capture new…')
    expect(relayed(f, alice).at(-1)).toMatch(/^@versionnew=\d+$/) // the relay search asks everyone nearby
  })
})

describe('LuaSitter2 [LS]root-RLV capture by menu (relay search)', () => {
  const owner: Avatar = { key: OWNER, name: 'Owner Resident' }

  /** The owner touches the empty furniture: [LS]root-control starts the relay search (90211). */
  async function search(settings = 'ROLES D|S\nONSIT NONE') {
    const f = await furniture(settings)
    const bob = f.avatar('Bob')
    near(f)
    f.touch(owner)
    return { f, bob }
  }

  it('asks every avatar nearby for a relay, and lists those who answer', async () => {
    const { f, bob } = await search()
    const ch = channelOf(f, bob, /^@versionnew=(\d+)$/)
    expect(relayed(f, owner)).toContain(`@versionnew=${ch}`)
    f.say(bob, ch, 'RestrainedLove viewer v3.4.3') // Bob's relay answers, the owner's does not
    f.settle(1_000)
    const d = lastRlv(f, owner)
    expect(d.message).toContain('RLV ▸ Capture new\n\nWho do you want to capture?\nOnly avatars wearing an RLV relay are listed.')
    expect(d.buttons).toEqual(['Bob', '[SECURITY]']) // [SECURITY] for the owner while nobody sits
  })

  it('the menu comes at once when every avatar found has answered', async () => {
    const { f, bob } = await search()
    const ch = channelOf(f, bob, /^@versionnew=(\d+)$/)
    const shown = rlvDialogs(f, owner).length
    hear(f, bob, ch, 'RestrainedLove viewer v3.4.3')
    hear(f, bob, ch, 'RestrainedLove viewer v3.4.3') // a second answer is counted once
    f.settle(100)
    expect(rlvDialogs(f, owner)).toHaveLength(shown) // still waiting for the owner's relay
    hear(f, owner, ch, 'RestrainedLove viewer v3.4.3')
    f.settle(100) // well before the 1.5 s timeout
    expect([...lastRlv(f, owner).buttons].sort()).toEqual(['Bob', 'Owner', '[SECURITY]'])
  })

  it('choosing someone makes their relay sit them, and they are captured when they sit', async () => {
    const { f, bob } = await search()
    f.say(bob, channelOf(f, bob, /^@versionnew=(\d+)$/), 'RestrainedLove viewer v3.4.3')
    f.settle(1_000)
    answer(f, owner, 'Bob')
    expect(relayed(f, bob).at(-1)).toBe(`@sit:${f.prims[0]!.key}=force`)
    f.sit(bob, 2) // the relay makes Bob sit (ONSIT NONE: only because the owner chose him)
    f.settle(3_000)
    expect(relayed(f, bob)).toContain('@unsit=n')
    relayConfirms(f, bob)
    expect(saidLocal(f)).toContain('Bob Resident was captured!')
    expect(hover(f)).toContain('Locked by:\n"Owner Resident"')
  })

  it('choosing yourself: "you can not capture yourself"', async () => {
    const { f } = await search()
    f.say(owner, channelOf(f, owner, /^@versionnew=(\d+)$/), 'RestrainedLove viewer v3.4.3')
    f.settle(1_000)
    answer(f, owner, 'Owner')
    expect(lastRlv(f, owner).message).toContain('Sorry, you can not capture yourself.')
  })

  it('[SECURITY] opens the security menu for the owner (90100)', async () => {
    const { f } = await search()
    f.settle(1_000)
    answer(f, owner, '[SECURITY]')
    expect(f.linked()).toContainEqual({ num: 90100, str: '0|[SECURITY]', id: OWNER })
  })

  it('nobody answers: "No RLV relays found in range (20 m)."', async () => {
    const { f } = await search()
    f.settle(1_000)
    expect(lastRlv(f, owner).message).toContain('No RLV relays found in range (20 m).')
  })

  it('nobody nearby: "No avatars found in range!"', async () => {
    const f = await furniture('ROLES D|S')
    f.touch(owner) // the avatars are far away (rezless puts them at <0,0,0>)
    f.settle(2_000)
    const d = lastRlv(f, owner)
    expect(d.message).toContain('No avatars found in range!')
    expect(d.buttons).toEqual(['[SECURITY]'])
  })

  it('no search without a submissive seat', async () => {
    const f = await furniture('ROLES D|D')
    near(f)
    const before = f.script('[LS]root-RLV').chat.length
    f.broadcast(90211, '', OWNER)
    f.settle(2_000)
    expect(f.script('[LS]root-RLV').chat.slice(before)).toEqual([])
  })

  it('ONTOUCH CAPTURE: touching the empty furniture makes the toucher\'s relay sit them, then captures them', async () => {
    const f = await furniture('ROLES D|S\nONSIT NONE\nONTOUCH CAPTURE')
    const bob = f.avatar('Bob')
    const before = f.linked().length
    f.touch(bob)
    expect(relayed(f, bob)).toEqual([`@sit:${f.prims[0]!.key}=force`])
    expect(f.linked().slice(before).some((m) => m.num === 90007)).toBe(false)
    f.sit(bob, 2)
    f.settle(3_000)
    expect(relayed(f, bob)).toContain('@unsit=n')
  })

  it('ONTOUCH NONE: touching the empty furniture does nothing', async () => {
    const f = await furniture('ROLES D|S\nONTOUCH NONE')
    const bob = f.avatar('Bob')
    const before = f.linked().length
    f.touch(bob)
    f.settle(2_000)
    expect(f.linked().slice(before).map((m) => m.num)).toEqual([90012])
    expect(relayed(f, bob)).toEqual([])
  })
})

describe('LuaSitter2 [LS]root-RLV timelock', () => {
  it('shows the time left in the hover text and the menu (TIMELOCK 2)', async () => {
    const { f, alice } = await aliceControlsBob('ROLES D|S\nTIMELOCK 2')
    expect(hover(f)).toMatch(/Timelocked for:\n1 min, \d+ sec/)
    expect(lastRlv(f, alice).message).toMatch(/Captured\. Timelock: 1 min, \d+ sec/)
  })

  it('Hide / Show hides the time from the hover text', async () => {
    const { f, alice } = await aliceControlsBob('ROLES D|S\nTIMELOCK 2')
    answer(f, alice, 'Timelock')
    answer(f, alice, 'Hide')
    expect(hover(f)).toContain('Timelocked for:\n(hidden)')
    expect(lastRlv(f, alice).message).toContain('Timelock Hidden')
    expect(lastRlv(f, alice).message).toContain('Hide/Show = hide the time from the hover text')
    answer(f, alice, 'Show')
    expect(hover(f)).not.toContain('(hidden)')
  })

  it('Stop pauses the countdown (and offers -time); Start runs it again until the release', async () => {
    const { f, alice, bob } = await aliceControlsBob('ROLES D|S\nTIMELOCK 1')
    answer(f, alice, 'Timelock')
    answer(f, alice, 'Stop')
    const d = lastRlv(f, alice)
    expect(d.message).toContain('Timelock Stopped')
    expect(d.buttons).toEqual(expect.arrayContaining(['Start', '-1min', '-30min', '-1hrs']))
    expect(hover(f)).not.toContain('Timelocked for')
    f.settle(120_000)
    expect(relayed(f, bob)).not.toContain('!release')
    answer(f, alice, '[BACK]')
    expect(lastRlv(f, alice).message).toContain('(stopped)')
    answer(f, alice, 'Timelock')
    answer(f, alice, 'Start')
    f.settle(70_000)
    expect(relayed(f, bob)).toContain('!release')
  })

  it('+1hrs adds an hour; -1hrs on a stopped timelock goes down to 0, not below', async () => {
    const { f, alice } = await aliceControlsBob('ROLES D|S\nTIMELOCK 1')
    answer(f, alice, 'Timelock')
    answer(f, alice, '+1hrs')
    expect(lastRlv(f, alice).message).toMatch(/Time remaining: 1 hrs, 0 min\n/)
    answer(f, alice, 'Stop')
    answer(f, alice, '-1hrs')
    answer(f, alice, '-1hrs')
    const d = lastRlv(f, alice)
    expect(d.message).toContain('Time remaining: 0 sec')
    expect(d.buttons.filter((b) => b === ' ')).toHaveLength(2) // no Start / Stop, no Hide
  })

  it('time added while stopped does not start the countdown', async () => {
    const { f, alice, bob } = await aliceControlsBob('ROLES D|S')
    answer(f, alice, 'Timelock')
    answer(f, alice, '+1min')
    answer(f, alice, 'Stop')
    answer(f, alice, '+1min')
    f.settle(150_000)
    expect(relayed(f, bob)).not.toContain('!release')
    answer(f, alice, 'Start')
    f.settle(125_000)
    expect(relayed(f, bob)).toContain('!release')
  })

  it('an unknown button in the Timelock menu changes nothing', async () => {
    const { f, alice } = await aliceControlsBob('ROLES D|S\nTIMELOCK 1')
    answer(f, alice, 'Timelock')
    const shown = rlvDialogs(f, alice).length
    f.say(alice, lastRlv(f, alice).channel, 'Nonsense')
    expect(rlvDialogs(f, alice)).toHaveLength(shown)
  })
})

describe('LuaSitter2 [LS]root-RLV Restrict menu', () => {
  async function restrict() {
    const r = await aliceControlsBob()
    r.f.say(r.alice, lastRlv(r.f, r.alice).channel, 'Restrict')
    const status = channelOf(r.f, r.bob, /^@getstatus=(\d+)$/)
    r.f.say(r.bob, status, '/sendchat/fly') // Bob's relay: chat already restricted
    return { ...r, status }
  }

  it('asks the relay which restrictions are set, and shows each as allowed (✔) or restricted (✘)', async () => {
    const { f, alice } = await restrict()
    const d = lastRlv(f, alice)
    expect(d.message).toContain('LuaSitter RLV Restrict 3.0-lua1\n\nRLV for Bob Resident')
    expect(d.buttons).toContain('[BACK]')
    expect(d.buttons).toContain('✘ Chat              .')
    expect(d.buttons).toContain('✔ IM                .')
    expect(d.buttons).toContain('✔ Map               .') // two commands, neither set
    for (const b of d.buttons) expect(new TextEncoder().encode(b).length).toBeLessThanOrEqual(24)
  })

  it('a button toggles the restriction, says so, and asks the relay again', async () => {
    const { f, alice, bob, status } = await restrict()
    let before = relayed(f, bob).length
    answer(f, alice, '✔ Map               .')
    expect(relayed(f, bob).slice(before)).toEqual(['@showworldmap=n', '@showminimap=n', `@getstatus=${status}`])
    expect(saidLocal(f)).toContain('Bob is restricted from seeing their map.')
    before = relayed(f, bob).length
    answer(f, alice, '✘ Chat              .')
    expect(relayed(f, bob).slice(before)).toEqual(['@sendchat=y', `@getstatus=${status}`])
    expect(saidLocal(f)).toContain('Bob is no longer restricted from sending chat.')
  })

  it('[BACK] returns to Bob\'s RLV menu', async () => {
    const { f, alice } = await restrict()
    answer(f, alice, '[BACK]')
    f.settle(3_000)
    expect(lastRlv(f, alice).message).toContain('RLV ▸ Bob Resident\nCaptured.')
  })

  it('another script can open it with 90209 (id "captive|controller|title")', async () => {
    const { f, bob, alice } = await aliceControlsBob()
    f.broadcast(90209, '', `${bob.key}|${alice.key}|Limits`)
    f.say(bob, channelOf(f, bob, /^@getstatus=(\d+)$/), '')
    expect(lastRlv(f, alice).message).toContain('LuaSitter RLV Limits 3.0-lua1')
    expect(lastRlv(f, alice).buttons).toContain('✔ Chat              .')
  })
})

describe('LuaSitter2 [LS]root-RLV Un/Dress menu', () => {
  async function undress() {
    const r = await aliceControlsBob()
    r.f.say(r.alice, lastRlv(r.f, r.alice).channel, 'Un/Dress')
    return r
  }

  it('offers Browse #RLV, Fast Strip, Undress, Detach and [BACK]', async () => {
    const { f, alice } = await undress()
    const d = lastRlv(f, alice)
    expect(d.message).toContain('LuaSitter RLV Un/Dress 3.0-lua1\n\nUn/Dress menu for Bob Resident')
    expect([...d.buttons].sort()).toEqual([' ', 'Browse #RLV', 'Detach', 'Fast Strip', 'Undress', '[BACK]'])
    answer(f, alice, '[BACK]')
    f.settle(3_000)
    expect(lastRlv(f, alice).message).toContain('RLV ▸ Bob Resident')
  })

  it('Undress lists the clothes Bob wears; choosing one removes it, then asks again', async () => {
    const { f, alice, bob } = await undress()
    answer(f, alice, 'Undress')
    const ch = channelOf(f, bob, /^@getoutfit=(\d+)$/)
    f.say(bob, ch, '100100000000000') // gloves, shirt
    const d = lastRlv(f, alice)
    expect(d.message).toContain('Undress menu for Bob Resident\n\nThe captive\'s RLV setup may prevent some items from being removed.')
    expect([...d.buttons].sort()).toEqual(['[BACK]', 'gloves', 'shirt'])
    const before = relayed(f, bob).length
    answer(f, alice, 'shirt')
    expect(relayed(f, bob).slice(before)).toEqual(['@remoutfit:shirt=force'])
    f.settle(2_000)
    expect(relayed(f, bob).slice(before)).toEqual(['@remoutfit:shirt=force', `@getoutfit=${ch}`])
    answer(f, alice, '[BACK]') // back to the Un/Dress menu
    expect(lastRlv(f, alice).message).toContain('Un/Dress menu for Bob Resident')
  })

  it('Detach lists the attachments, paged past 11, and removes the one chosen', async () => {
    const { f, alice, bob } = await undress()
    answer(f, alice, 'Detach')
    const ch = channelOf(f, bob, /^@getattach=(\d+)$/)
    f.say(bob, ch, '1'.repeat(41)) // everything worn
    const page1 = lastRlv(f, alice).buttons
    expect(page1).toEqual(expect.arrayContaining(['[BACK]', '[<<]', '[>>]', 'chest', 'skull']))
    expect(page1).toHaveLength(12)
    answer(f, alice, '[>>]')
    const page2 = lastRlv(f, alice).buttons
    expect(page2).not.toContain('chest')
    answer(f, alice, '[<<]')
    answer(f, alice, '[<<]') // wraps to the last page
    expect(lastRlv(f, alice).buttons).toContain('root')
    answer(f, alice, '[>>]') // and past the last page back to the first
    expect(lastRlv(f, alice).buttons).toContain('chest')
    answer(f, alice, '[<<]')
    const before = relayed(f, bob).length
    answer(f, alice, 'root')
    f.settle(2_000)
    expect(relayed(f, bob).slice(before)).toEqual(['@remattach:root=force', `@getattach=${ch}`])
  })

  it('nothing worn: says so', async () => {
    const { f, alice, bob } = await undress()
    answer(f, alice, 'Detach')
    f.say(bob, channelOf(f, bob, /^@getattach=(\d+)$/), '0000')
    expect(lastRlv(f, alice).message).toContain('The captive is not wearing any items to detach.')
  })

  it('Fast Strip asks first; YES! removes every clothing layer and attachment but the skull', async () => {
    const { f, alice, bob } = await undress()
    answer(f, alice, 'Fast Strip')
    expect(lastRlv(f, alice).message).toContain('Are you really sure?')
    const before = relayed(f, bob).length
    answer(f, alice, 'YES!')
    const sent = relayed(f, bob).slice(before)
    expect(sent).toContain('@remoutfit:gloves=force')
    expect(sent).toContain('@remoutfit:tattoo=force')
    expect(sent).toContain('@remattach:chest=force')
    expect(sent).toContain('@remattach:root=force')
    expect(sent).not.toContain('@remattach:skull=force')
    expect(sent.filter((c) => c.startsWith('@remoutfit:') || c.startsWith('@remattach:'))).toHaveLength(11 + 31)
    expect(lastRlv(f, alice).message).toContain('Un/Dress menu for Bob Resident')
  })

  it('Browse #RLV: a folder can be worn ([➕]) or removed ([➖]), and [BACK] goes up a folder', async () => {
    const { f, alice, bob } = await undress()
    answer(f, alice, 'Browse #RLV')
    const ch = channelOf(f, bob, /^@getinvworn=(\d+)$/)
    f.say(bob, ch, '|10,Shoes|20')
    expect(lastRlv(f, alice).message).toContain('Folder: /\n[none worn]')
    answer(f, alice, '◑ Shoes')
    expect(relayed(f, bob).at(-1)).toBe(`@getinvworn:Shoes=${ch}`)
    f.say(bob, ch, '|20')
    const d = lastRlv(f, alice)
    expect(d.message).toContain('Folder: /Shoes\n[some worn]')
    expect(d.buttons).toEqual(expect.arrayContaining(['[➕]', '[➖]']))
    let before = relayed(f, bob).length
    answer(f, alice, '[➕]')
    f.settle(4_000)
    expect(relayed(f, bob).slice(before)).toEqual(['@attach:Shoes=force', `@getinvworn:Shoes=${ch}`])
    before = relayed(f, bob).length
    answer(f, alice, '[➖]')
    expect(relayed(f, bob).slice(before)).toEqual(['@detach:Shoes=force'])
    answer(f, alice, '[BACK]')
    expect(relayed(f, bob).at(-1)).toBe(`@getinvworn:=${ch}`)
    f.say(bob, ch, '|30,Shoes|33')
    expect(lastRlv(f, alice).message).toContain('[all worn]')
    expect(lastRlv(f, alice).buttons).toContain('● Shoes')
    answer(f, alice, '[BACK]') // at the top: the Un/Dress menu
    expect(lastRlv(f, alice).message).toContain('Un/Dress menu for Bob Resident')
  })

  it('Browse #RLV: an empty #RLV folder', async () => {
    const { f, alice, bob } = await undress()
    answer(f, alice, 'Browse #RLV')
    f.say(bob, channelOf(f, bob, /^@getinvworn=(\d+)$/), '|0')
    expect(lastRlv(f, alice).message).toContain('#RLV folder empty')
  })

  it('stops listening to the relay when the captive stands up', async () => {
    const { f, alice, bob } = await undress()
    answer(f, alice, 'Undress')
    const ch = channelOf(f, bob, /^@getoutfit=(\d+)$/)
    const shown = rlvDialogs(f, alice).length
    f.stand(bob)
    f.settle(2_000)
    f.say(bob, ch, '100100000000000')
    expect(rlvDialogs(f, alice)).toHaveLength(shown)
  })

  it('another script can open it with 90208', async () => {
    const { f, bob, alice } = await aliceControlsBob()
    f.broadcast(90208, '', `${bob.key}|${alice.key}|Clothes`)
    expect(lastRlv(f, alice).message).toContain('LuaSitter RLV Clothes 3.0-lua1\n\nUn/Dress menu for Bob Resident')
  })
})

describe('LuaSitter2 [LS]root-RLV touches (90012)', () => {
  it('a captive touching gets "captives can\'t access the menu"; with SUBCONTROL 1 they get the menu', async () => {
    for (const sub of [0, 1]) {
      const f = await furniture(`ROLES D|S\nSUBCONTROL ${sub}`)
      const bob = f.avatar('Bob')
      f.sit(bob)
      f.settle(5_000)
      relayConfirms(f, bob)
      const before = f.linked().length
      f.touch(bob)
      if (sub) {
        expect(f.linked().slice(before)).toContainEqual({ num: 90007, str: '', id: bob.key })
      } else {
        expect(lastRlv(f, bob).message).toContain('Sorry, captives can\'t access the menu. Enjoy your captivity :).')
        expect(f.linked().slice(before).some((m) => m.num === 90007)).toBe(false)
      }
    }
  })

  it('a submissive who is not captured touching: "submissives can\'t access the menu" (SUBCONTROL 1: the menu)', async () => {
    for (const sub of [0, 1]) {
      const f = await furniture(`ROLES D|S\nONSIT NONE\nSUBCONTROL ${sub}`)
      const bob = f.avatar('Bob')
      f.sit(f.avatar('Alice'), 1)
      f.sit(bob, 2) // the S seat
      f.settle(2_000)
      const before = f.linked().length
      f.touch(bob)
      if (sub) {
        expect(f.linked().slice(before)).toContainEqual({ num: 90007, str: '', id: bob.key })
      } else {
        expect(lastRlv(f, bob).message).toContain('Sorry, submissives can\'t access the menu.')
      }
    }
  })

  it('ONSIT ASK: a sitter who has not chosen a role is asked again when touching', async () => {
    const f = await furniture('ROLES D|S\nONSIT ASK')
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(2_000)
    const asked = () => rlvDialogs(f, bob).filter((d) => d.message.includes('Please select your role')).length
    expect(asked()).toBe(1)
    f.touch(bob)
    expect(asked()).toBe(2)
  })

  it('someone who does not sit cannot use the menu while a dominant seat is taken', async () => {
    const f = await furniture('ROLES D|S\nONSIT NONE')
    f.sit(f.avatar('Alice'), 1)
    f.settle(2_000)
    const carol = f.avatar('Carol')
    const before = f.linked().length
    f.touch(carol)
    expect(f.linked().slice(before).map((m) => m.num)).toEqual([90012])
  })

  it('touching the empty furniture after a locked capture ended forgets the lock', async () => {
    const { f, alice, bob } = await aliceControlsBob()
    answer(f, alice, 'Lock menu')
    f.stand(alice)
    f.stand(bob)
    f.settle(2_000)
    const carol = f.avatar('Carol')
    near(f)
    const before = f.linked().length
    f.touch(carol) // nobody sits: 90007, then [LS]root-control starts a search for Carol
    expect(f.linked().slice(before)).toContainEqual({ num: 90007, str: '', id: carol.key })
    expect(hover(f)).not.toContain('Locked by')
  })
})

describe('LuaSitter2 [LS]root-RLV link messages from other scripts', () => {
  it('[STOP] (90015) from a submissive does nothing', async () => {
    const { f, bob } = await aliceControlsBob()
    const before = relayed(f, bob).length
    f.broadcast(90015, '', bob.key)
    expect(relayed(f, bob).slice(before)).toEqual([])
  })

  it('[STOP] (90015) while the menu is locked: only the controller can stop', async () => {
    const { f, alice, bob } = await aliceControlsBob()
    answer(f, alice, 'Lock menu')
    const carol = f.avatar('Carol')
    const before = relayed(f, bob).length
    f.broadcast(90015, '', carol.key)
    f.broadcast(90015, '', '') // a script without an avatar
    expect(relayed(f, bob).slice(before)).toEqual([])
    f.broadcast(90015, '', alice.key)
    expect(relayed(f, bob).slice(before)).toContain('!release')
  })

  it('[STOP] (90015) with "1" releases without saying "was released"', async () => {
    const { f, bob } = await aliceControlsBob()
    f.broadcast(90015, '1', '')
    expect(relayed(f, bob)).toContain('!release')
    expect(saidLocal(f)).not.toContain('Bob Resident was released.')
  })

  it('[STOP] from the pose menu (90100): refused to a submissive, done for the dominant', async () => {
    const { f, alice, bob } = await aliceControlsBob()
    f.broadcast(90100, `1|[STOP]|${bob.key}`, bob.key)
    expect(lastRlv(f, bob).message).toContain('Sorry, submissives can\'t access this.')
    expect(relayed(f, bob)).not.toContain('!release')
    f.broadcast(90100, `0|[STOP]|${alice.key}`, alice.key)
    expect(relayed(f, bob)).toContain('!release')
    expect(f.script('[LS]root-RLV').callsOf('llUnSit').map((c) => String(c.args[0]))).toEqual(expect.arrayContaining([alice.key, bob.key]))
  })

  it('90201 plays WAITPOSE', async () => {
    const f = await furniture('ROLES D|S\nWAITPOSE Wait')
    const before = f.linked().length
    f.broadcast(90201, '', '')
    f.settle(2_000)
    expect(f.linked().slice(before)).toContainEqual({ num: 90000, str: 'Wait', id: '' })
  })

  it('swapping a captive into a dominant seat (90030) releases the captives', async () => {
    const { f, bob } = await aliceControlsBob()
    f.broadcast(90030, '0', '1')
    expect(saidLocal(f)).toContain('Bob Resident was released.')
    expect(relayed(f, bob)).toContain('!release')
    // the roles follow the avatars: Bob now holds the D seat
    expect(f.linked().filter((m) => m.num === 90206).at(-1)!.str.split('|')[0]).toBe(bob.key)
  })

  it('swapping two seats of the same role keeps the captive', async () => {
    const f = await furniture('ROLES D|S|S', { seats: 3 })
    const bob = f.avatar('Bob')
    f.sit(bob, 2)
    f.settle(3_000)
    relayConfirms(f, bob)
    f.broadcast(90032, '1', '2')
    expect(relayed(f, bob)).not.toContain('!release')
    expect(f.linked().filter((m) => m.num === 90206).at(-1)!.str).toBe(`D|S|${bob.key}`)
  })
})

describe('LuaSitter2 [LS]root-RLV relay pings', () => {
  const ping = (f: Furniture) => `ping,${f.prims[0]!.key},ping,ping`

  it('a captive\'s relay that pings after a relog is forgotten without RECAPTURE', async () => {
    const f = await furniture('ROLES D|S')
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(5_000)
    relayConfirms(f, bob)
    f.stand(bob) // logged off
    f.settle(2_000)
    f.say(bob, RELAY_CHANNEL, ping(f)) // back online, the relay asks the furniture
    expect(f.script('[LS]root-RLV').chat.some((c) => c.text.endsWith(',!pong'))).toBe(false)
    f.broadcast(90015, '', '')
    expect(relayed(f, bob)).not.toContain('!release') // no captive left to release
  })

  it('RECAPTURE 1: the furniture answers the ping (!pong, which makes the relay sit them again), keeping the captive', async () => {
    const f = await furniture('ROLES D|S\nRECAPTURE 1')
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(5_000)
    relayConfirms(f, bob)
    f.stand(bob) // logged off: the S seat is free again
    f.settle(2_000)
    f.say(bob, RELAY_CHANNEL, ping(f))
    expect(f.script('[LS]root-RLV').chat.filter((c) => c.channel === RELAY_CHANNEL).at(-1))
      .toMatchObject({ text: `ping,${bob.key},!pong`, type: 'regionSay' })
    f.say(bob, RELAY_CHANNEL, 'ping,someone,else') // not our ping
    f.broadcast(90015, '', '')
    expect(relayed(f, bob)).toContain('!release')
  })
})

describe('LuaSitter2 [LS]root-RLV roles', () => {
  it('ONSIT ASKONLY: choosing the submissive role moves the sitter without capturing', async () => {
    const f = await furniture('ROLES D|S\nONSIT ASKONLY')
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(2_000)
    answer(f, bob, 'Submissive')
    f.settle(3_000)
    expect(f.linked()).toContainEqual({ num: 90030, str: '0', id: '1' })
    expect(relayed(f, bob)).toEqual([])
  })

  it('a second dominant when there is only one dominant seat is unseated: "no available seats"', async () => {
    const f = await furniture('ROLES D|S\nONSIT ASK')
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice, 1)
    f.settle(2_000)
    answer(f, alice, 'Dominant')
    f.settle(3_000)
    f.sit(bob, 2)
    f.settle(2_000)
    answer(f, bob, 'Dominant')
    f.settle(2_000)
    expect(lastRlv(f, bob).message).toContain('Sorry, there no available seats for Dominant.')
    expect(f.script('[LS]root-RLV').callsOf('llUnSit').map((c) => String(c.args[0]))).toContain(bob.key)
  })

  it('a role answer from someone who does not sit is ignored', async () => {
    const f = await furniture('ROLES D|S\nONSIT ASK')
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(2_000)
    const ch = lastRlv(f, bob).channel
    const carol = f.avatar('Carol')
    const before = f.linked().length
    f.say(carol, ch, 'Dominant')
    f.settle(3_000)
    expect(f.linked().slice(before).filter((m) => m.num === 90206)).toEqual([])
  })
})

describe('LuaSitter2 [LS]root-RLV captive back in their pose (PR #149)', () => {
  it('a captive who stands and sits again gets their last pose back', async () => {
    const f = await furniture('ROLES D|S')
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(5_000)
    relayConfirms(f, bob)
    f.broadcast(90000, 'Other', bob.key)
    f.settle(2_000)
    expect(f.playing(bob)).toEqual(['other'])
    f.stand(bob)
    f.settle(2_000)
    f.sit(bob)
    f.settle(5_000)
    expect(f.playing(bob)).toEqual(['other'])
    // once back, later pose changes are kept as usual
    f.broadcast(90000, 'Wait', bob.key)
    f.settle(2_000)
    expect(f.playing(bob)).toEqual(['wait'])
  })

  it('gives up after 3 tries when the pose cannot be played', async () => {
    const f = await furniture('ROLES D|S')
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(5_000)
    relayConfirms(f, bob)
    const sitter = (pose: string) => f.sendLinked('[LS]root-RLV', 90045, `1|${pose}|x|0|${bob.key}`, bob.key)
    sitter('Gone') // the captive's last pose (deleted from the notecard since)
    f.sendLinked('[LS]root-RLV', 90065, '1', bob.key)
    f.sendLinked('[LS]root-RLV', 90070, '1', bob.key)
    const before = f.linked().length
    for (let i = 0; i < 5; i++) sitter('Wait')
    expect(f.linked().slice(before).filter((m) => m.num === 90000 && m.str === 'Gone')).toHaveLength(3)
  })
})

describe('LuaSitter2 [LS]root-RLV more setups', () => {
  it('reads the settings from AVpos when there is no LSpos, with LSL-style numbers (TIMELOCK 0x2)', async () => {
    const f = await furniture('ROLES D|S\nTIMELOCK 0x2', { cardName: 'AVpos' })
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(5_000)
    relayConfirms(f, bob)
    expect(hover(f)).toMatch(/Timelocked for:\n1 min, \d+ sec/)
  })

  it('RLV 0: the RLV menu says "RLV is off."', async () => {
    const f = await furniture('ROLES D|S\nRLV 0')
    const bob = f.avatar('Bob')
    const carol = f.avatar('Carol')
    f.sit(bob)
    f.settle(3_000)
    f.broadcast(90100, `0|Control...|${bob.key}`, carol.key)
    f.settle(3_000)
    expect(lastRlv(f, carol).message).toContain('RLV ▸ Bob Resident\nRLV is off.')
  })

  it('one seat (no "[LS]sit 1"): a captive plays SUBPOSE in their own seat', async () => {
    const f = await furniture('ROLES S\nSUBPOSE Sub1', { seats: 1 })
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(5_000)
    expect(relayed(f, bob)).toContain('@unsit=n')
    expect(f.linked()).toContainEqual({ num: 90000, str: 'Sub1', id: bob.key })
    expect(f.playing(bob)).toEqual(['sub'])
  })

  it('a new captive in the seat of one who left: the one who left is forgotten', async () => {
    const f = await furniture('ROLES D|S')
    const bob = f.avatar('Bob')
    const carol = f.avatar('Carol')
    f.sit(bob)
    f.settle(5_000)
    relayConfirms(f, bob)
    f.stand(bob) // still a captive (to restore if they come back)
    f.settle(2_000)
    f.sit(carol) // takes the only S seat
    f.settle(5_000)
    relayConfirms(f, carol)
    expect(hover(f)).toContain('Captive:\n"Carol Resident"\n')
    f.broadcast(90015, '', '')
    expect(relayed(f, carol)).toContain('!release')
    expect(relayed(f, bob)).not.toContain('!release')
  })

  it('a relay search started by another script (90211) makes the relay sit the avatar on the root prim', async () => {
    const f = await furniture('ROLES D|S\nONSIT NONE')
    const bob = f.avatar('Bob')
    const owner: Avatar = { key: OWNER, name: 'Owner Resident' }
    near(f)
    f.broadcast(90211, '', OWNER) // no touch: no prim was touched
    f.say(bob, channelOf(f, bob, /^@versionnew=(\d+)$/), 'RestrainedLove viewer v3.4.3')
    f.settle(1_000)
    answer(f, owner, 'Bob')
    expect(relayed(f, bob).at(-1)).toBe(`@sit:${f.prims[0]!.key}=force`)
  })

  it('takes new relay channels when rezzed', async () => {
    const f = await furniture('ROLES D|S')
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(5_000)
    const first = channelOf(f, bob, /^@getstatus=(\d+)$/)
    f.stand(bob)
    f.settle(2_000)
    f.script('[LS]root-RLV').fire('on_rez', { start_param: 0 })
    f.settle()
    f.sit(bob)
    f.settle(5_000)
    expect(channelOf(f, bob, /^@getstatus=(\d+)$/)).not.toBe(first)
  })
})

describe('LuaSitter2 [LS]root-RLV "Which submissive?" with more than 12 captives', () => {
  it('is paged; a blank filler button shows the page again; a name on page 2 opens that captive\'s menu', async () => {
    const n = 13
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]root-RLV'],
      notecards: { LSpos: `ROLES D|${Array(n).fill('S').join('|')}\nSITTER 0\nPOSE Sit|wait` },
      animations: ['wait'],
    })
    f.start()
    const subs: Avatar[] = []
    for (let i = 1; i <= n; i++) {
      const av = f.avatar(`Sub${i}`)
      subs.push(av)
      f.sendLinked('[LS]root-RLV', 90060, String(i), av.key) // [LS]sit: sitter i sat down (ONSIT CAPTURE)
    }
    const carol = f.avatar('Carol')
    f.sendLinked('[LS]root-RLV', 90100, `0|Control...|${carol.key}`, carol.key)
    const page1 = lastRlv(f, carol).buttons
    expect(page1).toHaveLength(12)
    expect(page1).toEqual(expect.arrayContaining(['[<<]', '[>>]']))
    answer(f, carol, '[>>]')
    const page2 = lastRlv(f, carol).buttons
    expect(page2).toContain(' ')
    const names = new Set([...page1, ...page2].filter((b) => b.startsWith('Sub')))
    expect(names.size).toBe(n)
    const shown = rlvDialogs(f, carol).length
    answer(f, carol, ' ')
    expect(rlvDialogs(f, carol)).toHaveLength(shown + 1)
    expect(lastRlv(f, carol).buttons).toEqual(page2)
    const pick = page2.find((b) => b.startsWith('Sub'))!
    answer(f, carol, pick)
    const target = subs.find((s) => s.name === `${pick} Resident`)!
    expect(relayed(f, target).at(-1)).toMatch(/^@versionnew=\d+$/) // the relay check of their menu
  })
})

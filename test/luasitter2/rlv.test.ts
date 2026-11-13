// LuaSitter2: [LS]root-RLV: roles (ONSIT ASK / CAPTURE / NONE), capture and release
// commands sent to the RLV relay, DOMPOSE / SUBPOSE, seat swap by role, [STOP] (90015),
// timelock, RLV 0, and the RLV settings in DUMP. The relay itself is not simulated:
// the tests check the relay commands the furniture says.
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS, OWNER } from '../helpers/furniture.js'
import type { Furniture, Avatar } from '../helpers/furniture.js'

const RELAY_CHANNEL = -1812221819

const card = (settings: string) => `${settings}
SITTER 0|Top
POSE Wait|wait_a
POSE Dom1|dom_a
POSE Sub1|sub_a
{Wait}<0,0.3,0.5><0,0,0>
{Dom1}<0,0.3,0.5><0,0,0>
{Sub1}<0,0.3,0.5><0,0,0>
SITTER 1|Bottom
POSE Wait|wait_b
POSE Dom1|dom_b
POSE Sub1|sub_b
{Wait}<0,-0.3,0.5><0,0,0>
{Dom1}<0,-0.3,0.5><0,0,0>
{Sub1}<0,-0.3,0.5><0,0,0>`

async function furniture(settings: string, extra: string[] = []) {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]sit', '[LS]sit 1', '[LS]root-RLV', '[LS]root-control', ...extra],
    prims: 2,
    notecards: { LSpos: card(settings) },
    animations: ['wait_a', 'wait_b', 'dom_a', 'dom_b', 'sub_a', 'sub_b'],
  })
  f.start()
  return f
}

/** RLV relay commands said by the furniture to an avatar (the part after "RLV,<key>,"). */
function relayed(f: Furniture, av: Avatar): string[] {
  return f.script('[LS]root-RLV').chat
    .filter((c) => c.channel === RELAY_CHANNEL && c.text.startsWith(`RLV,${av.key},`))
    .map((c) => c.text.slice(`RLV,${av.key},`.length))
}

/**
 * Answer the furniture's @getstatus like an RLV relay worn by the avatar would,
 * which confirms the capture. (The reply comes from the avatar's key here; for an
 * avatar, llGetOwnerKey returns the avatar itself.)
 */
function relayAnswers(f: Furniture, av: Avatar) {
  const ask = relayed(f, av).map((c) => /@getstatus=(-?\d+)/.exec(c)).filter(Boolean).at(-1)
  if (!ask) throw new Error(`no @getstatus sent to ${av.name}`)
  f.say(av, Number(ask[1]), '/unsit')
  f.settle(2_000)
}

/** The role question shown to an avatar, if any. */
const roleDialog = (f: Furniture, av: Avatar) =>
  f.dialogsFor(av).filter((d) => d.script === '[LS]root-RLV' && d.message.includes('Please select your role')).at(-1)

describe('LuaSitter2 [LS]root-RLV roles (ONSIT ASK)', () => {
  const ASK = 'ROLES D|S\nONSIT ASK\nWAITPOSE Wait\nDOMPOSE Dom1\nSUBPOSE Sub1'

  it('asks a new sitter to choose a role, and plays WAITPOSE meanwhile', async () => {
    const f = await furniture(ASK)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.settle(3_000)
    const d = roleDialog(f, alice)
    expect(d).toBeDefined()
    expect(d!.buttons).toHaveLength(2)
    expect(f.playing(alice)).toEqual(['wait_a'])
  })

  it('choosing the dominant role plays DOMPOSE after 1 s, then gives the control menu', async () => {
    const f = await furniture(ASK)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.settle(3_000)
    const d = roleDialog(f, alice)!
    const before = f.linked().length
    f.script('[LS]root-RLV').answerDialog(d.buttons[0]!, { name: alice.name, dialog: f.script('[LS]root-RLV').dialogs.at(-1)! })
    f.advance(500)
    // still waiting (upstream: llSleep(1)); nothing sent yet
    expect(f.linked().slice(before).some((m) => m.num === 90000)).toBe(false)
    f.settle(3_000)
    const after = f.linked().slice(before)
    const play = after.findIndex((m) => m.num === 90000 && m.str === 'Dom1')
    const control = after.findIndex((m) => m.num === 90007 && m.id === alice.key)
    expect(play).toBeGreaterThanOrEqual(0)
    expect(control).toBeGreaterThan(play) // same order as upstream
    expect(f.playing(alice)).toEqual(['dom_a'])
  })

  it('a message that arrives during the 1 s wait is handled after it, as LSL did during llSleep', async () => {
    const f = await furniture(ASK)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.settle(3_000)
    const rlv = f.script('[LS]root-RLV')
    const before = f.linked().length
    rlv.answerDialog(roleDialog(f, alice)!.buttons[0]!, { name: alice.name, dialog: rlv.dialogs.at(-1)! })
    // the dominant choice now waits 1 s, then plays DOMPOSE, waits 1 s, gives the control menu;
    // meanwhile [LS]adjuster asks for the RLV DUMP lines
    rlv.fire('link_message', { sender_num: rlv.host.linkNumber, num: 90020, str: '0', id: '[LS]root-RLV' })
    f.settle(5_000)
    const after = f.linked().slice(before)
    const control = after.findIndex((m) => m.num === 90007)
    const dumped = after.findIndex((m) => m.num === 90022)
    expect(control).toBeGreaterThanOrEqual(0)
    expect(dumped).toBeGreaterThan(control) // answered after the task, not in the middle of it
  })

  it('choosing the submissive role in the dominant seat moves the sitter to the submissive seat', async () => {
    const f = await furniture(ASK)
    const alice = f.avatar('Alice')
    f.sit(alice) // sits in SITTER 0, the D seat
    f.settle(3_000)
    const d = roleDialog(f, alice)!
    const rlv = f.script('[LS]root-RLV')
    rlv.answerDialog(d.buttons[1]!, { name: alice.name, dialog: rlv.dialogs.at(-1)! })
    f.settle(5_000)
    expect(f.linked()).toContainEqual({ num: 90030, str: '0', id: '1' })
    expect(f.playing(alice)).toEqual(['sub_b'])
    expect(relayed(f, alice)).toContain('@unsit=n') // captured: default ONCAPTURE
  })
})

describe('LuaSitter2 [LS]root-RLV capture and release', () => {
  it('ONSIT CAPTURE (default) captures a sitter: the ONCAPTURE commands go to their relay', async () => {
    const f = await furniture('ROLES D|S\nONCAPTURE @unsit=n|@fartouch=n')
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(5_000)
    const cmds = relayed(f, bob).join('|')
    expect(cmds).toContain('@unsit=n')
    expect(cmds).toContain('@fartouch=n')
    expect(cmds).toMatch(/@getstatus=-?\d+/)
  })

  it('ONSIT NONE does not capture', async () => {
    const f = await furniture('ROLES D|S\nONSIT NONE')
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(5_000)
    expect(relayed(f, bob)).toHaveLength(0)
  })

  it('RLV 0 sends no relay commands', async () => {
    const f = await furniture('ROLES D|S\nRLV 0')
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(5_000)
    expect(relayed(f, bob)).toHaveLength(0)
  })

  it('the capture is confirmed when the relay answers: "was captured!"', async () => {
    const f = await furniture('ROLES D|S')
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(5_000)
    relayAnswers(f, bob)
    expect(f.script('[LS]root-RLV').chat.map((c) => c.text)).toContain('Bob Resident was captured!')
  })

  it('[STOP] (90015) releases the captive with the ONRELEASE commands', async () => {
    const f = await furniture('ROLES D|S\nONRELEASE @unsit=y|@clear')
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(5_000)
    relayAnswers(f, bob)
    const before = relayed(f, bob).length
    f.broadcast(90015, '', OWNER)
    f.settle(3_000)
    const released = relayed(f, bob).slice(before).join('|')
    expect(released).toContain('@unsit=y')
    expect(released).toContain('@clear')
  })

  it('a voluntary sitter is released when the TIMELOCK runs out', async () => {
    const f = await furniture('ROLES D|S\nTIMELOCK 1')
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(5_000)
    relayAnswers(f, bob)
    const before = relayed(f, bob).length
    f.settle(30_000)
    expect(relayed(f, bob).slice(before).join('|')).not.toContain('@unsit=force')
    f.settle(40_000)
    expect(relayed(f, bob).slice(before).join('|')).toContain('@unsit=force') // default ONRELEASE
  })

  it('shows the RLV status as hover text', async () => {
    const f = await furniture('ROLES D|S')
    const bob = f.avatar('Bob')
    f.sit(bob)
    f.settle(5_000)
    relayAnswers(f, bob)
    const texts = f.script('[LS]root-RLV').callsOf('llSetText').map((c) => String(c.args[0]))
    expect(texts.some((t) => t.includes('Bob'))).toBe(true)
  })
})

describe('LuaSitter2 [LS]root-RLV menus', () => {
  /**
   * Bob is captured in the S seat; Alice sits in the D seat. ([LS]root-security tells
   * the sit scripts that RLV is present, as in every RLV build.)
   */
  async function dominantOpensRlv() {
    const f = await furniture('ROLES D|S', ['[LS]root-security'])
    const bob = f.avatar('Bob')
    const alice = f.avatar('Alice')
    f.sit(bob)
    f.settle(5_000)
    relayAnswers(f, bob)
    f.sit(alice)
    f.settle(3_000)
    f.broadcast(90005, '', alice.key)
    return { f, bob, alice }
  }

  it('the pose menu has "RLV ▸" and [STOP], explained in the menu text', async () => {
    const { f, alice } = await dominantOpensRlv()
    const d = f.lastDialog(alice)
    expect(d.script).toBe('[LS]sit')
    expect(d.buttons).toContain('RLV ▸')
    expect(d.buttons).toContain('[STOP]')
    expect(d.buttons).not.toContain('Control...')
    expect(d.message).toContain('RLV ▸ = capture and RLV controls')
    expect(d.message).toContain('[STOP] = release everyone and stand up')
  })

  it('"RLV ▸" still sends "Control..." (90100) for LSL plugins, and opens the RLV menu of the captive', async () => {
    const { f, alice } = await dominantOpensRlv()
    f.click(alice, 'RLV ▸')
    expect(f.linked().some((m) => m.num === 90100 && m.str.split('|')[1] === 'Control...')).toBe(true)
    f.settle(3_000) // relay check timeout
    const d = f.lastDialog(alice)
    expect(d.script).toBe('[LS]root-RLV')
    expect(d.message).toContain('RLV ▸ Bob')
    expect(d.message).toContain('Captured.')
    expect(d.message).toContain('Release = free Bob')
    expect(d.buttons).toEqual(expect.arrayContaining(['Release', 'Timelock', 'Restrict', 'Un/Dress', '◂ Poses']))
    expect(d.buttons.some((b) => b === 'Lock menu' || b === 'Unlock menu')).toBe(true)
    expect(d.buttons).not.toContain('Release!')
    expect(d.buttons).not.toContain('Menu...')
  })

  it('"◂ Poses" opens the captive\'s pose menu for the controller (90004)', async () => {
    const { f, alice, bob } = await dominantOpensRlv()
    f.click(alice, 'RLV ▸')
    f.settle(3_000)
    f.click(alice, '◂ Poses')
    expect(f.linked()).toContainEqual({ num: 90004, str: '', id: `${alice.key}|${bob.key}` })
  })

  it('Lock menu / Unlock menu say who holds the menu', async () => {
    const { f, alice } = await dominantOpensRlv()
    f.click(alice, 'RLV ▸')
    f.settle(3_000)
    const first = f.lastDialog(alice)
    const toggle = first.buttons.includes('Lock menu') ? 'Lock menu' : 'Unlock menu'
    f.click(alice, toggle)
    const after = f.lastDialog(alice)
    if (toggle === 'Lock menu') {
      expect(after.message).toContain('Menu locked by Alice Resident.')
      expect(after.buttons).toContain('Unlock menu')
    } else {
      expect(after.message).toContain('Menu unlocked: anyone can take control.')
      expect(after.buttons).toContain('Lock menu')
    }
  })

  it('the Timelock menu explains its buttons', async () => {
    const { f, alice } = await dominantOpensRlv()
    f.click(alice, 'RLV ▸')
    f.settle(3_000)
    f.click(alice, 'Timelock')
    const d = f.lastDialog(alice)
    expect(d.message).toContain('RLV ▸ Bob Resident ▸ Timelock')
    expect(d.message).toContain('+/- = add or remove time')
    expect(d.message).toContain('[BACK] = RLV menu')
    f.click(alice, '[BACK]')
    expect(f.lastDialog(alice).message).toContain('RLV ▸ Bob')
  })

  it('time added in the Timelock menu counts down and releases the captive (no TIMELOCK line)', async () => {
    // upstream bug: the countdown had stopped at capture time (time 0), so added time stayed frozen
    const { f, alice, bob } = await dominantOpensRlv()
    f.click(alice, 'RLV ▸')
    f.settle(3_000)
    f.click(alice, 'Timelock')
    const plus = f.lastDialog(alice).buttons.filter((b) => /^\+\d+min$/.test(b)).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))[0]
    expect(plus).toBeDefined()
    const minutes = parseInt(plus!.slice(1))
    const before = relayed(f, bob).length
    f.click(alice, plus!)
    f.settle(minutes * 60_000 - 5_000)
    expect(relayed(f, bob).slice(before)).not.toContain('!release')
    f.settle(10_000)
    expect(relayed(f, bob).slice(before)).toContain('!release')
  })

  it('Browse #RLV: long non-ASCII folder names give buttons that fit a dialog, and each opens its folder', async () => {
    const { f, alice, bob } = await dominantOpensRlv()
    f.click(alice, 'RLV ▸')
    f.settle(3_000)
    f.click(alice, 'Un/Dress')
    f.click(alice, 'Browse #RLV')
    const ask = relayed(f, bob).map((c) => /^@getinvworn=(\d+)$/.exec(c)).filter(Boolean).at(-1)
    expect(ask).toBeDefined()
    const long1 = 'Одежда летняя красная' // 2 bytes per letter
    const long2 = 'Одежда летняя синяя'
    f.say(bob, Number(ask![1]), `|10,${long1}|30,${long2}|30,Shoes|10`)
    const d = f.lastDialog(alice)
    const folders = d.buttons.filter((b) => b.startsWith('●') || b.startsWith('○') || b.startsWith('◑'))
    expect(folders).toHaveLength(3)
    for (const b of folders) expect(new TextEncoder().encode(b).length).toBeLessThanOrEqual(24)
    expect(new Set(folders).size).toBe(3) // the two long names, cut alike, are told apart
    f.click(alice, folders[1]!)
    expect(relayed(f, bob).at(-1)).toBe(`@getinvworn:${long2}=${ask![1]}`)
  })

  it('the upstream button names still work (for example "Release!")', async () => {
    const { f, alice, bob } = await dominantOpensRlv()
    f.click(alice, 'RLV ▸')
    f.settle(3_000)
    const before = relayed(f, bob).length
    f.say(alice, f.lastDialog(alice).channel, 'Release!')
    expect(relayed(f, bob).slice(before)).toContain('!release')
  })
})

describe('LuaSitter2 [LS]root-RLV in DUMP (AVsitter issue #18)', () => {
  it('writes the RLV settings', async () => {
    const f = await furniture('ROLES D|S\nONSIT ASK\nTIMELOCK 5\nDOMPOSE Dom1', ['[LS]adjuster'])
    const adjuster = f.script('[LS]adjuster')
    f.broadcast(90100, '0|[DUMP]|', OWNER)
    f.settle(30_000)
    const text = adjuster.chat.map((c) => c.text).join('\n')
    expect(text).toContain('ROLES D|S')
    expect(text).toContain('ONSIT ASK')
    expect(text).toContain('TIMELOCK 5')
    expect(text).toContain('DOMPOSE Dom1')
  })
})

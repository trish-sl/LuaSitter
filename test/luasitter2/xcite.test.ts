// LuaSitter2: [LS]Xcite! (Xcite! / Sensations): reading "[LS]Xcite_settings" (or
// "[AV]Xcite_settings"), the arousal and tilt link messages (20001, 20014, 20020) sent to
// the partner scripts for each pose played, the re-send timer, and reloading.
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS, LS2, notecardFile } from '../helpers/furniture.js'
import type { Furniture } from '../helpers/furniture.js'

const NAK = '\n\x15\n'
const NULL_KEY = '00000000-0000-0000-0000-000000000000'
const EXAMPLE = notecardFile(LS2 + 'Plugins/LScontrol/Xcite!-Sensations/[LS]Xcite_settings.notecard')

const CARD = `SITTER 0|Her
POSE Couples1|anim1
POSE Waiting|anim2
POSE Rest|anim2
POSE Other|anim2
{Couples1}<0,0,0.5><0,0,0>
{Waiting}<0,0,0.5><0,0,0>
{Rest}<0,0,0.5><0,0,0>
{Other}<0,0,0.5><0,0,0>
SITTER 1|Him
POSE Couples1|anim1
POSE Other|anim2
{Couples1}<0,0,0.5><0,0,0>
{Other}<0,0,0.5><0,0,0>`

async function furniture(notecards: Record<string, string>, nak = false) {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]sit', '[LS]sit 1', '[LS]Xcite!'],
    prims: 2,
    notecards: { LSpos: CARD, ...notecards },
    animations: ['anim1', 'anim2'],
  })
  if (nak) f.script('[LS]Xcite!').mock('llGetNotecardLineSync', () => NAK)
  f.start()
  return f
}

/** Link messages to the Xcite! / Sensations partner scripts. */
const xcite = (f: Furniture) => f.linked().filter((m) => m.num === 20001 || m.num === 20014 || m.num === 20020)

describe('LuaSitter2 [LS]Xcite! settings notecard', () => {
  it('reads the example "[LS]Xcite_settings" and says how many lines it has', async () => {
    const f = await furniture({ '[LS]Xcite_settings': EXAMPLE })
    expect(f.printed('[LS]Xcite!')).toEqual([
      '[LS]Xcite![3.0-lua1]:Loading...',
      expect.stringMatching(/^\[LS\]Xcite!\[3\.0-lua1\]:7 items Ready, Mem=\d+$/),
    ])
  })

  it('reads "[AV]Xcite_settings" when there is no "[LS]Xcite_settings"', async () => {
    const f = await furniture({ '[AV]Xcite_settings': 'XCITE *|*|5|90' })
    expect(f.printed('[LS]Xcite!').at(-1)).toMatch(/:1 items Ready/)
  })

  it('"[LS]Xcite_settings" wins when both exist', async () => {
    const f = await furniture({ '[AV]Xcite_settings': 'XCITE *|*|5|90', '[LS]Xcite_settings': 'XCITE *|*|5|90\nXCITE Rest|*|0|0' })
    expect(f.printed('[LS]Xcite!').at(-1)).toMatch(/:2 items Ready/)
  })

  it('says so when there is no settings notecard (no script error)', async () => {
    const f = await furniture({})
    expect(f.printed('[LS]Xcite!')).toEqual([
      '[LS]Xcite![3.0-lua1]:Loading...',
      '[LS]Xcite![3.0-lua1]:Notecard "[LS]Xcite_settings" not found.',
    ])
  })

  it('stops reading at an "end" line', async () => {
    const f = await furniture({ '[LS]Xcite_settings': 'XCITE *|*|5|90\n  END  \nXCITE Rest|*|0|0' })
    expect(f.printed('[LS]Xcite!').at(-1)).toMatch(/:1 items Ready/)
  })

  it('falls back to the dataserver reader when the fast reader answers NAK', async () => {
    const f = await furniture({ '[LS]Xcite_settings': 'XCITE *|*|5|90\nXCITE Rest|*|0|0\nend\nXCITE Other|*|1|1' }, true)
    f.settle(3_000)
    expect(f.script('[LS]Xcite!').callsOf('llGetNotecardLine').length).toBeGreaterThan(0)
    expect(f.printed('[LS]Xcite!').at(-1)).toMatch(/:2 items Ready/)
  })

  it('the dataserver reader also stops at the end of the notecard', async () => {
    const f = await furniture({ '[LS]Xcite_settings': 'XCITE *|*|5|90' }, true)
    f.settle(3_000)
    expect(f.printed('[LS]Xcite!').at(-1)).toMatch(/:1 items Ready/)
  })

  it('reloads when the settings notecard changes, not for other inventory changes', async () => {
    const f = await furniture({ '[LS]Xcite_settings': 'XCITE *|*|5|90' })
    const loads = () => f.printed('[LS]Xcite!').filter((t) => t.endsWith('Loading...')).length
    f.setItem('another anim', 'animation')
    expect(loads()).toBe(1)
    f.setNotecard('[LS]Xcite_settings', 'XCITE *|*|5|90\nXCITE Rest|*|0|0')
    expect(loads()).toBe(2)
    expect(f.printed('[LS]Xcite!').at(-1)).toMatch(/:2 items Ready/)
  })
})

describe('LuaSitter2 [LS]Xcite! poses', () => {
  it('a pose sends the arousal (20001) with /0 /1 replaced by the sitters\' first names, and its tilt (20020)', async () => {
    const f = await furniture({ '[LS]Xcite_settings': EXAMPLE })
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice, 1)
    f.sit(bob, 2)
    const before = xcite(f).length
    f.broadcast(90000, 'Couples1', '') // both sitters
    f.settle(2_000)
    const sent = xcite(f).slice(before)
    expect(sent).toContainEqual({ num: 20014, str: 'Alice Resident', id: '' }) // tilt 0: restore
    expect(sent).toContainEqual({ num: 20001, str: 'Alice Resident|15|95|Alice takes Bob by the hand...|kink', id: NULL_KEY })
    expect(sent).toContainEqual({ num: 20020, str: 'Bob Resident|50', id: '' })
    expect(sent).toContainEqual({ num: 20001, str: 'Bob Resident|5|95|example text for male...|kink', id: NULL_KEY })
  })

  it('a pose without its own line uses "pose|*", else "*|*"', async () => {
    const f = await furniture({ '[LS]Xcite_settings': EXAMPLE })
    const alice = f.avatar('Alice')
    f.sit(alice, 1)
    const at = () => xcite(f).length
    let before = at()
    f.click(alice, 'Waiting') // XCITE Waiting|*|-15|95
    expect(xcite(f).slice(before)).toContainEqual({ num: 20001, str: 'Alice Resident|-15|95||', id: NULL_KEY })
    before = at()
    f.click(alice, 'Other') // XCITE *|*|5|90
    expect(xcite(f).slice(before)).toContainEqual({ num: 20001, str: 'Alice Resident|5|90||', id: NULL_KEY })
  })

  it('a "*|1" line is the default for all poses of SITTER 1 (upstream ignored it)', async () => {
    // FIX (upstream [AV]Xcite! tried "pose|sitter", "pose|*" and "*|*", never "*|sitter",
    // although the example notecard has "XCITE *|1|5|90" as "Default arousal for sitter1's poses").
    const f = await furniture({ '[LS]Xcite_settings': 'XCITE *|*|5|90\nXCITE *|1|7|70' })
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice, 1) // SITTER 0: no "*|0" line, so "*|*"
    f.sit(bob, 2) // SITTER 1
    expect(xcite(f)).toContainEqual({ num: 20001, str: 'Alice Resident|5|90||', id: NULL_KEY })
    expect(xcite(f)).toContainEqual({ num: 20001, str: 'Bob Resident|7|70||', id: NULL_KEY })
    expect(xcite(f)).not.toContainEqual({ num: 20001, str: 'Bob Resident|5|90||', id: NULL_KEY })
  })

  it('a pose\'s own "pose|*" line still wins over "*|1"', async () => {
    const f = await furniture({ '[LS]Xcite_settings': 'XCITE *|1|7|70\nXCITE Couples1|*|15|95' })
    const bob = f.avatar('Bob')
    f.sit(bob, 2) // SITTER 1, pose Couples1
    expect(xcite(f)).toContainEqual({ num: 20001, str: 'Bob Resident|15|95||', id: NULL_KEY })
    expect(xcite(f).some((m) => m.str.includes('|7|70'))).toBe(false)
  })

  it('no matching line: nothing is sent', async () => {
    const f = await furniture({ '[LS]Xcite_settings': 'XCITE Rest|0|0|0' })
    const alice = f.avatar('Alice')
    f.sit(alice, 1)
    expect(xcite(f)).toEqual([])
    f.click(alice, 'Rest')
    expect(xcite(f).map((m) => m.num)).toEqual([20014, 20001])
  })

  it('the arousal is sent again every TIMER seconds (without the text), for the current pose only', async () => {
    const f = await furniture({ '[LS]Xcite_settings': 'TIMER 5\nXCITE Couples1|0|15|95|/0 smiles|kink|0\nXCITE Waiting|*|-15|95' })
    const alice = f.avatar('Alice')
    f.sit(alice, 1) // Couples1
    const before = xcite(f).length
    f.settle(5_000)
    expect(xcite(f).slice(before)).toEqual([{ num: 20001, str: 'Alice Resident|15|95||kink', id: NULL_KEY }])
    f.click(alice, 'Waiting')
    const later = xcite(f).length
    f.settle(5_000)
    expect(xcite(f).slice(later)).toEqual([{ num: 20001, str: 'Alice Resident|-15|95||', id: NULL_KEY }])
  })

  it('the timer stops re-sending when nobody sits any more', async () => {
    const f = await furniture({ '[LS]Xcite_settings': 'TIMER 5\nXCITE *|*|5|90' })
    const alice = f.avatar('Alice')
    f.sit(alice, 1)
    f.stand(alice)
    f.script('[LS]Xcite!').fire('changed', { changes: 0x20 }) // CHANGED_LINK
    const before = xcite(f).length
    f.settle(12_000)
    expect(xcite(f).slice(before)).toEqual([])
  })

  it('the timer keeps re-sending while someone still sits', async () => {
    const f = await furniture({ '[LS]Xcite_settings': 'TIMER 5\nXCITE *|*|5|90' })
    const alice = f.avatar('Alice')
    f.sit(alice, 1)
    f.script('[LS]Xcite!').fire('changed', { changes: 0x20 }) // CHANGED_LINK, Alice still there
    const before = xcite(f).length
    f.settle(5_000)
    expect(xcite(f).slice(before)).toHaveLength(1)
  })

  it('TIMER 0 sends the arousal only once', async () => {
    const f = await furniture({ '[LS]Xcite_settings': 'TIMER 0\nXCITE *|*|5|90' })
    const alice = f.avatar('Alice')
    f.sit(alice, 1)
    const before = xcite(f).length
    f.settle(60_000)
    expect(xcite(f).slice(before)).toEqual([])
  })

  it('DEBUG 1 prints what is sent', async () => {
    const f = await furniture({ '[LS]Xcite_settings': 'DEBUG 1\nTIMER 5\nXCITE Couples1|*|15|95||kink|30\nXCITE *|*|5|90' })
    const alice = f.avatar('Alice')
    f.sit(alice, 1)
    f.settle(5_000)
    f.click(alice, 'Other')
    const printed = f.printed('[LS]Xcite!').map((t) => t.replace('[LS]Xcite![3.0-lua1]:', ''))
    expect(printed.slice(2)).toEqual([
      "Setting Alice Resident's tilt to 30",
      'Sending xcite commands: Alice Resident|15|95||kink', // the pose
      'Sending xcite commands: Alice Resident|15|95||kink', // the timer
      "Restoring Alice Resident's tilt.",
      'Sending xcite commands: Alice Resident|5|90||',
    ])
  })

  it('a sitter not in the sitter list is named "(nobody)" in the text', async () => {
    const f = await furniture({ '[LS]Xcite_settings': 'XCITE *|*|5|90|/0 and /1' })
    const alice = f.avatar('Alice')
    f.sit(alice, 1)
    expect(xcite(f)).toContainEqual({ num: 20001, str: 'Alice Resident|5|90|Alice and (nobody)|', id: NULL_KEY })
  })

  it('ignores poses of an unknown avatar and link messages from other prims', async () => {
    const f = await furniture({ '[LS]Xcite_settings': 'XCITE *|*|5|90' })
    const x = f.script('[LS]Xcite!')
    f.sendLinked('[LS]Xcite!', 90045, '0|Other|anim2|0|', '00000000-0000-0000-0000-00000000dead')
    const alice = f.avatar('Alice')
    x.fire('link_message', { sender_num: 2, num: 90045, str: `0|Other|anim2|0|${alice.key}`, id: alice.key })
    f.settle()
    expect(xcite(f)).toEqual([])
  })

  it('a line whose command has no space keeps the upstream quirk (the command loses its last letter)', async () => {
    // "TIMER" alone is read as command "TIME": not a known command, so the default TIMER 30 stays
    const f = await furniture({ '[LS]Xcite_settings': 'TIMER\nXCITE *|*|5|90' })
    const alice = f.avatar('Alice')
    f.sit(alice, 1)
    const before = xcite(f).length
    f.settle(30_000)
    expect(xcite(f).slice(before)).toHaveLength(1)
  })
})

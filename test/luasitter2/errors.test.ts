// LuaSitter2: notecard problems and robustness. LS-setup-checker NOTECARD lists every
// problem in the pose notecards with its line number (missing animations, position lines
// without a pose or with bad vectors, settings that are not numbers, names clashing
// after the 23-character cut, SITTER sections without a sit script, lines without their
// plugin, unknown or lower-case commands, missing prop objects, SYNC poses missing from a
// section); well-formed notecards give no problem. [LS]sit itself reports nothing (it
// has no memory to spare). Position vectors with text after them are read as AVsitter
// read them. No script stops on malformed notecard lines or
// on malformed link messages from other (LSL) plugins.
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS, OWNER } from '../helpers/furniture.js'
import type { Furniture } from '../helpers/furniture.js'

const owner = { key: OWNER, name: 'Owner Resident' }
const PLUGINS = ['[LS]plugins', '[LS]faces-camera', '[LS]root-RLV', '[LS]commands']
const ANIMS = ['sit_anim', 'anim1', 'anim2', 'hug_a', 'hug_b', 'smile']

// Uses every notecard command LuaSitter reads, in well-formed lines.
const GOOD = `MTYPE 0
ETYPE 1
SELECT 0
SWAP 2
AMENU 2
HELPER 0
SET -1
KFM 0
LROT 0
DFLT 1
WARN 1
TEXT Welcome\\nto the bed
BRAND Acme
ROLES D|S
ONSIT ASK
RLV 1
TIMELOCK 10
COMMANDS 5
ADJUST Pillow|2
Notes for the bed: free text is ignored
// a comment
◆SITTER 0|Left|M
MENU Cuddles
POSE Sit|sit_anim
POSE Walk|anim1|2|anim2|3
POSE Female|anim1|F
POSE Builtin|sit_ground
SYNC Hug|hug_a
SYNC A pose with a very long name|hug_a
TOMENU Extras
BUTTON Lamp|97
BUTTON Rez
SEQUENCE Show
ANIM Hug|smile|5
CAMERA Hug|<1,0,1>|<0,0,0>
PROP Ball|ball|0|<0,0,1>|<0,0,0>
{Sit}<0,0,0.5><0,0,0>
{Walk}<0.000,0.000,0.500><0.0,0.0,90.0>
{Hug}<0, 0.3, 0.5> <0, 0, 0>
{A pose with a very long}<0,0,1><0,0,0>
SITTER 1|Right
SYNC Hug|hug_b
SYNC A pose with a very long name|hug_b
{Hug}<0,-0.3,0.5><0,0,0>`

// The card of dump.test.ts.
const DUMP_CARD = `MTYPE 1
SITTER 0|Left
SYNC Cuddle|cud_a
SYNC Talk|talk_a
ANIM Cuddle|smile|5
{Cuddle}<0.000,0.300,0.500><0.0,0.0,0.0>
{Talk}<0.000,0.300,0.500><0.0,0.0,45.0>
SITTER 1|Right
SYNC Cuddle|cud_b
SYNC Talk|talk_b
{Cuddle}<0.000,-0.300,0.500><0.0,0.0,0.0>
{Talk}<0.000,-0.300,0.500><0.0,0.0,-45.0>`

type Opts = { plugins?: string[]; scripts?: string[]; animations?: string[] }

async function furniture(notecards: Record<string, string>, opts: Opts = {}) {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: opts.scripts ?? ['[LS]sit', '[LS]sit 1'],
    placeholders: opts.plugins ?? PLUGINS,
    prims: 2,
    notecards,
    animations: opts.animations ?? ANIMS,
    objects: { ball: [] },
  })
  f.start()
  return f
}

/** What a sit script told the owner, without its start messages. */
function told(f: Furniture, script = '[LS]sit'): string[] {
  return f.printed(script).filter((t) => !/\] (Loading|\d+ Items Ready)/.test(t))
}

/** Run the NOTECARD check of LS-setup-checker and return its lines after the heading. */
async function notecardCheck(notecards: Record<string, string>, opts: Opts = {}): Promise<string[]> {
  const f = await furniture(notecards, { ...opts, scripts: [...(opts.scripts ?? ['[LS]sit', '[LS]sit 1']), 'LS-setup-checker'] })
  f.click(owner, 'NOTECARD')
  f.settle(2_000)
  const out = f.printed('LS-setup-checker').map((t) => t.replace(/^LS-setup-checker: /, ''))
  const start = out.indexOf('Checking the pose notecards line by line.')
  return out.slice(start + 1, out.lastIndexOf('================================'))
}

describe('LuaSitter2 notecard check: well-formed notecards', () => {
  it('a notecard using every command gives no problem', async () => {
    const f = await furniture({ LSpos: GOOD })
    expect(told(f)).toEqual([])
    expect(told(f, '[LS]sit 1')).toEqual([])
    expect(await notecardCheck({ LSpos: GOOD })).toEqual(['No problems found.', 'Check complete, removing script.'])
  })

  it('the DUMP test notecard and the position lines of its dump give no message', async () => {
    const animations = ['cud_a', 'cud_b', 'talk_a', 'talk_b', 'smile']
    const f = await furniture({ LSpos: DUMP_CARD }, { animations })
    expect(told(f)).toEqual([])
    // [LS]sit's dump lines (90022), as [LS]adjuster writes them into the DUMP
    f.broadcast(90020, '', '')
    f.settle(5_000)
    const lines = f.linked().filter((m) => m.num === 90022 && m.str.startsWith('{')).map((m) => m.str.replace('{P:', '{'))
    expect(lines.length).toBeGreaterThan(0)
    const card = DUMP_CARD.split('\n').filter((l) => !l.startsWith('{') && !l.startsWith('SITTER 1') && !l.endsWith('_b'))
    const g = await furniture({ LSpos: card.concat(lines).join('\n') }, { animations })
    expect(told(g)).toEqual([])
    expect(await notecardCheck({ LSpos: DUMP_CARD }, { animations })).toEqual(['No problems found.', 'Check complete, removing script.'])
  })
})

describe('LuaSitter2 [LS]sit says nothing about notecard problems (LS-setup-checker does)', () => {
  it('a notecard with problems loads without notecard messages from [LS]sit', async () => {
    const card = 'MTYPE two\nSITTER 0\nPOSE Sit|nope\n{Gone}<0,0,1><0,0,0>\nPROP Ball|ball|0\nSITTER 2\nPOSE Unused|nope'
    const f = await furniture({ LSpos: card }, { plugins: [] })
    expect(told(f)).toEqual([])
    expect(told(f, '[LS]sit 1')).toEqual([])
    expect(f.printed('[LS]sit').join('\n')).toContain('Items Ready')
  })

  it('a position with text after it, or a 4th number, is read as AVsitter reads it', async () => {
    const card = 'SITTER 0\nPOSE A|anim1\nPOSE B|anim1\n{A}<0,0,1><0,0,90> // turned\n{B}<1,2,3,4><0,0,0,1>'
    const f = await furniture({ LSpos: card }, { scripts: ['[LS]sit'] })
    expect(told(f)).toEqual([])
    f.broadcast(90020, '', '')
    f.settle(5_000)
    const lines = f.linked().filter((m) => m.num === 90022 && m.str.startsWith('{')).map((m) => m.str)
    expect(lines).toEqual([
      '{P:A}<0.00000, 0.00000, 1.00000><0.00000, 0.00000, 90.00000>',
      '{P:B}<1.00000, 2.00000, 3.00000><0.00000, 0.00000, 0.00000>',
    ])
    expect(await notecardCheck({ LSpos: card }, { scripts: ['[LS]sit'] })).toEqual(['No problems found.', 'Check complete, removing script.'])
  })
})

describe('LuaSitter2 LS-setup-checker NOTECARD: each problem', () => {
  it('an AVpos notecard is checked the same way', async () => {
    expect(await notecardCheck({ AVpos: 'SITTER 0\nPOSE Sit|nope' }, { scripts: ['[LS]sit'] })).toEqual([
      "AVpos line 2: animation 'nope' is not in inventory",
      '1 problem(s) found.',
      'Check complete, removing script.',
    ])
  })

  it('missing animations, in sequences too (built-in animations are fine)', async () => {
    const out = await notecardCheck({ LSpos: 'SITTER 0\nPOSE Kneel|kneel2\nPOSE Sit|sit\nPOSE Seq|anim1|5|gone|5|M' }, { scripts: ['[LS]sit'] })
    expect(out).toEqual([
      "LSpos line 2: animation 'kneel2' is not in inventory",
      "LSpos line 4: animation 'gone' is not in inventory",
      '2 problem(s) found.',
      'Check complete, removing script.',
    ])
  })

  it('position lines: no pose above, a name longer than 23 characters, bad vectors, no "}"', async () => {
    const card = [
      'SITTER 0',
      '{Later}<0,0,1><0,0,0>',
      'POSE Later|anim1',
      'POSE A pose with a very long name|anim1',
      '{A pose with a very long name}<0,0,1><0,0,0>',
      '{Later}<0,0,1>',
      '{Later}<a,b,c><0,0,0>',
      '{Later<0,0,1><0,0,0>',
    ].join('\n')
    const out = await notecardCheck({ LSpos: card }, { scripts: ['[LS]sit'] })
    expect(out).toEqual([
      "LSpos line 2: position for 'Later', but no pose of that name above it (ignored)",
      "LSpos line 5: position for 'A pose with a very long name', but no pose of that name above it (ignored) (pose names are cut to 23 characters)",
      'LSpos line 6: position or rotation is not a <x,y,z> vector (read as <0,0,0>)',
      'LSpos line 7: position or rotation is not a <x,y,z> vector (read as <0,0,0>)',
      "LSpos line 8: position line without '}' (ignored)",
      '5 problem(s) found.',
      'Check complete, removing script.',
    ])
  })

  it('settings that are not numbers, names clashing after the 23-character cut, an unused SITTER section', async () => {
    const card = [
      'MTYPE two',
      'SITTER 0',
      'POSE A pose with a very long name 1|anim1',
      'POSE A pose with a very long name 2|anim1',
      'POSE Same|anim1',
      'POSE Same|anim2',
      'SITTER 2',
      'POSE Unused|nope',
    ].join('\n')
    expect(await notecardCheck({ LSpos: card })).toEqual([
      "LSpos line 1: MTYPE 'two' is not a number (read as 0)",
      "LSpos line 4: 'A pose with a very long name 2' is cut to 23 characters and then has the same name as line 3",
      'LSpos line 7: SITTER 2 is not used: there are sit scripts for SITTER 0 to 1',
      '3 problem(s) found.',
      'Check complete, removing script.',
    ])
  })

  it('PROP, ANIM and CAMERA lines without their plugin, once each (the AVsitter plugins count too)', async () => {
    const card = 'SITTER 0\nPOSE Sit|anim1\nPROP Ball|ball|0|<0,0,1>|<0,0,0>\nPROP Cup|ball|0\nANIM Sit|smile|5\nCAMERA Sit|<1,0,1>|<0,0,0>'
    expect(await notecardCheck({ LSpos: card }, { plugins: [], scripts: ['[LS]sit'] })).toEqual([
      "LSpos line 3: PROP lines need the script '[LS]plugins' in this prim",
      "LSpos line 5: ANIM lines need the script '[LS]faces-camera' in this prim",
      "LSpos line 6: CAMERA lines need the script '[LS]faces-camera' in this prim",
      '3 problem(s) found.',
      'Check complete, removing script.',
    ])
    expect(await notecardCheck({ LSpos: card }, { plugins: ['[AV]prop', '[AV]faces', '[AV]camera'], scripts: ['[LS]sit'] }))
      .toEqual(['No problems found.', 'Check complete, removing script.'])
  })

  it('a "LSpos sitter N" card is checked; the main section it replaces is not', async () => {
    const main = 'SITTER 0\nPOSE Sit|anim1\nSITTER 1\nPOSE Old|replaced_anim'
    expect(await notecardCheck({ LSpos: main, 'LSpos sitter 1': 'POSE Mine|mine_anim\n{Other}<0,0,1><0,0,0>' })).toEqual([
      "LSpos sitter 1 line 1: animation 'mine_anim' is not in inventory",
      "LSpos sitter 1 line 2: position for 'Other', but no pose of that name above it (ignored)",
      '2 problem(s) found.',
      'Check complete, removing script.',
    ])
  })
})

describe('LuaSitter2 LS-setup-checker NOTECARD', () => {
  it('lists every problem with its notecard and line, including what [LS]sit does not check', async () => {
    const main = [
      'MTYPE x', // 1
      'POSES Sit|anim1', // 2 unknown command
      'pose Sit|anim1', // 3 lower case
      'SITTER', // 4 no value
      'SITTER 0', // 5
      'POSE Sit|nope', // 6
      'SYNC Hug|hug_a', // 7
      'PROP Ball|no_such_object|0', // 8
      'RLV 1', // 9 no [LS]root-RLV
      'COMMANDS 5', // 10 no [LS]commands
      '{Gone}<0,0,1><0,0,0>', // 11
      'SITTER 1', // 12
      'POSE Other|dance1', // 13 built-in
      'SITTER 3', // 14
    ].join('\n')
    const out = await notecardCheck({ LSpos: main, 'LSpos sitter 1': 'POSE Mine|nope_too' }, { plugins: ['[LS]plugins'] })
    expect(out).toEqual([
      "LSpos line 1: MTYPE 'x' is not a number (read as 0)",
      "LSpos line 2: unknown command 'POSES' (ignored, unless a plugin reads it)",
      "LSpos line 3: 'pose' is ignored: commands are upper case (POSE)",
      "LSpos line 4: 'SITTER' without a value (ignored)",
      "LSpos line 6: animation 'nope' is not in inventory",
      "LSpos line 8: prop object 'no_such_object' is not in inventory",
      "LSpos line 9: RLV lines need the script '[LS]root-RLV' in this prim",
      "LSpos line 10: COMMANDS lines need the script '[LS]commands' in this prim",
      "LSpos line 11: position for 'Gone', but no pose of that name above it (ignored)",
      'LSpos line 14: SITTER 3 is not used: there are sit scripts for SITTER 0 to 1',
      "LSpos sitter 1 line 1: animation 'nope_too' is not in inventory",
      "LSpos line 7: SYNC 'Hug' has no SYNC line in SITTER 1",
      '12 problem(s) found.',
      'Check complete, removing script.',
    ])
  })

  it('PROP and RLV lines in a per-sitter card are reported as not read there; ANIM / CAMERA are fine', async () => {
    const own = 'POSE Mine|anim1\nPROP Ball|ball|0\nRLV 1\nANIM Mine|smile|5\nCAMERA Mine|<1,0,1>|<0,0,0>'
    const out = await notecardCheck({ LSpos: 'SITTER 0\nPOSE Sit|anim1\nSITTER 1\nPOSE Sit2|anim1', 'LSpos sitter 1': own })
    expect(out).toEqual([
      'LSpos sitter 1 line 2: PROP lines are only read from LSpos (ignored here)',
      'LSpos sitter 1 line 3: RLV lines are only read from LSpos (ignored here)',
      '2 problem(s) found.',
      'Check complete, removing script.',
    ])
  })

  it('lists all problems, not only the first 5', async () => {
    const card = ['SITTER 0', ...Array.from({ length: 12 }, (_, i) => `POSE P${i}|missing${i}`)].join('\n')
    const out = await notecardCheck({ LSpos: card }, { scripts: ['[LS]sit'] })
    expect(out.filter((l) => l.includes('is not in inventory')).length).toBe(12)
    expect(out).toContain('12 problem(s) found.')
  })
})

// ---------------------------------------------------------------------------
// Robustness: no script stops (a run-time error) on bad input.

const DEBUG_CHANNEL = 2147483647

function errors(f: Furniture): string[] {
  const out: string[] = []
  for (const [name, s] of Object.entries(f.scripts)) {
    for (const c of s.chat) {
      // "Could not find animation" is Second Life's notice when a plugin asks [LS]sit
      // (90001 / 90002) to play an animation that isn't there; the script goes on.
      // Anything else on DEBUG_CHANNEL is a run-time error.
      if (c.channel === DEBUG_CHANNEL && !c.text.startsWith('Could not find animation')) out.push(`${name}: ${c.text}`)
    }
    if (!(s as unknown as { running: boolean }).running) out.push(`${name}: not running`)
  }
  return out
}

const ROBUST_SCRIPTS = ['[LS]sit', '[LS]sit 1', '[LS]select', '[LS]root-security', '[LS]faces-camera',
  '[LS]root-control', '[LS]root-RLV', '[LS]Xcite!', '[LS]commands', '[LS]LockGuard', '[LS]LockMeister']

describe('LuaSitter2 robustness', () => {
  it('malformed lines of every command are read without a run-time error', async () => {
    const bad = [
      'SITTER', 'SITTER ', 'SITTER x', 'SITTER 0|', 'SITTER -1', 'SITTER 99', 'POSE', 'POSE |', 'POSE a|', 'POSE a|nope|x|nope2',
      'SYNC |', 'MENU', 'TOMENU |', 'BUTTON |', 'BUTTON x|abc', '{', '{}', '{a}<', '{nope}<1,2,3><4,5,6>', '}{',
      'ANIM |', 'ANIM a|x|y', 'ANIM a|1|x|', 'CAMERA a|<1|', 'PROP |', 'PROP1 a|b|c|<1>|<2>|x', 'MTYPE 99', 'ETYPE -5',
      'AMENU 7', 'KFM 9', 'TEXT |', 'ADJUST a|b|c', 'ROLES x|y', 'RLV x', 'TIMELOCK x|y', 'ONSIT x', 'COMMANDS x',
      'LMSOURCE x', 'SEQUENCE |', '◆', 'x◆POSE z|anim1', '|||', 'é', 'POSE ' + 'é'.repeat(40) + '|anim1', 'SYNC ' + 'x'.repeat(300) + '|anim1',
    ].join('\n')
    const good = 'SITTER 0|A\nPOSE p|anim1\n{p}<0,0,1><0,0,0>\nSITTER 1|B\nPOSE q|anim1'
    for (const card of [bad + '\n' + good, good + '\n' + bad]) {
      const f = await buildFurniture({
        sources: LS2_SCRIPTS,
        scripts: [...ROBUST_SCRIPTS, '[LS]adjuster', 'LS-setup-checker'],
        prims: 2,
        notecards: { LSpos: card, 'LSpos sitter 1': card, '[LS]Xcite_settings': bad },
        animations: ['anim1', 'smile'],
      })
      f.start()
      f.click(owner, 'NOTECARD')
      const a = f.avatar('Alice')
      const b = f.avatar('Bob')
      f.sit(a)
      f.sit(b)
      f.touch(a)
      f.broadcast(90020, '', '')
      f.settle(10_000)
      f.stand(a)
      f.settle(3_000)
      expect(errors(f)).toEqual([])
    }
  }, 60_000)

  it('malformed link messages 90000-90500 (as from a third-party LSL plugin) cause no run-time error', async () => {
    for (const seated of [false, true]) {
      const f = await buildFurniture({
        sources: LS2_SCRIPTS,
        scripts: ROBUST_SCRIPTS,
        prims: 2,
        notecards: { LSpos: GOOD, '[LS]Xcite_settings': 'Hug|0|1|0' },
        animations: ANIMS,
      })
      f.start()
      const alice = f.avatar('Alice')
      if (seated) f.sit(alice)
      const ak = alice.key
      const payloads: [string, string][] = [
        ['', ''], ['|', '|'], ['x', 'x'], ['0', ''], ['-1', '-1'], ['99', '99'], ['a|b|c|d|e|f|g|h|i|j', 'a|b|c'],
        ['Hug', ak], [ak, ak], ['0', ak], ['Hug', ak + '|' + ak], [ak + '|x', ''], ['Hug|' + ak, ak], ['', ak + '|' + ak + '|' + ak],
      ]
      for (let n = 90000; n <= 90500; n++) {
        for (const [str, id] of payloads) {
          for (const s of Object.values(f.scripts)) s.fire('link_message', { sender_num: s.host.linkNumber, num: n, str, id })
          f.advance(20)
        }
      }
      f.settle(5_000)
      expect(errors(f)).toEqual([])
    }
  }, 120_000)
})

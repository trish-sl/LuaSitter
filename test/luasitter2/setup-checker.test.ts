// LuaSitter2: LS-setup-checker. REPORT names the pose notecard in use and warns
// when both LSpos and AVpos are present; PERMS, ANIMS, the chooser and self-removal.
import { describe, it, expect } from 'vitest'
import { InventoryType } from '@rezless/vitest'
import { buildFurniture, LS2_SCRIPTS, OWNER } from '../helpers/furniture.js'
import type { Furniture } from '../helpers/furniture.js'

const CARD = 'SITTER 0\nPOSE Sit1|anim1\n{Sit1}<0,0,0.5><0,0,0>'

async function report(notecards: Record<string, string>, placeholders: string[] = []): Promise<string> {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]sit', 'LS-setup-checker'],
    placeholders,
    notecards,
    animations: ['anim1'],
  })
  f.start()
  const owner = { key: OWNER, name: 'Owner Resident' }
  if (f.dialogsFor(owner).length === 0) f.touch(owner)
  f.click(owner, 'REPORT')
  const checker = f.script('LS-setup-checker')
  for (let i = 0; i < 5; i++) {
    const last = checker.dialogs.at(-1)
    if (last && !last.answered && last.buttons.includes('OK')) checker.answerDialog('OK', { name: owner.name })
    f.settle(5_000)
  }
  return f.script('LS-setup-checker').chat.map((c) => c.text).join('\n')
}

describe('LuaSitter2 LS-setup-checker REPORT', () => {
  it('names the pose notecard in use', async () => {
    const text = await report({ LSpos: CARD })
    expect(text).toContain('pose notecard: LSpos')
    expect(text).not.toContain('BOTH LSpos and AVpos')
  })

  it('reports AVpos when that is the only notecard', async () => {
    const text = await report({ AVpos: CARD })
    expect(text).toContain('pose notecard: AVpos')
  })

  it('warns when both LSpos and AVpos are present', async () => {
    const text = await report({ LSpos: CARD, AVpos: CARD })
    expect(text).toContain('BOTH LSpos and AVpos')
  })

  it('warns about duplicate copies named like "LSpos 1", but not about "LSpos sitter 1"', async () => {
    const text = await report({ LSpos: CARD, 'LSpos 1': CARD, 'AVpos 2': CARD, 'LSpos sitter 1': CARD })
    expect(text).toContain('DUPLICATE notecard "LSpos 1"')
    expect(text).toContain('DUPLICATE notecard "AVpos 2"')
    expect(text).not.toContain('DUPLICATE notecard "LSpos sitter 1"')
  })

  it('a leftover [AV]Xcite!, [AV]root, [AV]LockGuard or [AV]LockMeister makes the setup MIXED', async () => {
    for (const leftover of ['[AV]Xcite!', '[AV]root', '[AV]LockGuard', '[AV]LockMeister']) {
      const text = await report({ LSpos: CARD }, [leftover])
      expect(text).toContain('setup: MIXED LuaSitter and AVsitter scripts!')
    }
    const ls = await report({ LSpos: CARD }, ['[LS]root'])
    expect(ls).toContain('LuaSitter scripts (2): [LS]root, [LS]sit')
  })

  it('counts the helper script under both names ([LS]helperscript, [AV]helperscript)', async () => {
    const ls = await report({ LSpos: CARD }, ['[LS]helperscript'])
    expect(ls).toContain('LuaSitter scripts (2): [LS]helperscript, [LS]sit')
    expect(ls).toContain('setup: LuaSitter')
    const av = await report({ LSpos: CARD }, ['[AV]helperscript'])
    expect(av).toContain('setup: MIXED LuaSitter and AVsitter scripts!')
  })

  it('lists the inventory and the notecard text, and ends with ----END----', async () => {
    const text = await report({ LSpos: CARD })
    expect(text).toContain('----START----')
    expect(text).toContain('----ANIMATIONS----')
    expect(text).toContain('1.anim1 [')
    expect(text).toContain('LSpos (notecard)')
    expect(text).toContain('POSE Sit1|anim1')
    expect(text).toContain('setup: LuaSitter')
    expect(text).toContain('----END----')
  })
})

// ---------------------------------------------------------------------------
// PERMS and ANIMS checks, the chooser and self-removal

const PERM_COPY = 0x8000
const PERM_MODIFY = 0x4000
const PERM_TRANSFER = 0x2000

async function checker(notecards: Record<string, string>, animations: string[], objectName?: string) {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['LS-setup-checker'],
    notecards,
    animations,
    ...(objectName ? { primNames: { 1: objectName } } : {}),
  })
  f.start()
  return f
}

const owner = { key: OWNER, name: 'Owner Resident' }
const printed = (f: Furniture) => f.printed('LS-setup-checker').map((t) => t.replace(/^LS-setup-checker: /, ''))
const hasScript = (f: Furniture) => f.prims[0]!.inventory.some((i) => i.name === 'LS-setup-checker')
const anims = (f: Furniture) => f.prims[0]!.inventory.filter((i) => i.type === InventoryType.ANIMATION).map((i) => i.name)

describe('LuaSitter2 LS-setup-checker PERMS', () => {
  it('counts the next-owner permissions of the animations and removes itself', async () => {
    const f = await checker({}, ['ct', 'c', 't', 'none'])
    const set = (name: string, next: number) => {
      const item = f.prims[0]!.inventory.find((i) => i.name === name)!
      ;(item as { permMask: object }).permMask = { ...item.permMask, next }
    }
    set('ct', PERM_COPY | PERM_TRANSFER | PERM_MODIFY)
    set('c', PERM_COPY | PERM_MODIFY)
    set('t', PERM_TRANSFER)
    set('none', PERM_MODIFY)
    f.click(owner, 'PERMS')
    const out = printed(f)
    expect(out).toContain('ct is COPY-TRANSFER!')
    expect(out).toContain('4 anims total')
    expect(out).toContain('1 anims are TRANSFER')
    expect(out).toContain('1 anims are COPY.')
    expect(out).toContain('1 anims are COPY-TRANSFER!')
    expect(out).toContain('Check complete, removing script.')
    expect(hasScript(f)).toBe(false)
  })

  it('stays in a Utilities box', async () => {
    const f = await checker({}, ['a'], 'AVsitter Utilities box')
    f.click(owner, 'PERMS')
    expect(hasScript(f)).toBe(true)
  })
})

describe('LuaSitter2 LS-setup-checker ANIMS', () => {
  const POSES = [
    'SITTER 0',
    'POSE Sit|used',
    'SYNC Hug|hugA',
    'POSE Gone|missing',
    'MENU Speed|V',
    'POSE Walk|walk',
    'SITTER 1',
    'POSE Late|late',
  ].join('\n')

  it('reports missing and unused anims; variable-speed +/- anims count as used', async () => {
    const f = await checker({ LSpos: POSES }, ['used', 'hugA', 'walk', 'walk+', 'walk-', 'late', 'extra', 'LShipfix'])
    f.click(owner, 'ANIMS')
    const out = printed(f)
    expect(out).toContain("Animation 'missing' not found in inventory!")
    expect(out).toContain('Anims were used in the notecard but not found in inventory!')
    expect(out).toContain("Animation 'extra' found in inventory but not used in notecard!")
    expect(out.join('\n')).not.toContain("'walk+' found")
    expect(out.join('\n')).not.toContain("'LShipfix' found")
    // asks before deleting the unused anims
    expect(f.lastDialog(owner).buttons).toEqual(['YES', 'NO'])
    expect(f.lastDialog(owner).message).toContain('1 unused')
  })

  it('YES deletes the unused anims, NO keeps them', async () => {
    const yes = await checker({ LSpos: 'SITTER 0\nPOSE A|a' }, ['a', 'b', 'c'])
    yes.click(owner, 'ANIMS')
    yes.click(owner, 'YES')
    expect(anims(yes)).toEqual(['a'])
    expect(printed(yes)).toContain("Deleted unused anim: 'b'")
    expect(printed(yes)).toContain('Check complete, removing script.')

    const no = await checker({ LSpos: 'SITTER 0\nPOSE A|a' }, ['a', 'b'])
    no.click(owner, 'ANIMS')
    no.click(owner, 'NO')
    expect(anims(no)).toEqual(['a', 'b'])
    expect(hasScript(no)).toBe(false)
  })

  it('warns about missing +/- anims of a variable-speed submenu', async () => {
    const f = await checker({ LSpos: 'SITTER 0\nMENU Fast|V\nPOSE Run|run' }, ['run', 'run+'])
    f.click(owner, 'ANIMS')
    const out = printed(f)
    expect(out).toContain("Variable-Speed Animation 'run-' not found in inventory!")
    expect(out.join('\n')).not.toContain("'run+' not found")
    expect(out).toContain('All anims referenced in the notecard were accounted for.')
    expect(out).toContain('No unused anims were found!')
  })

  it('anims only used in a per-sitter notecard are not unused; duplicate copies are not read', async () => {
    const f = await checker({
      LSpos: 'SITTER 0\nPOSE A|a',
      'LSpos sitter 1': 'POSE B|b',
      'LSpos 1': 'POSE C|c',
      // not read by [LS]sit either (sitter 0 uses the main card; no leading zeros)
      'LSpos sitter 0': 'POSE D|d',
      'LSpos sitter 02': 'POSE E|e',
    }, ['a', 'b', 'c', 'd', 'e'])
    f.click(owner, 'ANIMS')
    const out = printed(f).join('\n')
    expect(out).not.toContain("'b' found in inventory but not used")
    expect(out).toContain("'c' found in inventory but not used")
    expect(out).toContain("'d' found in inventory but not used")
    expect(out).toContain("'e' found in inventory but not used") // and no hang reading a missing "LSpos sitter 2"
  })

  it('reads AVpos when there is no LSpos, and says when there is no pose notecard', async () => {
    const av = await checker({ AVpos: 'SITTER 0\nPOSE A|a' }, ['a'])
    av.click(owner, 'ANIMS')
    expect(printed(av)).toContain('No unused anims were found!')

    const none = await checker({}, ['a'])
    none.click(owner, 'ANIMS')
    expect(printed(none)).toContain("LSpos notecard not found. Removing 'LS-setup-checker' from inventory.")
    expect(hasScript(none)).toBe(false)
  })

  it('the delete question times out after 60 s', async () => {
    const f = await checker({ LSpos: 'SITTER 0\nPOSE A|a' }, ['a', 'b'])
    f.click(owner, 'ANIMS')
    f.settle(61_000)
    expect(printed(f)).toContain('timeout')
    expect(anims(f)).toEqual(['a', 'b'])
    expect(hasScript(f)).toBe(false)
  })
})

describe('LuaSitter2 LS-setup-checker chooser', () => {
  it('ALL runs PERMS, ANIMS, NOTECARD then REPORT, and only the last step says it removes the script', async () => {
    const f = await checker({ LSpos: 'SITTER 0\nPOSE A|a' }, ['a'])
    f.click(owner, 'ALL')
    const out = printed(f)
    expect(out).toContain('1 anims total')
    expect(out).toContain('No unused anims were found!')
    expect(out).toContain('No problems found.')
    expect(out.filter((t) => t === 'Check complete.').length).toBe(3)
    expect(out).not.toContain('Check complete, removing script.')
    // then REPORT: the disclaimer dialog
    expect(f.lastDialog(owner).message).toContain('Click OK to proceed.')
  })

  it('CANCEL keeps the script; touching shows the menu again', async () => {
    const f = await checker({}, [])
    f.click(owner, 'CANCEL')
    expect(printed(f)).toContain('Cancelled. Touch to show the menu again.')
    expect(hasScript(f)).toBe(true)
    const before = f.dialogsFor(owner).length
    f.touch(owner)
    expect(f.dialogsFor(owner).length).toBe(before + 1)
    expect(f.lastDialog(owner).buttons).toContain('ALL')
  })

  it('removes itself when no check is chosen in 2 minutes (but not from a Utilities box)', async () => {
    const f = await checker({}, [])
    f.settle(121_000)
    expect(printed(f)).toContain('No check selected, removing script.')
    expect(hasScript(f)).toBe(false)

    const box = await checker({}, [], 'Utilities')
    box.settle(121_000)
    expect(printed(box)).toContain('No check selected. Touch to show the menu again.')
    expect(hasScript(box)).toBe(true)
  })

  it('REPORT without a LuaSitter/AVsitter product removes itself', async () => {
    const f = await checker({}, [])
    f.click(owner, 'REPORT')
    expect(printed(f)).toContain('Sorry, could not find correct product for this script.')
    expect(hasScript(f)).toBe(false)
  })

  it('REPORT removes itself when the disclaimer is not answered in 2 minutes', async () => {
    const f = await checker({ LSpos: 'SITTER 0' }, [])
    f.click(owner, 'REPORT')
    f.settle(121_000)
    expect(printed(f)).toContain('Diagnostic script removed.')
    expect(hasScript(f)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// more: the NOTECARD check without a notecard, the dataserver reader, REPORT details

const NAK = '\n\x15\n'
const EOF_LINE = '\n\n\n'

describe('LuaSitter2 LS-setup-checker more', () => {
  it('NOTECARD without a pose notecard says so and removes itself', async () => {
    const f = await checker({}, [])
    f.click(owner, 'NOTECARD')
    const out = printed(f)
    expect(out).toContain('LSpos notecard not found.')
    expect(out).toContain('Check complete, removing script.')
    expect(out).not.toContain('Checking the pose notecards line by line.')
    expect(hasScript(f)).toBe(false)
  })

  it('ALL without a pose notecard: ANIMS and NOTECARD say so without "removing", REPORT finds no product', async () => {
    const f = await checker({}, ['a'])
    f.click(owner, 'ALL')
    const out = printed(f)
    expect(out.filter((t) => t === 'LSpos notecard not found.')).toHaveLength(2)
    expect(out.join('\n')).not.toContain("Removing 'LS-setup-checker'")
    expect(out).toContain('Sorry, could not find correct product for this script.')
    expect(hasScript(f)).toBe(false)
  })

  it('ANIMS through the dataserver (NAK): an anim used again in a variable-speed submenu, a MENU line without a name', async () => {
    const f = await checker({ LSpos: 'SITTER 0\nPOSE Run|run\nMENU Fast|V\nPOSE RunFast|run\nMENU |\nPOSE Walk|walk' },
      ['run', 'run-', 'walk', 'walk-'])
    f.script('LS-setup-checker').mock('llGetNotecardLineSync', () => NAK)
    f.click(owner, 'ANIMS')
    f.settle(3_000)
    const out = printed(f)
    // "run" is used in the V submenu too: its +/- anims are checked and run- is used
    expect(out).toContain("Variable-Speed Animation 'run+' not found in inventory!")
    expect(out.join('\n')).not.toContain("'run-' not found")
    expect(out.join('\n')).not.toContain("'run-' found in inventory but not used")
    // "MENU |" (no name) ends the V submenu: walk is not variable-speed, so walk- is unused
    expect(out.join('\n')).not.toContain("'walk+' not found")
    expect(out).toContain("Animation 'walk-' found in inventory but not used in notecard!")
    expect(out).toContain('All anims referenced in the notecard were accounted for.')
    expect(f.lastDialog(owner).message).toContain('1 unused')
    // chat on another channel during the question is ignored
    f.script('LS-setup-checker').fire('listen', { channel: 5, name: owner.name, id: owner.key, msg: 'YES' })
    expect(anims(f)).toContain('walk-')
    f.click(owner, 'YES')
    expect(anims(f)).not.toContain('walk-')
  })

  it('NOTECARD through the dataserver: answers to other requests are ignored, blank lines skipped', async () => {
    const f = await checker({ LSpos: 'x' }, ['a'])
    const s = f.script('LS-setup-checker')
    const keys = Array.from({ length: 5 }, (_, i) => `99999999-0000-0000-0000-00000000000${i + 1}`)
    let asked = 0
    s.mock('llGetNotecardLineSync', () => NAK)
    s.mock('llGetNotecardLine', () => keys[asked++]!) // answered by hand below
    f.click(owner, 'NOTECARD')
    expect(asked).toBe(1)
    s.fire('dataserver', { queryid: '77777777-0000-0000-0000-000000000001', data: 'POSE Stray|stray' })
    s.fire('dataserver', { queryid: keys[0], data: 'POSE A|nope' })
    s.fire('dataserver', { queryid: keys[1], data: '   ' })
    s.fire('dataserver', { queryid: keys[2], data: EOF_LINE })
    f.settle()
    const out = printed(f)
    const start = out.indexOf('Checking the pose notecards line by line.')
    expect(out.slice(start + 1, start + 3)).toEqual([
      "LSpos line 1: animation 'nope' is not in inventory",
      '1 problem(s) found.',
    ])
    expect(hasScript(f)).toBe(false)
  })

  it('REPORT: an AVsitter setup in several prims, double spaces in names, a script not running, an over-long line', async () => {
    const long = 'x'.repeat(1100)
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['LS-setup-checker'],
      placeholders: ['[AV]sitA', '[AV]menu'],
      prims: 2,
      primNames: { 2: 'Pillow' },
      notecards: { AVpos: `SITTER 0\nPOSE Sit|anim1\n${long}`, 'My  notes': 'hello' },
      animations: ['anim1'],
    })
    f.start()
    f.script('[AV]menu').running = false
    const s = f.script('LS-setup-checker')
    f.click(owner, 'REPORT')
    expect(printed(f)).toContain('setup: AVsitter')
    // chat on another channel while the disclaimer is shown is ignored
    s.fire('listen', { channel: 5, name: owner.name, id: owner.key, msg: 'OK' })
    expect(s.chat).toEqual([])
    s.answerDialog('OK', { name: owner.name })
    f.settle(5_000)
    const text = s.chat.map((c) => c.text).join('\n')
    expect(text).toContain('setup: AVsitter')
    expect(text).toContain('AVsitter scripts (2): ')
    expect(text).toContain('total prims: 2')
    expect(text).toContain('1, Furniture, ')
    expect(text).toContain('2, Pillow, ')
    expect(text).toMatch(/\.My {2}notes \[[^\]]*\]\[[^\]]*\]~DOUBLE-SPACE IN NAME!~/)
    expect(text).toMatch(/\.\[AV\]menu \[[^\]]*\]\[[^\]]*\]~NOT RUNNING!~/)
    expect(text).not.toMatch(/\.\[AV\]sitA \[[^\]]*\]\[[^\]]*\]~NOT RUNNING!~/)
    // the 1100-character notecard line is cut to the 1000-byte chunk limit
    expect(text).toContain('x'.repeat(1000))
    expect(text).not.toContain('x'.repeat(1001))
    expect(text).toContain('----END----')
    expect(hasScript(f)).toBe(false)
  })

  it('REPORT: any answer but OK to the disclaimer removes the script without a report', async () => {
    const f = await checker({ LSpos: 'SITTER 0' }, [])
    const s = f.script('LS-setup-checker')
    f.click(owner, 'REPORT')
    const d = s.dialogs.at(-1)!
    f.say(owner, d.channel, 'no thanks')
    expect(printed(f)).toContain('Diagnostic script removed.')
    expect(s.chat.map((c) => c.text).join('\n')).not.toContain('----START----')
    expect(hasScript(f)).toBe(false)
  })
})

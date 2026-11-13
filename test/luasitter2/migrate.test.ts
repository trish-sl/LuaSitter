// LuaSitter2: the updater's Migrate mode (LS-update-sender + LS-update-receiver):
// AVsitter (LSL) scripts in old furniture replaced by their LuaSitter versions.
// The old furniture carries the original LSL update receiver, as AVsitter furniture does.
import { describe, it, expect } from 'vitest'
import { loadLinkset, makeInventoryItem, InventoryType } from '@rezless/vitest'
import type { Script } from '@rezless/vitest'
import path from 'node:path'
import { buildFurniture, INERT, LS2_SCRIPTS, OWNER, REGION, REPO } from '../helpers/furniture.js'
import type { Furniture } from '../helpers/furniture.js'

const PIN = -29752
const RECEIVER = 'update receiver (auto removing)'
const owner = { key: OWNER, name: 'Owner Resident' }
const LSL_RECEIVER = REPO + 'AVsitter2/Utilities/Updater/update-receiver.lsl'

const OLD_SCRIPTS = ['[AV]sitA', '[AV]sitB', '[AV]sitA 1', '[AV]sitB 1', '[AV]prop', '[AV]faces', '[AV]camera 1', 'My plugin']

/** Old AVsitter furniture: inert stand-ins for the [AV] scripts, the LSL receiver, an AVpos and a prop. */
async function oldFurniture(): Promise<Furniture> {
  const f = await buildFurniture({
    sources: { ...LS2_SCRIPTS, [RECEIVER]: LSL_RECEIVER },
    scripts: [RECEIVER],
    placeholders: OLD_SCRIPTS,
    notecards: { AVpos: 'SITTER 0\nPOSE Sit|anim1\n{Sit}<0,0,0.5><0,0,0>\nSITTER 1\nPOSE Sit|anim1\n{Sit}<1,0,0.5><0,0,0>' },
    animations: ['anim1'],
    objects: { ball: [] },
  })
  for (const name of OLD_SCRIPTS) f.script(name).start()
  f.script(RECEIVER).start()
  f.settle(1_000)
  return f
}

/** The sender object, at the same place, holding the LuaSitter receiver and the scripts to send (not running). */
async function sender(f: Furniture, scripts: string[]): Promise<Script> {
  const all = ['LS-update-sender', RECEIVER, ...scripts]
  const s = await loadLinkset({
    world: f.world, region: REGION, owner: OWNER, position: { x: 128, y: 128, z: 25 },
    prims: [{
      name: 'Sender',
      scripts: all.map((name) => ({ name, source: path.normalize(LS2_SCRIPTS[name.replace(/ \d+$/, '')]!) })),
    }],
  })
  const script = s.scripts['LS-update-sender']!
  script.start()
  f.settle(1_000)
  s.linkset.touch(1, { avatar: owner })
  f.settle(1_000)
  return script
}

const told = (s: Script) => s.chat.filter((c) => c.channel === 0).map((c) => c.text)
const scriptsOf = (f: Furniture) => f.prims[0]!.inventory.filter((i) => i.type === 10).map((i) => i.name).sort()
const NEEDED = ['[LS]sit', '[LS]sit 1', '[LS]plugins', '[LS]faces-camera', '[LS]faces-camera 1']

/** Choose Migrate and wait for the plan. */
function plan(f: Furniture, s: Script) {
  s.answerDialog('Migrate', { name: owner.name })
  f.settle(25_000)
}

describe('LuaSitter2 updater: Migrate', () => {
  it('shows the plan first and changes nothing before APPLY', async () => {
    const f = await oldFurniture()
    const s = await sender(f, NEEDED)
    expect(s.dialogs.at(-1)!.buttons).toEqual(['Update', 'Migrate', 'Range', 'Cancel'])
    plan(f, s)
    const text = told(s).join('\n')
    expect(text).toContain(`Sending: ${RECEIVER} to Furniture`) // the LSL receiver is replaced first
    const removeLine = told(s).find((t) => t.startsWith('  remove: '))!
    expect(removeLine.slice(10).split(', ').sort()).toEqual(OLD_SCRIPTS.filter((n) => n !== 'My plugin').sort())
    expect(text).toMatch(/ {2}add: \[LS\]faces-camera, \[LS\]faces-camera 1, \[LS\]plugins, \[LS\]sit, \[LS\]sit 1/)
    expect(text).toContain('  keep: My plugin')
    expect(s.dialogs.at(-1)!.buttons).toEqual(['APPLY', 'CANCEL'])
    // nothing removed yet; the objects (props) are still there
    expect(scriptsOf(f)).toEqual([...OLD_SCRIPTS, RECEIVER].sort())
    expect(f.prims[0]!.inventory.some((i) => i.name === 'ball')).toBe(true)
  })

  it('APPLY replaces the AVsitter scripts with running LuaSitter scripts, keeping notecards, props and other scripts', async () => {
    const f = await oldFurniture()
    const s = await sender(f, NEEDED)
    plan(f, s)
    s.answerDialog('APPLY', { name: owner.name })
    f.settle(30_000)
    expect(told(s).join('\n')).toContain('done: removed 7, started 5.')
    expect(told(s)).toContain('Migration complete! Sit and test every sitter, pose and prop.')
    expect(scriptsOf(f)).toEqual([...NEEDED, 'My plugin', RECEIVER].sort())
    for (const name of NEEDED) {
      const item = f.prims[0]!.inventory.find((i) => i.name === name)!
      expect(item.script!.running, name).toBe(true)
    }
    const kept = f.prims[0]!.inventory.map((i) => i.name)
    expect(kept).toContain('AVpos')
    expect(kept).toContain('ball')
    expect(kept).toContain('anim1')
  })

  it('does not migrate a prim when the sender lacks a needed script', async () => {
    const f = await oldFurniture()
    const s = await sender(f, NEEDED.filter((n) => n !== '[LS]sit 1'))
    plan(f, s)
    expect(told(s).join('\n')).toContain('  CANNOT migrate, this sender has no: [LS]sit 1')
    expect(told(s)).toContain('Nothing to migrate.')
    expect(scriptsOf(f)).toEqual([...OLD_SCRIPTS, RECEIVER].sort())
  })

  it('after APPLY, REMOVE deletes the LuaSitter receiver', async () => {
    const f = await oldFurniture()
    const s = await sender(f, NEEDED)
    plan(f, s)
    s.answerDialog('APPLY', { name: owner.name })
    f.settle(30_000)
    expect(s.dialogs.at(-1)!.buttons).toEqual(['REMOVE', 'KEEP'])
    s.answerDialog('REMOVE', { name: owner.name })
    f.settle(6_000)
    expect(told(s)).toContain('Removed 1 update receiver(s).')
    expect(scriptsOf(f)).toEqual([...NEEDED, 'My plugin'].sort())
  })

  it('REMOVE after an update names the prims whose LSL receiver cannot remove itself', async () => {
    const f = await oldFurniture()
    const card = makeInventoryItem({
      name: 'AVpos', type: InventoryType.NOTECARD, key: '44444444-0000-0000-0000-000000000003',
      notecardLines: ['SITTER 0', 'POSE New|anim1'], creator: OWNER,
    })
    const l = await loadLinkset({
      world: f.world, region: REGION, owner: OWNER, position: { x: 128, y: 128, z: 25 },
      prims: [{
        name: 'Sender',
        scripts: [{ name: 'LS-update-sender', source: path.normalize(LS2_SCRIPTS['LS-update-sender']!) }],
        inventory: [card],
      }],
    })
    const s = l.scripts['LS-update-sender']!
    s.start()
    f.settle(1_000)
    l.linkset.touch(1, { avatar: owner })
    f.settle(1_000)
    s.answerDialog('Update', { name: owner.name })
    f.settle(15_000)
    s.answerDialog('REMOVE', { name: owner.name })
    f.settle(6_000)
    expect(told(s)).toContain('Removed 0 update receiver(s).')
    expect(told(s)).toContain('Still have an update receiver (remove it by hand): Furniture')
    expect(scriptsOf(f)).toContain(RECEIVER)
  })

  it('finds a LuaSitter receiver under another name in the first step (it said "Found 0 prims" first)', async () => {
    const f = await buildFurniture({
      sources: { ...LS2_SCRIPTS, 'LS-update-receiver': LS2_SCRIPTS[RECEIVER]! },
      scripts: ['LS-update-receiver'],
      placeholders: ['[AV]sitA', '[AV]sitB'],
      notecards: { AVpos: 'SITTER 0\nPOSE Sit|anim1\n{Sit}<0,0,0.5><0,0,0>' },
      animations: ['anim1'],
    })
    f.start()
    f.settle(1_000)
    expect(f.printed('LS-update-receiver').join('\n')).toContain(`NOTICE: rename this script to "${RECEIVER}"`)
    const s = await sender(f, ['[LS]sit'])
    plan(f, s)
    expect(told(s)).not.toContain('No answer yet, asking again...')
    expect(told(s)).toContain('Found 1 prims with an update receiver...')
    expect(told(s).some((t) => t.startsWith(`Sending: ${RECEIVER}`))).toBe(false) // no second receiver
    s.answerDialog('APPLY', { name: owner.name })
    f.settle(30_000)
    expect(told(s).join('\n')).toContain('done: removed 2, started 1.')
    expect(scriptsOf(f)).toEqual(['LS-update-receiver', '[LS]sit'].sort())
  })

  it('CANCEL changes no script', async () => {
    const f = await oldFurniture()
    const s = await sender(f, NEEDED)
    plan(f, s)
    s.answerDialog('CANCEL', { name: owner.name })
    f.settle(5_000)
    expect(scriptsOf(f)).toEqual([...OLD_SCRIPTS, RECEIVER].sort())
  })
})

describe('LuaSitter2 LS-update-receiver: migration safety', () => {
  async function withLsReceiver() {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: [RECEIVER],
      placeholders: ['[AV]sitA', 'My plugin', '[LS]sit'],
      notecards: { AVpos: 'SITTER 0' },
    })
    f.start()
    return f
  }

  it('only deletes AVsitter scripts and only starts LuaSitter scripts', async () => {
    const f = await withLsReceiver()
    const me = f.prims[0]!.key
    f.say(owner, PIN, `MIGRATE_REMOVE|${me}|[AV]sitA|My plugin|AVpos|${RECEIVER}`)
    f.say(owner, PIN, `MIGRATE_START|${me}|[LS]sit`)
    f.say(owner, PIN, `MIGRATE_GO|${me}`)
    const names = f.prims[0]!.inventory.map((i) => i.name)
    expect(names).not.toContain('[AV]sitA')
    expect(names).toEqual(expect.arrayContaining(['My plugin', 'AVpos', RECEIVER, '[LS]sit']))
    const reply = f.script(RECEIVER).chat.map((c) => c.text).find((t) => t.startsWith('MIGRATE_DONE|'))
    expect(reply).toBe(`MIGRATE_DONE|${me}|ok|1|1`)
  })

  it('deletes nothing when a new script did not arrive', async () => {
    const f = await withLsReceiver()
    const me = f.prims[0]!.key
    f.say(owner, PIN, `MIGRATE_REMOVE|${me}|[AV]sitA`)
    f.say(owner, PIN, `MIGRATE_START|${me}|[LS]sit|[LS]sit 1`)
    f.say(owner, PIN, `MIGRATE_GO|${me}`)
    expect(f.prims[0]!.inventory.map((i) => i.name)).toContain('[AV]sitA')
    const reply = f.script(RECEIVER).chat.map((c) => c.text).find((t) => t.startsWith('MIGRATE_DONE|'))
    expect(reply).toBe(`MIGRATE_DONE|${me}|missing|[LS]sit 1`)
  })

  it('ignores commands for another prim', async () => {
    const f = await withLsReceiver()
    const other = '00000000-0000-0000-0000-00000000beef'
    f.say(owner, PIN, `MIGRATE_REMOVE|${other}|[AV]sitA`)
    f.say(owner, PIN, `MIGRATE_GO|${other}`)
    expect(f.prims[0]!.inventory.map((i) => i.name)).toContain('[AV]sitA')
  })
})

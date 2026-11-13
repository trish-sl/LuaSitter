// LuaSitter2: more of the remote updater. LS-update-sender: Cancel and menu
// timeouts, touches while busy, Range > 10 m, furniture already up to date,
// [BOX] targets, props resent with a new receiver, and the Migrate cases that
// stop early or go wrong. LS-update-receiver: removing itself when rezzed with
// a start parameter or sold, ignoring other owners, long script lists, and
// dropping the objects when loaded with start parameter -1.
import { describe, it, expect } from 'vitest'
import { loadLinkset, makeInventoryItem, InventoryType } from '@rezless/vitest'
import type { Script } from '@rezless/vitest'
import path from 'node:path'
import { buildFurniture, INERT, LS2_SCRIPTS, OWNER, REGION, REPO } from '../helpers/furniture.js'
import type { Furniture } from '../helpers/furniture.js'

const PIN = -29752
const RECEIVER = 'update receiver (auto removing)'
const owner = { key: OWNER, name: 'Owner Resident' }
const CARD = 'SITTER 0\nPOSE Old|anim1'

/** A sender object `dx` m east of the furniture: the sender script, plus scripts (by source) and items. */
async function senderNear(f: Furniture, opts: { dx?: number; scripts?: Record<string, string | typeof INERT>; items?: ReturnType<typeof makeInventoryItem>[] } = {}) {
  const scripts = [{ name: 'LS-update-sender', source: path.normalize(LS2_SCRIPTS['LS-update-sender']!) as string | typeof INERT }]
  for (const [name, source] of Object.entries(opts.scripts ?? {})) {
    scripts.push({ name, source: typeof source === 'string' ? path.normalize(source) : source })
  }
  const l = await loadLinkset({
    world: f.world, region: REGION, owner: OWNER, position: { x: 128 + (opts.dx ?? 0), y: 128, z: 25 },
    prims: [{ name: 'Sender', scripts, inventory: opts.items ?? [] }],
  })
  const s = l.scripts['LS-update-sender']!
  s.start()
  f.settle(1_000)
  const touch = () => {
    l.linkset.touch(1, { avatar: owner })
    f.settle(1_000)
  }
  const choose = (button: string, wait = 1_000) => {
    s.answerDialog(button, { name: owner.name })
    f.settle(wait)
  }
  const told = () => s.chat.filter((c) => c.channel === 0).map((c) => c.text)
  return { l, s, touch, choose, told }
}

/** Furniture with the LuaSitter receiver and an old LSpos. */
async function furniture(opts: { name?: string; placeholders?: string[]; objects?: Record<string, string[]>; lslReceiver?: boolean } = {}) {
  const f = await buildFurniture({
    sources: opts.lslReceiver ? { ...LS2_SCRIPTS, [RECEIVER]: REPO + 'AVsitter2/Utilities/Updater/update-receiver.lsl' } : LS2_SCRIPTS,
    scripts: [RECEIVER],
    placeholders: opts.placeholders,
    notecards: { LSpos: CARD },
    objects: opts.objects,
    primNames: opts.name ? { 1: opts.name } : undefined,
  })
  f.start()
  return f
}

const newCard = (key: string) => makeInventoryItem({
  name: 'LSpos', type: InventoryType.NOTECARD, key, notecardLines: ['SITTER 0', 'POSE New|anim1'], creator: OWNER,
})

describe('LS-update-sender: menus', () => {
  it('Cancel closes the menu; a touch opens it again', async () => {
    const f = await furniture()
    const u = await senderNear(f, { items: [newCard('44444444-0000-0000-0000-0000000000a1')] })
    u.touch()
    u.choose('Cancel')
    expect(u.s.listens.filter((l) => l.channel !== PIN)).toEqual([])
    const before = u.s.dialogs.length
    u.touch()
    expect(u.s.dialogs.length).toBe(before + 1)
    expect(u.s.dialogs.at(-1)!.buttons).toEqual(['Update', 'Migrate', 'Range', 'Cancel'])
  })

  it('the menus stop listening after 2 minutes', async () => {
    const f = await furniture()
    const u = await senderNear(f, { items: [newCard('44444444-0000-0000-0000-0000000000a2')] })
    u.touch()
    u.choose('Range')
    f.settle(121_000)
    expect(u.s.listens.filter((l) => l.channel !== PIN)).toEqual([])
    u.touch() // idle again: the main menu
    f.settle(121_000)
    expect(u.s.listens.filter((l) => l.channel !== PIN)).toEqual([])
    expect(u.told()).toEqual([])
  })

  it('ignores touches while it is updating', async () => {
    const f = await furniture()
    const u = await senderNear(f, { items: [newCard('44444444-0000-0000-0000-0000000000a3')] })
    u.touch()
    u.choose('Update', 2_000) // collecting the answers
    const before = u.s.dialogs.length
    u.touch()
    expect(u.s.dialogs.length).toBe(before)
    f.settle(15_000)
    expect(u.told()).toContain('Updates complete!')
  })

  it('Range > 10 m does not reach furniture 15 m away', async () => {
    const f = await furniture()
    const u = await senderNear(f, { dx: 15, items: [newCard('44444444-0000-0000-0000-0000000000a4')] })
    u.touch()
    u.choose('Range')
    u.choose('10 m')
    expect(u.s.dialogs.at(-1)!.message).toContain('Now: 10 m.')
    u.choose('Update', 16_000)
    expect(u.told()).toContain('listening... (range: 10 m)')
    expect(u.told()).toContain('Found 0 prims...')
  })

  it('Region range: no answer to UPDATE / CANCEL in 2 minutes cancels the update', async () => {
    const f = await furniture()
    const u = await senderNear(f, { dx: 120, items: [newCard('44444444-0000-0000-0000-0000000000a5')] })
    u.touch()
    u.choose('Range')
    u.choose('Region')
    u.choose('Update', 15_000)
    expect(u.s.dialogs.at(-1)!.buttons).toEqual(['UPDATE', 'CANCEL'])
    f.settle(121_000)
    expect(u.told()).toContain('Update cancelled (no answer).')
    expect(f.prims[0]!.inventory.map((i) => i.name)).not.toContain('LSpos 1')
  })

  it('no answer to REMOVE / KEEP in 2 minutes keeps the receivers', async () => {
    const f = await furniture()
    const u = await senderNear(f, { items: [newCard('44444444-0000-0000-0000-0000000000a6')] })
    u.touch()
    u.choose('Update', 15_000)
    expect(u.s.dialogs.at(-1)!.buttons).toEqual(['REMOVE', 'KEEP'])
    f.settle(121_000)
    expect(u.told()).toContain('Update receivers kept.')
    expect(f.prims[0]!.inventory.map((i) => i.name)).toContain(RECEIVER)
  })
})

describe('LS-update-sender: what it sends', () => {
  it('sends nothing to furniture whose items are the same as the sender\'s', async () => {
    const f = await furniture()
    const same = makeInventoryItem({
      name: 'LSpos', type: InventoryType.NOTECARD, key: f.itemKey('LSpos'), notecardLines: CARD.split('\n'), creator: OWNER,
    })
    const u = await senderNear(f, { items: [same] })
    u.touch()
    u.choose('Update', 15_000)
    expect(u.told()).toContain('Found 1 prims...')
    expect(u.told().some((t) => t.startsWith('Sending: '))).toBe(false)
    expect(u.s.callsOf('llRemoteLoadScriptPin')).toEqual([])
    expect(u.told()).toContain('Updates complete!')
  })

  it('loads the scripts of a [BOX] object not running (the receiver still runs)', async () => {
    const f = await furniture({ name: 'Bench [BOX]', placeholders: ['[LS]select'] })
    const u = await senderNear(f, { scripts: { '[LS]select': INERT, [RECEIVER]: LS2_SCRIPTS[RECEIVER]! } })
    u.touch()
    u.choose('Update', 15_000)
    const loads = u.s.callsOf('llRemoteLoadScriptPin').map((c) => [c.args[1], Number(c.args[3])])
    expect(loads).toContainEqual(['[LS]select', 0])
    expect(loads).toContainEqual([RECEIVER, 1])
    expect(f.prims[0]!.inventory.find((i) => i.name === '[LS]select')!.script!.running).toBe(false)
  })

  it('resends the props when it sends a new receiver (which drops the objects)', async () => {
    const f = await furniture({ objects: { ball: [] } })
    const ballKey = f.prims[0]!.inventory.find((i) => i.name === 'ball')!.key
    const ball = makeInventoryItem({ name: 'ball', type: InventoryType.OBJECT, key: ballKey, creator: OWNER })
    const u = await senderNear(f, { scripts: { [RECEIVER]: LS2_SCRIPTS[RECEIVER]! }, items: [ball] })
    u.touch()
    u.choose('Update', 15_000)
    expect(u.told().some((t) => t.startsWith(`Sending: ${RECEIVER} to `))).toBe(true)
    expect(u.told().some((t) => t.startsWith('Sending: ball to '))).toBe(true)
    expect(f.prims[0]!.inventory.map((i) => i.name)).toContain('ball')
  })
})

describe('LS-update-sender: Migrate stops early or goes wrong', () => {
  const told = (s: Script) => s.chat.filter((c) => c.channel === 0).map((c) => c.text)

  async function migrating(opts: { name?: string; placeholders?: string[]; senderScripts?: string[]; senderHasReceiver?: boolean; lslReceiver?: boolean } = {}) {
    const f = await furniture({ name: opts.name, placeholders: opts.placeholders ?? ['[AV]sitA', '[AV]sitB'], lslReceiver: opts.lslReceiver })
    const scripts: Record<string, string> = {}
    if (opts.senderHasReceiver !== false) scripts[RECEIVER] = LS2_SCRIPTS[RECEIVER]!
    for (const n of opts.senderScripts ?? ['[LS]sit']) scripts[n] = LS2_SCRIPTS[n]!
    const u = await senderNear(f, { scripts })
    u.touch()
    return { f, ...u }
  }

  it('with no furniture around: nothing to migrate', async () => {
    const f = await buildFurniture({ sources: LS2_SCRIPTS, scripts: ['LS-update-sender', RECEIVER] })
    f.start()
    f.touch(owner)
    f.click(owner, 'Migrate')
    f.settle(40_000)
    const s = f.script('LS-update-sender')
    expect(told(s)).toContain('Found 0 prims with an update receiver...')
    expect(told(s)).toContain('Found 0 prims with a LuaSitter receiver. Nothing to migrate.')
  })

  it('furniture without AVsitter scripts: nothing to migrate', async () => {
    const u = await migrating({ placeholders: ['[LS]sit'] })
    u.choose('Migrate', 40_000)
    expect(u.told()).toContain('Furniture (link 0): no AVsitter scripts.')
    expect(u.told()).toContain('Nothing to migrate.')
  })

  it('needs the LuaSitter receiver in the sender for furniture with the LSL receiver', async () => {
    const u = await migrating({ senderHasReceiver: false, lslReceiver: true })
    u.choose('Migrate', 20_000)
    expect(u.told()).toContain(`Put the LuaSitter "${RECEIVER}" (LS-update-receiver) in this sender to migrate.`)
    expect(u.f.prims[0]!.inventory.map((i) => i.name)).toContain('[AV]sitA')
  })

  it('migrates furniture that already has the LuaSitter receiver without one in the sender', async () => {
    const u = await migrating({ senderHasReceiver: false })
    u.choose('Migrate', 40_000)
    expect(u.told()).toContain('Found 1 prims with an update receiver...')
    expect(u.s.dialogs.at(-1)!.buttons).toEqual(['APPLY', 'CANCEL'])
    u.choose('APPLY', 30_000)
    expect(u.told().join('\n')).toContain('done: removed 2, started 1.')
  })

  it('no answer to APPLY / CANCEL in 2 minutes cancels the migration', async () => {
    const u = await migrating()
    u.choose('Migrate', 40_000)
    expect(u.s.dialogs.at(-1)!.buttons).toEqual(['APPLY', 'CANCEL'])
    u.f.settle(121_000)
    expect(u.told()).toContain('Migration cancelled (no answer).')
    expect(u.f.prims[0]!.inventory.map((i) => i.name)).toContain('[AV]sitA')
  })

  it('a [BOX] object gets the new scripts, not running', async () => {
    const u = await migrating({ name: 'Bench [BOX]' })
    u.choose('Migrate', 40_000)
    u.choose('APPLY', 30_000)
    expect(u.told().join('\n')).toContain('done: removed 2, started 0.')
    const sit = u.f.prims[0]!.inventory.find((i) => i.name === '[LS]sit')!
    expect(sit.script!.running).toBe(false)
    expect(u.f.prims[0]!.inventory.map((i) => i.name)).not.toContain('[AV]sitA')
  })

  it('says which scripts did not arrive, and removes nothing there', async () => {
    const u = await migrating()
    u.choose('Migrate', 40_000)
    u.s.mock('llRemoteLoadScriptPin', () => undefined) // the new scripts get lost on the way
    u.choose('APPLY', 30_000)
    expect(u.told()).toContain('  NOT migrated, these scripts did not arrive (nothing was removed): [LS]sit')
    expect(u.f.prims[0]!.inventory.map((i) => i.name)).toContain('[AV]sitA')
  })

  it('a prim that does not answer within 15 s is reported and skipped', async () => {
    const u = await migrating()
    u.choose('Migrate', 40_000)
    // from now on the furniture hears nothing the sender region-says (MIGRATE_GO included)
    u.s.mock('llRegionSay', () => undefined)
    u.choose('APPLY', 30_000)
    expect(u.told()).toContain('  no answer from Furniture (link 0): nothing was removed there.')
    expect(u.f.prims[0]!.inventory.map((i) => i.name)).toContain('[AV]sitA')
  })
})

describe('LS-update-receiver', () => {
  async function receiver(opts: { placeholders?: string[]; objects?: Record<string, string[]>; startParam?: number } = {}) {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: [RECEIVER],
      placeholders: opts.placeholders,
      notecards: { LSpos: CARD },
      objects: opts.objects,
    })
    if (opts.startParam !== undefined) f.script(RECEIVER).mock('llGetStartParameter', () => opts.startParam!)
    f.start()
    return f
  }
  const removed = (f: Furniture) => f.script(RECEIVER).callsOf('llRemoveInventory').map((c) => String(c.args[0]))

  it('removes itself (and its PIN and name label) when rezzed with a start parameter, not with 0', async () => {
    const f = await receiver()
    const root = f.prims[0]!
    expect(root.remoteScriptAccessPin).toBe(PIN)
    f.script(RECEIVER).fire('on_rez', { start_param: 0 })
    f.settle()
    expect(removed(f)).toEqual([])
    root.appearance.text = { text: 'Furniture', color: { x: 1, y: 1, z: 0 }, alpha: 1 }
    f.script(RECEIVER).fire('on_rez', { start_param: 7 })
    f.settle()
    expect(removed(f)).toEqual([RECEIVER])
    expect(root.remoteScriptAccessPin).toBe(0)
    expect(root.appearance.text?.text ?? '').toBe('')
  })

  it('removes itself when the furniture changes owner (sold)', async () => {
    const f = await receiver()
    f.script(RECEIVER).fire('changed', { changes: 0x80 }) // CHANGED_OWNER
    f.settle()
    expect(removed(f)).toEqual([RECEIVER])
  })

  it('does not answer a search from someone else\'s object or avatar', async () => {
    const f = await receiver()
    const alice = f.avatar('Alice')
    f.say(alice, PIN, 'OBJECT_SEARCH|LSpos')
    expect(f.script(RECEIVER).chat.filter((c) => c.channel === PIN)).toEqual([])
    f.say(owner, PIN, 'OBJECT_SEARCH|LSpos|missing item')
    expect(f.script(RECEIVER).chat.filter((c) => c.channel === PIN).map((c) => c.text))
      .toEqual([`OBJECT_HERE|LSpos|${f.itemKey('LSpos')}`])
  })

  it('splits a long list of scripts into answers that fit in chat', async () => {
    const names: string[] = []
    for (let i = 0; i < 40; i++) names.push(`A plugin with a long name number ${i}`)
    const f = await receiver({ placeholders: names })
    f.say(owner, PIN, 'MIGRATE_SEARCH')
    const answers = f.script(RECEIVER).chat.filter((c) => c.channel === PIN).map((c) => c.text)
    expect(answers.length).toBeGreaterThan(1)
    for (const a of answers) {
      expect(a.length).toBeLessThanOrEqual(1000)
      expect(a.startsWith(`MIGRATE_HERE|${f.prims[0]!.key}|Furniture (link 0)`)).toBe(true)
    }
    const listed = answers.flatMap((a) => a.split('|').slice(3)).sort()
    expect(listed).toEqual([...names].sort())
  })

  it('loaded with start parameter -1, drops the objects of the prim (the sender resends the ones still needed)', async () => {
    const f = await receiver({ objects: { ball: [], chair: [] }, startParam: -1 })
    expect(f.prims[0]!.inventory.filter((i) => i.type === InventoryType.OBJECT)).toEqual([])
    const said = f.script(RECEIVER).chat.filter((c) => c.channel === 0).map((c) => c.text).sort()
    expect(said).toEqual(['Removing :ball', 'Removing :chair'])
  })
})

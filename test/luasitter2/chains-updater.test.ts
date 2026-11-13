// LuaSitter2: chain plugins ([LS]LockGuard, [LS]LockMeister) and the remote updater
// (LS-update-sender in a sender object, LS-update-receiver in the furniture).
import { describe, it, expect } from 'vitest'
import { loadLinkset, makeInventoryItem, InventoryType } from '@rezless/vitest'
import { buildFurniture, LS2_SCRIPTS, OWNER, REGION } from '../helpers/furniture.js'
import type { Furniture, Avatar } from '../helpers/furniture.js'
import path from 'node:path'

const CARD = `SITTER 0
POSE arms|anim1
POSE free|anim2
{arms}<0,0,0.5><0,0,0>
{free}<0,0,0.5><0,0,0>`

/** Furniture with the chain plugin and prims named ring1 / ring2 (the chain points). */
async function chained(plugin: string) {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]sit', plugin],
    prims: 3,
    primNames: { 2: 'ring1', 3: 'ring2' },
    notecards: { LSpos: CARD },
    animations: ['anim1', 'anim2'],
  })
  f.start()
  return f
}

const whispers = (f: Furniture, script: string, channel: number) =>
  f.script(script).chat.filter((c) => c.channel === channel).map((c) => c.text)

describe('LuaSitter2 [LS]LockGuard', () => {
  const LOCKGUARD = -9119

  it('links the cuffs of a pose in POSES to the ring prims', async () => {
    const f = await chained('[LS]LockGuard')
    const alice = f.avatar('Alice')
    f.sit(alice) // first pose: "arms" = rightwrist to ring1, leftwrist to ring2
    const ring1 = f.prims[1]!.key
    const ring2 = f.prims[2]!.key
    const said = whispers(f, '[LS]LockGuard', LOCKGUARD)
    expect(said.some((t) => t.startsWith(`lockguard ${alice.key} rightwrist link ${ring1} `))).toBe(true)
    expect(said.some((t) => t.startsWith(`lockguard ${alice.key} leftwrist link ${ring2} `))).toBe(true)
  })

  it('unlinks the chains for a pose without chains, and when the sitter stands up', async () => {
    const f = await chained('[LS]LockGuard')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'free')
    expect(whispers(f, '[LS]LockGuard', LOCKGUARD)).toContain(`lockguard ${alice.key} rightwrist unlink`)
    const f2 = await chained('[LS]LockGuard')
    const bob = f2.avatar('Bob')
    f2.sit(bob)
    f2.stand(bob)
    expect(whispers(f2, '[LS]LockGuard', LOCKGUARD)).toContain(`lockguard ${bob.key} leftwrist unlink`)
  })

  it('does not take a sitting avatar for a ring prim', async () => {
    const f = await chained('[LS]LockGuard')
    const ringo = f.avatar('Ringo') // an avatar whose name contains "ring"
    f.sit(ringo)
    const said = whispers(f, '[LS]LockGuard', LOCKGUARD).join('\n')
    expect(said).not.toContain(`link ${ringo.key}`)
  })
})

describe('LuaSitter2 [LS]LockMeister', () => {
  const LM = -8888

  it('asks the cuffs of a pose in POSES, and draws a chain when a cuff answers (LMV1), then asks LMV2', async () => {
    const f = await chained('[LS]LockMeister')
    const alice: Avatar = f.avatar('Alice')
    f.sit(alice)
    const asked = whispers(f, '[LS]LockMeister', LM)
    expect(asked).toContain(`${alice.key}rcuff`)
    expect(asked).toContain(`${alice.key}lcuff`)
    f.say(alice, LM, `${alice.key}rcuff ok`) // the right wrist cuff answers
    const lm = f.script('[LS]LockMeister')
    const chains = lm.callsOf('llLinkParticleSystem')
    expect(chains.length).toBeGreaterThan(0)
    expect(chains.at(-1)!.args[0]).toBe(2) // from ring1
    expect(whispers(f, '[LS]LockMeister', LM)).toContain(`${alice.key}|LMV2|RequestPoint|rcuff`)
  })
})

describe('LuaSitter2 remote updater', () => {
  it('the sender sends a newer notecard and the receiver script to the furniture', async () => {
    // the furniture to update: receiver + an old LSpos
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['update receiver (auto removing)'],
      notecards: { LSpos: 'SITTER 0\nPOSE Old|anim1' },
    })
    f.start()
    const oldKey = f.itemKey('LSpos')

    // the sender object, at the same place: the sender script, a newer LSpos and the receiver script (not running)
    const newCard = makeInventoryItem({
      name: 'LSpos', type: InventoryType.NOTECARD, key: '44444444-0000-0000-0000-000000000001',
      notecardLines: ['SITTER 0', 'POSE New|anim1'], creator: OWNER,
    })
    const sender = await loadLinkset({
      world: f.world, region: REGION, owner: OWNER, position: { x: 128, y: 128, z: 25 },
      prims: [{
        name: 'Sender',
        scripts: [
          { name: 'LS-update-sender', source: path.normalize(LS2_SCRIPTS['LS-update-sender']!) },
          { name: 'update receiver (auto removing)', source: path.normalize(LS2_SCRIPTS['update receiver (auto removing)']!) },
        ],
        inventory: [newCard],
      }],
    })
    sender.scripts['LS-update-sender']!.start()
    f.settle(1_000)
    sender.linkset.touch(1, { avatar: { key: OWNER, name: 'Owner Resident' } })
    f.settle(1_000)
    sender.scripts['LS-update-sender']!.answerDialog('Update', { name: 'Owner Resident' }) // the Update / Migrate menu
    f.settle(15_000)

    const told = sender.scripts['LS-update-sender']!.chat.map((c) => c.text)
    expect(told).toContain('Found 1 prims...')
    expect(told.some((t) => t.startsWith('Sending: LSpos to '))).toBe(true)
    expect(told.some((t) => t.startsWith('Sending: update receiver (auto removing) to '))).toBe(true)
    expect(told).toContain('Updates complete!')
    // The new notecard arrives next to the old one as "LSpos 1": giving an item to a prim
    // that already has one with that name adds a numbered copy (as in Second Life). The
    // updater (like upstream) only replaces scripts and objects in place. LuaSitter does
    // not read "LSpos 1" (per-sitter notecards are "LSpos sitter N"), and LS-setup-checker
    // reports it as a duplicate.
    const items = f.prims[0]!.inventory.map((i) => [i.name, i.key])
    expect(items).toContainEqual(['LSpos', oldKey])
    expect(items).toContainEqual(['LSpos 1', newCard.key])
  })

  /** Furniture with a receiver at 128,128,25, and a sender `dx` metres east of it (touched, menu open). */
  async function apart(dx: number) {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['update receiver (auto removing)'],
      notecards: { LSpos: 'SITTER 0\nPOSE Old|anim1' },
    })
    f.start()
    const s = await loadLinkset({
      world: f.world, region: REGION, owner: OWNER, position: { x: 128 + dx, y: 128, z: 25 },
      prims: [{
        name: 'Sender',
        scripts: [{ name: 'LS-update-sender', source: path.normalize(LS2_SCRIPTS['LS-update-sender']!) }],
        inventory: [makeInventoryItem({
          name: 'LSpos', type: InventoryType.NOTECARD, key: '44444444-0000-0000-0000-000000000002',
          notecardLines: ['SITTER 0', 'POSE New|anim1'], creator: OWNER,
        })],
      }],
    })
    const sender = s.scripts['LS-update-sender']!
    sender.start()
    f.settle(1_000)
    const touch = () => {
      s.linkset.touch(1, { avatar: { key: OWNER, name: 'Owner Resident' } })
      f.settle(1_000)
    }
    const choose = (button: string, wait = 1_000) => {
      sender.answerDialog(button, { name: 'Owner Resident' })
      f.settle(wait)
    }
    const told = () => sender.chat.filter((c) => c.channel === 0).map((c) => c.text)
    const searches = () => sender.chat.filter((c) => c.channel === -29752 && c.text.startsWith('OBJECT_SEARCH'))
    touch()
    return { f, sender, touch, choose, told, searches }
  }

  it('by default shouts the search and finds furniture up to 100 m away (upstream: half the sender size)', async () => {
    const u = await apart(50)
    u.choose('Update', 15_000)
    expect(u.searches().at(-1)!.type).toBe('shout')
    expect(u.told()).toContain('listening... (range: Shout 100 m)')
    expect(u.told()).toContain('Found 1 prims...')
    expect(u.told()).toContain('Updates complete!')
  })

  it('Range > Prim size keeps the upstream rule, and the choice survives the reset after a run', async () => {
    const u = await apart(50)
    u.choose('Range')
    expect(u.sender.dialogs.at(-1)!.buttons).toEqual(['10 m', '20 m', 'Shout 100 m', 'Region', 'Prim size'])
    u.choose('Prim size') // back to the main menu
    expect(u.sender.dialogs.at(-1)!.message).toContain('Now: prim size (')
    u.choose('Update', 15_000)
    expect(u.searches().at(-1)!.type).toBe('say')
    expect(u.told()).toContain('Found 0 prims...')
    // the script reset after the run; the range is kept
    u.touch()
    expect(u.sender.dialogs.at(-1)!.message).toContain('Now: prim size (')
  })

  it('Range > 20 m does not reach furniture 50 m away', async () => {
    const u = await apart(50)
    u.choose('Range')
    u.choose('20 m')
    u.choose('Update', 15_000)
    expect(u.searches().at(-1)!.type).toBe('say')
    expect(u.told()).toContain('Found 0 prims...')
  })

  it('Range > Region searches the whole region and asks before updating', async () => {
    const u = await apart(120)
    u.choose('Range')
    u.choose('Region')
    u.choose('Update', 15_000)
    expect(u.searches().at(-1)!.type).toBe('regionSay')
    expect(u.told()).toContain('Found 1 prims...')
    expect(u.sender.dialogs.at(-1)!.buttons).toEqual(['UPDATE', 'CANCEL'])
    expect(u.told().some((t) => t.startsWith('Sending: '))).toBe(false)
    u.choose('CANCEL')
    expect(u.told()).toContain('Update cancelled. Nothing was changed.')
    expect(u.f.prims[0]!.inventory.map((i) => i.name)).not.toContain('LSpos 1')

    // again, and UPDATE
    u.touch()
    u.choose('Update', 15_000)
    u.choose('UPDATE', 5_000)
    expect(u.told().some((t) => t.startsWith('Sending: LSpos to '))).toBe(true)
    expect(u.told()).toContain('Updates complete!')
  })

  const RECEIVER = 'update receiver (auto removing)'
  const LABEL = (text: string) => ({ text, color: { x: 1, y: 1, z: 0 }, alpha: 1 })

  it('does not label the furniture with its name (upstream did, every 10 s)', async () => {
    const u = await apart(0)
    u.f.settle(25_000)
    expect(u.f.prims[0]!.appearance.text?.text ?? '').toBe('')
  })

  it('after an update, REMOVE deletes the receiver and clears an old name label', async () => {
    const u = await apart(0)
    const root = u.f.prims[0]!
    root.appearance.text = LABEL('Furniture') // left by an upstream receiver
    u.choose('Update', 15_000)
    expect(u.told()).toContain('Updates complete!')
    expect(u.sender.dialogs.at(-1)!.buttons).toEqual(['REMOVE', 'KEEP'])
    u.choose('REMOVE', 6_000)
    expect(u.told()).toContain('Removed 1 update receiver(s).')
    expect(root.inventory.map((i) => i.name)).not.toContain(RECEIVER)
    expect(root.remoteScriptAccessPin).toBe(0)
    expect(root.appearance.text?.text ?? '').toBe('')
  })

  it('REMOVE keeps hover text that is not the name label', async () => {
    const u = await apart(0)
    const root = u.f.prims[0]!
    root.appearance.text = LABEL('Sit here!')
    u.choose('Update', 15_000)
    u.choose('REMOVE', 6_000)
    expect(root.inventory.map((i) => i.name)).not.toContain(RECEIVER)
    expect(root.appearance.text?.text).toBe('Sit here!')
  })

  it('KEEP leaves the receiver for the next update', async () => {
    const u = await apart(0)
    u.choose('Update', 15_000)
    u.choose('KEEP')
    expect(u.told()).toContain('Update receivers kept.')
    expect(u.f.prims[0]!.inventory.map((i) => i.name)).toContain(RECEIVER)
  })

  it('reports completion when no furniture answers (upstream looped forever)', async () => {
    const f = await buildFurniture({ sources: LS2_SCRIPTS, scripts: ['LS-update-sender'] })
    f.start()
    f.touch({ key: OWNER, name: 'Owner Resident' })
    f.click({ key: OWNER, name: 'Owner Resident' }, 'Update')
    f.settle(20_000)
    const sender = f.script('LS-update-sender')
    const told = sender.chat.map((c) => c.text)
    expect(told).toContain('No answer yet, asking again...')
    expect(sender.chat.filter((c) => c.channel === -29752).length).toBe(3) // asked at 0, 5 and 10 s
    expect(told).toContain('Found 0 prims...')
    expect(told).toContain('Updates complete!')
  })

  it('asks again, and finds furniture that did not hear the first question', async () => {
    // apart() with the furniture's receiver started only after the first search
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: [RECEIVER],
      notecards: { LSpos: 'SITTER 0\nPOSE Old|anim1' },
    })
    const l = await loadLinkset({
      world: f.world, region: REGION, owner: OWNER, position: { x: 128, y: 128, z: 25 },
      prims: [{
        name: 'Sender',
        scripts: [{ name: 'LS-update-sender', source: path.normalize(LS2_SCRIPTS['LS-update-sender']!) }],
        inventory: [makeInventoryItem({
          name: 'LSpos', type: InventoryType.NOTECARD, key: '44444444-0000-0000-0000-000000000004',
          notecardLines: ['SITTER 0', 'POSE New|anim1'], creator: OWNER,
        })],
      }],
    })
    const sender = l.scripts['LS-update-sender']!
    sender.start()
    f.settle(1_000)
    l.linkset.touch(1, { avatar: { key: OWNER, name: 'Owner Resident' } })
    f.settle(1_000)
    sender.answerDialog('Update', { name: 'Owner Resident' })
    f.settle(2_000)
    f.start() // the receiver starts listening now
    f.settle(20_000)
    const told = sender.chat.filter((c) => c.channel === 0).map((c) => c.text)
    expect(told).toContain('No answer yet, asking again...')
    expect(told).toContain('Found 1 prims...') // counted once, although asked again
    expect(told.some((t) => t.startsWith('Sending: LSpos to '))).toBe(true)
  })
})

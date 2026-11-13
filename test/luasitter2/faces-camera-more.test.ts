// LuaSitter2: more of [LS]faces-camera: built-in expressions by number, repeated
// (negative) durations, "none", ANIM aliases, the adjuster's 90172 / 90174, camera
// presets from menu buttons (90230 / 90231), no camera at all, DUMP, [FACES] for
// others than the owner, per-sitter notecards, reloading and the NAK reader.
import { describe, it, expect } from 'vitest'
import { makeInventoryItem, InventoryType } from '@rezless/vitest'
import { buildFurniture, LS2_SCRIPTS, OWNER } from '../helpers/furniture.js'
import type { Furniture, Avatar } from '../helpers/furniture.js'

const CAMERA_ACTIVE = 12
const CAMERA_POSITION = 13
const NAK = '\n\x15\n'

async function furniture(card: string, opts: { copies?: string[]; sitters?: number; notecards?: Record<string, string>; card?: string } = {}) {
  const sitters = opts.sitters ?? 1
  const sits = ['[LS]sit']
  for (let i = 1; i < sitters; i++) sits.push(`[LS]sit ${i}`)
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: [...sits, ...(opts.copies ?? ['[LS]faces-camera'])],
    prims: sitters,
    notecards: { LSpos: card, ...(opts.notecards ?? {}) },
    animations: ['sit1', 'sit2', 'smile', 'grin'],
  })
  f.start()
  return f
}

const fc = (f: Furniture, copy = '[LS]faces-camera') => f.script(copy)

/** Expressions started (+) and stopped (-) for an avatar, in order. */
function expressions(f: Furniture, av: Avatar): string[] {
  return f.linked().filter((m) => (m.num === 90001 || m.num === 90002) && m.id === av.key)
    .map((m) => `${m.num === 90001 ? '+' : '-'}${m.str}`)
}

const POSES = `SITTER 0
POSE Sit1|sit1
POSE Sit2|sit2
{Sit1}<0,0,0.5><0,0,0>
{Sit2}<0,0,0.5><0,0,0>`

describe('LuaSitter2 [LS]faces-camera expressions', () => {
  it('a number plays a built-in expression, and it is stopped when the pose changes (FIX)', async () => {
    const f = await furniture(`${POSES}\nANIM Sit1|8|2`)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.settle(500)
    expect(expressions(f, alice)).toContain('+express_smile')
    f.click(alice, 'Sit2')
    expect(expressions(f, alice)).toContain('-express_smile')
  })

  it('a negative duration repeats the expression every second while it lasts (as upstream: not in its last second)', async () => {
    const f = await furniture(`${POSES}\nANIM Sit1|smile|-3|grin|2`)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.settle(4_000)
    // smile at 0 s and again at 1 s, nothing at 2 s, grin at 3 s
    expect(expressions(f, alice).filter((e) => e.startsWith('+')).slice(0, 3)).toEqual(['+smile', '+smile', '+grin'])
  })

  it('"none" in a sequence plays nothing for that time', async () => {
    const f = await furniture(`${POSES}\nANIM Sit1|smile|1|none|2`)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.settle(5_000)
    const plays = expressions(f, alice).filter((e) => e.startsWith('+'))
    expect(plays).not.toContain('+none')
    expect(plays.filter((e) => e === '+smile').length).toBeGreaterThanOrEqual(2)
  })

  it('an ANIM line naming another pose uses that pose\'s expressions', async () => {
    const f = await furniture(`${POSES}\nANIM Sit1|grin|5\nANIM Sit2|Sit1`)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    f.settle(500)
    const plays = expressions(f, alice).filter((e) => e.startsWith('+'))
    expect(plays).not.toContain('+Sit1')
    expect(plays.filter((e) => e === '+grin').length).toBe(2) // once for Sit1, once for Sit2
  })

  it('the adjuster adds an expression to the current pose (90172), and "none" removes it', async () => {
    const f = await furniture(POSES)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    f.sendLinked('[LS]faces-camera', 90172, '0', 'grin')
    expect(fc(f).chat.map((c) => c.text)).toContain("FACE added: 'grin' to 'Sit2' for SITTER 0.")
    expect(expressions(f, alice)).toContain('+grin')
    f.sendLinked('[LS]faces-camera', 90172, '0', 'none')
    expect(expressions(f, alice).at(-1)).toBe('-grin')
    const n = expressions(f, alice).length
    f.settle(5_000)
    expect(expressions(f, alice)).toHaveLength(n)
  })

  it('[FACES] from someone else than the owner is refused', async () => {
    const f = await furniture(`${POSES}\nANIM Sit1|smile|2`)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.sendLinked('[LS]faces-camera', 90100, `0|[FACES]|${alice.key}`, alice.key)
    expect(fc(f).chat.filter((c) => c.to === alice.key).map((c) => c.text)).toEqual(['Sorry, only the owner can change this.'])
    expect(f.linked()).toContainEqual(expect.objectContaining({ num: 90101, str: `0|[ADJUST]|${alice.key}` }))
  })

  it('[FACES] by the owner says OFF, then ON', async () => {
    const f = await furniture(`${POSES}\nANIM Sit1|smile|2`)
    f.sendLinked('[LS]faces-camera', 90100, `0|[FACES]|${OWNER}`, OWNER)
    f.sendLinked('[LS]faces-camera', 90100, `0|[FACES]|${OWNER}`, OWNER)
    expect(fc(f).chat.filter((c) => c.to === OWNER).map((c) => c.text)).toEqual(['Facial Expressions OFF', 'Facial Expressions ON'])
  })

  it('a rezzed object stops the running expressions', async () => {
    const f = await furniture(`${POSES}\nANIM Sit1|smile|2|grin|2`)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.settle(500)
    fc(f).fire('on_rez', { start_param: 0 })
    f.settle()
    expect(expressions(f, alice)).toEqual(expect.arrayContaining(['-smile', '-grin']))
  })

  it('standing up stops the expressions', async () => {
    const f = await furniture(`${POSES}\nANIM Sit1|smile|2`)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.settle(500)
    f.stand(alice)
    f.settle(500)
    expect(expressions(f, alice).at(-1)).toBe('-smile')
  })
})

describe('LuaSitter2 [LS]faces-camera cameras', () => {
  const CAMS = `${POSES}
BUTTON Close up|90230|close
BUTTON Wide|90231|wide
BUTTON Pose camera|90230|RESET
CAMERA Sit1|<0,-2,1>|<0,0,0.5>
CAMERA close|<0,-1,0.8>|<0,0,0.6>
CAMERA wide|<0,-6,3>|<0,0,0.5>`

  const position = (f: Furniture) => {
    const p = fc(f).cameraParams.get(CAMERA_POSITION) as { x: number; y: number; z: number }
    return [p.x, p.y, p.z].map((v) => Math.round(v * 100) / 100)
  }

  it('a camera BUTTON (90230) sets that camera and gives the menu back; RESET returns to the pose camera', async () => {
    const f = await furniture(CAMS)
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(position(f)).toEqual([128, 126, 26])
    const menus = f.dialogsFor(alice).length
    f.click(alice, 'Close up')
    expect(position(f)).toEqual([128, 127, 25.8])
    expect(f.dialogsFor(alice).length).toBeGreaterThan(menus) // the menu again
    f.click(alice, 'Pose camera')
    expect(position(f)).toEqual([128, 126, 26])
  })

  it('a 90231 camera BUTTON sets the camera without giving the menu back, and is kept for poses without a camera', async () => {
    const f = await furniture(CAMS)
    const alice = f.avatar('Alice')
    f.sit(alice)
    const menus = f.dialogsFor(alice).length
    f.click(alice, 'Wide')
    expect(position(f)).toEqual([128, 122, 28])
    expect(f.dialogsFor(alice).length).toBe(menus)
    f.broadcast(90005, '', alice.key)
    f.click(alice, 'Sit2') // no CAMERA line for Sit2: the button's camera stays
    expect(position(f)).toEqual([128, 122, 28])
  })

  it('a pose without a camera and no DEFAULT switches the camera off', async () => {
    const f = await furniture(`${POSES}\nCAMERA Sit1|<0,-2,1>|<0,0,0.5>`)
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(fc(f).cameraParams.get(CAMERA_ACTIVE)).toBe(1)
    f.click(alice, 'Sit2')
    expect(fc(f).cameraParams.get(CAMERA_ACTIVE)).toBe(0)
  })

  it('the adjuster saves a camera for the current pose (90174), and clears it with "none"', async () => {
    const f = await furniture(POSES)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    f.sendLinked('[LS]faces-camera', 90174, '0', '<0,-3,1>|<0,0,0.5>')
    const said = () => fc(f).chat.map((c) => c.text)
    expect(said()).toEqual(expect.arrayContaining(["CAMERA saved to 'Sit2' for SITTER 0.", 'CAMERA Sit2|<0,-3,1>|<0,0,0.5>']))
    expect(position(f)).toEqual([128, 125, 26])
    f.sendLinked('[LS]faces-camera', 90174, '0', 'none')
    expect(said()).toContain("CAMERA cleared from 'Sit2' for SITTER 0.")
    expect(fc(f).cameraParams.get(CAMERA_ACTIVE)).toBe(0)
  })

  it('when another sitter stands up, the camera of the sitter is set again', async () => {
    const card = `SITTER 0\nSYNC S|sit1\nCAMERA S|<0,-2,1>|<0,0,0.5>\n{S}<0,0,0.5><0,0,0>\nSITTER 1\nSYNC S|sit2\n{S}<0,0,0.5><0,0,0>`
    const f = await furniture(card, { sitters: 2 })
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    const sets = () => fc(f).callsOf('llSetCameraParams').length
    const n = sets()
    f.stand(bob)
    f.settle(500)
    expect(sets()).toBeGreaterThan(n)
  })
})

describe('LuaSitter2 [LS]faces-camera DUMP', () => {
  it('dumps ANIM lines with expression names and the CAMERA lines, then 90021', async () => {
    const f = await furniture(`${POSES}\nANIM Sit1|8|2|grin|3\nCAMERA Sit1|<0,-2,1>|<0,0,0.5>`)
    f.sendLinked('[LS]faces-camera', 90020, '0', '[LS]faces-camera')
    f.settle(2_000)
    const out = f.linked().filter((m) => m.num === 90022 || m.num === 90021).map((m) => `${m.num} ${m.str}`)
    expect(out).toEqual([
      '90022 ANIM Sit1|express_smile|2|grin|3',
      '90022 CAMERA Sit1|<0,-2,1>|<0,0,0.5>',
      '90021 0',
    ])
  })

  it('copy 0 dumps the expressions of sitter 1 when there is no copy 1; a 90020 for another script is ignored', async () => {
    const card = `SITTER 0\nSYNC S|sit1\n{S}<0,0,0.5><0,0,0>\nSITTER 1\nSYNC S|sit2\nANIM S|grin|2\nCAMERA S|<0,2,1>|<0,0,0.5>\n{S}<0,0,0.5><0,0,0>`
    const f = await furniture(card, { sitters: 2 })
    f.sendLinked('[LS]faces-camera', 90020, '1', '[LS]plugins')
    f.settle(1_000)
    expect(f.linked().filter((m) => m.num === 90022)).toHaveLength(0)
    f.sendLinked('[LS]faces-camera', 90020, '1', '[LS]faces-camera')
    f.settle(2_000)
    // copy 0 has no CAMERA lines of sitter 1 (cameras need copy 1)
    expect(f.linked().filter((m) => m.num === 90022).map((m) => m.str)).toEqual(['ANIM S|grin|2'])
  })
})

describe('LuaSitter2 [LS]faces-camera notecards', () => {
  it('"LSpos sitter 1" replaces the ANIM lines of sitter 1 from the main notecard', async () => {
    const card = `SITTER 0\nSYNC S|sit1\n{S}<0,0,0.5><0,0,0>\nSITTER 1\nSYNC S|sit2\nANIM S|smile|2\n{S}<0,0,0.5><0,0,0>`
    const f = await furniture(card, { sitters: 2, notecards: { 'LSpos sitter 1': 'SYNC S|sit2\nANIM S|grin|2\n{S}<0,0,0.5><0,0,0>' } })
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.settle(500)
    expect(expressions(f, bob)).toContain('+grin')
    expect(expressions(f, bob)).not.toContain('+smile')
  })

  it('reloads when the notecard is edited', async () => {
    const f = await furniture(`${POSES}\nANIM Sit1|smile|2`)
    f.setNotecard('LSpos', `${POSES}\nANIM Sit1|grin|2`)
    f.settle(2_000)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.settle(500)
    expect(expressions(f, alice)).toContain('+grin')
    expect(expressions(f, alice)).not.toContain('+smile')
  })

  it('reads AVpos through the dataserver when the fast reader answers NAK', async () => {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]sit', '[LS]faces-camera'],
      notecards: { AVpos: `${POSES}\nANIM Sit1|smile|2` },
      animations: ['sit1', 'sit2', 'smile'],
    })
    fc(f).mock('llGetNotecardLineSync', () => NAK)
    f.start()
    f.settle(3_000)
    expect(fc(f).callsOf('llGetNotecardLine').length).toBeGreaterThan(0)
    expect(f.printed('[LS]faces-camera').join('\n')).toContain('1 Expressions, 0 Cameras Ready')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.settle(500)
    expect(expressions(f, alice)).toContain('+smile')
  })
})

describe('LuaSitter2 [LS]faces-camera copies and seats', () => {
  const TWO = `SITTER 0\nSYNC S|sit1\n{S}<0,0.3,0.5><0,0,0>\nSITTER 1\nSYNC S|sit2\nANIM S|grin|2\n{S}<0,-0.3,0.5><0,0,0>`

  /** 90001 expressions copy `copy` sent for an avatar. */
  const sentBy = (f: Furniture, copy: string, av: Avatar) =>
    f.script(copy).linkedMessages.filter((m) => m.num === 90001 && String(m.id) === av.key).length

  async function seated(copies: string[], notecards: Record<string, string> = {}) {
    const f = await furniture(TWO, { sitters: 2, copies, notecards })
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.settle(500)
    return { f, alice, bob }
  }

  it('after [SWAP] the expressions follow the seat', async () => {
    const { f, alice, bob } = await seated(['[LS]faces-camera'])
    expect(expressions(f, bob)).toContain('+grin')
    expect(expressions(f, alice)).not.toContain('+grin')
    f.click(alice, '[SWAP]')
    f.settle(3_000)
    expect(expressions(f, alice)).toContain('+grin')
  })

  it('copy 0 takes over the expressions of sitter 1 when "[LS]faces-camera 1" is removed', async () => {
    const { f, bob } = await seated(['[LS]faces-camera', '[LS]faces-camera 1'])
    expect(sentBy(f, '[LS]faces-camera', bob)).toBe(0) // copy 1 does them
    f.setItem('[LS]faces-camera 1', null)
    f.click(bob, 'S') // play the pose again
    f.settle(500)
    expect(sentBy(f, '[LS]faces-camera', bob)).toBeGreaterThan(0)
  })

  it('copy 0 hands the expressions of sitter 1 over when "[LS]faces-camera 1" is added', async () => {
    const { f, bob } = await seated(['[LS]faces-camera'])
    expect(sentBy(f, '[LS]faces-camera', bob)).toBeGreaterThan(0)
    const prim = f.prims[0]!
    prim.addInventory(makeInventoryItem({ name: '[LS]faces-camera 1', type: InventoryType.SCRIPT, key: '44444444-0000-0000-0000-000000000001', creator: OWNER }))
    fc(f).fire('changed', { changes: 0x1 }) // CHANGED_INVENTORY
    f.settle()
    expect(expressions(f, bob).at(-1)).toBe('-grin') // stopped by copy 0
    const n = sentBy(f, '[LS]faces-camera', bob)
    f.settle(5_000)
    expect(sentBy(f, '[LS]faces-camera', bob)).toBe(n)
  })

  it('editing "LSpos sitter 1" reloads the expressions of sitter 1', async () => {
    const { f } = await seated(['[LS]faces-camera'], { 'LSpos sitter 1': 'SYNC S|sit2\nANIM S|grin|2\n{S}<0,-0.3,0.5><0,0,0>' })
    f.setNotecard('LSpos sitter 1', 'SYNC S|sit2\nANIM S|smile|2\n{S}<0,-0.3,0.5><0,0,0>')
    f.settle(2_000)
    expect(f.printed('[LS]faces-camera').filter((t) => t.includes('Ready'))).toHaveLength(2) // reloaded
    const before = f.linked().length
    f.sendLinked('[LS]faces-camera', 90020, '1', '[LS]faces-camera')
    f.settle(2_000)
    expect(f.linked().slice(before).filter((m) => m.num === 90022).map((m) => m.str)).toEqual(['ANIM S|smile|2'])
  })

  it('a copy for sitter 1 resets when its notecard changes', async () => {
    const { f } = await seated(['[LS]faces-camera', '[LS]faces-camera 1'])
    const ready = () => f.printed('[LS]faces-camera 1').filter((t) => t.includes('Ready')).length
    expect(ready()).toBe(1)
    f.setNotecard('LSpos', `${TWO}\nCAMERA S|<0,2,1>|<0,0,0.5>`)
    f.settle(2_000)
    expect(ready()).toBe(2)
  })
})

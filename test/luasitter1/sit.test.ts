// LuaSitter1 LSsit: the personal adjust menu (moving and turning the sitter, the
// step size, [SAVE] remembering it for the pose and the avatar, [DEFAULT]), [SWAP]
// from a POSE to the free seat, paging long pose menus, MTYPE 2 with LOOP and MTYPE 3,
// the hip fix animation, long pose names, notecard errors, and the DUMP of
// MTYPE / ETYPE / SELECT / LOOP / BUTTON lines.
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS1_SCRIPTS } from '../helpers/furniture.js'
import type { Avatar, Furniture, FurnitureOptions } from '../helpers/furniture.js'

const CARD = `SITTER 0
POSE Sit1|anim1
POSE Sit2|anim2
{Sit1}<0,0,0.5><0,0,0>
{Sit2}<0,0,0.6><0,0,90>`

async function chair(card = CARD, opts: Partial<FurnitureOptions> = {}) {
  const f = await buildFurniture({
    sources: LS1_SCRIPTS,
    scripts: ['LSsit'],
    notecards: { LSpos: card },
    animations: ['anim1', 'anim2'],
    ...opts,
  })
  f.start()
  f.settle(5_000)
  return f
}

/** Where LSsit last put the avatar: [rotation, position] of its sitter link. */
function placed(f: Furniture, script = 'LSsit') {
  const rules = f.script(script).callsOf('llSetLinkPrimitiveParamsFast').at(-1)!.args[1] as unknown[]
  return { rot: rules[1] as { x: number; y: number; z: number; s: number }, pos: rules[3] as { x: number; y: number; z: number } }
}

const round = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z].map((n) => Math.round(n * 1000) / 1000)

function adjust(f: Furniture, av: Avatar) {
  f.touch(av)
  f.click(av, '[ADJUST]')
}

describe('LuaSitter1 LSsit personal adjust', () => {
  it('[ADJUST] shows the personal adjust menu, and Z+ / X- move the sitter by the step', async () => {
    const f = await chair()
    const alice = f.avatar('Alice')
    f.sit(alice)
    adjust(f, alice)
    expect(f.lastDialog(alice).message).toBe('\nPersonal Adjust:')
    expect(f.lastDialog(alice).buttons).toEqual(expect.arrayContaining(['[BACK]', '[SAVE]', '[DEFAULT]', 'POS', ' - ', '0.05m', 'X+', 'Z-']))
    f.click(alice, 'Z+')
    expect(round(placed(f).pos)).toEqual([0, 0, 0.55])
    f.click(alice, 'X-')
    expect(round(placed(f).pos)).toEqual([-0.05, 0, 0.55])
  })

  it('the step button cycles 0.05 m, 0.25 m, 0.01 m', async () => {
    const f = await chair()
    const alice = f.avatar('Alice')
    f.sit(alice)
    adjust(f, alice)
    f.click(alice, '0.05m')
    expect(f.lastDialog(alice).buttons).toContain('0.25m')
    f.click(alice, 'Y+')
    expect(round(placed(f).pos)).toEqual([0, 0.25, 0.5])
    f.click(alice, '0.25m')
    f.click(alice, '0.01m')
    expect(f.lastDialog(alice).buttons).toContain('0.05m')
  })

  it('POS switches to ROT: the buttons then turn the sitter in degrees', async () => {
    const f = await chair()
    const alice = f.avatar('Alice')
    f.sit(alice)
    adjust(f, alice)
    f.click(alice, 'POS')
    expect(f.lastDialog(alice).buttons).toEqual(expect.arrayContaining(['ROT', '5°']))
    f.click(alice, '5°')
    expect(f.lastDialog(alice).buttons).toContain('25°')
    f.click(alice, 'Z+')
    const r = placed(f).rot
    expect(2 * Math.atan2(r.z, r.s) * 180 / Math.PI).toBeCloseTo(25, 0) // turned 25° around Z
    f.click(alice, 'ROT')
    expect(f.lastDialog(alice).buttons).toContain('POS')
  })

  it('[SAVE] remembers the adjustment for this pose and avatar; [DEFAULT] goes back to the notecard', async () => {
    const f = await chair()
    const alice = f.avatar('Alice')
    f.sit(alice)
    adjust(f, alice)
    f.click(alice, 'Z+')
    f.click(alice, '[SAVE]')
    f.settle(3_000)
    expect(f.script('LSsit').callsOf('llInstantMessage').map((c) => String(c.args[1]))).toContain('Saved')
    f.touch(alice)
    f.click(alice, 'Sit2')
    expect(round(placed(f).pos)).toEqual([0, 0, 0.6])
    f.touch(alice)
    f.click(alice, 'Sit1')
    expect(round(placed(f).pos)).toEqual([0, 0, 0.55]) // the saved adjustment
    adjust(f, alice)
    f.click(alice, '[DEFAULT]')
    expect(round(placed(f).pos)).toEqual([0, 0, 0.5])
    f.click(alice, '[SAVE]') // saving the default forgets the adjustment
    f.settle(3_000)
    f.touch(alice)
    f.click(alice, 'Sit2')
    f.touch(alice)
    f.click(alice, 'Sit1')
    expect(round(placed(f).pos)).toEqual([0, 0, 0.5])
  })

  it('another avatar does not get someone else\'s saved adjustment', async () => {
    const f = await chair()
    const alice = f.avatar('Alice')
    f.sit(alice)
    adjust(f, alice)
    f.click(alice, 'Z+')
    f.click(alice, '[SAVE]')
    f.settle(3_000)
    f.stand(alice)
    const bob = f.avatar('Bob')
    f.sit(bob)
    expect(round(placed(f).pos)).toEqual([0, 0, 0.5])
  })

  it('[BACK] in the adjust menu returns to the pose menu', async () => {
    const f = await chair()
    const alice = f.avatar('Alice')
    f.sit(alice)
    adjust(f, alice)
    f.click(alice, '[BACK]')
    expect(f.lastDialog(alice).buttons).toEqual(expect.arrayContaining(['Sit1', 'Sit2', '[ADJUST]']))
  })
})

describe('LuaSitter1 LSsit menus and notecard', () => {
  it('[SWAP] from a POSE moves the sitter to the free seat, with that seat\'s pose', async () => {
    const card = CARD + '\nSITTER 1\nPOSE Sit1|anim2\n{Sit1}<1,0,0.5><0,0,0>'
    const f = await chair(card, { scripts: ['LSsit', 'LSsit 1'], prims: 2 })
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.playing(alice)).toEqual(['anim1'])
    f.touch(alice)
    f.click(alice, '[SWAP]')
    expect(f.linked()).toContainEqual({ num: 90030, str: '0', id: '1' })
    f.settle(2_000)
    expect(f.script('LSsit 1').permissionRequests.at(-1)!.agent).toBe(alice.key)
    expect(f.playing(alice)).toEqual(['anim2'])
    f.touch(alice)
    expect(f.lastDialog(alice).message).toContain('Sitter 1')
  })

  it('a menu with more than 12 buttons is paged, and wraps around', async () => {
    const poses = Array.from({ length: 14 }, (_, i) => `P${i + 1}`)
    const card = 'SITTER 0\n' + poses.map((p) => `POSE ${p}|anim1`).join('\n') + '\n' + poses.map((p) => `{${p}}<0,0,0.5><0,0,0>`).join('\n')
    const f = await chair(card)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    const page1 = f.lastDialog(alice).buttons
    expect(page1).toEqual(expect.arrayContaining(['[PAGE-]', '[PAGE+]', '[ADJUST]', 'P1', 'P9']))
    expect(page1).not.toContain('P10')
    f.click(alice, '[PAGE+]')
    expect(f.lastDialog(alice).buttons).toEqual(expect.arrayContaining(['P10', 'P14']))
    f.click(alice, '[PAGE+]') // past the last page
    expect(f.lastDialog(alice).buttons).toContain('P1')
    f.click(alice, '[PAGE-]') // before the first page
    expect(f.lastDialog(alice).buttons).toContain('P14')
  })

  it('MTYPE 2 with LOOP: touching cycles through the poses up to a LOOP mark', async () => {
    const card = `MTYPE 2
SITTER 0
POSE A|anim1
POSE B|anim2
LOOP
POSE C|anim1
POSE D|anim2
{A}<0,0,0.5><0,0,0>
{B}<0,0,0.5><0,0,0>
{C}<0,0,0.5><0,0,0>
{D}<0,0,0.5><0,0,0>`
    const f = await chair(card)
    const alice = f.avatar('Alice')
    f.sit(alice)
    const pose = () => f.linked().filter((m) => m.num === 90045).at(-1)!.str.split('|')[0]
    expect(pose()).toBe('A')
    f.touch(alice)
    expect(pose()).toBe('B')
    f.touch(alice) // the LOOP mark: back to the first pose
    expect(pose()).toBe('A')
    f.sendLinked('LSsit', 90000, 'C', '') // a pose after the LOOP mark
    expect(pose()).toBe('C')
    f.touch(alice)
    expect(pose()).toBe('D')
    f.touch(alice) // the end: back to the last LOOP mark
    expect(pose()).toBe('C')
  })

  it('MTYPE 3 passes touches on and opens no menu', async () => {
    const f = await chair('MTYPE 3\n' + CARD)
    expect(f.script('LSsit').callsOf('llPassTouches').map((c) => Number(c.args[0]))).toEqual([0, 1])
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    expect(f.dialogsFor(alice)).toHaveLength(0)
  })

  it('plays the LShipfix animation (or AVhipfix) when a sitter sits', async () => {
    for (const hipfix of ['LShipfix', 'AVhipfix']) {
      const f = await chair(CARD, { animations: ['anim1', 'anim2', hipfix] })
      const alice = f.avatar('Alice')
      f.sit(alice)
      expect(f.playing(alice).sort()).toEqual([hipfix, 'anim1'].sort())
    }
  })

  it('cuts pose names to 23 characters', async () => {
    const f = await chair('SITTER 0\nPOSE A very long pose name, really|anim1\n{A very long pose name, r}<0,0,0.5><0,0,0>')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    expect(f.lastDialog(alice).buttons).toContain('A very long pose name, ')
  })

  it('reports a position line for a pose that is not in the menu', async () => {
    const f = await chair(CARD + '\n{Nope}<0,0,0.5><0,0,0>')
    expect(f.printed('LSsit')).toContain("LSsit:Error: 'Nope' not found in menu structure")
  })

  it('reports a missing notecard', async () => {
    const f = await chair(CARD, { notecards: {} })
    expect(f.printed('LSsit')).toContain("LSsit:Error: notecard 'LSpos' not found")
  })

  it('the DUMP writes MTYPE, ETYPE, SELECT, LOOP and BUTTON lines', async () => {
    const card = `MTYPE 1
ETYPE 2
SELECT 1
SITTER 0|Lady
POSE Sit1|anim1
LOOP
POSE Sit2|anim2
BUTTON Ring|42
{Sit1}<0,0,0.5><0,0,0>
{Sit2}<0,0,0.6><0,0,90>`
    const f = await chair(card)
    f.sendLinked('LSsit', 90020, '0', '')
    f.settle(5_000)
    const out = f.script('LSsit').chat.map((c) => c.text.replace(/^◆/, ''))
    expect(out.slice(0, 9)).toEqual([
      'MTYPE 1',
      'ETYPE 2',
      'SELECT 1',
      '',
      'SITTER 0|Lady',
      'POSE Sit1|anim1',
      'LOOP',
      'POSE Sit2|anim2',
      'BUTTON Ring|42',
    ])
  })
})

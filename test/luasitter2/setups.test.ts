// LuaSitter2: other setups and features: reloading when notecards change,
// [LS]root with the sit scripts in a child prim, [LS]menu (objects without sit
// scripts), [LS]select seat choice, personal position adjustment, LS-notecard-tools.
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS, OWNER } from '../helpers/furniture.js'
import type { Furniture, Avatar } from '../helpers/furniture.js'

const owner: Avatar = { key: OWNER, name: 'Owner Resident' }
const card = (...poses: string[]) =>
  ['SITTER 0', ...poses.map((p, i) => `POSE ${p}|anim${i + 1}`), ...poses.map((p, i) => `{${p}}<0,0,${0.5 + i * 0.1}><0,0,0>`)].join('\n')

async function oneSitter(notecards: Record<string, string>, extra: string[] = []) {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]sit', ...extra],
    notecards,
    animations: ['anim1', 'anim2', 'anim3'],
  })
  f.start()
  return f
}

describe('LuaSitter2 notecard changes', () => {
  it('editing LSpos reloads the poses', async () => {
    const f = await oneSitter({ LSpos: card('Sit1', 'Sit2') })
    f.setNotecard('LSpos', card('Lie1', 'Lie2', 'Lie3'))
    const alice = f.avatar('Alice')
    f.sit(alice)
    const buttons = f.lastDialog(alice).buttons
    expect(buttons).toHaveLength(4)
    expect(buttons).toEqual(expect.arrayContaining(['Lie1', 'Lie2', 'Lie3', '[ADJUST]']))
  })

  it('adding LSpos next to AVpos switches to LSpos', async () => {
    const f = await oneSitter({ AVpos: card('Old1') })
    f.setNotecard('LSpos', card('New1'))
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.lastDialog(alice).buttons).toContain('New1')
  })

  it('deleting LSpos falls back to AVpos', async () => {
    const f = await oneSitter({ AVpos: card('Old1'), LSpos: card('New1') })
    f.setNotecard('LSpos', null)
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.lastDialog(alice).buttons).toContain('Old1')
  })

  it('adding an animation does not reload the notecard', async () => {
    const f = await oneSitter({ LSpos: card('Sit1') })
    const reads = f.script('[LS]sit').callsOf('llGetNotecardLineSync').length
    f.setItem('anim9', 'animation')
    expect(f.script('[LS]sit').callsOf('llGetNotecardLineSync').length).toBe(reads)
  })

  it('[LS]plugins reloads when the sequence notecard changes', async () => {
    const f = await oneSitter({ LSpos: card('Sit1', 'Sit2') + '\nSEQUENCE Go' }, ['[LS]plugins'])
    f.setNotecard('[LS]sequence_settings', 'SEQUENCE Go\nPLAY Sit2')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Go')
    f.settle(2_000)
    expect(f.playing(alice)).toEqual(['anim2'])
  })

  it('editing the notecard while someone sits stops their animation (the scripts reset, as in AVsitter)', async () => {
    const f = await oneSitter({ LSpos: card('Sit1', 'Sit2') })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.setNotecard('LSpos', card('Sit1', 'Sit2', 'Sit3'))
    expect(f.playing(alice)).toEqual([])
  })
})

describe('LuaSitter2 [LS]root (sit scripts in a child prim)', () => {
  async function childSetup() {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]root'],
      childScripts: { 2: ['[LS]sit'] },
      contentsLink: 2,
      prims: 2,
      notecards: { LSpos: card('Sit1', 'Sit2') + '\nMTYPE 1' },
      animations: ['anim1', 'anim2'],
    })
    f.start()
    return f
  }

  it('sitting on the child prim animates the sitter', async () => {
    const f = await childSetup()
    const alice = f.avatar('Alice')
    f.sit(alice, 2)
    expect(f.playing(alice)).toEqual(['anim1'])
  })

  it('touching the root prim opens the menu of the child prim', async () => {
    const f = await childSetup()
    const alice = f.avatar('Alice')
    f.sit(alice, 2)
    f.touch(alice, 1)
    expect(f.lastDialog(alice).buttons).toContain('Sit2')
  })
})

describe('LuaSitter2 [LS]menu (no sit scripts)', () => {
  const MENU_CARD = `TEXT Lamp controls
BUTTON On|5001
BUTTON Off|5002
TOMENU Colours
MENU Colours
BUTTON Red|5003|red
BUTTON Blue|5003|blue`

  async function lamp(scripts = ['[LS]menu']) {
    const f = await buildFurniture({ sources: LS2_SCRIPTS, scripts, notecards: { LSpos: MENU_CARD } })
    f.start()
    return f
  }

  it('touch opens the menu with its TEXT and BUTTONs', async () => {
    const f = await lamp()
    const bob = f.avatar('Bob')
    f.touch(bob)
    const d = f.lastDialog(bob)
    expect(d.message).toContain('Lamp controls')
    expect(d.buttons).toEqual(expect.arrayContaining(['On', 'Off', 'Colours*']))
  })

  it('a BUTTON sends its link message, in submenus too', async () => {
    const f = await lamp()
    const bob = f.avatar('Bob')
    f.touch(bob)
    f.click(bob, 'On')
    expect(f.linked()).toContainEqual({ num: 5001, str: 'On', id: bob.key })
    f.touch(bob)
    f.click(bob, 'Colours*')
    f.click(bob, 'Blue')
    expect(f.linked()).toContainEqual({ num: 5003, str: 'blue', id: bob.key })
  })

  it('90005 with a submenu name opens that submenu (AVsitter PR #78)', async () => {
    const f = await lamp()
    const bob = f.avatar('Bob')
    f.broadcast(90005, 'Colours', bob.key)
    expect(f.lastDialog(bob).buttons).toEqual(expect.arrayContaining(['Red', 'Blue']))
  })

  it('removes itself when the object has a sit script', async () => {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]sit', '[LS]menu'],
      notecards: { LSpos: card('Sit1') },
      animations: ['anim1'],
    })
    f.start()
    expect(f.script('[LS]menu').callsOf('llRemoveInventory').map((c) => String(c.args[0]))).toContain('[LS]menu')
  })
})

describe('LuaSitter2 [LS]select', () => {
  const SEATS = `SITTER 0|Left
POSE Sit|anim1
POSE Lean|anim1
{Sit}<0,0.5,0.5><0,0,0>
{Lean}<0,0.5,0.5><0,0,0>
SITTER 1|Middle
POSE Sit|anim2
POSE Lean|anim2
{Sit}<0,0,0.5><0,0,0>
{Lean}<0,0,0.5><0,0,0>
SITTER 2|Right
POSE Sit|anim3
POSE Lean|anim3
{Sit}<0,-0.5,0.5><0,0,0>
{Lean}<0,-0.5,0.5><0,0,0>`

  async function bench(settings = '') {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]sit', '[LS]sit 1', '[LS]sit 2', '[LS]select'],
      prims: 3,
      notecards: { LSpos: settings + SEATS },
      animations: ['anim1', 'anim2', 'anim3'],
    })
    f.start()
    return f
  }

  it('choosing a free seat moves the sitter there', async () => {
    const f = await bench()
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.broadcast(90009, '', alice.key)
    expect(f.lastDialog(alice).script).toBe('[LS]select')
    f.click(alice, 'Right')
    expect(f.playing(alice)).toEqual(['anim3'])
  })

  it('choosing your own seat shows the pose menu instead of swapping (AVsitter PR #158)', async () => {
    const f = await bench()
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.broadcast(90009, '', alice.key)
    const before = f.linked().filter((m) => m.num === 90030).length
    f.click(alice, 'Left')
    expect(f.linked().filter((m) => m.num === 90030)).toHaveLength(before)
    expect(f.lastDialog(alice).script).toBe('[LS]sit')
    expect(f.playing(alice)).toEqual(['anim1'])
  })

  it('SELECT 0 (default): a seat taken by a solo pose is marked ⊘ and cannot be swapped into', async () => {
    const f = await bench()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.broadcast(90009, '', alice.key)
    const taken = f.lastDialog(alice).buttons.find((b) => b.startsWith('⊘'))
    expect(taken).toBeDefined()
    f.click(alice, taken!)
    expect(f.playing(alice)).toEqual(['anim1'])
    expect(f.playing(bob)).toEqual(['anim2'])
  })

  it('SELECT 1: occupied seats are not marked, and choosing one swaps the two sitters', async () => {
    const f = await bench(`SELECT 1
`)
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.broadcast(90009, '', alice.key)
    const buttons = f.lastDialog(alice).buttons
    expect(buttons.some((b) => b.startsWith('⊘'))).toBe(false)
    f.click(alice, 'Middle')
    expect(f.playing(alice)).toEqual(['anim2'])
    expect(f.playing(bob)).toEqual(['anim1'])
  })
})

describe('LuaSitter2 personal position adjustment', () => {
  /** The last local position the sit script gave its sitter. */
  function sitterZ(f: Furniture): number {
    const PRIM_POS_LOCAL = 33
    const calls = f.script('[LS]sit').callsOf('llSetLinkPrimitiveParamsFast')
    for (let i = calls.length - 1; i >= 0; i--) {
      const rules = calls[i]!.args[1] as unknown[]
      const at = rules.indexOf(PRIM_POS_LOCAL)
      if (at >= 0) return Math.round((rules[at + 1] as { z: number }).z * 1000) / 1000
    }
    throw new Error('no position set')
  }

  async function adjusting() {
    const f = await oneSitter({ LSpos: card('Sit1', 'Sit2') })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, '[ADJUST]')
    expect(f.lastDialog(alice).message).toContain('Personal adjustment')
    return { f, alice }
  }

  it('Z+ raises the sitter by the step (0.05 m)', async () => {
    const { f, alice } = await adjusting()
    expect(sitterZ(f)).toBe(0.5)
    f.click(alice, 'Z+')
    expect(sitterZ(f)).toBe(0.55)
  })

  it('[SAVE] keeps the offset for that pose only', async () => {
    const { f, alice } = await adjusting()
    f.click(alice, 'Z+')
    f.click(alice, '[SAVE]')
    f.broadcast(90000, 'Sit2', alice.key)
    expect(sitterZ(f)).toBe(0.6)
    f.broadcast(90000, 'Sit1', alice.key)
    expect(sitterZ(f)).toBe(0.55)
  })

  it('without [SAVE] the offset is lost on the next pose', async () => {
    const { f, alice } = await adjusting()
    f.click(alice, 'Z+')
    f.broadcast(90000, 'Sit2', alice.key)
    f.broadcast(90000, 'Sit1', alice.key)
    expect(sitterZ(f)).toBe(0.5)
  })

  it('[SAVE ALL] applies the offset to every pose', async () => {
    const { f, alice } = await adjusting()
    f.click(alice, 'Z+')
    f.click(alice, '[SAVE ALL]')
    f.click(alice, '[ALL POSES]')
    f.broadcast(90000, 'Sit2', alice.key)
    expect(sitterZ(f)).toBe(0.65)
  })

  it('[DEFAULT] goes back to the notecard position', async () => {
    const { f, alice } = await adjusting()
    f.click(alice, 'Z+')
    f.click(alice, '[SAVE]')
    f.click(alice, '[DEFAULT]')
    expect(sitterZ(f)).toBe(0.5)
  })
})

describe('LuaSitter2 LS-notecard-tools', () => {
  async function tools(notecards: Record<string, string>) {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['LS-notecard-tools'],
      notecards,
      animations: ['walk', 'dance'],
    })
    f.start()
    return f
  }
  const readout = (f: Furniture) => f.script('LS-notecard-tools').chat.map((c) => c.text.replace(/^◆/, ''))

  it('Generate reads out a POSE line for every animation, then removes itself', async () => {
    const f = await tools({})
    f.click(owner, 'Generate')
    f.settle(5_000)
    const out = readout(f)
    expect(out).toContain('POSE Anim1|dance')
    expect(out).toContain('POSE Anim2|walk')
    expect(out.some((l) => l.includes('COPY BELOW INTO LSpos NOTECARD'))).toBe(true)
    expect(f.script('LS-notecard-tools').callsOf('llRemoveInventory')).toHaveLength(1)
  })

  it('Shift moves every position by the offset said on channel 5', async () => {
    const f = await tools({ AVpos: 'SITTER 0\nPOSE Sit1|walk\n{Sit1}<0.1,0,0.5><0,0,0>' })
    f.click(owner, 'Shift')
    f.say(owner, 5, '<0,0,1>')
    f.settle(10_000)
    const out = readout(f).join('\n')
    expect(out).toContain('COPY BELOW INTO "AVpos" NOTECARD')
    expect(out).toContain('POSE Sit1|walk')
    expect(out).toMatch(/\{Sit1\}<0\.1(0*)?,0(\.0*)?,1\.5(0*)?>/)
  })
})

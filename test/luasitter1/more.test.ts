// LuaSitter1: two sitters (SYNC, [SWAP], ETYPE), submenus, BUTTON lines, MTYPE 2,
// LSplus (props with LSprop inside, facial expressions), and LSroot in the root prim.
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS1_SCRIPTS } from '../helpers/furniture.js'
import type { Furniture } from '../helpers/furniture.js'

const COUPLE = `SITTER 0
TOMENU SITS
MENU SITS
POSE Sit1|anim1
SYNC Cuddle|cud_a
BUTTON Press Me!|99
{Sit1}<0,0.3,0.5><0,0,0>
{Cuddle}<0,0.3,0.5><0,0,0>
SITTER 1
TOMENU SITS
MENU SITS
POSE Sit1|anim2
SYNC Cuddle|cud_b
{Sit1}<0,-0.3,0.5><0,0,0>
{Cuddle}<0,-0.3,0.5><0,0,0>`

async function couple(card = COUPLE, extra: string[] = [], objects?: Record<string, string[]>) {
  const f = await buildFurniture({
    sources: LS1_SCRIPTS,
    scripts: ['LSsit', 'LSsit 1', ...extra],
    prims: 2,
    notecards: { LSpos: card },
    animations: ['anim1', 'anim2', 'cud_a', 'cud_b'],
    objects,
  })
  f.start()
  f.settle(5_000)
  return f
}

/** Open the menu by touch and go into the SITS submenu. */
function sitsMenu(f: Furniture, av: { key: string; name: string }) {
  f.touch(av)
  if (!f.lastDialog(av).buttons.includes('Cuddle')) f.click(av, 'SITS*')
}

describe('LuaSitter1 two sitters', () => {
  it('each sitter plays the first pose of their section', async () => {
    const f = await couple()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    expect(f.playing(alice)).toEqual(['anim1'])
    expect(f.playing(bob)).toEqual(['anim2'])
  })

  it('TOMENU opens the submenu, and a SYNC pose plays for both sitters', async () => {
    const f = await couple()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.touch(alice)
    expect(f.lastDialog(alice).buttons).toContain('SITS*')
    f.click(alice, 'SITS*')
    f.click(alice, 'Cuddle')
    expect(f.playing(alice)).toEqual(['cud_a'])
    expect(f.playing(bob)).toEqual(['cud_b'])
  })

  it('[SWAP] in a SYNC exchanges the two sitters', async () => {
    const f = await couple()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    sitsMenu(f, alice)
    f.click(alice, 'Cuddle')
    sitsMenu(f, alice)
    f.click(alice, '[SWAP]')
    expect(f.playing(alice)).toEqual(['cud_b'])
    expect(f.playing(bob)).toEqual(['cud_a'])
  })

  it('a swap within 0.5 s of a pose change still stops the previous animation', async () => {
    // regression: the old animation was stopped on a 0.5 s timer that the swap made skip
    const f = await couple(COUPLE.replace('POSE Sit1|anim1', 'POSE Sit1|anim1\nPOSE Sit2|cud_a'))
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    expect(f.playing(alice)).toEqual(['anim1'])
    const sit0 = f.script('LSsit')
    sit0.fire('link_message', { sender_num: 1, num: 90000, str: 'Sit2', id: '' })
    f.advance(100)
    expect(f.playing(alice)).toContain('cud_a')
    for (const s of [f.script('LSsit'), f.script('LSsit 1')]) {
      s.fire('link_message', { sender_num: 1, num: 90030, str: '0', id: '1' })
    }
    f.settle(3_000)
    expect(f.playing(alice)).not.toContain('anim1')
    expect(f.playing(alice)).not.toContain('cud_a')
  })

  it('a BUTTON sends its link message with its name and the sitter', async () => {
    const f = await couple()
    const alice = f.avatar('Alice')
    f.sit(alice)
    sitsMenu(f, alice)
    f.click(alice, 'Press Me!')
    expect(f.linked()).toContainEqual({ num: 99, str: 'Press Me!', id: alice.key })
  })

  it('ETYPE 1: leaving a SYNC sends the partner back to their first pose', async () => {
    const f = await couple('ETYPE 1\n' + COUPLE)
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    sitsMenu(f, alice)
    f.click(alice, 'Cuddle')
    expect(f.playing(bob)).toEqual(['cud_b'])
    sitsMenu(f, alice)
    f.click(alice, 'Sit1')
    expect(f.playing(alice)).toEqual(['anim1'])
    expect(f.playing(bob)).toEqual(['anim2'])
  })
})

describe('LuaSitter1 MTYPE 2', () => {
  it('a touch plays the next pose instead of opening the menu', async () => {
    const f = await buildFurniture({
      sources: LS1_SCRIPTS,
      scripts: ['LSsit'],
      notecards: { LSpos: 'MTYPE 2\nSITTER 0\nPOSE Sit1|anim1\nPOSE Sit2|anim2\n{Sit1}<0,0,0.5><0,0,0>\n{Sit2}<0,0,0.5><0,0,0>' },
      animations: ['anim1', 'anim2'],
    })
    f.start()
    f.settle(5_000)
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(f.playing(alice)).toEqual(['anim1'])
    f.touch(alice)
    expect(f.playing(alice)).toEqual(['anim2'])
    expect(f.dialogsFor(alice)).toHaveLength(0)
    f.touch(alice)
    expect(f.playing(alice)).toEqual(['anim1']) // cycles back to the first pose
  })
})

describe('LuaSitter1 LSplus', () => {
  const card = `SITTER 0
POSE Sit1|anim1
POSE Sit2|anim2
{Sit1}<0,0,0.5><0,0,0>
{Sit2}<0,0,0.5><0,0,0>
PROP Sit2|ball|<0,0,1>|<0,0,0>
ANIM Sit2|express_smile:2:express_wink_emote:2`

  async function plus() {
    const f = await buildFurniture({
      sources: LS1_SCRIPTS,
      scripts: ['LSsit', 'LSplus'],
      notecards: { LSpos: card },
      animations: ['anim1', 'anim2'],
      objects: { ball: ['LSprop'] },
    })
    f.start()
    f.settle(5_000)
    return f
  }

  it('reads PROP and ANIM lines', async () => {
    const f = await plus()
    const out = f.printed('LSplus').join('\n')
    expect(out).toContain("Read settings for Prop 'ball'")
    expect(out).toContain("Read settings for Expressions for 'Sit2'")
  })

  it('a pose with a PROP line rezzes the prop, another pose removes it', async () => {
    const f = await plus()
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    f.click(alice, 'Sit2')
    expect(f.rezzed().map((l) => l.prims[0]!.name)).toEqual(['ball'])
    f.touch(alice)
    f.click(alice, 'Sit1')
    f.settle(5_000)
    expect(f.rezzed()).toHaveLength(0)
  })

  it('a pose with an ANIM line plays its facial expressions in turn', async () => {
    const f = await plus()
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    f.click(alice, 'Sit2')
    f.settle(5_000)
    const started = f.linked().filter((m) => m.num === 90001 && m.id === alice.key).map((m) => m.str)
    expect(started).toContain('express_smile')
    expect(started).toContain('express_wink_emote')
  })
})

describe('LuaSitter1 LSroot', () => {
  it('touching the root prim opens the menu of the sit scripts in a child prim', async () => {
    const f = await buildFurniture({
      sources: LS1_SCRIPTS,
      scripts: ['LSroot'],
      childScripts: { 2: ['LSsit'] },
      contentsLink: 2,
      prims: 2,
      notecards: { LSpos: 'MTYPE 1\nSITTER 0\nPOSE Sit1|anim1\nPOSE Sit2|anim2\n{Sit1}<0,0,0.5><0,0,0>\n{Sit2}<0,0,0.5><0,0,0>' },
      animations: ['anim1', 'anim2'],
    })
    f.start()
    f.settle(5_000)
    const alice = f.avatar('Alice')
    f.sit(alice, 2)
    expect(f.playing(alice)).toEqual(['anim1'])
    f.touch(alice, 1)
    expect(f.lastDialog(alice).buttons).toContain('Sit2')
  })
})

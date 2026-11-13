// LuaSitter1 LSselect with the real LSsit scripts: [SELECT] instead of [SWAP], the
// seat menu (seat names from SITTER lines or first poses, seats taken by others
// shown as "⊘name"), moving to a free seat, SELECT 1, the own seat, [ADJUST], the
// seat menu for a new sitter and for one-pose seats, a seat freed when its sitter
// stands, AVpos, and everyone unseated when the notecard changes.
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS1_SCRIPTS } from '../helpers/furniture.js'
import type { Avatar, Furniture } from '../helpers/furniture.js'

const CARD = `SITTER 0|Left
POSE Sit1|anim1
POSE Sit2|anim2
{Sit1}<0,0.5,0.5><0,0,0>
{Sit2}<0,0.5,0.5><0,0,0>
SITTER 1
POSE Right seat with a very long name|anim2
{Right seat with a very }<0,-0.5,0.5><0,0,0>
SITTER 2|Middle
POSE Lie|anim1
{Lie}<0,0,0.5><0,0,0>`

async function sofa(card = CARD, name = 'LSpos') {
  const f = await buildFurniture({
    sources: LS1_SCRIPTS,
    scripts: ['LSsit', 'LSsit 1', 'LSsit 2', 'LSselect'],
    prims: 3,
    notecards: { [name]: card },
    animations: ['anim1', 'anim2'],
  })
  f.start()
  f.settle(5_000)
  return f
}

const seatMenu = (f: Furniture, av: Avatar) => {
  const d = f.lastDialog(av)
  expect(d.script).toBe('LSselect')
  return d
}

describe('LuaSitter1 LSselect seat menu', () => {
  it('a new sitter gets the seat menu, named after SITTER lines or first poses', async () => {
    const f = await sofa()
    const alice = f.avatar('Alice')
    f.sit(alice)
    const d = seatMenu(f, alice)
    expect(d.message).toContain('\nLeft') // her seat
    expect(d.buttons).toEqual(expect.arrayContaining(['Left', 'Right seat with a very ', 'Middle', '[ADJUST]']))
  })

  it('the pose menu has [SELECT] instead of [SWAP], which opens the seat menu', async () => {
    const f = await sofa()
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    expect(f.lastDialog(alice).buttons).toContain('[SELECT]')
    expect(f.lastDialog(alice).buttons).not.toContain('[SWAP]')
    f.click(alice, '[SELECT]')
    expect(seatMenu(f, alice).buttons).toContain('Middle')
  })

  it('choosing a free seat moves the sitter there', async () => {
    const f = await sofa()
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Middle')
    expect(f.linked()).toContainEqual({ num: 90030, str: '0', id: '2' })
    f.settle(2_000)
    expect(f.script('LSsit 2').permissionRequests.at(-1)!.agent).toBe(alice.key)
    expect(f.playing(alice)).toEqual(['anim1'])
  })

  it('a seat taken by someone else shows their name and cannot be chosen', async () => {
    const f = await sofa()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    const d = seatMenu(f, bob)
    expect(d.buttons).toContain('⊘Alice ')
    expect(d.buttons).not.toContain('Left')
    const swaps = f.linked().filter((m) => m.num === 90030).length
    f.click(bob, '⊘Alice ')
    expect(seatMenu(f, bob).buttons).toContain('⊘Alice ') // the menu again, nothing else
    expect(f.linked().filter((m) => m.num === 90030)).toHaveLength(swaps)
  })

  it('SELECT 1: a taken seat keeps its name and choosing it swaps the two sitters', async () => {
    const f = await sofa('SELECT 1\n' + CARD)
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    const d = seatMenu(f, bob)
    expect(d.buttons).toContain('Left')
    expect(d.buttons.some((b) => b.startsWith('⊘'))).toBe(false)
    f.click(bob, 'Left')
    expect(f.linked()).toContainEqual({ num: 90030, str: '1', id: '0' })
  })

  it('choosing your own seat shows the seat menu again', async () => {
    const f = await sofa()
    const alice = f.avatar('Alice')
    f.sit(alice)
    const before = f.dialogsFor(alice).length
    f.click(alice, 'Left')
    expect(f.dialogsFor(alice).length).toBe(before + 1)
    expect(f.linked().filter((m) => m.num === 90030)).toHaveLength(0)
  })

  it('[ADJUST] in the seat menu opens the personal adjust menu', async () => {
    const f = await sofa()
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, '[ADJUST]')
    expect(f.lastDialog(alice).message).toBe('\nPersonal Adjust:')
  })

  it('in a seat with only one pose, touching opens the seat menu instead of the pose menu', async () => {
    const f = await sofa()
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Middle') // a seat with one pose
    f.settle(2_000)
    f.touch(alice)
    const d = seatMenu(f, alice)
    expect(d.message).toContain('\nMiddle')
    expect(d.buttons).not.toContain('Lie')
  })

  it('a seat is free again when its sitter stands up', async () => {
    const f = await sofa()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.stand(alice)
    f.touch(bob) // Bob's seat has one pose: the seat menu
    expect(seatMenu(f, bob).buttons).toContain('Left')
    expect(seatMenu(f, bob).buttons).not.toContain('⊘Alice ')
  })

  it('reads AVpos when there is no LSpos', async () => {
    const f = await sofa(CARD, 'AVpos')
    expect(f.printed('LSselect')).toContain('LSselect:Reading AVpos')
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(seatMenu(f, alice).buttons).toContain('Middle')
  })

  it('editing the notecard unseats everyone and reads it again', async () => {
    const f = await sofa()
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.setNotecard('LSpos', CARD.replace('SITTER 2|Middle', 'SITTER 2|Centre'))
    f.settle(3_000)
    expect(f.script('LSselect').callsOf('llUnSit').map((c) => String(c.args[0]))).toContain(alice.key)
    expect(f.printed('LSselect').filter((l) => l === 'LSselect:Ready')).toHaveLength(2)
  })
})

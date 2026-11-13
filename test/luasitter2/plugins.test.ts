// LuaSitter2: [LS]plugins: props (PROP lines, rezzed with [LS]object inside),
// sequences ([LS]sequence_settings / [AV]sequence_settings) and favourites (90401-90403).
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS } from '../helpers/furniture.js'

const POSES = `SITTER 0
POSE Sit1|anim1
POSE Sit2|anim2
POSE Sit3|anim3
{Sit1}<0,0,0.5><0,0,0>
{Sit2}<0,0,0.5><0,0,0>
{Sit3}<0,0,0.5><0,0,0>`

async function furniture(card: string, notecards: Record<string, string> = {}, objects?: Record<string, string[]>) {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]sit', '[LS]plugins'],
    notecards: { LSpos: card, ...notecards },
    animations: ['anim1', 'anim2', 'anim3'],
    objects,
  })
  f.start()
  return f
}

describe('LuaSitter2 props', () => {
  const card = `${POSES}
PROP Sit2|ball|G1|<0,0,1>|<0,0,0>
PROP Sit3|cube|G1|<0,0,1>|<0,0,0>`
  const props = { ball: ['[LS]object'], cube: ['[LS]object'] }
  const names = (f: Awaited<ReturnType<typeof furniture>>) => f.rezzed().map((l) => l.prims[0]!.name).sort()

  it('a pose with a PROP line rezzes the prop', async () => {
    const f = await furniture(card, {}, props)
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(names(f)).toEqual([])
    f.click(alice, 'Sit2')
    expect(names(f)).toEqual(['ball'])
  })

  it('a pose with another prop of the same group replaces it', async () => {
    const f = await furniture(card, {}, props)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    f.click(alice, 'Sit3')
    f.settle(5_000)
    expect(names(f)).toEqual(['cube'])
  })

  it('a pose without a prop removes it', async () => {
    const f = await furniture(card, {}, props)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    f.click(alice, 'Sit1')
    f.settle(5_000)
    expect(names(f)).toEqual([])
  })

  it('the prop is removed when the sitter stands up', async () => {
    const f = await furniture(card, {}, props)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    f.stand(alice)
    f.settle(5_000)
    expect(names(f)).toEqual([])
  })

  it('a BUTTON with the prop name rezzes it (90200)', async () => {
    const f = await furniture(`${POSES}\nBUTTON Rez Ball|90200\nPROP Rez Ball|ball|G2|<0,0,1>|<0,0,0>`, {}, props)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Rez Ball')
    expect(names(f)).toEqual(['ball'])
  })

  it('without PROP lines no listen is opened (unused features cost nothing)', async () => {
    const f = await furniture(POSES)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    expect(f.script('[LS]plugins').listens).toHaveLength(0)
  })
})

describe('LuaSitter2 sequences', () => {
  const seq = `SEQUENCE Scene
PLAY Sit2
SAY Hello /0
WAIT 10
PLAY Sit3
WAIT 10
LOOP`
  const card = `${POSES}\nSEQUENCE Scene`

  for (const name of ['[LS]sequence_settings', '[AV]sequence_settings']) {
    it(`plays the steps of a sequence from "${name}", with WAIT and LOOP`, async () => {
      const f = await furniture(card, { [name]: seq })
      const alice = f.avatar('Alice')
      f.sit(alice)
      f.click(alice, 'Scene')
      f.settle(2_000) // PLAY pauses 0.5 s; the previous animation stops shortly after the new one starts
      expect(f.playing(alice)).toEqual(['anim2'])
      expect(f.lastDialog(alice).buttons).toContain('▶▶') // the sequence controls
      f.settle(10_000)
      expect(f.playing(alice)).toEqual(['anim3'])
      f.settle(10_500)
      expect(f.playing(alice)).toEqual(['anim2']) // LOOP back to the start
    })
  }

  it('each PLAY pauses 0.5 s before the next step, even though the sit script answers at once', async () => {
    // regression: the plugin's own 90003 and the sit script's answers ended the pause early
    const f = await furniture(card, { '[LS]sequence_settings': 'SEQUENCE Scene\nPLAY Sit2\nPLAY Sit3\nSAY Done\nWAIT 10' })
    const alice = f.avatar('Alice')
    f.sit(alice)
    const said = () => f.script('[LS]plugins').chat.map((c) => c.text)
    const plays = () => f.linked().filter((m) => m.num === 90003).map((m) => m.str)
    f.script('[LS]plugins').fire('link_message', { sender_num: 0, num: 90000, str: 'Scene', id: alice.key })
    f.settle(300)
    expect(plays()).toEqual(['Sit2'])
    expect(said()).not.toContain('Done')
    f.settle(500)
    expect(plays()).toEqual(['Sit2', 'Sit3'])
    expect(said()).not.toContain('Done')
    f.settle(500)
    expect(said()).toContain('Done')
  })

  it('SAY replaces /0 with the first name of sitter 0', async () => {
    const f = await furniture(card, { '[LS]sequence_settings': seq })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Scene')
    f.settle(2_000)
    const said = f.script('[LS]plugins').chat.map((c) => c.text)
    expect(said).toContain('Hello Alice')
  })

  it('▶▶ skips to the next step, ▮▮ pauses', async () => {
    const f = await furniture(card, { '[LS]sequence_settings': seq })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Scene')
    f.click(alice, '▶▶')
    expect(f.playing(alice)).toEqual(['anim3'])
    f.click(alice, '▮▮')
    f.settle(30_000)
    expect(f.playing(alice)).toEqual(['anim3'])
  })

  it('choosing another pose stops the sequence', async () => {
    const f = await furniture(card, { '[LS]sequence_settings': seq })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Scene')
    f.broadcast(90005, '', alice.key)
    f.click(alice, 'Sit1')
    f.settle(25_000)
    expect(f.playing(alice)).toEqual(['anim1'])
  })

  it('a sequence named like a pose starts when that pose is chosen', async () => {
    const f = await furniture(POSES, { '[LS]sequence_settings': 'SEQUENCE Sit1\nPLAY Sit1\nWAIT 5\nPLAY Sit2' })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit3')
    f.click(alice, 'Sit1')
    f.settle(6_000)
    expect(f.playing(alice)).toEqual(['anim2'])
  })
})

describe('LuaSitter2 favourites', () => {
  const card = `${POSES}
BUTTON Add Fav|90401
BUTTON Del Fav|90402
BUTTON Favorites...|90403`

  it('adds the current pose to the favourites, and plays it from the favourites menu', async () => {
    const f = await furniture(card)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit3')
    f.click(alice, 'Add Fav')
    f.broadcast(90005, '', alice.key)
    f.click(alice, 'Sit1')
    f.click(alice, 'Favorites...')
    const favs = f.lastDialog(alice)
    expect(favs.script).toBe('[LS]plugins')
    expect(favs.buttons).toContain('Sit3')
    expect(favs.buttons).not.toContain('Sit2')
    f.click(alice, 'Sit3')
    expect(f.playing(alice)).toEqual(['anim3'])
  })

  it('removes the current pose from the favourites', async () => {
    const f = await furniture(card)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    f.click(alice, 'Add Fav')
    f.click(alice, 'Sit3')
    f.click(alice, 'Add Fav')
    f.click(alice, 'Del Fav') // Sit3 is playing
    f.click(alice, 'Favorites...')
    const favs = f.lastDialog(alice)
    expect(favs.script).toBe('[LS]plugins')
    expect(favs.buttons).toContain('Sit2')
    expect(favs.buttons).not.toContain('Sit3')
  })
})

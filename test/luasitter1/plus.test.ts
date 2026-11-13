// LuaSitter1 LSplus (with LSprop in the props): the [EXTRA] menu in helper mode
// (camera, props, sounds, items, facial expressions, paging, [CLEAR], owner only,
// new listens after a re-rez), and the PROP / SOUND / ITEM / ANIM / CAMERA lines
// of the notecard at work: sounds played and stopped, items given, held and numbered
// expressions, expressions switched off (1125), the camera set for the sitters, props
// removed when everyone stands, BUTTON props, AVpos, inert copies, notecard edits.
import { describe, it, expect } from 'vitest'
import { makeInventoryItem, InventoryType, NULL_KEY } from '@rezless/vitest'
import { buildFurniture, LS1_SCRIPTS, LS1, OWNER } from '../helpers/furniture.js'
import type { Avatar, Furniture, FurnitureOptions } from '../helpers/furniture.js'

const owner: Avatar = { key: OWNER, name: 'Owner Resident' }
const sources = { ...LS1_SCRIPTS, 'LShelper-script': LS1 + 'LShelper-script.luau' }
const CARD = `SITTER 0
POSE Sit1|anim1
POSE Sit2|anim2
{Sit1}<0,0,0.5><0,0,0>
{Sit2}<0,0,0.5><0,0,0>`
const NAK = '\n\x15\n'
const SILENCE = 'ed124764-705d-d497-167a-182cd9fa2e6c'

/** Add a sound to the root prim (the harness only adds notecards and animations). */
function addSound(f: Furniture, name: string) {
  f.prims[0]!.addInventory(makeInventoryItem({
    name,
    type: InventoryType.SOUND,
    key: '44444444-0000-0000-0000-000000000001',
    creator: OWNER,
  }))
}

async function furniture(opts: Partial<FurnitureOptions> = {}, sounds: string[] = []) {
  const f = await buildFurniture({
    sources,
    scripts: ['LSsit', 'LSplus'],
    notecards: { LSpos: CARD },
    animations: ['anim1', 'anim2'],
    objects: { ball: ['LSprop'], gift: [] },
    ...opts,
  })
  for (const s of sounds) addSound(f, s)
  if (f.scripts['LSadjuster']) {
    // rezless raises `changed` inside llUnSit, before the link messages LSadjuster
    // sends right after it; in Second Life it comes later. So the unseat is only
    // recorded, and extras() stands the owner up once the helper is rezzed.
    f.script('LSadjuster').mock('llUnSit', () => undefined)
  }
  f.start()
  f.settle(5_000)
  return f
}

const helperObject = (f: Furniture) => f.rezzed().find((l) => l.prims[0]!.name === 'LShelper 0')!
const touchHelper = (f: Furniture, av: Avatar) => {
  helperObject(f).touch(1, { avatar: { key: av.key, name: av.name } })
  f.settle(2_000)
}

/**
 * Helper mode, as in-world: the avatar sits, [ADJUST] > [HELPER], stands up, sits
 * on the helper (its LSsit asks for permissions: granted here, as the helper is
 * not a link of the furniture) and touches it for the menu.
 */
function helperMode(f: Furniture, av: Avatar = owner) {
  f.sit(av)
  f.touch(av)
  f.click(av, '[ADJUST]')
  f.click(av, '[HELPER]')
  f.settle(3_000)
  f.stand(av)
  const wa = f.world.avatars.find((a) => a.key === av.key)!
  if (!f.world.sitAvatar(wa, helperObject(f).prims[0]!)) throw new Error('rezless refused the sit')
  f.settle(2_000)
  f.script('LSsit').grantPermissions()
  f.settle(2_000)
  touchHelper(f, av)
}

/** Furniture with LSadjuster and its helper, in helper mode, with the [EXTRA] menu open. */
async function extras(sounds: string[] = [], card = CARD) {
  const f = await furniture({
    scripts: ['LSsit', 'LSplus', 'LSadjuster'],
    notecards: { LSpos: card },
    objects: { LShelper: ['LShelper-script'], ball: ['LSprop'], gift: [] },
  }, sounds)
  helperMode(f)
  expect(f.lastDialog(owner).buttons).toContain('[EXTRA]')
  f.click(owner, '[EXTRA]')
  return f
}

const menuText = (f: Furniture) => f.lastDialog(owner).message
const printed = (f: Furniture) => f.printed('LSplus')
const ims = (f: Furniture) => f.script('LSplus').callsOf('llInstantMessage').map((c) => String(c.args[1]))
const faces = (f: Furniture, av: Avatar) => f.linked().filter((m) => m.num === 90001 && m.id === av.key).map((m) => m.str)
const sound = (f: Furniture) => f.prims[0]!.sound.current

/** [DUMP] from the helper-mode pose menu; LSplus prints its EXTRAS after the poses. */
function dump(f: Furniture) {
  touchHelper(f, owner)
  f.click(owner, '[DUMP]')
  f.settle(10_000)
  return printed(f).filter((l) => l.startsWith('◆')).map((l) => l.slice(1))
}

describe('LuaSitter1 LSplus [EXTRA] menu', () => {
  it('shows the EXTRAS of the current pose', async () => {
    const f = await extras()
    expect(menuText(f)).toContain('EXTRAS for Pose:Sit1')
    expect(menuText(f)).toContain('Camera:N/A\nProp:N/A\nSound:N/A\nItem:N/A\nFace:N/A')
    expect(f.lastDialog(owner).buttons).toEqual(expect.arrayContaining(['[TOP]', '[CAMERA]', '[PROPS]', '[SOUNDS]', '[ITEMS]', '[FACES]']))
    f.click(owner, '[TOP]') // back to the pose menu
    expect(f.lastDialog(owner).script).toBe('LSsit')
  })

  it('[CAMERA] > [SET] stores the owner\'s camera for the pose, [RELEASE] clears it', async () => {
    const f = await extras()
    f.click(owner, '[CAMERA]')
    const plus = f.script('LSplus')
    expect(plus.permissionRequests.at(-1)!.agent).toBe(OWNER)
    plus.grantPermissions() // PERMISSION_TRACK_CAMERA
    f.settle()
    expect(f.lastDialog(owner).buttons).toEqual(expect.arrayContaining(['[BACK]', '[SET]', '[RELEASE]']))
    plus.setCamera({ pos: { x: 130, y: 128, z: 26 }, rot: { x: 0, y: 0, z: 0, s: 1 } })
    f.click(owner, '[SET]')
    expect(plus.callsOf('llPlaySound').map((c) => String(c.args[0]))).toContain('3d09f582-3851-c0e0-f5ba-277ac5c73fb4')
    expect(menuText(f)).toContain('Camera:YES')
    // the camera menu again: the permission is kept
    f.click(owner, '[CAMERA]')
    expect(plus.permissionRequests).toHaveLength(1)
    f.click(owner, '[RELEASE]')
    expect(menuText(f)).toContain('Camera:N/A')
    f.click(owner, '[CAMERA]')
    f.click(owner, '[SET]')
    expect(dump(f)).toContain('CAMERA <2.00000, 0.00000, 1.00000>|<3.00000, 0.00000, 1.00000>')
  })

  it('[PROPS] rezzes the chosen prop, and [SAVE] stores where it was moved', async () => {
    const f = await extras()
    f.click(owner, '[PROPS]')
    expect(menuText(f)).toContain('1.ball\n2.gift') // helper objects are not listed
    expect(menuText(f)).not.toContain('LShelper')
    f.click(owner, '1')
    expect(f.script('LSplus').chat.map((c) => c.text)).toContain('Please position your prop and click [SAVE] when done.')
    const ball = f.rezzed().find((l) => l.prims[0]!.name === 'ball')!
    expect(ball.prims[0]!.params.position).toEqual({ x: 128, y: 128, z: 27 })
    ball.prims[0]!.params.position = { x: 128, y: 129, z: 26 } // the owner moves it
    f.click(owner, '[SAVE]') // the pose menu came back
    f.settle(2_000)
    expect(f.script('LSplus').chat.map((c) => c.text)).toContain("PROP for pose 'Sit1' saved to memory.")
    expect(dump(f)).toContain('PROP Sit1|ball|<0.00000, 1.00000, 1.00000>|<0.00000, 0.00000, 0.00000>')
  })

  it('[SOUNDS] plays the chosen sound; volume, loop and [OK] store it (FIX: with its volume)', async () => {
    const f = await extras(['chime'])
    f.click(owner, '[SOUNDS]')
    expect(menuText(f)).toContain('1.chime')
    f.click(owner, '1')
    expect(menuText(f)).toContain('Sound:chime\nVolume:100%')
    expect(sound(f)).toMatchObject({ volume: 1, loop: false })
    f.click(owner, '[VOLUME+]') // already at the top
    expect(menuText(f)).toContain('Volume:100%')
    f.click(owner, '[VOLUME-]')
    expect(menuText(f)).toContain('Volume:80%')
    f.click(owner, '[LOOP]')
    expect(f.lastDialog(owner).buttons).toContain('[NO LOOP]')
    expect(sound(f)).toMatchObject({ loop: true })
    expect(sound(f)!.volume).toBeCloseTo(0.8, 5)
    f.click(owner, '[OK]')
    expect(menuText(f)).toContain('Sound:chime')
    expect(dump(f)).toContain('SOUND Sit1|chime|1|0.8')
  })

  it('[CLEAR] removes the pose\'s sound and stops it', async () => {
    const f = await extras(['chime'])
    f.click(owner, '[SOUNDS]')
    f.click(owner, '1')
    f.click(owner, '[OK]')
    f.click(owner, '[SOUNDS]')
    f.click(owner, '[CLEAR]')
    expect(menuText(f)).toContain('Sound:N/A')
    expect(String(sound(f)?.sound ?? '')).toBe(SILENCE)
  })

  it('[ITEMS] stores an item given to whoever plays the pose', async () => {
    const f = await extras()
    f.click(owner, '[ITEMS]')
    f.click(owner, '2')
    expect(menuText(f)).toContain('Item:gift')
    expect(dump(f)).toContain('ITEM Sit1|gift|')
  })

  it('[FACES] pages through the expressions; the chosen one plays and is stored, [CLEAR] stops it', async () => {
    const f = await extras()
    f.click(owner, '[FACES]')
    expect(menuText(f)).toContain('1.express_afraid_emote')
    expect(menuText(f)).toContain('8.express_toothsmile')
    f.click(owner, '[PAGE-]') // from the first page to the last
    expect(menuText(f)).toContain('1.express_kiss\n2.express_open_mouth\n3.express_tongue_out')
    f.click(owner, '[PAGE+]') // from the last page to the first
    expect(menuText(f)).toContain('1.express_afraid_emote')
    f.click(owner, '[PAGE+]')
    expect(menuText(f)).toContain('1.express_smile')
    f.click(owner, '1')
    f.settle(3_000)
    expect(menuText(f)).toContain('Face:express_smile')
    expect(faces(f, owner)).toContain('express_smile')
    f.click(owner, '[FACES]')
    f.click(owner, '[CLEAR]')
    expect(menuText(f)).toContain('Face:N/A')
    const count = faces(f, owner).length
    f.settle(5_000)
    expect(faces(f, owner)).toHaveLength(count) // stopped
  })

  it('choosing another face stops the previous one (FIX)', async () => {
    const f = await extras()
    f.click(owner, '[FACES]')
    f.click(owner, '1') // express_afraid_emote
    f.settle(2_000)
    f.click(owner, '[FACES]')
    f.click(owner, '2') // express_anger_emote
    f.settle(1_500)
    const before = faces(f, owner).length
    f.settle(5_000)
    const after = faces(f, owner).slice(before)
    expect(after.length).toBeGreaterThan(0)
    expect(new Set(after)).toEqual(new Set(['express_anger_emote']))
  })

  it('[BACK] in a list returns to the EXTRAS menu', async () => {
    const f = await extras()
    f.click(owner, '[ITEMS]')
    f.click(owner, '[BACK]')
    expect(menuText(f)).toContain('EXTRAS for Pose:Sit1')
  })

  it('a list with nothing to choose says so', async () => {
    const f = await extras()
    f.click(owner, '[SOUNDS]')
    expect(menuText(f)).toBe('\nNo items of that type in the prim inventory.')
    expect(f.lastDialog(owner).buttons).toEqual(['[BACK]'])
  })

  it('is for the owner only', async () => {
    const f = await furniture({
      scripts: ['LSsit', 'LSplus', 'LSadjuster'],
      objects: { LShelper: ['LShelper-script'] },
    })
    const alice = f.avatar('Alice')
    helperMode(f, alice)
    const before = f.dialogsFor(alice).length
    f.click(alice, '[EXTRA]')
    f.settle(3_000)
    expect(ims(f)).toContain('Sorry, the [EXTRAS] menu is for Owner only.')
    expect(f.dialogsFor(alice).length).toBe(before + 1) // the pose menu again
    expect(f.lastDialog(alice).script).toBe('LSsit')
  })

  it('[CLEAR] removes the prop and the item of the pose', async () => {
    const card = CARD + '\nPROP Sit1|ball|<0,0,1>|<0,0,0>\nITEM Sit1|gift'
    const f = await extras([], card)
    expect(menuText(f)).toContain('Prop:ball')
    expect(menuText(f)).toContain('Item:gift')
    f.click(owner, '[PROPS]')
    f.click(owner, '[CLEAR]')
    expect(menuText(f)).toContain('Prop:N/A')
    f.click(owner, '[ITEMS]')
    f.click(owner, '[CLEAR]')
    expect(menuText(f)).toContain('Item:N/A')
    const out = dump(f)
    expect(out.some((l) => l.startsWith('PROP') || l.startsWith('ITEM'))).toBe(false)
  })

  it('[DUMP] writes the EXTRAS of the notecard back, numbered expressions by name', async () => {
    const card = CARD + `
◆PROP Sit1|ball|<0,0,1>|<0,0,0>
SOUND Sit1|chime|0|1
ITEM Sit1|gift|anim1
ANIM Sit1|8:2:express_wink_emote:-
CAMERA <2,0,1>|<3,0,1>`
    const f = await extras(['chime'], card)
    expect(dump(f)).toEqual(expect.arrayContaining([
      '-----EXTRAS------------',
      'PROP Sit1|ball|<0,0,1>|<0,0,0>',
      'SOUND Sit1|chime|0|1',
      'ITEM Sit1|gift|anim1',
      'ANIM Sit1|express_smile:2:express_wink_emote:-',
      'CAMERA <2.00000, 0.00000, 1.00000>|<3.00000, 0.00000, 1.00000>',
    ]))
  })

  it('standing up from the helper stops the sound', async () => {
    const f = await extras(['chime'])
    f.click(owner, '[SOUNDS]')
    f.click(owner, '1')
    f.click(owner, '[LOOP]')
    expect(sound(f)).toMatchObject({ loop: true })
    f.world.standAvatar(f.world.avatars.find((a) => a.key === OWNER)!)
    f.settle(2_000)
    expect(String(sound(f)!.sound)).toBe(SILENCE)
  })

  it('asks for a pose to be chosen first when none was played yet', async () => {
    const f = await furniture()
    f.sendLinked('LSplus', 90140, '', OWNER)
    expect(printed(f)).toContain('LSplus:Please select an animation first.')
  })

  it('keeps working after the furniture is rezzed again (FIX: it listened on the old channels)', async () => {
    const f = await extras()
    f.script('LSplus').fire('on_rez', { start_param: 0 })
    f.settle()
    touchHelper(f, owner)
    f.click(owner, '[EXTRA]')
    const channel = f.lastDialog(owner).channel
    expect(f.script('LSplus').listens.some((l) => l.channel === channel && l.active)).toBe(true)
    f.click(owner, '[ITEMS]')
    expect(menuText(f)).toContain('Please choose your item')
  })
})

describe('LuaSitter1 LSplus notecard settings', () => {
  it('a SOUND line plays (or loops) its sound with the pose, and stops on another pose', async () => {
    const card = CARD + '\nSOUND Sit2|chime|1|0.5'
    const f = await furniture({ notecards: { LSpos: card } }, ['chime'])
    expect(printed(f)).toContain("LSplus:Read settings for Sound 'chime'")
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    f.click(alice, 'Sit2')
    expect(sound(f)).toMatchObject({ sound: f.itemKey('chime'), loop: true })
    expect(sound(f)!.volume).toBeCloseTo(0.5, 5)
    f.touch(alice)
    f.click(alice, 'Sit1')
    expect(String(sound(f)!.sound)).toBe(SILENCE)
  })

  it('a sound stops when its sitter stands up', async () => {
    const f = await furniture({ notecards: { LSpos: CARD + '\nSOUND Sit2|chime|0|1' } }, ['chime'])
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    f.click(alice, 'Sit2')
    expect(sound(f)).toMatchObject({ sound: f.itemKey('chime'), loop: false })
    f.stand(alice)
    expect(String(sound(f)!.sound)).toBe(SILENCE)
  })

  it('an ITEM line gives the item a second after the pose starts, only for its animation', async () => {
    const card = CARD + '\nITEM Sit2|gift|anim2\nITEM Sit1|ball|other_anim'
    const f = await furniture({ notecards: { LSpos: card } })
    expect(printed(f)).toContain("LSplus:Read settings for Item 'gift'")
    const alice = f.avatar('Alice')
    f.sit(alice) // Sit1: its ITEM is for another animation
    f.touch(alice)
    f.click(alice, 'Sit2')
    f.settle(2_000)
    const given = f.script('LSplus').callsOf('llGiveInventory').map((c) => c.args.map(String))
    expect(given).toEqual([[alice.key, 'gift']])
  })

  it('an ANIM line plays numbered expressions, and "-" holds the last one', async () => {
    const card = CARD + '\nANIM Sit2|8:1:express_wink_emote:-'
    const f = await furniture({ notecards: { LSpos: card } })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    f.click(alice, 'Sit2')
    f.settle(10_000)
    // number 8 is AVsitter1's express_smile; the wink is held, so not sent again
    expect(faces(f, alice)).toEqual(['express_smile', 'express_wink_emote'])
    expect(f.script('LSsit').callsOf('llStartAnimation').map((c) => String(c.args[0]))).toContain('express_wink_emote')
  })

  it('an ANIM sequence loops, and 1125 switches the expressions off and on', async () => {
    const card = CARD + '\nANIM Sit2|express_smile:1:express_frown:1'
    const f = await furniture({ notecards: { LSpos: card } })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    f.click(alice, 'Sit2')
    f.settle(4_000)
    expect(faces(f, alice).slice(0, 4)).toEqual(['express_smile', 'express_frown', 'express_smile', 'express_frown'])
    f.sendLinked('LSplus', 1125, '', alice.key)
    expect(ims(f)).toContain('Facial Expressions OFF')
    const count = faces(f, alice).length
    f.settle(4_000)
    expect(faces(f, alice)).toHaveLength(count)
    f.sendLinked('LSplus', 1125, '', alice.key)
    expect(ims(f)).toContain('Facial Expressions ON')
    f.settle(3_000)
    expect(faces(f, alice).length).toBeGreaterThan(count)
  })

  it('expressions stop when their sitter stands up', async () => {
    const f = await furniture({ notecards: { LSpos: CARD + '\nANIM Sit2|express_smile:1' } })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    f.click(alice, 'Sit2')
    f.settle(2_000)
    f.stand(alice)
    const count = faces(f, alice).length
    f.settle(5_000)
    expect(faces(f, alice)).toHaveLength(count)
  })

  it('a CAMERA line sets the camera of the first sitter and sends it on for the second (90150)', async () => {
    const card = `CAMERA <2,0,1>|<3,0,1>\n${CARD}\nSITTER 1\nPOSE Sit1|anim1\n{Sit1}<1,0,0.5><0,0,0>`
    const f = await furniture({ scripts: ['LSsit', 'LSsit 1', 'LSplus'], prims: 2, notecards: { LSpos: card } })
    expect(printed(f)).toContain('LSplus:Read settings for Camera')
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    const params = f.script('LSplus').cameraParams
    expect(params.get(13)).toEqual({ x: 130, y: 128, z: 26 }) // CAMERA_POSITION
    expect(params.get(17)).toEqual({ x: 131, y: 128, z: 26 }) // CAMERA_FOCUS
    f.sit(bob)
    expect(f.linked()).toContainEqual({ num: 90150, str: `${bob.key}|<2.00000, 0.00000, 1.00000>|<3.00000, 0.00000, 1.00000>`, id: '1' })
  })

  it('the props are removed when the last sitter stands up', async () => {
    const f = await furniture({ notecards: { LSpos: CARD + '\nPROP Sit2|ball|<0,0,1>|<0,0,0>' } })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    f.click(alice, 'Sit2')
    expect(f.rezzed().map((l) => l.prims[0]!.name)).toEqual(['ball'])
    f.stand(alice)
    f.settle(2_000)
    expect(f.rezzed()).toHaveLength(0)
  })

  it('a prop rezzed by a BUTTON stays when the pose changes', async () => {
    const card = CARD.replace('POSE Sit2|anim2', 'POSE Sit2|anim2\nBUTTON Ball|90200') + '\nPROP Ball|ball|<0,0,1>|<0,0,0>'
    const f = await furniture({ notecards: { LSpos: card } })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    f.click(alice, 'Ball')
    f.settle(2_000)
    expect(f.rezzed().map((l) => l.prims[0]!.name)).toEqual(['ball'])
    f.touch(alice)
    f.click(alice, 'Sit2')
    f.settle(2_000)
    expect(f.rezzed().map((l) => l.prims[0]!.name)).toEqual(['ball'])
  })

  it('a BUTTON without a PROP line removes the props and opens the menu again', async () => {
    const card = CARD.replace('POSE Sit2|anim2', 'POSE Sit2|anim2\nBUTTON Nothing|90200') + '\nPROP Sit2|ball|<0,0,1>|<0,0,0>'
    const f = await furniture({ notecards: { LSpos: card } })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    f.click(alice, 'Sit2')
    expect(f.rezzed()).toHaveLength(1)
    f.touch(alice)
    const before = f.dialogsFor(alice).length
    f.click(alice, 'Nothing')
    f.settle(2_000)
    expect(f.rezzed()).toHaveLength(0)
    expect(f.dialogsFor(alice).length).toBe(before + 1)
  })

  it('a SYNC with a PROP line rezzes the prop once for both sitters, and keeps it while one stays', async () => {
    const card = `SITTER 0
POSE Sit1|anim1
SYNC Hug|anim1
{Sit1}<0,0,0.5><0,0,0>
{Hug}<0,0,0.5><0,0,0>
SITTER 1
POSE Sit1|anim2
SYNC Hug|anim2
{Sit1}<1,0,0.5><0,0,0>
{Hug}<1,0,0.5><0,0,0>
PROP S:Hug|ball|<0,0,1>|<0,0,0>`
    const f = await furniture({ scripts: ['LSsit', 'LSsit 1', 'LSplus'], prims: 2, notecards: { LSpos: card } })
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.touch(alice)
    f.click(alice, 'Hug')
    f.settle(2_000)
    expect(f.rezzed().map((l) => l.prims[0]!.name)).toEqual(['ball'])
    expect(f.script('LSplus').callsOf('llRezAtRoot')).toHaveLength(1)
    f.stand(bob)
    f.settle(2_000)
    expect(f.rezzed()).toHaveLength(1) // Alice is still sitting
    f.stand(alice)
    f.settle(2_000)
    expect(f.rezzed()).toHaveLength(0)
  })

  it('two sitters in a pose with an ANIM line both get the expressions', async () => {
    const card = `SITTER 0
POSE Sit1|anim1
{Sit1}<0,0,0.5><0,0,0>
SITTER 1
POSE Sit1|anim2
{Sit1}<1,0,0.5><0,0,0>
ANIM Sit1|express_smile:1`
    const f = await furniture({ scripts: ['LSsit', 'LSsit 1', 'LSplus'], prims: 2, notecards: { LSpos: card } })
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.settle(3_000)
    expect(faces(f, alice)).toContain('express_smile')
    expect(faces(f, bob)).toContain('express_smile')
  })

  it('falls back to the dataserver reader when the fast reader answers NAK', async () => {
    const f = await buildFurniture({
      sources,
      scripts: ['LSsit', 'LSplus'],
      notecards: { LSpos: CARD + '\nPROP Sit2|ball|<0,0,1>|<0,0,0>' },
      animations: ['anim1', 'anim2'],
      objects: { ball: ['LSprop'] },
    })
    f.script('LSplus').mock('llGetNotecardLineSync', () => NAK)
    f.start()
    f.settle(5_000)
    expect(f.script('LSplus').callsOf('llGetNotecardLine').length).toBeGreaterThan(0)
    expect(printed(f)).toContain("LSplus:Read settings for Prop 'ball'")
    expect(printed(f).some((l) => l.startsWith('LSplus:Ready'))).toBe(true)
  })

  it('reads AVpos when there is no LSpos', async () => {
    const f = await furniture({ notecards: { AVpos: CARD + '\nPROP Sit2|ball|<0,0,1>|<0,0,0>' } })
    expect(printed(f)).toContain('LSplus:Reading AVpos')
    expect(printed(f)).toContain("LSplus:Read settings for Prop 'ball'")
  })

  it('editing the notecard removes the props and reads it again', async () => {
    const card = CARD + '\nPROP Sit2|ball|<0,0,1>|<0,0,0>'
    const f = await furniture({ notecards: { LSpos: card } })
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    f.click(alice, 'Sit2')
    expect(f.rezzed()).toHaveLength(1)
    f.setNotecard('LSpos', card + '\nSOUND Sit1|chime|0|1')
    f.settle(3_000)
    expect(f.rezzed()).toHaveLength(0)
    expect(printed(f)).toContain("LSplus:Read settings for Sound 'chime'")
  })

  it('a numbered copy ("LSplus 1") does nothing', async () => {
    const f = await furniture({ scripts: ['LSsit', 'LSplus', 'LSplus 1'] })
    expect(f.printed('LSplus 1')).toEqual([])
    expect(f.script('LSplus 1').listens).toEqual([])
  })
})

describe('LuaSitter1 LSprop', () => {
  it('rezzed by hand (start parameter 0), a prop does not listen', async () => {
    const f = await buildFurniture({ sources, scripts: ['LSprop'] })
    f.start()
    f.script('LSprop').fire('on_rez', { start_param: 0 })
    f.settle()
    expect(f.script('LSprop').listens).toEqual([])
  })

  it('a rezzed prop answers PROPSEARCH and dies on REMPROPS, from any prim', async () => {
    const f = await buildFurniture({ sources, scripts: ['LSprop'] })
    f.start()
    const prop = f.script('LSprop')
    prop.fire('on_rez', { start_param: -42 })
    f.settle()
    prop.deliverChat({ channel: -42, name: 'x', key: NULL_KEY, message: 'PROPSEARCH' })
    f.settle()
    expect(prop.chat).toContainEqual(expect.objectContaining({ channel: -42, text: 'SAVEPROP', type: 'shout' }))
    prop.deliverChat({ channel: -42, name: 'x', key: NULL_KEY, message: 'REMPROPS' })
    f.settle()
    expect(prop.dead).toBe(true)
  })
})

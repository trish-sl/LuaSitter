// LuaSitter1 LSadjuster with the LShelper object (LShelper-script inside): the [NEW]
// menu (POSE, SYNC, SUBMENU, paging, empty and cleaned-up names, owner and prim
// checks), helper mode (sitting on and touching helpers, standing up, swapping
// SYNC helpers, [SAVE] of a SYNC, the helpers removed by a notecard edit or a new
// sitter), the AVsitter names AVpos / AVhelper, the "one adjuster" rule and /5 cleanup.
import { describe, it, expect } from 'vitest'
import { NULL_KEY } from '@rezless/vitest'
import { buildFurniture, LS1_SCRIPTS, LS1, OWNER } from '../helpers/furniture.js'
import type { Avatar, Furniture, FurnitureOptions } from '../helpers/furniture.js'

const owner: Avatar = { key: OWNER, name: 'Owner Resident' }
const sources = { ...LS1_SCRIPTS, 'LShelper-script': LS1 + 'LShelper-script.luau' }
const CARD = `SITTER 0
POSE Sit1|anim1
SYNC Hug|anim1
{Sit1}<0,0,0.5><0,0,0>
{Hug}<0,0,0.5><0,0,0>
SITTER 1
POSE Sit1|anim1
SYNC Hug|anim2
{Sit1}<1,0,0.5><0,0,0>
{Hug}<1,0,0.5><0,0,0>`

async function workshop(opts: Partial<FurnitureOptions> = {}) {
  const f = await buildFurniture({
    sources,
    scripts: ['LSsit', 'LSsit 1', 'LSadjuster'],
    prims: 2,
    notecards: { LSpos: CARD },
    animations: ['anim1', 'anim2'],
    objects: { LShelper: ['LShelper-script'] },
    ...opts,
  })
  // rezless raises `changed` inside llUnSit, before the link messages LSadjuster
  // sends right after it; in Second Life the avatar stands up (and `changed`
  // comes) later. So the unseat is only recorded here, and helperMode() stands
  // the avatar up once the helpers are rezzed.
  f.script('LSadjuster').mock('llUnSit', () => undefined)
  f.start()
  f.settle(5_000)
  return f
}

/**
 * An avatar sits, chooses a pose, then [ADJUST] > [HELPER]: helper mode. LSadjuster
 * unseats the avatar and rezzes a helper per sitter in the pose; the avatar then
 * sits on helper `onHelper` (if given) and touches it for the helper-mode menu.
 * (A new sitter gets no menu by itself: LSsit leaves that to LSselect, as upstream.)
 */
function helperMode(f: Furniture, av: Avatar = owner, pose?: string, onHelper: number | null = 0) {
  f.sit(av)
  if (pose) {
    f.touch(av)
    f.click(av, pose)
  }
  f.touch(av)
  f.click(av, '[ADJUST]')
  f.click(av, '[HELPER]')
  f.settle(3_000)
  for (const c of f.script('LSadjuster').callsOf('llUnSit')) {
    const unsat = f.seated.find((a) => a.key === String(c.args[0]))
    if (unsat) f.stand(unsat)
  }
  if (onHelper !== null) {
    sitOnHelper(f, av, onHelper)
    grantFromHelper(f, onHelper)
    touchHelper(f, av, onHelper)
  }
}

/** Sitters on a helper are not links of the furniture: grant LSsit's request by hand. */
function grantFromHelper(f: Furniture, n: number) {
  f.script(n === 0 ? 'LSsit' : `LSsit ${n}`).grantPermissions()
  f.settle(2_000)
}

/** The owner types a name in the adjuster's text box. */
function typeName(f: Furniture, name: string) {
  f.script('LSadjuster').answerDialog(name, { name: owner.name })
  f.settle(3_000)
}

const said = (f: Furniture) => f.script('LSadjuster').chat.filter((c) => c.channel === 0).map((c) => c.text)
const ims = (f: Furniture, script = 'LSadjuster') => f.script(script).callsOf('llInstantMessage').map((c) => String(c.args[1]))

/** [DUMP] from the helper-mode menu: the notecard lines the sitter scripts say. */
function dump(f: Furniture, av: Avatar = owner) {
  touchHelper(f, av, 0)
  f.click(av, '[DUMP]')
  f.settle(10_000)
  return ['LSsit', 'LSsit 1'].flatMap((s) => f.script(s).chat.map((c) => c.text.replace(/^◆/, '')))
}

const helpers = (f: Furniture) => f.rezzed().map((l) => l.prims[0]!.name).sort()
const helper = (f: Furniture, n: number) => f.rezzed().find((l) => l.prims[0]!.name === `LShelper ${n}`)!

/** An avatar sits on a rezzed helper object (as clicking "Sit" on it in-world). */
function sitOnHelper(f: Furniture, av: Avatar, n: number) {
  const wa = f.world.avatars.find((a) => a.key === av.key)!
  if (!f.world.sitAvatar(wa, helper(f, n).prims[0]!)) throw new Error('rezless refused the sit')
  f.settle(2_000)
}

function touchHelper(f: Furniture, av: Avatar, n: number) {
  helper(f, n).touch(1, { avatar: { key: av.key, name: av.name } })
  f.settle(2_000)
}

describe('LuaSitter1 LSadjuster [NEW] menu', () => {
  it('[NEW] > [POSE] adds a pose with the chosen animation, plays it and lists it in the menu and DUMP', async () => {
    const f = await workshop()
    helperMode(f)
    f.click(owner, '[NEW]')
    expect(f.lastDialog(owner).message).toContain('What would you like to create?')
    expect(f.lastDialog(owner).buttons).toEqual(expect.arrayContaining(['[POSE]', '[SYNC]', '[SUBMENU]', '[BACK]']))
    f.click(owner, '[POSE]')
    expect(f.lastDialog(owner).message).toContain('1.anim1\n2.anim2')
    f.click(owner, '2')
    expect(f.script('LSadjuster').dialogs.at(-1)!.message).toContain('Please type a menu name for pose\n\nAnimation: anim2')
    typeName(f, 'Lean')
    expect(said(f)).toContain("Added POSE 'Lean' using anim 'anim2' in SITTER 0")
    expect(f.lastDialog(owner).buttons).toContain('Lean')
    expect(dump(f)).toContain('POSE Lean|anim2')
  })

  it('[NEW] > [SYNC] adds a SYNC to both sitters with the two chosen animations', async () => {
    const f = await workshop()
    helperMode(f)
    f.click(owner, '[NEW]')
    f.click(owner, '[SYNC]')
    expect(f.lastDialog(owner).message).toContain('Please choose your first animation:')
    f.click(owner, '2')
    expect(f.lastDialog(owner).message).toContain('Please choose your second animation:')
    f.click(owner, '1')
    expect(f.script('LSadjuster').dialogs.at(-1)!.message).toContain('Animation1: anim2\nAnimation2: anim1')
    typeName(f, 'Kiss')
    expect(said(f)).toContain("Added SYNC 'Kiss' using anms 'anim2' and 'anim1'")
    const out = dump(f)
    const sitter1 = out.indexOf('SITTER 1|')
    expect(out.indexOf('SYNC Kiss|anim2')).toBeLessThan(sitter1)
    expect(out.lastIndexOf('SYNC Kiss|anim1')).toBeGreaterThan(sitter1)
  })

  it('[NEW] > [SYNC] with one LSsit says two are needed and shows the [NEW] menu again', async () => {
    const f = await workshop({ scripts: ['LSsit', 'LSadjuster'], prims: 1 })
    helperMode(f)
    f.click(owner, '[NEW]')
    f.click(owner, '[SYNC]')
    expect(f.printed('LSadjuster')).toContain('LSadjuster: To create a SYNC via menu requires 2 LSsit scripts in the prim!')
    expect(f.lastDialog(owner).message).toContain('What would you like to create?')
  })

  it('[NEW] > [SUBMENU] adds a TOMENU button and its MENU', async () => {
    const f = await workshop()
    helperMode(f)
    f.click(owner, '[NEW]')
    f.click(owner, '[SUBMENU]')
    expect(f.script('LSadjuster').dialogs.at(-1)!.message).toContain('Please type a name for your submenu:')
    typeName(f, 'Extras')
    expect(f.printed('LSadjuster')).toContain("LSadjuster: Created submenu 'Extras' in SITTER 0")
    expect(f.lastDialog(owner).buttons).toContain('Extras*')
    const out = dump(f)
    expect(out).toContain('TOMENU Extras')
    expect(out).toContain('MENU Extras')
  })

  it('a typed name loses "|" and is cut to 23 characters', async () => {
    const f = await workshop()
    helperMode(f)
    f.click(owner, '[NEW]')
    f.click(owner, '[POSE]')
    f.click(owner, '1')
    typeName(f, 'A|very long pose name indeed')
    expect(said(f)).toContain("Added POSE 'Avery long pose name in' using anim 'anim1' in SITTER 0")
  })

  it('an empty name adds nothing and opens the menu once (FIX: it opened twice)', async () => {
    const f = await workshop()
    helperMode(f)
    f.click(owner, '[NEW]')
    f.click(owner, '[POSE]')
    f.click(owner, '1')
    f.script('LSadjuster').clearLinkedMessages()
    typeName(f, '')
    expect(f.script('LSadjuster').linkedMessages.filter((m) => m.num === 90005)).toHaveLength(1)
    expect(said(f).filter((t) => t.startsWith('Added'))).toHaveLength(0)
    expect(f.lastDialog(owner).script).toBe('LSsit')
  })

  it('[BACK] in the [NEW] menu returns to the pose menu', async () => {
    const f = await workshop()
    helperMode(f)
    f.click(owner, '[NEW]')
    f.click(owner, '[BACK]')
    expect(f.lastDialog(owner).script).toBe('LSsit')
    expect(f.lastDialog(owner).buttons).toContain('[NEW]')
  })

  it('[PAGE+] and [PAGE-] page through more than 9 animations, wrapping at both ends', async () => {
    const anims = Array.from({ length: 11 }, (_, i) => `a${String(i + 1).padStart(2, '0')}`)
    const card = CARD.replace(/anim1/g, 'a01').replace(/anim2/g, 'a02')
    const f = await workshop({ animations: anims, notecards: { LSpos: card } })
    helperMode(f)
    f.click(owner, '[NEW]')
    f.click(owner, '[POSE]')
    expect(f.lastDialog(owner).message).toContain('9.a09')
    expect(f.lastDialog(owner).message).not.toContain('a10')
    f.click(owner, '[PAGE+]')
    expect(f.lastDialog(owner).message).toContain('1.a10\n2.a11')
    f.click(owner, '[PAGE+]') // past the last page: back to the first
    expect(f.lastDialog(owner).message).toContain('1.a01')
    f.click(owner, '[PAGE-]') // before the first page: the last
    expect(f.lastDialog(owner).message).toContain('1.a10')
    f.click(owner, '2')
    typeName(f, 'Eleven')
    expect(said(f)).toContain("Added POSE 'Eleven' using anim 'a11' in SITTER 0")
  })

  it('with no animations in the prim, [POSE] says so and offers only [BACK]', async () => {
    const f = await workshop()
    helperMode(f)
    f.setItem('anim1', null)
    f.setItem('anim2', null)
    touchHelper(f, owner, 0)
    f.click(owner, '[NEW]')
    f.click(owner, '[POSE]')
    expect(f.lastDialog(owner).message).toBe('\nNo animations in the prim inventory.')
    expect(f.lastDialog(owner).buttons).toEqual(['[BACK]'])
  })

  it('[NEW] is for the owner only', async () => {
    const f = await workshop()
    const alice = f.avatar('Alice')
    helperMode(f, alice)
    f.click(alice, '[NEW]')
    expect(ims(f)).toContain('Sorry, the [NEW] menu is for owner only.')
  })

  it('[NEW] needs LSadjuster in the same prim as LSsit', async () => {
    const f = await workshop({
      scripts: ['LSadjuster'],
      childScripts: { 2: ['LSsit', 'LSsit 1'] },
      contentsLink: 2,
      prims: 3,
    })
    f.sit(owner, 2)
    f.touch(owner, 2)
    f.click(owner, '[ADJUST]')
    f.click(owner, '[HELPER]')
    f.settle(3_000)
    f.stand(owner)
    expect(helpers(f)).toEqual(['LShelper 0'])
    sitOnHelper(f, owner, 0)
    grantFromHelper(f, 0)
    touchHelper(f, owner, 0)
    f.click(owner, '[NEW]')
    expect(ims(f)).toContain('Sorry, the [NEW] menu is only available if your LSadjuster and LShelper are in the same prim as your LSsit.')
  })
})

describe('LuaSitter1 LSadjuster helper mode', () => {
  it('[HELPER] unseats the sitters and rezzes a helper for each sitter in the pose', async () => {
    const f = await workshop()
    helperMode(f, owner, 'Hug', null)
    expect(f.script('LSadjuster').callsOf('llUnSit').map((c) => String(c.args[0]))).toEqual([OWNER])
    expect(helpers(f)).toEqual(['LShelper 0', 'LShelper 1'])
    // each helper stands where its sitter's pose is
    expect(helper(f, 0).prims[0]!.params.position).toEqual({ x: 128, y: 128, z: 25.5 })
    expect(helper(f, 1).prims[0]!.params.position).toEqual({ x: 129, y: 128, z: 25.5 })
  })

  it('an avatar sitting on a helper is given the pose of that sitter', async () => {
    const f = await workshop()
    helperMode(f, owner, undefined, null)
    const alice = f.avatar('Alice')
    sitOnHelper(f, alice, 0)
    expect(f.linked()).toContainEqual({ num: 90050, str: '0', id: alice.key })
    expect(f.script('LSsit').permissionRequests.at(-1)!.agent).toBe(alice.key)
    grantFromHelper(f, 0)
    expect(f.playing(alice)).toEqual(['anim1'])
    touchHelper(f, alice, 0)
    expect(f.lastDialog(alice).message).toContain('Sitter 0')
    expect(f.lastDialog(alice).buttons).toEqual(expect.arrayContaining(['[NEW]', '[DUMP]', '[SAVE]']))
  })

  it('touching a free helper gives its pose to the toucher', async () => {
    const f = await workshop()
    helperMode(f, owner, undefined, null)
    const alice = f.avatar('Alice')
    touchHelper(f, alice, 0)
    expect(f.linked()).toContainEqual({ num: 90050, str: '0', id: alice.key })
    expect(f.script('LSsit').permissionRequests.at(-1)!.agent).toBe(alice.key)
  })

  it('touching the helper you sit on opens your menu', async () => {
    const f = await workshop()
    helperMode(f)
    const before = f.dialogsFor(owner).length
    touchHelper(f, owner, 0)
    expect(f.linked()).toContainEqual({ num: 90005, str: '3', id: OWNER })
    expect(f.dialogsFor(owner).length).toBe(before + 1)
    expect(f.lastDialog(owner).message).toContain('Sitter 0')
  })

  it('standing up from a helper frees that sitter (90075)', async () => {
    const f = await workshop()
    helperMode(f)
    expect(f.playing(owner)).toEqual(['anim1'])
    f.world.standAvatar(f.world.avatars.find((a) => a.key === OWNER)!)
    f.settle(2_000)
    expect(f.linked()).toContainEqual({ num: 90075, str: '0', id: NULL_KEY })
    expect(f.playing(owner)).toEqual([])
  })

  it('claiming another helper unseats the avatar from the first one and frees that sitter', async () => {
    const f = await workshop()
    helperMode(f)
    f.click(owner, 'Hug') // a SYNC: a helper for sitter 1 too
    expect(helpers(f)).toEqual(['LShelper 0', 'LShelper 1'])
    touchHelper(f, owner, 1) // the owner, on helper 0, touches helper 1
    expect(f.linked()).toContainEqual({ num: 90075, str: '0', id: NULL_KEY })
    expect(f.linked()).toContainEqual({ num: 90050, str: '1', id: OWNER })
    const unsat = helper(f, 0).allScripts()[0]!.callsOf('llUnSit').map((c) => String(c.args[0]))
    expect(unsat).toContain(OWNER)
  })

  it('leaving a SYNC removes the helper of the partner and frees the avatar on it', async () => {
    const f = await workshop()
    helperMode(f)
    f.click(owner, 'Hug')
    const alice = f.avatar('Alice')
    sitOnHelper(f, alice, 1)
    grantFromHelper(f, 1)
    expect(f.playing(alice)).toEqual(['anim2'])
    f.click(owner, 'Sit1') // a POSE: sitter 1 is no longer part of it
    f.settle(2_000)
    expect(helpers(f)).toEqual(['LShelper 0'])
    expect(f.linked()).toContainEqual({ num: 90075, str: '1', id: NULL_KEY })
    expect(f.playing(alice)).toEqual([])
  })

  it('a swap swaps the numbers of the SYNC helpers', async () => {
    const f = await workshop()
    helperMode(f, owner, 'Hug', null)
    const h0 = helper(f, 0)
    const h1 = helper(f, 1)
    f.broadcast(90030, '0', '1')
    f.settle(2_000)
    expect(h0.prims[0]!.name).toBe('LShelper 1')
    expect(h1.prims[0]!.name).toBe('LShelper 0')
  })

  it('[SAVE] of a SYNC saves both sitters and says "SYNC ... saved to memory"', async () => {
    const f = await workshop()
    helperMode(f)
    f.click(owner, 'Hug')
    f.click(owner, '[SAVE]')
    f.settle(2_000)
    expect(said(f)).toContain("SYNC 'Hug' saved to memory.")
    expect(f.linked().filter((m) => m.num === 90090).map((m) => m.str).sort()).toEqual(['0', '1'])
  })

  it('[SAVE] with an avatar on the helper saves the avatar\'s position', async () => {
    const f = await workshop()
    helperMode(f)
    // place the seated owner by hand, half a metre beside and one metre above the furniture
    f.script('LSadjuster').mock('llGetObjectDetails', (_ctx, args) => {
      if (String(args[0]) === OWNER) return [{ x: 128, y: 128.5, z: 26 }, { x: 0, y: 0, z: 0, s: 1 }]
      return [{ x: 128, y: 128, z: 25 }, { x: 0, y: 0, z: 0, s: 1 }]
    })
    f.click(owner, '[SAVE]')
    f.settle(2_000)
    expect(f.linked()).toContainEqual({ num: 90090, str: '0', id: '<0.00000, 0.50000, 1.00000>|<0.00000, 0.00000, 0.00000>' })
    expect(said(f)).toContain("POSE 'Sit1' saved to memory.")
  })

  it('editing the notecard removes the helpers', async () => {
    const f = await workshop()
    helperMode(f)
    expect(helpers(f)).toEqual(['LShelper 0'])
    f.setNotecard('LSpos', CARD + '\n')
    f.settle(3_000)
    expect(helpers(f)).toEqual([])
  })

  it('someone sitting on the furniture removes the helpers', async () => {
    const f = await workshop()
    helperMode(f, owner, undefined, null)
    f.sit(f.avatar('Alice'))
    f.settle(2_000)
    expect(helpers(f)).toEqual([])
  })

  it('without a helper object there is no [HELPER] button, and helper mode reports an error', async () => {
    const f = await workshop({ objects: {} })
    f.sit(owner)
    f.touch(owner)
    f.click(owner, '[ADJUST]')
    expect(f.lastDialog(owner).buttons).not.toContain('[HELPER]')
    f.broadcast(90100, '0|2', '')
    f.settle(3_000)
    expect(f.printed('LSadjuster')).toContain('LSadjuster: Error: no LShelper (or AVhelper) object in this prim')
    expect(f.rezzed()).toHaveLength(0)
  })

  it('uses AVpos and an AVhelper object when the LuaSitter names are missing', async () => {
    const f = await workshop({ notecards: { AVpos: CARD }, objects: { AVhelper: ['LShelper-script'] } })
    helperMode(f, owner, undefined, null)
    expect(helpers(f)).toEqual(['LShelper 0']) // the helper script names itself
    f.setNotecard('AVpos', CARD + '\n') // an edit of AVpos is noticed
    expect(helpers(f)).toEqual([])
  })
})

describe('LuaSitter1 LSadjuster removal', () => {
  it('a newer adjuster in the linkset makes the old one delete itself and its helper objects', async () => {
    const f = await workshop({ objects: { LShelper: ['LShelper-script'], ball: [] } })
    f.sendLinked('LSadjuster', -5000, 'Adjuster-Check', NULL_KEY)
    const out = f.printed('LSadjuster')
    expect(out).toContain('Cleaning "LShelper" from prim 1')
    expect(out).toContain('Please place only one Adjuster in your linkset!')
    const removed = f.script('LSadjuster').callsOf('llRemoveInventory').map((c) => String(c.args[0]))
    expect(removed).toEqual(['LShelper', 'LSadjuster']) // other objects are kept
  })

  it('"/5 cleanup" removes the helpers, the helper object and the adjuster', async () => {
    const f = await workshop()
    helperMode(f)
    f.say(owner, 5, 'cleanup')
    f.settle(3_000)
    expect(f.rezzed()).toHaveLength(0)
    expect(f.prims[0]!.inventory.map((i) => i.name)).not.toContain('LShelper')
    expect(f.prims[0]!.inventory.map((i) => i.name)).not.toContain('LSadjuster')
  })

  it('is reset when the furniture is rezzed (and announces itself again)', async () => {
    const f = await workshop()
    const checks = () => f.linked().filter((m) => m.str === 'Adjuster-Check').length
    expect(checks()).toBe(1)
    f.script('LSadjuster').fire('on_rez', { start_param: 0 })
    f.settle()
    expect(checks()).toBe(2)
  })
})

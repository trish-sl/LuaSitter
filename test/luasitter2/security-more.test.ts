// LuaSitter2: more of [LS]root-security: GROUP access, the [BACK] button and
// how the security menu closes, touches handed to [LS]root-control /
// [LS]root-RLV, relayed touches (90006), [LS]commands checks (90013), and the
// "is RLV present" answer (90201 / 90202).
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS, OWNER } from '../helpers/furniture.js'
import type { Avatar, Furniture } from '../helpers/furniture.js'

const CARD = `MTYPE 1
SITTER 0
POSE Sit1|anim1
{Sit1}<0,0.3,0.5><0,0,0>
SITTER 1
POSE Sit1|anim1
{Sit1}<0,-0.3,0.5><0,0,0>`

const owner: Avatar = { key: OWNER, name: 'Owner Resident' }

async function furniture(placeholders: string[] = []) {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]sit', '[LS]sit 1', '[LS]root-security'],
    placeholders,
    prims: 2,
    notecards: { LSpos: CARD },
    animations: ['anim1'],
  })
  f.start()
  return f
}

/** Only the root-security script, so the tests see exactly the link messages it sends. */
async function securityOnly(placeholders: string[] = []) {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]root-security'],
    placeholders,
    prims: 2,
    notecards: { LSpos: CARD },
  })
  f.start()
  return f
}

/** The owner opens [ADJUST] > [SECURITY] (the owner sits first). */
function openSecurity(f: Furniture) {
  if (!f.seated.some((a) => a.key === OWNER)) f.sit(owner)
  f.touch(owner)
  f.click(owner, '[ADJUST]')
  f.click(owner, '[SECURITY]')
  expect(f.lastDialog(owner).script).toBe('[LS]root-security')
}

const unsat = (f: Furniture) =>
  Object.values(f.scripts).flatMap((s) => s.callsOf('llUnSit').map((c) => String(c.args[0])))

const securityListens = (f: Furniture) => f.script('[LS]root-security').listens.filter((l) => l.active !== false)

/** Say something on the security menu's channel as the owner (an old dialog, or a typed answer). */
function ownerSays(f: Furniture, text: string) {
  const s = f.script('[LS]root-security')
  const channel = f.lastDialog(owner).channel
  s.deliverChat({ channel, name: owner.name, key: OWNER, message: text })
  f.settle()
}

describe('LuaSitter2 [LS]root-security: GROUP access', () => {
  it('Sit access GROUP keeps group members seated and unseats the others', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice') // in the object's group
    const bob = f.avatar('Bob') // not
    f.script('[LS]root-security').mock('llSameGroup', (_ctx, args) => (String(args[0]).toLowerCase() === alice.key ? 1 : 0))
    openSecurity(f)
    f.click(owner, 'Sit')
    expect(f.lastDialog(owner).buttons.sort()).toEqual(['ALL', 'GROUP', 'OWNER'])
    f.click(owner, 'GROUP')
    const shown = f.dialogsFor(owner).slice(-3).map((d) => d.message)
    expect(shown.some((m) => m.includes('Sit access: GROUP\nMenu access: ALL'))).toBe(true)
    // GROUP does not include the owner (as in AVsitter): an owner who is not in the
    // object's group is unseated too. (The harness drops an unseated avatar from the
    // links only at the next settle step, so the CHANGED_LINK check may unseat it twice.)
    expect(new Set(unsat(f))).toEqual(new Set([OWNER]))
    expect(shown.at(-1)).toContain('Sorry, Sit access is set to: GROUP')
    f.sit(alice)
    expect(unsat(f)).not.toContain(alice.key)
    f.sit(bob)
    expect(unsat(f)).toContain(bob.key)
    expect(f.lastDialog(bob).message).toContain('Sorry, Sit access is set to: GROUP')
  })

  it('Menu access GROUP gives the menu to group members only', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.script('[LS]root-security').mock('llSameGroup', (_ctx, args) => (String(args[0]).toLowerCase() === alice.key ? 1 : 0))
    openSecurity(f)
    f.click(owner, 'Menu')
    f.click(owner, 'GROUP')
    f.stand(owner)
    f.sit(alice)
    f.sit(bob)
    f.touch(alice)
    expect(f.lastDialog(alice).buttons).toContain('Sit1')
    f.touch(bob)
    expect(f.lastDialog(bob).message).toContain('Sorry, Menu access is set to: GROUP')
  })
})

describe('LuaSitter2 [LS]root-security: the security menu', () => {
  it('[BACK] returns to the adjust menu', async () => {
    const f = await furniture()
    openSecurity(f)
    expect(f.lastDialog(owner).buttons).toContain('[BACK]')
    f.click(owner, '[BACK]')
    const d = f.lastDialog(owner)
    expect(d.script).toBe('[LS]sit')
    expect(d.buttons).toContain('[SECURITY]')
  })

  it('an unknown answer keeps the setting', async () => {
    const f = await furniture()
    openSecurity(f)
    f.click(owner, 'Sit')
    ownerSays(f, 'EVERYONE')
    expect(f.lastDialog(owner).message).toContain('Sit access: ALL')
  })

  it('stops listening after 10 minutes, on an answer it does not know, and on 90033', async () => {
    const f = await furniture()
    openSecurity(f)
    expect(securityListens(f)).toHaveLength(1)
    f.settle(601_000)
    expect(securityListens(f)).toHaveLength(0)

    openSecurity(f)
    expect(securityListens(f)).toHaveLength(1)
    ownerSays(f, 'OK') // not a security button
    expect(securityListens(f)).toHaveLength(0)

    openSecurity(f)
    f.sendLinked('[LS]root-security', 90033, '', '')
    expect(securityListens(f)).toHaveLength(0)
  })

  it('a non-owner asking for [SECURITY] without a sitter gets the adjust menu back for nobody', async () => {
    const f = await securityOnly()
    const alice = f.avatar('Alice')
    f.sendLinked('[LS]root-security', 90100, '3|[SECURITY]', alice.key)
    expect(f.linked()).toContainEqual({ num: 90101, str: `3|[ADJUST]|${alice.key}`, id: '00000000-0000-0000-0000-000000000000' })
  })
})

describe('LuaSitter2 [LS]root-security: touches and checks', () => {
  it('touching the furniture while nobody sits opens no menu', async () => {
    const f = await securityOnly()
    const alice = f.avatar('Alice')
    f.touch(alice)
    expect(f.linked().filter((m) => m.num === 90005 || m.num === 90007 || m.num === 90012)).toEqual([])
  })

  it('a touch is handed to [LS]root-control (90007), or to [LS]root-RLV with the prim (90012) even when nobody sits', async () => {
    const f = await securityOnly(['[LS]root-control'])
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    expect(f.linked()).toContainEqual({ num: 90007, str: '', id: alice.key })
    expect(f.linked().some((m) => m.num === 90005)).toBe(false)

    const rlv = await securityOnly(['[LS]root-control', '[LS]root-RLV'])
    const bob = rlv.avatar('Bob')
    rlv.touch(bob, 2)
    expect(rlv.linked()).toContainEqual({ num: 90012, str: '2', id: bob.key })
  })

  it('answers 90201 with 90202: 1 when [LS]root-RLV is present, else 0 (also said at start)', async () => {
    const f = await securityOnly()
    expect(f.linked()).toContainEqual({ num: 90202, str: '0', id: '' })
    f.sendLinked('[LS]root-security', 90201, '', '')
    expect(f.linked().filter((m) => m.num === 90202)).toHaveLength(2)
    const rlv = await securityOnly(['[LS]root-RLV'])
    expect(rlv.linked()).toContainEqual({ num: 90202, str: '1', id: '' })
  })

  it('a touch relayed by a sit script (90006) opens the menu, is refused silently, and is left to [LS]root-control', async () => {
    const f = await securityOnly()
    const alice = f.avatar('Alice')
    f.sendLinked('[LS]root-security', 90006, '2', alice.key)
    expect(f.linked()).toContainEqual({ num: 90005, str: '2', id: alice.key })

    // Menu access OWNER: refused without a message (the sit script's own touch handles that)
    f.sit(owner)
    f.sendLinked('[LS]root-security', 90100, '0|[SECURITY]|' + OWNER, OWNER)
    f.click(owner, 'Menu')
    f.click(owner, 'OWNER')
    const before = f.dialogsFor(alice).length
    f.sendLinked('[LS]root-security', 90006, '0', alice.key)
    expect(f.linked().filter((m) => m.num === 90005)).toHaveLength(1)
    expect(f.dialogsFor(alice)).toHaveLength(before)

    const ctl = await securityOnly(['[LS]root-control'])
    ctl.sendLinked('[LS]root-security', 90006, '0', alice.key)
    expect(ctl.linked().filter((m) => m.num === 90005 || m.num === 90007)).toEqual([])
  })

  it('[LS]commands checks (90013): "menu" opens the menu, other commands are allowed back (90016) or refused', async () => {
    const f = await securityOnly()
    const alice = f.avatar('Alice')
    f.sendLinked('[LS]root-security', 90013, 'menu', alice.key)
    expect(f.linked()).toContainEqual({ num: 90005, str: '0', id: alice.key })
    f.sendLinked('[LS]root-security', 90013, 'next', alice.key)
    expect(f.linked()).toContainEqual({ num: 90016, str: 'next', id: alice.key })

    f.sit(owner)
    f.sendLinked('[LS]root-security', 90100, '0|[SECURITY]|' + OWNER, OWNER)
    f.click(owner, 'Menu')
    f.click(owner, 'OWNER')
    f.sendLinked('[LS]root-security', 90013, 'menu', alice.key)
    expect(f.lastDialog(alice).message).toContain('Sorry, Menu access is set to: OWNER')
    f.sendLinked('[LS]root-security', 90013, 'prev', alice.key)
    expect(f.linked().some((m) => m.num === 90016 && m.str === 'prev')).toBe(false)
    expect(f.dialogsFor(alice)).toHaveLength(2)
  })
})

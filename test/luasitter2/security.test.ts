// LuaSitter2: [LS]root-security: who can sit and who can use the menu (ALL / OWNER),
// set by the owner from [ADJUST] > [SECURITY].
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS, OWNER } from '../helpers/furniture.js'
import type { Avatar } from '../helpers/furniture.js'

const CARD = `MTYPE 1
SITTER 0
POSE Sit1|anim1
{Sit1}<0,0.3,0.5><0,0,0>
SITTER 1
POSE Sit1|anim1
{Sit1}<0,-0.3,0.5><0,0,0>`

const owner: Avatar = { key: OWNER, name: 'Owner Resident' }

async function furniture() {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]sit', '[LS]sit 1', '[LS]root-security'],
    prims: 2,
    notecards: { LSpos: CARD },
    animations: ['anim1'],
  })
  f.start()
  return f
}

/** The owner sits, and sets "Sit" or "Menu" access to a value from the [SECURITY] menu. */
function setAccess(f: Awaited<ReturnType<typeof furniture>>, what: 'Sit' | 'Menu', value: string) {
  if (!f.seated.some((a) => a.key === OWNER)) f.sit(owner)
  f.touch(owner)
  f.click(owner, '[ADJUST]')
  f.click(owner, '[SECURITY]')
  f.click(owner, what)
  f.click(owner, value)
  expect(f.lastDialog(owner).message).toContain(`${what} access: ${value}`)
}

const unsat = (f: Awaited<ReturnType<typeof furniture>>) =>
  Object.values(f.scripts).flatMap((s) => s.callsOf('llUnSit').map((c) => String(c.args[0])))

describe('LuaSitter2 [LS]root-security', () => {
  it('by default anyone can sit and use the menu', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    expect(f.lastDialog(alice).buttons).toContain('Sit1')
    expect(unsat(f)).toHaveLength(0)
  })

  it('shows [SECURITY] in the adjust menu', async () => {
    const f = await furniture()
    f.sit(owner)
    f.touch(owner)
    f.click(owner, '[ADJUST]')
    expect(f.lastDialog(owner).buttons).toContain('[SECURITY]')
  })

  it('Sit access OWNER unseats other avatars', async () => {
    const f = await furniture()
    setAccess(f, 'Sit', 'OWNER')
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(unsat(f)).toContain(alice.key)
    expect(unsat(f)).not.toContain(OWNER)
    expect(f.lastDialog(alice).message).toContain('Sit access is set to: OWNER')
  })

  it('Sit access OWNER also unseats someone already sitting', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    f.sit(owner)
    f.sit(alice)
    setAccess(f, 'Sit', 'OWNER')
    expect(unsat(f)).toContain(alice.key)
  })

  it('Menu access OWNER refuses the menu to others', async () => {
    const f = await furniture()
    setAccess(f, 'Menu', 'OWNER')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    expect(f.lastDialog(alice).message).toContain('Menu access is set to: OWNER')
    expect(f.lastDialog(alice).buttons).toEqual(['OK'])
    f.touch(owner)
    expect(f.lastDialog(owner).buttons).toContain('Sit1')
  })

  it('only the owner can open [SECURITY]', async () => {
    const f = await furniture()
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.touch(alice)
    f.click(alice, '[ADJUST]')
    f.click(alice, '[SECURITY]') // shown to every sitter, as in AVsitter
    const security = f.script('[LS]root-security')
    expect(security.dialogs).toHaveLength(0)
    expect(security.chat.map((c) => c.text)).toContain('Sorry, only the owner can change security settings.')
    expect(f.lastDialog(alice).buttons).toContain('[SECURITY]') // back to the adjust menu
  })
})

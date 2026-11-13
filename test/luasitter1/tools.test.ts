// LuaSitter1 tools: LSadjuster with the LShelper object (helper mode, moving a pose,
// [SAVE], DUMP), LSsittarget-add (sit target in another prim), LSroot-security.
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS1_SCRIPTS, LS1, OWNER } from '../helpers/furniture.js'
import type { Avatar, Furniture } from '../helpers/furniture.js'

const owner: Avatar = { key: OWNER, name: 'Owner Resident' }
const sources = {
  ...LS1_SCRIPTS,
  'LShelper-script': LS1 + 'LShelper-script.luau',
  'LSsittarget-add': LS1 + 'LSsittarget-add.luau',
}
const CARD = 'SITTER 0\nPOSE Sit1|anim1\n{Sit1}<0,0,0.5><0,0,0>\nSITTER 1\nPOSE Sit1|anim1\n{Sit1}<1,0,0.5><0,0,0>'

describe('LuaSitter1 LSadjuster and LShelper', () => {
  async function workshop() {
    const f = await buildFurniture({
      sources,
      scripts: ['LSsit', 'LSsit 1', 'LSadjuster'],
      prims: 2,
      notecards: { LSpos: CARD },
      animations: ['anim1'],
      objects: { LShelper: ['LShelper-script'] },
    })
    f.start()
    f.settle(5_000)
    f.sit(owner)
    f.touch(owner)
    f.click(owner, '[ADJUST]')
    f.click(owner, '[HELPER]')
    f.settle(3_000)
    return f
  }

  const dump = (f: Furniture) => {
    f.touch(owner)
    f.click(owner, '[DUMP]')
    f.settle(10_000)
    return f.script('LSsit').chat.map((c) => c.text.replace(/^◆/, ''))
  }

  it('[HELPER] rezzes the helper and switches the menu to helper mode', async () => {
    const f = await workshop()
    expect(f.rezzed().map((l) => l.prims[0]!.name)).toEqual(['LShelper 0'])
    f.touch(owner)
    expect(f.lastDialog(owner).buttons).toEqual(expect.arrayContaining(['[DUMP]', '[SAVE]', '[NEW]']))
  })

  it('[DUMP] reads out the notecard', async () => {
    const out = dump(await workshop())
    expect(out).toContain('POSE Sit1|anim1')
    expect(out).toContain('{Sit1}<0.00000, 0.00000, 0.50000><0.00000, 0.00000, 0.00000>')
  })

  it('moving the helper and [SAVE] changes the position in the DUMP', async () => {
    const f = await workshop()
    const helper = f.rezzed()[0]!.prims[0]!
    const p = helper.params.position
    helper.params.position = { x: p.x, y: p.y, z: p.z + 0.2 }
    f.settle(3_000)
    f.touch(owner)
    f.click(owner, '[SAVE]')
    f.settle(3_000)
    expect(dump(f)).toContain('{Sit1}<0.00000, 0.00000, 0.70000><0.00000, 0.00000, 0.00000>')
  })
})

describe('LuaSitter1 LSsittarget-add', () => {
  it('gives its prim the sit target of the next sitter, near that sitter\'s first pose', async () => {
    const f = await buildFurniture({
      sources,
      scripts: ['LSsit', 'LSsit 1'],
      childScripts: { 3: ['LSsittarget-add'] },
      prims: 3,
      notecards: { LSpos: CARD },
      animations: ['anim1'],
    })
    f.start()
    f.settle(5_000)
    const target = f.prims[2]!.params.sitTarget
    expect(target.enabled).toBe(true) // a placeholder target until LSsit 1 announces its pose
    // LSsit 1 announces its first pose when it reads the notecard (here: after an edit)
    f.setNotecard('LSpos', CARD)
    f.settle(5_000)
    const offset = f.prims[2]!.params.sitTarget.offset
    expect(offset.x).toBeCloseTo(1, 3)
    expect(offset.z).toBeCloseTo(0.1, 3) // pose z 0.5, minus AVsitter1's 0.4 sit target offset
  })
})

describe('LuaSitter1 LSroot-security', () => {
  async function secured() {
    const f = await buildFurniture({
      sources,
      scripts: ['LSroot-security'],
      childScripts: { 2: ['LSsit', 'LSsit 1'] },
      contentsLink: 2,
      prims: 3,
      notecards: { LSpos: `MTYPE 1\nSITTER 0\nPOSE Sit1|anim1\nBUTTON [SECURITY]|1\n{Sit1}<0,0,0.5><0,0,0>\nSITTER 1\nPOSE Sit1|anim1\n{Sit1}<1,0,0.5><0,0,0>` },
      animations: ['anim1'],
    })
    f.start()
    f.settle(5_000)
    return f
  }
  const unsat = (f: Furniture) => f.script('LSroot-security').callsOf('llUnSit').map((c) => String(c.args[0]))

  it('the owner switches security to OWNER ONLY with the [SECURITY] button', async () => {
    const f = await secured()
    f.sit(owner, 2)
    f.touch(owner, 1)
    f.click(owner, '[SECURITY]')
    const ims = f.script('LSroot-security').callsOf('llInstantMessage').map((c) => String(c.args[1]))
    expect(ims).toContain('Security set to: OWNER ONLY')
  })

  it('with OWNER ONLY, another avatar is unseated 2 s after sitting', async () => {
    const f = await secured()
    f.sit(owner, 2)
    f.touch(owner, 1)
    f.click(owner, '[SECURITY]')
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(unsat(f)).toHaveLength(0)
    f.settle(3_000)
    expect(unsat(f)).toContain(alice.key)
    expect(unsat(f)).not.toContain(OWNER)
  })

  it('a refused avatar is unseated once, even when someone else sits meanwhile', async () => {
    const f = await secured()
    f.sit(owner, 2)
    f.touch(owner, 1)
    f.click(owner, '[SECURITY]')
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice) // refused: unseated in 2 s
    f.sit(bob) // another link change during the wait
    f.settle(8_000)
    expect(unsat(f).filter((k) => k === alice.key)).toHaveLength(1)
    expect(unsat(f).filter((k) => k === bob.key)).toHaveLength(1)
  })

  it('a refused avatar that stands up before its turn is not unseated', async () => {
    const f = await secured()
    f.sit(owner, 2)
    f.touch(owner, 1)
    f.click(owner, '[SECURITY]')
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.stand(alice)
    f.settle(3_000)
    expect(unsat(f)).not.toContain(alice.key)
  })

  it('a non-owner cannot change it', async () => {
    const f = await secured()
    const alice = f.avatar('Alice')
    f.sit(alice, 2)
    f.touch(alice, 1)
    f.click(alice, '[SECURITY]')
    const ims = f.script('LSroot-security').callsOf('llInstantMessage').map((c) => String(c.args[1]))
    expect(ims).toContain('Sorry, only the owner can change this.')
  })
})

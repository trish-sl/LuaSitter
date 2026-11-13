// LuaSitter2: [LS]adjuster and the [LS]helper object (with [LS]helperscript inside):
// helper mode, moving a pose with the helper, [SAVE], adding a pose with [NEW],
// the "delete before selling" reminder, and "/5 cleanup".
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS, OWNER } from '../helpers/furniture.js'
import type { Avatar } from '../helpers/furniture.js'

const owner: Avatar = { key: OWNER, name: 'Owner Resident' }

async function workshop() {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]sit', '[LS]adjuster'],
    notecards: { LSpos: 'SITTER 0\nPOSE Sit1|anim1\n{Sit1}<0,0,0.5><0,0,0>' },
    animations: ['anim1', 'anim2'],
    objects: { '[LS]helper': ['[LS]helperscript'] },
  })
  f.start()
  f.sit(owner)
  return f
}

/** Owner: [ADJUST] > [HELPER] rezzes the helper and switches to helper mode. */
function helperMode(f: Awaited<ReturnType<typeof workshop>>) {
  f.click(owner, '[ADJUST]')
  f.click(owner, '[HELPER]')
  f.settle(3_000)
}

const said = (f: Awaited<ReturnType<typeof workshop>>) => f.script('[LS]adjuster').chat.map((c) => c.text)

describe('LuaSitter2 [LS]adjuster', () => {
  it('[HELPER] rezzes a helper for the sitter and shows the helper-mode menu', async () => {
    const f = await workshop()
    helperMode(f)
    expect(f.rezzed().map((l) => l.prims[0]!.name)).toEqual(['[LS]helper 0'])
    expect(f.lastDialog(owner).buttons).toEqual(expect.arrayContaining(['[NEW]', '[DUMP]', '[SAVE]']))
  })

  it('moving the helper and [SAVE] stores the new position of the pose', async () => {
    const f = await workshop()
    helperMode(f)
    const helper = f.rezzed()[0]!.prims[0]!
    const p = helper.params.position
    helper.params.position = { x: p.x, y: p.y, z: p.z + 0.2 } // the owner moves the helper up 20 cm
    f.settle(3_000)
    f.click(owner, '[SAVE]')
    f.settle(2_000)
    expect(said(f).some((t) => t.includes('POSE Saved to memory') && t.includes('{Sit1}<0.00000, 0.00000, 0.70000>'))).toBe(true)
  })

  it('[NEW] > [POSE] adds a pose with the chosen animation and name', async () => {
    const f = await workshop()
    helperMode(f)
    f.click(owner, '[NEW]')
    expect(f.lastDialog(owner).message).toContain('Remember to delete [LS]adjuster')
    f.click(owner, '[POSE]')
    expect(f.lastDialog(owner).message).toContain('2.anim2')
    f.click(owner, '2')
    f.script('[LS]adjuster').answerDialog('Lean', { name: owner.name }) // the name text box
    f.settle(3_000)
    expect(said(f)).toContain("POSE Added: 'Lean' using anim 'anim2' to SITTER 0")
    expect(f.lastDialog(owner).buttons).toContain('Lean')
    expect(f.playing(owner)).toEqual(['anim2'])
  })

  it('[NEW] > [SYNC] offers [DONE] only once two animations are chosen (as upstream)', async () => {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]sit', '[LS]sit 1', '[LS]sit 2', '[LS]adjuster'],
      prims: 3,
      notecards: { LSpos: 'SITTER 0\nSYNC S|anim1\n{S}<0,0,0.5><0,0,0>\nSITTER 1\nSYNC S|anim1\n{S}<1,0,0.5><0,0,0>\nSITTER 2\nSYNC S|anim1\n{S}<2,0,0.5><0,0,0>' },
      animations: ['anim1', 'anim2'],
      objects: { '[LS]helper': ['[LS]helperscript'] },
    })
    f.start()
    f.sit(owner)
    helperMode(f)
    f.click(owner, '[NEW]')
    f.click(owner, '[SYNC]')
    expect(f.lastDialog(owner).buttons).not.toContain('[DONE]') // first sitter
    f.click(owner, '1')
    expect(f.lastDialog(owner).buttons).not.toContain('[DONE]') // second sitter
    f.click(owner, '2')
    expect(f.lastDialog(owner).buttons).toContain('[DONE]') // third sitter: may stop at two
  })

  it('reminds the owner to delete it when the object is rezzed', async () => {
    const f = await workshop()
    const adjuster = f.script('[LS]adjuster')
    adjuster.fire('on_rez', { start_param: 0 })
    f.settle()
    const texts = [...adjuster.chat.map((c) => c.text), ...f.printed('[LS]adjuster')].join('\n')
    expect(texts).toContain('/5 cleanup')
  })

  it('"/5 cleanup" removes the helper and the adjuster', async () => {
    const f = await workshop()
    helperMode(f)
    f.say(owner, 5, 'cleanup')
    f.settle(3_000)
    expect(f.rezzed()).toHaveLength(0)
    expect(f.script('[LS]adjuster').callsOf('llRemoveInventory').map((c) => String(c.args[0]))).toContain('[LS]adjuster')
  })
})

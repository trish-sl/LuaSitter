// LuaSitter2: more of [LS]adjuster: the DUMP header (every setting line), DUMP of
// SEQUENCE and BUTTON lines, the [NEW] menu ([SUBMENU], [PROP], [FACE], [CAMERA],
// paging the animation list, [SYNC] with [DONE]), ending helper mode, the chat
// commands "/5 targets" and "/5 helper", resetting on an inventory change, an
// extra copy, and the notice for a new owner.
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS, OWNER } from '../helpers/furniture.js'
import type { Furniture, Avatar } from '../helpers/furniture.js'

const owner: Avatar = { key: OWNER, name: 'Owner Resident' }
const ONE = 'SITTER 0\nPOSE Sit1|anim1\n{Sit1}<0,0,0.5><0,0,0>'

async function workshop(opts: { card?: string; scripts?: string[]; animations?: string[]; objects?: Record<string, string[]>; sitters?: number } = {}) {
  const sitters = opts.sitters ?? 1
  const sits = ['[LS]sit']
  for (let i = 1; i < sitters; i++) sits.push(`[LS]sit ${i}`)
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: [...sits, '[LS]adjuster', ...(opts.scripts ?? [])],
    prims: sitters,
    notecards: { LSpos: opts.card ?? ONE },
    animations: opts.animations ?? ['anim1', 'anim2'],
    objects: { '[LS]helper': ['[LS]helperscript'], ...(opts.objects ?? {}) },
  })
  f.start()
  f.sit(owner)
  return f
}

const adjuster = (f: Furniture) => f.script('[LS]adjuster')
const said = (f: Furniture) => adjuster(f).chat.map((c) => c.text)

/** Owner: [ADJUST] > [HELPER] (helper mode), then [NEW]. */
function newMenu(f: Furniture) {
  f.click(owner, '[ADJUST]')
  f.click(owner, '[HELPER]')
  f.settle(3_000)
  f.click(owner, '[NEW]')
}

/** Answer the adjuster's text box (or any dialog) with free text. */
function type(f: Furniture, text: string) {
  adjuster(f).answerDialog(text, { name: owner.name })
  f.settle(2_000)
}

/** Run DUMP and return the notecard lines between the markers, without "◆" and blank lines. */
function dump(f: Furniture, by = OWNER): string[] {
  const before = adjuster(f).chat.length
  f.broadcast(90100, '0|[DUMP]|', by)
  f.settle(30_000)
  const lines = adjuster(f).chat.slice(before).filter((c) => c.to === OWNER).map((c) => c.text.replace(/^◆/, ''))
  const start = lines.findIndex((l) => l.includes('COPY BELOW INTO'))
  const end = lines.findIndex((l) => l.includes('COPY ABOVE INTO'))
  return lines.slice(start + 1, end).filter((l) => l.trim() !== '')
}

describe('LuaSitter2 [LS]adjuster DUMP', () => {
  it('writes every setting line of the header, and they survive a round trip', async () => {
    const header = [
      'MTYPE 2',
      'ETYPE 0',
      'SET 1',
      'SWAP 0',
      'TEXT Hello\\nWorld',
      'ADJUST Lights|90500',
      'SELECT 1',
      'AMENU 1',
      'LROT 1',
      'DFLT 0',
      'WARN 0',
      'BRAND My Brand',
      'ROLES D|S',
    ]
    const card = `${header.join('\n')}\nSITTER 0|Lady\nPOSE Sit1|anim1\n{Sit1}<0,0,0.5><0,0,0>`
    const f = await workshop({ card })
    const lines = dump(f)
    for (const h of header) expect(lines).toContain(h)
    expect(lines).toContain('SITTER 0|Lady')
    expect(lines[0]).toMatch(/^"FURNITURE" LuaSitter /)
    // round trip: the dump read back gives the same dump
    const g = await workshop({ card: lines.slice(1).join('\n') })
    expect(dump(g).slice(1)).toEqual(lines.slice(1))
  })

  it('writes HELPER, KFM and ONSIT lines', async () => {
    const card = `HELPER 1\nKFM 1\nONSIT NONE\n${ONE}`
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]sit', '[LS]adjuster'],
      notecards: { LSpos: card },
      animations: ['anim1'],
    })
    f.start()
    const lines = dump(f)
    expect(lines).toEqual(expect.arrayContaining(['HELPER 1', 'KFM 1', 'ONSIT NONE']))
  })

  it('writes SEQUENCE lines and BUTTON lines with their message', async () => {
    const card = `SITTER 0\nPOSE Sit1|anim1\nSEQUENCE Scene\nBUTTON Light|5001|on\nBUTTON Ball\nTOMENU More\nMENU More\nPOSE Sit2|anim2\n{Sit1}<0,0,0.5><0,0,0>\n{Sit2}<0,0,0.5><0,0,0>`
    const f = await workshop({ card })
    const lines = dump(f)
    expect(lines).toEqual(expect.arrayContaining(['SEQUENCE Scene', 'BUTTON Light|5001|on', 'BUTTON Ball', 'TOMENU More', 'MENU More', 'POSE Sit2|anim2']))
  })

  it('a DUMP asked by someone else goes to the owner, and they are told so', async () => {
    const f = await workshop()
    const bob = f.avatar('Bob')
    const lines = dump(f, bob.key)
    expect(lines).toContain('POSE Sit1|anim1')
    expect(adjuster(f).chat.filter((c) => c.to === bob.key).map((c) => c.text)).toEqual(['Dumping settings to Owner'])
  })
})

describe('LuaSitter2 [LS]adjuster [NEW] menu', () => {
  it('[SUBMENU] adds a submenu with the typed name', async () => {
    const f = await workshop()
    newMenu(f)
    f.click(owner, '[SUBMENU]')
    expect(f.lastDialog(owner).message).toContain('Name your submenu:')
    type(f, 'Lying|down\nnow') // "|" and new lines are removed
    expect(said(f)).toContain("MENU Added: 'Lyingdownnow' for SITTER 0")
    expect(f.linked()).toContainEqual(expect.objectContaining({ num: 90300, str: '0', id: 'T:Lyingdownnow*||' }))
    expect(f.lastDialog(owner).buttons).toContain('Lyingdownnow*')
  })

  it('an empty name goes back to the menu without adding anything', async () => {
    const f = await workshop()
    newMenu(f)
    f.click(owner, '[SUBMENU]')
    type(f, '')
    expect(f.linked().filter((m) => m.num === 90300)).toHaveLength(0)
    expect(f.lastDialog(owner).script).toBe('[LS]sit')
  })

  it('[BACK] returns to the pose menu', async () => {
    const f = await workshop()
    newMenu(f)
    f.click(owner, '[BACK]')
    expect(f.lastDialog(owner).script).toBe('[LS]sit')
    expect(f.lastDialog(owner).buttons).toContain('Sit1')
  })

  it('[PROP] needs [LS]plugins', async () => {
    const f = await workshop()
    newMenu(f)
    f.click(owner, '[PROP]')
    expect(said(f)).toContain('For this you need the [LS]plugins plugin script.')
    expect(f.lastDialog(owner).script).toBe('[LS]sit')
  })

  it('[PROP] lists the objects (not the helper), and adds the chosen prop to the pose (90171)', async () => {
    const f = await workshop({ scripts: ['[LS]plugins'], objects: { ball: ['[LS]object'] } })
    newMenu(f)
    f.click(owner, '[PROP]')
    const d = f.lastDialog(owner)
    expect(d.message).toContain('Choose your prop:')
    expect(d.message).toContain('1.ball')
    expect(d.message).not.toContain('helper')
    f.click(owner, '1')
    expect(f.linked()).toContainEqual(expect.objectContaining({ num: 90171, str: '0', id: 'ball' }))
  })

  it('[PROP] refuses a prop that is not copy for the next owner', async () => {
    const f = await workshop({ scripts: ['[LS]plugins'], objects: { ball: ['[LS]object'] } })
    newMenu(f)
    f.click(owner, '[PROP]')
    adjuster(f).mock('llGetInventoryPermMask', () => 0x2000) // transfer only
    f.click(owner, '1')
    expect(said(f)).toContain("Could not add prop 'ball'. Props and their content must be COPY-OK for NEXT owner.")
    expect(f.linked().filter((m) => m.num === 90171)).toHaveLength(0)
  })

  it('[FACE] needs [LS]faces-camera; with it, lists the expressions and adds the chosen one (90172)', async () => {
    const without = await workshop()
    newMenu(without)
    without.click(owner, '[FACE]')
    expect(said(without)).toContain('For this you need the [LS]faces-camera plugin script.')

    const f = await workshop({ scripts: ['[LS]faces-camera'] })
    newMenu(f)
    f.click(owner, '[FACE]')
    const page1 = f.lastDialog(owner)
    expect(page1.message).toContain('Choose your facial anim:')
    expect(page1.message).toContain('(Page 1/3)')
    expect(page1.message).toContain('2.express_afraid_emote')
    f.click(owner, '[>>]')
    f.click(owner, '[>>]')
    expect(f.lastDialog(owner).message).toContain('(Page 3/3)')
    expect(f.lastDialog(owner).message).toContain('2.express_tongue_out')
    f.click(owner, '[>>]') // wraps to the first page
    expect(f.lastDialog(owner).message).toContain('(Page 1/3)')
    f.click(owner, '[<<]') // wraps to the last page
    expect(f.lastDialog(owner).message).toContain('(Page 3/3)')
    f.click(owner, '2')
    expect(f.linked()).toContainEqual(expect.objectContaining({ num: 90172, str: '0', id: 'express_tongue_out' }))
  })

  it('[POSE] pages a long list of animations', async () => {
    const animations = Array.from({ length: 12 }, (_, i) => `anim${i + 1}`)
    const f = await workshop({ animations })
    newMenu(f)
    f.click(owner, '[POSE]')
    expect(f.lastDialog(owner).message).toContain('(Page 1/2)')
    f.click(owner, '[>>]')
    const page2 = f.lastDialog(owner)
    expect(page2.message).toContain('(Page 2/2)')
    expect(page2.message).toMatch(/1\.anim\d+/)
    f.click(owner, '1')
    type(f, 'Late')
    expect(said(f).some((t) => t.startsWith("POSE Added: 'Late' using anim"))).toBe(true)
  })

  it('[POSE] says so when there are no animations', async () => {
    const f = await workshop({ animations: [] })
    newMenu(f)
    f.click(owner, '[POSE]')
    expect(f.lastDialog(owner).message).toContain('No items of required type in prim inventory.')
    expect(f.lastDialog(owner).buttons).toEqual(['[BACK]'])
  })

  it('[SYNC] with [DONE] after two sitters adds the pose to those two sitters', async () => {
    const card = 'SITTER 0\nSYNC S|anim1\n{S}<0,0,0.5><0,0,0>\nSITTER 1\nSYNC S|anim1\n{S}<1,0,0.5><0,0,0>\nSITTER 2\nSYNC S|anim1\n{S}<2,0,0.5><0,0,0>'
    const f = await workshop({ card, sitters: 3 })
    newMenu(f)
    f.click(owner, '[SYNC]')
    f.click(owner, '2') // anim2 for sitter 0
    f.click(owner, '1') // anim1 for sitter 1
    f.click(owner, '[DONE]')
    expect(f.lastDialog(owner).message).toContain('Type a menu name for SYNC\nSITTER 0: anim2\nSITTER 1: anim1')
    type(f, 'Duo')
    expect(said(f)).toEqual(expect.arrayContaining([
      "SYNC Added: 'Duo' using anim 'anim2' to SITTER 0",
      "SYNC Added: 'Duo' using anim 'anim1' to SITTER 1",
    ]))
    expect(said(f).some((t) => t.includes('to SITTER 2'))).toBe(false)
  })
})

describe('LuaSitter2 [LS]adjuster [CAMERA]', () => {
  const PERMISSION_TRACK_CAMERA = 0x400

  it('without [LS]faces-camera, [SAVE] stores the camera as a prim property (90011)', async () => {
    const f = await workshop()
    newMenu(f)
    f.click(owner, '[CAMERA]')
    expect(f.lastDialog(owner).message).toContain('(prim property)')
    const adj = adjuster(f)
    adj.setCamera({ pos: { x: 128, y: 126, z: 26 }, rot: { x: 0, y: 0, z: 0.7071068, s: 0.7071068 } })
    f.click(owner, '[SAVE]') // asks the sitter for camera tracking (granted, the sitter is seated)
    expect(adj.permissionRequests.at(-1)).toMatchObject({ agent: owner.key, permissions: PERMISSION_TRACK_CAMERA })
    const m = f.linked().find((l) => l.num === 90011)!
    expect(m.str).toBe('<0.00000, -2.00000, 1.00000>') // eye, relative to the furniture
    expect(m.id).toBe('<0.00000, -1.00000, 1.00000>') // looking along +Y
    expect(said(f)).toContain('Camera property saved for all sitters in prim (takes effect next sit).')
    expect(f.lastDialog(owner).message).toContain('Camera:')
  })

  it('with [LS]faces-camera, [SAVE] sends the camera of the sitter to it (90174)', async () => {
    const f = await workshop({ scripts: ['[LS]faces-camera'] })
    newMenu(f)
    f.click(owner, '[CAMERA]')
    expect(f.lastDialog(owner).message).toContain('(using [LS]faces-camera scripts)')
    const adj = adjuster(f)
    adj.setCamera({ pos: { x: 128, y: 126, z: 26 }, rot: { x: 0, y: 0, z: 0, s: 1 } })
    f.click(owner, '[SAVE]')
    expect(f.linked()).toContainEqual(expect.objectContaining({ num: 90174, str: '0', id: '<0.00000, -2.00000, 1.00000>|<1.00000, -2.00000, 1.00000>' }))
  })

  it('[CLEAR] clears the camera of every prim, or asks [LS]faces-camera to (90174 "none")', async () => {
    const f = await workshop()
    newMenu(f)
    f.click(owner, '[CAMERA]')
    f.click(owner, '[CLEAR]')
    expect(adjuster(f).callsOf('llSetLinkCamera').length).toBeGreaterThanOrEqual(2)
    expect(said(f)).toContain('Camera property cleared from all prims (takes effect next sit).')

    const g = await workshop({ scripts: ['[LS]faces-camera'] })
    newMenu(g)
    g.click(owner, '[CAMERA]')
    g.click(owner, '[CLEAR]')
    expect(g.linked()).toContainEqual(expect.objectContaining({ num: 90174, str: '0', id: 'none' }))
  })
})

describe('LuaSitter2 [LS]adjuster helper mode and commands', () => {
  it('[HELPER] again ends helper mode and removes the helpers', async () => {
    const f = await workshop()
    f.click(owner, '[ADJUST]')
    f.click(owner, '[HELPER]')
    f.settle(3_000)
    expect(f.rezzed()).toHaveLength(1)
    f.broadcast(90100, `0|[HELPER]|${owner.key}|0`, owner.key)
    f.settle(2_000)
    expect(f.rezzed()).toHaveLength(0)
  })

  it('[ADJUST] ends helper mode', async () => {
    const f = await workshop()
    f.click(owner, '[ADJUST]')
    f.click(owner, '[HELPER]')
    f.settle(3_000)
    f.broadcast(90100, `0|[ADJUST]|${owner.key}`, owner.key)
    f.settle(2_000)
    expect(f.rezzed()).toHaveLength(0)
  })

  it('the sitter standing up ends helper mode', async () => {
    const f = await workshop()
    f.click(owner, '[ADJUST]')
    f.click(owner, '[HELPER]')
    f.settle(3_000)
    f.stand(owner)
    adjuster(f).fire('changed', { changes: 0x20 }) // CHANGED_LINK
    f.settle(2_000)
    expect(f.rezzed()).toHaveLength(0)
  })

  it('choosing a pose in helper mode moves the helper to it', async () => {
    const card = 'SITTER 0\nPOSE Sit1|anim1\nPOSE Sit2|anim2\n{Sit1}<0,0,0.5><0,0,0>\n{Sit2}<0,1,0.5><0,0,0>'
    const f = await workshop({ card })
    f.click(owner, '[ADJUST]')
    f.click(owner, '[HELPER]')
    f.settle(3_000)
    f.click(owner, 'Sit2')
    f.settle(2_000)
    const p = f.rezzed()[0]!.prims[0]!.params.position
    expect([p.x, p.y, p.z].map((v) => Math.round(v * 100) / 100)).toEqual([128, 129, 25.5])
  })

  it('"/5 helper" starts helper mode for the owner while seated; "/5 targets" asks for the sit targets (90298)', async () => {
    const f = await workshop()
    f.say(owner, 5, 'helper')
    f.settle(3_000)
    expect(f.rezzed()).toHaveLength(1)
    f.say(owner, 5, 'targets')
    expect(f.linked()).toContainEqual(expect.objectContaining({ num: 90298 }))
  })

  it('an inventory change ends helper mode and resets the adjuster', async () => {
    const f = await workshop()
    f.click(owner, '[ADJUST]')
    f.click(owner, '[HELPER]')
    f.settle(3_000)
    const notices = () => f.printed('[LS]adjuster').filter((t) => t.startsWith('NOTICE')).length
    expect(notices()).toBe(1)
    f.setItem('anim3', 'animation')
    f.settle(2_000)
    expect(f.rezzed()).toHaveLength(0)
    expect(notices()).toBe(2) // started again
  })

  it('with the old helper method (HELPER 1), swapping sitters (90030) swaps the helpers too', async () => {
    const card = 'HELPER 1\nSITTER 0\nSYNC S|anim1\n{S}<0,0,0.5><0,0,0>\nSITTER 1\nSYNC S|anim1\n{S}<1,0,0.5><0,0,0>'
    const f = await workshop({ card, sitters: 2 })
    f.click(owner, '[ADJUST]')
    f.click(owner, '[HELPER]')
    f.settle(3_000)
    expect(adjuster(f).callsOf('llUnSit').map((c) => String(c.args[0]))).toContain(owner.key) // the old method unseats
    const byName = (n: string) => f.rezzed().find((h) => h.prims[0]!.name === n)!
    const h0 = byName('[LS]helper 0')
    const h1 = byName('[LS]helper 1')
    f.broadcast(90030, '0', '1')
    f.settle(2_000)
    expect(said(f)).toContain('SWAP|0|1')
    expect(h0.prims[0]!.name).toBe('[LS]helper 1')
    expect(h1.prims[0]!.name).toBe('[LS]helper 0')
  })
})

describe('LuaSitter2 [LS]adjuster chooser', () => {
  // FIX (also upstream): long names could make the chooser text 512 bytes or more, and
  // llDialog then showed nothing. Cyrillic letters take 2 bytes each.
  it('[NEW] > [POSE] lists 9 long Unicode animation names within the 512-byte dialog limit', async () => {
    // rezless keeps only ASCII in inventory names, so the adjuster is told Unicode names
    const names = Array.from({ length: 9 }, (_, i) => `поза ${i + 1} ${'ж'.repeat(45)}`)
    const f = await workshop({ animations: Array.from({ length: 9 }, (_, i) => `pose ${i + 1}`) })
    adjuster(f).mock('llGetInventoryName', (_ctx, args) => // mocks get the 0-based LSL index
      Number(args[0]) === 20 ? names[Number(args[1])] ?? '' : '') // INVENTORY_ANIMATION
    f.click(owner, '[ADJUST]')
    f.click(owner, '[HELPER]')
    f.settle(3_000)
    f.click(owner, '[NEW]')
    f.click(owner, '[POSE]')
    const d = f.lastDialog(owner)
    expect(new TextEncoder().encode(d.message).length).toBeLessThan(512)
    const lines = d.message.split('\n').filter((l) => /^\d\./.test(l))
    expect(lines).toHaveLength(9)
    expect(lines[0]).toMatch(/^1\.поза 1 ж+\.\.$/)
  })
})

describe('LuaSitter2 [LS]adjuster start', () => {
  it('an extra copy ("[LS]adjuster 1") removes itself', async () => {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]sit', '[LS]adjuster', '[LS]adjuster 1'],
      notecards: { LSpos: ONE },
      animations: ['anim1'],
    })
    f.start()
    expect(f.script('[LS]adjuster 1').callsOf('llRemoveInventory').map((c) => String(c.args[0]))).toEqual(['[LS]adjuster 1'])
    expect(f.lastDialog(owner).message).toContain('Use only one of this script!')
  })

  it('tells a customer they may keep and use the setup tool, and keeps working for them', async () => {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]sit', '[LS]adjuster'],
      notecards: { LSpos: ONE },
      animations: ['anim1'],
    })
    adjuster(f).mock('llGetCreator', () => '00000000-0000-0000-0000-00000000c0de')
    f.start()
    const told = f.printed('[LS]adjuster').join('\n')
    expect(told).toContain('You can use it to adjust, add and save poses.')
    expect(told).not.toContain('normally removes')
    expect(adjuster(f).callsOf('llRemoveInventory')).toHaveLength(0) // stays in the furniture
  })

  it('reminds the creator on start that customers can edit poses with it', async () => {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]sit', '[LS]adjuster'],
      notecards: { LSpos: ONE },
      animations: ['anim1'],
    })
    adjuster(f).mock('llGetCreator', () => owner.key)
    f.start()
    expect(f.printed('[LS]adjuster').join('\n')).toContain('If your customers should not edit poses, delete it')
  })
})

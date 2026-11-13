// LuaSitter2: menus that list one button per sitter are paged, so furniture is
// not limited to 11 sitters ([LS]select seat menu, [LS]root-control "Which avatar?").
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS } from '../helpers/furniture.js'
import type { Avatar, Furniture } from '../helpers/furniture.js'

function seatsCard(n: number): string {
  const lines: string[] = []
  for (let i = 0; i < n; i++) {
    lines.push(`SITTER ${i}|Seat${i}`, `POSE Sit|anim1`, `{Sit}<0,0,0.5><0,0,0>`)
  }
  return lines.join('\n')
}

/** [LS]select with n seats; the extra "[LS]sit N" copies are placeholders. */
async function selectFurniture(n: number): Promise<{ f: Furniture; avatars: Avatar[] }> {
  const placeholders = ['[LS]sit']
  for (let i = 1; i < n; i++) placeholders.push(`[LS]sit ${i}`)
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]select'],
    placeholders,
    notecards: { LSpos: seatsCard(n) },
    animations: ['anim1'],
  })
  f.start()
  const avatars: Avatar[] = []
  for (let i = 0; i < n; i++) {
    const av = f.avatar(`Sitter${i}`)
    avatars.push(av)
    f.sendLinked('[LS]select', 90070, String(i), av.key) // sitter i is seated
  }
  return { f, avatars }
}

describe('LuaSitter2 [LS]select seat menu', () => {
  it('is unchanged with up to 11 seats', async () => {
    const { f, avatars } = await selectFurniture(4)
    f.sendLinked('[LS]select', 90009, '', avatars[0]!.key)
    const d = f.lastDialog(avatars[0]!)
    expect(d.buttons).not.toContain('[>>]')
    expect(d.buttons).toContain('[ADJUST]')
    expect(d.buttons.filter((b) => b.startsWith('Seat') || b.startsWith('⊘'))).toHaveLength(4)
  })

  it('is paged with [<<] / [>>] for 15 seats, and every seat is reachable', async () => {
    const { f, avatars } = await selectFurniture(15)
    const me = avatars[0]!
    f.sendLinked('[LS]select', 90009, '', me.key)
    const page1 = f.lastDialog(me).buttons
    expect(page1).toHaveLength(12)
    expect(page1).toContain('[<<]')
    expect(page1).toContain('[>>]')
    expect(page1).toContain('[ADJUST]')
    f.click(me, '[>>]')
    const page2 = f.lastDialog(me).buttons
    expect(page2).toContain('[ADJUST]')
    // seats are named Seat0..Seat14; my own seat is shown by name, others by sitter name (⊘...)
    const seen = new Set([...page1, ...page2].filter((b) => b !== ' ' && !b.startsWith('[')))
    expect(seen.size).toBe(15)
    f.click(me, '[>>]')
    expect(f.lastDialog(me).buttons).toEqual(page1) // pages wrap around
    f.click(me, '[<<]')
    expect(f.lastDialog(me).buttons).toEqual(page2)
  })

  it('swaps to a free seat on the second page', async () => {
    const { f, avatars } = await selectFurniture(15)
    const me = avatars[0]!
    f.sendLinked('[LS]select', 90065, '14', avatars[14]!.key) // sitter 14 stood up: Seat14 is free
    f.sendLinked('[LS]select', 90009, '', me.key)
    f.click(me, '[>>]')
    f.click(me, 'Seat14')
    const swap = f.linked().find((m) => m.num === 90030)
    expect(swap).toEqual({ num: 90030, str: '0', id: '14' })
  })
})

describe('LuaSitter2 with 13 sitters (end to end)', () => {
  it('seats and animates 13 sitters, and the seat menu is paged', async () => {
    const n = 13
    const scripts = ['[LS]sit', '[LS]select']
    for (let i = 1; i < n; i++) scripts.push(`[LS]sit ${i}`)
    const anims: string[] = []
    const lines: string[] = []
    for (let i = 0; i < n; i++) {
      anims.push(`pose${i}`)
      lines.push(`SITTER ${i}|Seat${i}`, `POSE Sit|pose${i}`, `{Sit}<0,0,0.5><0,0,0>`)
    }
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts,
      prims: n,
      notecards: { LSpos: lines.join('\n') },
      animations: anims,
    })
    f.start()
    const avatars: Avatar[] = []
    for (let i = 0; i < n; i++) {
      const av = f.avatar(`Guest${i}`)
      avatars.push(av)
      f.sit(av)
    }
    const played = avatars.map((av) => f.playing(av)).flat().sort()
    expect(played).toEqual([...anims].sort())
    const last = avatars[n - 1]!
    f.broadcast(90009, '', last.key)
    const menu = f.lastDialog(last)
    expect(menu.script).toBe('[LS]select')
    expect(menu.buttons).toContain('[>>]')
  })
})

describe('LuaSitter2 [LS]root-control "Which avatar?" menu', () => {
  it('is paged when more than 12 avatars sit', async () => {
    const n = 14
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]root-control'],
      notecards: { LSpos: seatsCard(1) },
      prims: n,
    })
    f.start()
    const sitters: Avatar[] = []
    for (let i = 0; i < n; i++) {
      const av = f.avatar(`Guest${i}`)
      sitters.push(av)
      f.sit(av, i + 1)
    }
    const controller = f.avatar('Controller')
    f.sendLinked('[LS]root-control', 90007, '', controller.key)
    const page1 = f.lastDialog(controller).buttons
    expect(page1).toHaveLength(12)
    expect(page1).toContain('[>>]')
    f.click(controller, '[>>]')
    const page2 = f.lastDialog(controller).buttons
    const names = new Set([...page1, ...page2].filter((b) => b.startsWith('Guest')))
    expect(names.size).toBe(n)
    // picking a name on page 2 opens that sitter's menu for the controller
    const pick = page2.find((b) => b.startsWith('Guest'))!
    f.click(controller, pick)
    const target = sitters.find((s) => s.name.startsWith(pick))!
    expect(f.linked().some((m) => m.num === 90005 && m.id === `${controller.key}|${target.key}`)).toBe(true)
  })
})

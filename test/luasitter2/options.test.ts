// LuaSitter2: the [LS]options plugin: textures, colours, alpha, glow, fullbright,
// lights and sounds of named prims, applied by link message 90250 (LSpos BUTTON
// lines), by pose (90045, with * and per-sitter lines), by BUTTON link numbers,
// by TOGGLE, and when the furniture is empty; notecard problems with line numbers,
// reloading, the NAK fallback, and Unicode names.
import { describe, it, expect } from 'vitest'
import { makeInventoryItem, InventoryType } from '@rezless/vitest'
import { buildFurniture, LS2_SCRIPTS } from '../helpers/furniture.js'
import type { Furniture } from '../helpers/furniture.js'

const NAK = '\n\x15\n'
const CARD = '[LS]options_settings'
const SOUND_UUID = '44444444-0000-0000-0000-000000000001'
const TEX_UUID = '55555555-0000-0000-0000-000000000001'

const LSPOS = `SITTER 0
POSE Sit|anim1
POSE Kneel|anim2
BUTTON Lamp on|90250
BUTTON Light|97
BUTTON Sheets red|90250|Red sheets
{Sit}<0,0,0.5><0,0,0>
{Kneel}<0,0,0.5><0,0,0>
SITTER 1
POSE Sit|anim1
POSE Kneel|anim2
{Sit}<0,0,0.5><0,0,0>
{Kneel}<0,0,0.5><0,0,0>`

const BASIC = `# lamp
OPTION Lamp on|lamp|light 1 0.8 0.6 1 10 0.75|glow 0.2|fullbright on
OPTION Lamp off|lamp|light off|glow 0|fullbright off
TOGGLE Lamp|Lamp on|Lamp off
// sheets
OPTION Red sheets|sheet:2|texture Silk|color 1 0 0|alpha 0.5
OPTION Music|*|sound Rain 0.8 loop
OPTION Quiet|*|sound stop`

interface Opts {
  nak?: boolean
  noCard?: boolean
  items?: { name: string; type: 'texture' | 'sound' }[]
}

/** Furniture: root "Furniture" with [LS]sit x2 and [LS]options, a "lamp" prim and two "sheet" prims. */
async function furniture(card: string | null, opts: Opts = {}): Promise<Furniture> {
  const notecards: Record<string, string> = { LSpos: LSPOS }
  if (card !== null) notecards[CARD] = card
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]sit', '[LS]sit 1', '[LS]options'],
    prims: 4,
    primNames: { 2: 'lamp', 3: 'sheet', 4: 'sheet' },
    notecards,
    animations: ['anim1', 'anim2'],
  })
  const items = opts.items ?? [{ name: 'Silk', type: 'texture' }, { name: 'Rain', type: 'sound' }]
  items.forEach((it, i) => addItem(f, it.name, it.type, i))
  if (opts.nak) f.script('[LS]options').mock('llGetNotecardLineSync', () => NAK)
  f.start()
  return f
}

function addItem(f: Furniture, name: string, type: 'texture' | 'sound', i: number) {
  f.prims[0]!.addInventory(makeInventoryItem({
    name,
    type: type === 'texture' ? InventoryType.TEXTURE : InventoryType.SOUND,
    key: `66666666-0000-0000-0000-${(i + 1).toString(16).padStart(12, '0')}`,
    creator: '00000000-0000-0000-0000-0000000000a1',
  }))
}

const prim = (f: Furniture, link: number) => f.prims[link - 1]!.params
const face = (f: Furniture, link: number, n: number) => prim(f, link).faces[n]!
const light = (f: Furniture) => prim(f, 2).pointLight
const sound = (f: Furniture, link = 1) => f.prims[link - 1]!.sound.current
const apply = (f: Furniture, name: string) => f.broadcast(90250, name, '')
const printed = (f: Furniture) => f.printed('[LS]options')

describe('LuaSitter2 [LS]options: settings', () => {
  it('light, glow and fullbright on every face of the named prim; off again', async () => {
    const f = await furniture(BASIC)
    expect(printed(f)).toEqual([])
    apply(f, 'Lamp on')
    expect(light(f).enabled).toBe(true)
    expect(light(f).color.x).toBeCloseTo(1)
    expect(light(f).color.y).toBeCloseTo(0.8)
    expect(light(f).color.z).toBeCloseTo(0.6)
    expect(light(f).intensity).toBeCloseTo(1)
    expect(light(f).radius).toBeCloseTo(10)
    expect(light(f).falloff).toBeCloseTo(0.75)
    for (const fc of prim(f, 2).faces) {
      expect(fc.glow).toBeCloseTo(0.2)
      expect(fc.fullBright).toBe(true)
    }
    expect(face(f, 3, 0).glow).toBe(0) // other prims untouched
    apply(f, 'Lamp off')
    expect(light(f).enabled).toBe(false)
    for (const fc of prim(f, 2).faces) {
      expect(fc.glow).toBe(0)
      expect(fc.fullBright).toBe(false)
    }
  })

  it('texture, color and alpha on one face of every prim with that name, keeping the texture repeats', async () => {
    const f = await furniture(BASIC)
    face(f, 3, 2).textureRepeats = { x: 2, y: 3, z: 0 }
    face(f, 3, 2).textureOffsets = { x: 0.25, y: 0, z: 0 }
    face(f, 3, 2).textureRotation = 1.5
    const silk = f.prims[0]!.inventory.find((i) => i.name === 'Silk')!.key
    apply(f, 'Red sheets')
    for (const link of [3, 4]) {
      expect(face(f, link, 2).texture).toBe(silk)
      expect(face(f, link, 2).color).toEqual({ x: 1, y: 0, z: 0 })
      expect(face(f, link, 2).alpha).toBeCloseTo(0.5)
      expect(face(f, link, 1).texture).not.toBe(silk)
      expect(face(f, link, 1).alpha).toBe(1)
    }
    expect(face(f, 3, 2).textureRepeats).toEqual({ x: 2, y: 3, z: 0 })
    expect(face(f, 3, 2).textureOffsets).toEqual({ x: 0.25, y: 0, z: 0 })
    expect(face(f, 3, 2).textureRotation).toBeCloseTo(1.5)
    expect(face(f, 2, 2).texture).not.toBe(silk)
  })

  it('color alone keeps the alpha, alpha alone keeps the color; 0-255 colours, <r,g,b>, several faces, root', async () => {
    const f = await furniture(`OPTION Blue|lamp:0,1|color 0 0 255
OPTION Ghost|lamp:1|alpha 0.25
OPTION Green|root|color <0, 1, 0>`)
    face(f, 2, 0).alpha = 0.3
    apply(f, 'Blue')
    expect(face(f, 2, 0).color).toEqual({ x: 0, y: 0, z: 1 })
    expect(face(f, 2, 0).alpha).toBeCloseTo(0.3)
    expect(face(f, 2, 1).color).toEqual({ x: 0, y: 0, z: 1 })
    expect(face(f, 2, 2).color).toEqual({ x: 1, y: 1, z: 1 })
    apply(f, 'Ghost')
    expect(face(f, 2, 1).alpha).toBeCloseTo(0.25)
    expect(face(f, 2, 1).color).toEqual({ x: 0, y: 0, z: 1 })
    apply(f, 'Green')
    expect(face(f, 1, 3).color).toEqual({ x: 0, y: 1, z: 0 })
  })

  it('a texture or sound by UUID, light on with the default white light', async () => {
    const f = await furniture(`OPTION Wood|sheet:0|texture ${TEX_UUID}
OPTION Bell|lamp|sound ${SOUND_UUID}
OPTION Bright|lamp|light on`)
    apply(f, 'Wood')
    expect(face(f, 3, 0).texture).toBe(TEX_UUID)
    apply(f, 'Bell')
    expect(sound(f, 2)).toMatchObject({ sound: SOUND_UUID, volume: 1, loop: false })
    apply(f, 'Bright')
    expect(light(f)).toMatchObject({ enabled: true, color: { x: 1, y: 1, z: 1 }, radius: 10 })
  })

  it('sounds: looped with a volume in this prim (*), stopped, played once in another prim', async () => {
    const f = await furniture(`${BASIC}
OPTION Ding|lamp|sound Rain`)
    const rain = f.prims[0]!.inventory.find((i) => i.name === 'Rain')!.key
    apply(f, 'Music')
    expect(sound(f)).toMatchObject({ sound: rain, loop: true })
    expect(sound(f)!.volume).toBeCloseTo(0.8)
    apply(f, 'Quiet')
    expect(sound(f)).toBeNull()
    apply(f, 'Ding')
    expect(sound(f, 2)).toMatchObject({ sound: rain, volume: 1, loop: false })
  })

  it('a sound named with spaces and a number is found by its full name first', async () => {
    const f = await furniture('OPTION Track|*|sound Track 2 0.5 loop\nOPTION Plain|*|sound Track 2',
      { items: [{ name: 'Track 2', type: 'sound' }] })
    expect(printed(f)).toEqual([])
    apply(f, 'Track')
    expect(sound(f)).toMatchObject({ loop: true, volume: 0.5 })
    apply(f, 'Plain')
    expect(sound(f)).toMatchObject({ loop: false, volume: 1 })
  })

  it('several OPTION lines with the same name add up; unknown names do nothing', async () => {
    const f = await furniture(`OPTION Night|lamp|glow 0.1
OPTION Night|sheet|color 0 0 0.5`)
    apply(f, 'Nothing here')
    expect(face(f, 2, 0).glow).toBe(0)
    apply(f, 'Night')
    expect(face(f, 2, 0).glow).toBeCloseTo(0.1)
    expect(face(f, 4, 5).color.z).toBeCloseTo(0.5)
  })
})

describe('LuaSitter2 [LS]options: triggers', () => {
  it('LSpos BUTTON lines with 90250 apply the option of the button name or message', async () => {
    const f = await furniture(BASIC)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Lamp on')
    expect(light(f).enabled).toBe(true)
    f.touch(alice) // a BUTTON doesn't give the menu back
    f.click(alice, 'Sheets red')
    expect(face(f, 3, 2).color).toEqual({ x: 1, y: 0, z: 0 })
  })

  it('BUTTON <number> lines: an LSpos BUTTON with that number toggles; a message filter', async () => {
    const f = await furniture(`${BASIC}
BUTTON 97|Lamp
BUTTON 98|Lamp off|off`)
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Light')
    expect(light(f).enabled).toBe(true)
    f.touch(alice) // a BUTTON doesn't give the menu back
    f.click(alice, 'Light')
    expect(light(f).enabled).toBe(false)
    f.touch(alice)
    f.click(alice, 'Light')
    expect(light(f).enabled).toBe(true)
    f.broadcast(98, 'something', '')
    expect(light(f).enabled).toBe(true)
    f.broadcast(98, 'off', '')
    expect(light(f).enabled).toBe(false)
  })

  it('TOGGLE by 90250 goes on from the option applied last', async () => {
    const f = await furniture(BASIC)
    apply(f, 'Lamp')
    expect(light(f).enabled).toBe(true)
    apply(f, 'Lamp')
    expect(light(f).enabled).toBe(false)
    apply(f, 'Lamp on')
    apply(f, 'Lamp') // the next after "Lamp on"
    expect(light(f).enabled).toBe(false)
  })

  it('POSE lines: a pose played from the menu, * for any pose, the most specific line wins', async () => {
    const f = await furniture(`${BASIC}
POSE *|Lamp on
POSE Kneel|Lamp off
POSE Kneel|Red sheets|1`)
    const alice = f.avatar('Alice')
    f.sit(alice)
    expect(light(f).enabled).toBe(true) // Sit: POSE *
    f.click(alice, 'Kneel')
    f.settle(1_000)
    expect(light(f).enabled).toBe(false)
    expect(face(f, 3, 2).color).toEqual({ x: 1, y: 1, z: 1 })
    // sitter 1 in Kneel: its own line, not "Kneel" for any sitter
    apply(f, 'Lamp on')
    f.broadcast(90045, '1|Kneel|anim2|0||', '')
    expect(face(f, 3, 2).color).toEqual({ x: 1, y: 0, z: 0 })
    expect(light(f).enabled).toBe(true)
  })

  it('POSE *|<sitter> wins over POSE *', async () => {
    const f = await furniture(`${BASIC}
POSE *|Lamp on
POSE *|Lamp off|0`)
    f.broadcast(90045, '1|Sit|anim1|0||', '')
    expect(light(f).enabled).toBe(true)
    f.broadcast(90045, '0|Sit|anim1|0||', '')
    expect(light(f).enabled).toBe(false)
  })

  it('a pose line does not restart the loop it already plays (one 90045 per sitter of a SYNC)', async () => {
    const f = await furniture(`${BASIC}
POSE *|Music`)
    const before = f.script('[LS]options').callsOf('llLinkPlaySound').length
    f.broadcast(90045, '0|Sync|a|0||0|1', '')
    f.broadcast(90045, '1|Sync|a|0||0|1', '')
    expect(f.script('[LS]options').callsOf('llLinkPlaySound').length).toBe(before + 1)
    apply(f, 'Music') // a button does restart it
    expect(f.script('[LS]options').callsOf('llLinkPlaySound').length).toBe(before + 2)
  })

  it('EMPTY lines apply when the last sitter stands up', async () => {
    const f = await furniture(`${BASIC}
EMPTY Lamp off
EMPTY Quiet`)
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    apply(f, 'Lamp on')
    apply(f, 'Music')
    f.stand(alice)
    expect(light(f).enabled).toBe(true)
    f.stand(bob)
    expect(light(f).enabled).toBe(false)
    expect(sound(f)).toBeNull()
  })

  it('Unicode option and pose names (the pose name cut to 23 characters, as [LS]sit does)', async () => {
    const pose = 'Câlin très très long ☀☀☀ nom'
    const cut = [...pose].slice(0, 23).join('')
    const f = await furniture(`OPTION Lampe allumée ☀|lamp|glow 0.5
OPTION Nuit 🌙|lamp|glow 0.1
POSE ${pose}|Nuit 🌙`)
    expect(printed(f)).toEqual([])
    apply(f, 'Lampe allumée ☀')
    expect(face(f, 2, 0).glow).toBeCloseTo(0.5)
    f.broadcast(90045, `0|${cut}|a|0||`, '')
    expect(face(f, 2, 0).glow).toBeCloseTo(0.1)
  })
})

describe('LuaSitter2 [LS]options: notecard', () => {
  it('says each problem to the owner with its line number, once', async () => {
    const f = await furniture(`OPTION Lamp on|lamp|light 1 1 1
OPTION Bad|lamp|sparkle 5
OPTION Gone|chair|glow 1
OPTION Tex|lamp|texture Missing
OPTION Snd|lamp|sound Nope loop
OPTION NoTarget
OPTION Face|lamp:9|glow 1
POSE Kneel|Lamp offf
BUTTON 97|Nothing
BUTTON abc|Lamp on
TOGGLE Lamp|Lamp on|Lamp out
POSE Sit|Lamp
hello there
OPTION Empty|lamp
OPTION Col|lamp|color 1 2
OPTION Fb|lamp|fullbright maybe
POSE Sit|Lamp on|x
BUTTON 90250|Lamp on
EMPTY`)
    const out = printed(f)
    expect(out[0]).toBe('[LS]options: 18 problem(s) in the notecard "[LS]options_settings":')
    expect(out.slice(1)).toEqual([
      'line 2: unknown setting "sparkle 5" (texture, color, alpha, glow, fullbright, light, sound).',
      'line 3: no prim named "chair".',
      'line 4: texture "Missing" is not in the prim\'s contents (or not a UUID).',
      'line 5: sound "Nope" is not in the prim\'s contents (or not a UUID).',
      'line 6: OPTION NoTarget: no target prim (a prim name, * or root).',
      'line 7: face 9 (faces are 0 to 7).',
      'line 10: BUTTON needs a link message number: BUTTON <number>|<option>[|<message>].',
      'line 13: unknown line "hello there" (OPTION, TOGGLE, POSE, BUTTON, EMPTY; # for comments).',
      'line 14: OPTION Empty: no settings.',
      'line 15: color needs three numbers, for example color 1 0.5 0.',
      'line 16: fullbright needs on or off.',
      'line 17: sitter "x" is not a SITTER number.',
      'line 18: BUTTON 90250 is not needed: 90250 applies the option named in its message.',
      'line 19: no option name.',
      'line 8: no OPTION named "Lamp offf".',
      'line 9: no OPTION named "Nothing".',
      'line 11: no OPTION named "Lamp out".',
      'line 12: "Lamp" is a TOGGLE; only BUTTON lines and 90250 can use it.',
    ])
    // the good line still works
    apply(f, 'Lamp on')
    expect(light(f).enabled).toBe(true)
  })

  it('lists at most 20 problems', async () => {
    const lines = Array.from({ length: 25 }, (_, i) => `OPTION X${i}|nowhere|glow 1`).join('\n')
    const f = await furniture(lines)
    const out = printed(f)
    expect(out[0]).toContain('25 problem(s)')
    expect(out).toHaveLength(22)
    expect(out.at(-1)).toBe('... and 5 more.')
  })

  it('without the notecard it says so and does nothing', async () => {
    const f = await furniture(null)
    expect(printed(f)).toEqual(['[LS]options: no "[LS]options_settings" notecard in this prim, nothing to do.'])
    apply(f, 'Lamp on')
    expect(light(f).enabled).toBe(false)
  })

  it('falls back to the dataserver reader when the fast reader answers NAK', async () => {
    const f = await furniture(BASIC + '\nBUTTON 97|Lamp', { nak: true })
    expect(printed(f)).toEqual([])
    f.broadcast(97, 'Light', '')
    expect(light(f).enabled).toBe(true)
  })

  it('reloads when the notecard is edited, not on other inventory changes', async () => {
    const f = await furniture(BASIC)
    f.setNotecard(CARD, 'OPTION Lamp on|lamp|glow 0.7')
    apply(f, 'Lamp on')
    expect(face(f, 2, 0).glow).toBeCloseTo(0.7)
    expect(light(f).enabled).toBe(false)
    const resets = () => f.script('[LS]options').callsOf('llResetScript').length
    const before = resets()
    f.setItem('anim3', 'animation')
    expect(resets()).toBe(before)
  })

  it('after a problem, reloads on any inventory change (a missing texture dropped in)', async () => {
    const f = await furniture('OPTION Wood|lamp:0|texture Oak', { items: [] })
    expect(printed(f)[1]).toContain('texture "Oak"')
    addItem(f, 'Oak', 'texture', 5)
    f.setItem('anim3', 'animation') // sends CHANGED_INVENTORY
    apply(f, 'Wood')
    const oak = f.prims[0]!.inventory.find((i) => i.name === 'Oak')!.key
    expect(face(f, 2, 0).texture).toBe(oak)
  })

  it('a prim name with a colon is not taken for faces', async () => {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]options'],
      prims: 2,
      primNames: { 2: 'Clock 12:30' },
      notecards: { [CARD]: 'OPTION Tick|Clock 12:30|glow 0.3\nOPTION Face|Clock 12:30:1|glow 0.6' },
    })
    f.start()
    expect(f.printed('[LS]options')).toEqual([])
    f.broadcast(90250, 'Tick', '')
    expect(f.prims[1]!.params.faces[0]!.glow).toBeCloseTo(0.3)
    f.broadcast(90250, 'Face', '')
    expect(f.prims[1]!.params.faces[1]!.glow).toBeCloseTo(0.6)
    expect(f.prims[1]!.params.faces[0]!.glow).toBeCloseTo(0.3)
  })
})

describe('LuaSitter2 [LS]options: more notecard problems and edge cases', () => {
  it('names, TOGGLE, POSE and BUTTON lines with parts missing, bad numbers, a clash of names', async () => {
    const f = await furniture(`OPTION A|lamp|glow 0.5
TOGGLE T|A
OPTION T|lamp|glow 1
TOGGLE A|A
TOGGLE Lonely
OPTION |lamp|glow 1
OPTION B|lamp|alpha
OPTION C|lamp|glow 1 2
OPTION D|lamp|light maybe
OPTION E|lamp|color 1..2 0 0
POSE |A
POSE Sit|
BUTTON 97|
TOGGLE U|`)
    const out = printed(f)
    expect(out[0]).toBe('[LS]options: 12 problem(s) in the notecard "[LS]options_settings":')
    expect(out.slice(1)).toEqual([
      'line 3: "T" is already a TOGGLE.',
      'line 4: "A" is already an OPTION or TOGGLE.',
      'line 5: TOGGLE needs a name and options: TOGGLE <name>|<option>|<option>.',
      'line 6: OPTION without a name.',
      'line 7: alpha needs a number from 0 to 1.',
      'line 8: glow needs a number from 0 to 1.',
      'line 9: light needs off, on, or a colour (and intensity, radius, falloff).',
      'line 10: color needs three numbers, for example color 1 0.5 0.',
      'line 11: POSE needs a pose name (or *): POSE <pose>|<option>[|<sitter>].',
      'line 12: no option name.',
      'line 13: no option name.',
      'line 14: no option name.',
    ])
    // the toggle T still works (the clashing OPTION T line was ignored)
    apply(f, 'T')
    expect(face(f, 2, 0).glow).toBeCloseTo(0.5)
    // a toggle left without options does nothing
    face(f, 2, 0).glow = 0
    apply(f, 'U')
    expect(face(f, 2, 0).glow).toBe(0)
    // the BUTTON 97 line without an option was not kept
    f.broadcast(97, '', '')
    expect(face(f, 2, 0).glow).toBe(0)
  })

  it('other spellings: fullbright yes/no/1/0/true/false, POSE sitter * and 01, a volume without loop; lines adding up', async () => {
    const f = await furniture(`OPTION FbYes|lamp:0|fullbright yes
OPTION FbYes|lamp:1|fullbright 1
OPTION FbYes|lamp:2|fullbright true
OPTION FbNo|lamp:0|fullbright no
OPTION FbNo|lamp:1|fullbright 0
OPTION FbNo|lamp:2|fullbright false
OPTION Soft|*|sound Rain 0.4
OPTION Glow|lamp|glow 0.6
POSE Kneel|FbYes|*
POSE Kneel|Soft|*
POSE Sit|FbNo|01
BUTTON 97|Glow
BUTTON 97|FbYes
BUTTON 98`)
    expect(printed(f)).toEqual([
      '[LS]options: 1 problem(s) in the notecard "[LS]options_settings":',
      'line 14: no option name.',
    ])
    f.broadcast(90045, '0|Kneel|anim2|0||', '') // both POSE Kneel lines
    for (const n of [0, 1, 2]) expect(face(f, 2, n).fullBright).toBe(true)
    const rain = f.prims[0]!.inventory.find((i) => i.name === 'Rain')!.key
    expect(sound(f)).toMatchObject({ sound: rain, loop: false })
    expect(sound(f)!.volume).toBeCloseTo(0.4)
    f.broadcast(90045, '1|Sit|anim1|0||', '') // "01" is sitter 1
    for (const n of [0, 1, 2]) expect(face(f, 2, n).fullBright).toBe(false)
    f.broadcast(97, '', '') // both BUTTON 97 lines
    expect(face(f, 2, 3).glow).toBeCloseTo(0.6)
    expect(face(f, 2, 0).fullBright).toBe(true)
  })

  it('90045 without a sitter number or pose name only matches the * lines', async () => {
    const f = await furniture(`${BASIC}
POSE *|Lamp on`)
    f.broadcast(90045, 'x', '')
    expect(light(f).enabled).toBe(true)
  })

  it('a texture on every face of a prim, and a light colour with only three numbers', async () => {
    const f = await furniture('OPTION Silky|lamp|texture Silk|light 255 0 0')
    expect(printed(f)).toEqual([])
    const silk = f.prims[0]!.inventory.find((i) => i.name === 'Silk')!.key
    apply(f, 'Silky')
    for (const fc of prim(f, 2).faces) expect(fc.texture).toBe(silk)
    expect(face(f, 1, 0).texture).not.toBe(silk)
    expect(light(f)).toMatchObject({ enabled: true, color: { x: 1, y: 0, z: 0 } })
    expect(light(f).intensity).toBeCloseTo(1)
    expect(light(f).radius).toBeCloseTo(10)
    expect(light(f).falloff).toBeCloseTo(0.75)
  })

  it('in a one-prim object: root and the object name are this prim, other names are missing', async () => {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]options'],
      notecards: { [CARD]: 'OPTION R|root|glow 0.4\nOPTION N|Furniture|fullbright on\nOPTION L|lamp|glow 1' },
    })
    f.start()
    expect(f.printed('[LS]options')).toEqual([
      '[LS]options: 1 problem(s) in the notecard "[LS]options_settings":',
      'line 3: no prim named "lamp".',
    ])
    f.broadcast(90250, 'R', '')
    expect(f.prims[0]!.params.faces[0]!.glow).toBeCloseTo(0.4)
    f.broadcast(90250, 'N', '')
    for (const fc of f.prims[0]!.params.faces) expect(fc.fullBright).toBe(true)
  })

  it('the dataserver reader ignores answers to other requests', async () => {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]options'],
      prims: 2,
      primNames: { 2: 'lamp' },
      notecards: { [CARD]: 'OPTION Lamp on|lamp|glow 0.3' },
    })
    const s = f.script('[LS]options')
    const Q = '88888888-0000-0000-0000-000000000001'
    s.mock('llGetNotecardLineSync', () => NAK)
    s.mock('llGetNotecardLine', () => Q) // answered by hand below
    s.start()
    // an answer to another request of the script, while the first line is awaited
    s.fire('dataserver', { queryid: '77777777-0000-0000-0000-000000000001', data: 'OPTION Bad|nowhere|glow 1' })
    s.fire('dataserver', { queryid: Q, data: 'OPTION Lamp on|lamp|glow 0.3' })
    s.fire('dataserver', { queryid: Q, data: '\n\n\n' }) // EOF
    f.settle()
    expect(f.printed('[LS]options')).toEqual([])
    f.broadcast(90250, 'Lamp on', '')
    expect(f.prims[1]!.params.faces[0]!.glow).toBeCloseTo(0.3)
  })
})

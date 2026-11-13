// LuaSitter2: [LS]faces-camera: facial expressions (ANIM lines) and pose cameras
// (CAMERA lines), one copy per sitter for cameras, copy 0 covering faces of all sitters.
import { describe, it, expect } from 'vitest'
import { buildFurniture, LS2_SCRIPTS, OWNER } from '../helpers/furniture.js'
import type { Furniture, Avatar } from '../helpers/furniture.js'

const CAMERA_ACTIVE = 12
const CAMERA_FOCUS = 17
const CAMERA_POSITION = 13

const CARD = `SITTER 0
SYNC Sit1|cud_a
SYNC Sit2|talk_a
ANIM Sit1|smile|2|grin|3
CAMERA Sit1|<0,-2,1>|<0,0,0.5>
CAMERA DEFAULT|<0,-4,2>|<0,0,0.5>
{Sit1}<0,0.3,0.5><0,0,0>
{Sit2}<0,0.3,0.5><0,0,0>
SITTER 1
SYNC Sit1|cud_b
SYNC Sit2|talk_b
ANIM Sit2|grin|-
CAMERA Sit1|<0,2,1>|<0,0,0.5>
{Sit1}<0,-0.3,0.5><0,0,0>
{Sit2}<0,-0.3,0.5><0,0,0>`

async function furniture(copies: string[], card = CARD) {
  const f = await buildFurniture({
    sources: LS2_SCRIPTS,
    scripts: ['[LS]sit', '[LS]sit 1', ...copies],
    prims: 2,
    notecards: { LSpos: card },
    animations: ['cud_a', 'cud_b', 'talk_a', 'talk_b', 'smile', 'grin'],
  })
  f.start()
  return f
}

/** Expressions started (90001) and stopped (90002) for an avatar, in order. */
function expressions(f: Furniture, av: Avatar): string[] {
  return f.linked().filter((m) => (m.num === 90001 || m.num === 90002) && m.id === av.key)
    .map((m) => `${m.num === 90001 ? '+' : '-'}${m.str}`)
}

describe('LuaSitter2 facial expressions (ANIM)', () => {
  it('plays the expressions of the pose in turn, and loops', async () => {
    const f = await furniture(['[LS]faces-camera'])
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.settle(500) // the sit script plays it on the next event
    expect(expressions(f, alice)).toContain('+smile')
    expect(f.playing(alice)).toContain('smile')
    f.settle(2_000)
    expect(expressions(f, alice)).toContain('+grin')
    f.settle(3_000)
    expect(expressions(f, alice).filter((e) => e === '+smile').length).toBeGreaterThanOrEqual(2)
  })

  it('stops the expression when the pose changes to one without ANIM', async () => {
    const f = await furniture(['[LS]faces-camera'])
    const alice = f.avatar('Alice')
    f.sit(alice)
    f.click(alice, 'Sit2')
    f.settle(2_000)
    expect(f.playing(alice)).toEqual(['talk_a'])
    expect(expressions(f, alice).at(-1)).toMatch(/^-/)
  })

  it('copy 0 alone also plays the expressions of sitter 1', async () => {
    const f = await furniture(['[LS]faces-camera'])
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.click(alice, 'Sit2')
    expect(expressions(f, bob)).toContain('+grin')
  })

  it('"-" as duration plays the expression once and holds the sequence there', async () => {
    const f = await furniture(['[LS]faces-camera'])
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    f.click(alice, 'Sit2')
    f.settle(10_000)
    expect(expressions(f, bob).filter((e) => e === '+grin')).toHaveLength(1)
  })

  it('[FACES] in the adjust menu switches expressions off for the owner', async () => {
    const f = await furniture(['[LS]faces-camera'])
    const owner: Avatar = { key: OWNER, name: 'Owner Resident' }
    f.sit(owner)
    f.click(owner, '[ADJUST]')
    f.click(owner, '[FACES]')
    const before = expressions(f, owner).filter((e) => e.startsWith('+')).length
    f.settle(10_000)
    expect(expressions(f, owner).filter((e) => e.startsWith('+')).length).toBe(before)
  })
})

describe('LuaSitter2 pose cameras (CAMERA)', () => {
  const camera = (f: Furniture, copy: string) => f.script(copy).cameraParams

  it('sets the camera of the pose when the sitter sits', async () => {
    const f = await furniture(['[LS]faces-camera'])
    const alice = f.avatar('Alice')
    f.sit(alice)
    const cam = camera(f, '[LS]faces-camera')
    expect(cam.get(CAMERA_ACTIVE)).toBe(1)
    expect(cam.has(CAMERA_POSITION)).toBe(true)
    expect(cam.has(CAMERA_FOCUS)).toBe(true)
  })

  it('switches to the DEFAULT camera for a pose without its own CAMERA line', async () => {
    const f = await furniture(['[LS]faces-camera'])
    const alice = f.avatar('Alice')
    f.sit(alice)
    const sit1 = JSON.stringify(camera(f, '[LS]faces-camera').get(CAMERA_POSITION))
    f.click(alice, 'Sit2')
    const sit2 = JSON.stringify(camera(f, '[LS]faces-camera').get(CAMERA_POSITION))
    expect(sit2).not.toBe(sit1)
  })

  it('copy N sets the camera of sitter N; copy 0 does not take it over', async () => {
    const f = await furniture(['[LS]faces-camera', '[LS]faces-camera 1'])
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    const asked = (copy: string) => f.script(copy).permissionRequests.map((r) => r.agent)
    expect(asked('[LS]faces-camera')).not.toContain(bob.key)
    expect(asked('[LS]faces-camera 1')).toContain(bob.key)
    expect(camera(f, '[LS]faces-camera 1').get(CAMERA_ACTIVE)).toBe(1)
  })

  it('a sitter without a camera copy gets no camera', async () => {
    const f = await furniture(['[LS]faces-camera'])
    const alice = f.avatar('Alice')
    const bob = f.avatar('Bob')
    f.sit(alice)
    f.sit(bob)
    expect(f.script('[LS]faces-camera').permissionRequests.map((r) => r.agent)).not.toContain(bob.key)
  })
})

// No script blocks with ll.Sleep.
// (Link messages are fired with sender_num 0: in a one-prim object, as here,
// llGetLinkNumber() is 0, and several scripts only accept their own link number.) The waits upstream did with llSleep are timers;
// these tests check that each wait still happens, lasts as long, and keeps the order
// of what the script does and sends.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { buildFurniture, LS1, LS2, LS1_SCRIPTS, LS2_SCRIPTS, OWNER } from '../helpers/furniture.js'
import type { Avatar } from '../helpers/furniture.js'

const owner: Avatar = { key: OWNER, name: 'Owner Resident' }

function luauFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) out.push(...luauFiles(p))
    else if (name.endsWith('.luau')) out.push(p)
  }
  return out
}

describe('no ll.Sleep', () => {
  it('no LuaSitter1 or LuaSitter2 script calls ll.Sleep', () => {
    const offenders: string[] = []
    for (const file of [...luauFiles(LS1), ...luauFiles(LS2)]) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const code = line.replace(/--.*$/, '')
        if (/\bll\.Sleep\s*\(/.test(code)) offenders.push(`${path.basename(file)}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})

describe('timed waits (were llSleep)', () => {
  it('LuaSitter1 LSsit: the old animation stops 0.5 s after the new one starts', async () => {
    const f = await buildFurniture({
      sources: LS1_SCRIPTS,
      scripts: ['LSsit'],
      notecards: { LSpos: 'SITTER 0\nPOSE Sit1|anim1\nPOSE Sit2|anim2\n{Sit1}<0,0,0.5><0,0,0>\n{Sit2}<0,0,0.5><0,0,0>' },
      animations: ['anim1', 'anim2'],
    })
    f.start()
    f.settle(5_000)
    const alice = f.avatar('Alice')
    f.sit(alice)
    // play the pose by link message: a menu answer would also run llDialog, whose
    // 1 s forced delay (modelled by rezless, as in Second Life) hides the 0.5 s wait
    f.script('LSsit').fire('link_message', { sender_num: 0, num: 90000, str: 'Sit2', id: '' })
    f.advance(200)
    expect(f.playing(alice).sort()).toEqual(['anim1', 'anim2']) // both, briefly (as upstream)
    f.advance(500)
    expect(f.playing(alice)).toEqual(['anim2'])
  })

  it('LuaSitter1 LSplus: a BUTTON prop rezzes after 1 s, and a pose change in that second comes after it', async () => {
    const f = await buildFurniture({
      sources: LS1_SCRIPTS,
      scripts: ['LSsit', 'LSplus'],
      notecards: {
        LSpos: 'SITTER 0\nPOSE Sit1|anim1\nPOSE Sit2|anim2\n{Sit1}<0,0,0.5><0,0,0>\n{Sit2}<0,0,0.5><0,0,0>\nPROP Ball|ball|<0,0,1>|<0,0,0>',
      },
      animations: ['anim1', 'anim2'],
      objects: { ball: ['LSprop'] },
    })
    f.start()
    f.settle(5_000)
    const alice = f.avatar('Alice')
    f.sit(alice)
    const plus = f.script('LSplus')
    plus.fire('link_message', { sender_num: 0, num: 90200, str: 'Ball', id: alice.key })
    f.advance(500)
    expect(f.rezzed()).toHaveLength(0) // still waiting
    // a pose change arrives during the wait: upstream handled it after the rez
    plus.fire('link_message', { sender_num: 0, num: 90045, str: 'Sit2|anim2', id: alice.key })
    f.advance(300) // llRezAtRoot has a 0.1 s forced delay
    expect(f.rezzed().map((l) => l.prims[0]!.name)).toEqual(['ball'])
    f.settle(3_000)
    expect(f.rezzed()).toHaveLength(1) // a BUTTON prop survives the next pose change ("sticky")
  })

  it('[LS]faces-camera DUMP: lines 0.2 s apart, and 90021 after the last one', async () => {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]sit', '[LS]faces-camera'],
      notecards: { LSpos: 'SITTER 0\nPOSE Sit1|anim1\nPOSE Sit2|anim1\nANIM Sit1|smile|2\nANIM Sit2|smile|3\nCAMERA Sit1|<0,-2,1>|<0,0,0.5>\n{Sit1}<0,0,0.5><0,0,0>\n{Sit2}<0,0,0.5><0,0,0>' },
      animations: ['anim1', 'smile'],
    })
    f.start()
    const faces = f.script('[LS]faces-camera')
    const before = f.linked().length
    faces.fire('link_message', { sender_num: 0, num: 90020, str: '0', id: '[LS]faces-camera' })
    const sent = () => f.linked().slice(before).filter((m) => m.num === 90022 || m.num === 90021).map((m) => m.num)
    f.advance(100)
    expect(sent()).toEqual([])
    f.advance(150)
    expect(sent()).toEqual([90022])
    f.advance(2_000)
    expect(sent()).toEqual([90022, 90022, 90022, 90021])
  })

  it('[LS]menu DUMP: the menu lines, then the prop lines, then the end marker', async () => {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]menu', '[LS]plugins'],
      notecards: { LSpos: 'BUTTON Ball\nBUTTON Cube\nPROP Ball|ball|G1|<0,0,1>|<0,0,0>' },
    })
    f.start()
    f.touch(owner)
    f.click(owner, '[OWNER]')
    f.click(owner, '[DUMP]')
    f.settle(10_000)
    const out = f.script('[LS]menu').chat.map((c) => c.text.replace(/^◆/, '')).filter((t) => t.trim() !== '')
    const at = (s: string) => out.findIndex((t) => t.startsWith(s))
    expect(at('BUTTON Ball')).toBeGreaterThan(at('--✄--COPY BELOW'))
    expect(at('BUTTON Cube')).toBeGreaterThan(at('BUTTON Ball'))
    expect(at('PROP Ball')).toBeGreaterThan(at('BUTTON Cube'))
    expect(at('--✄--COPY ABOVE')).toBeGreaterThan(at('PROP Ball'))
  })

  it('[LS]sit on keyframed furniture (KFM 1): pauses the motion, moves the sitter, resumes 0.2 s later', async () => {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]sit'],
      notecards: { LSpos: 'KFM 1\nSITTER 0\nPOSE Sit1|anim1\nPOSE Sit2|anim1\n{Sit1}<0,0,0.5><0,0,0>\n{Sit2}<0,0,0.7><0,0,0>' },
      animations: ['anim1'],
    })
    f.start()
    const alice = f.avatar('Alice')
    f.sit(alice)
    const sit = f.script('[LS]sit')
    const kfm = () => sit.callsOf('llSetKeyframedMotion').map((c) => {
      const opts = c.args[1] as number[]
      return opts[1] === 0 ? 'PLAY' : opts[1] === 2 ? 'PAUSE' : String(opts[1])
    })
    const before = kfm().length
    sit.fire('link_message', { sender_num: 0, num: 90000, str: 'Sit2', id: alice.key }) // moves the sitter: pause right away
    expect(kfm().slice(before)).toEqual(['PAUSE'])
    f.advance(250)
    expect(kfm().slice(before)).toEqual(['PAUSE', 'PLAY'])
  })

  it('[LS]sit KFM: a second move during the wait cancels the first one\'s resume, and resumes once', async () => {
    const f = await buildFurniture({
      sources: LS2_SCRIPTS,
      scripts: ['[LS]sit'],
      notecards: { LSpos: 'KFM 1\nSITTER 0\nPOSE Sit1|anim1\nPOSE Sit2|anim1\n{Sit1}<0,0,0.5><0,0,0>\n{Sit2}<0,0,0.7><0,0,0>' },
      animations: ['anim1'],
    })
    f.start()
    const alice = f.avatar('Alice')
    f.sit(alice)
    const sit = f.script('[LS]sit')
    const plays = () => sit.callsOf('llSetKeyframedMotion').filter((c) => (c.args[1] as number[])[1] === 0).length
    const before = plays()
    sit.fire('link_message', { sender_num: 0, num: 90000, str: 'Sit2', id: alice.key })
    f.advance(50)
    sit.fire('link_message', { sender_num: 0, num: 90000, str: 'Sit1', id: alice.key })
    f.advance(500)
    expect(plays() - before).toBe(1)
  })
})

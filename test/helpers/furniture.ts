// Test harness: builds a piece of LuaSitter furniture in a rezless World and
// fills the gaps between rezless and Second Life that LuaSitter depends on.
//
// Gaps filled here:
// - In Second Life, a seated avatar becomes an extra link of the object:
//   llGetNumberOfPrims() counts it and llGetLinkKey(n) returns its key. rezless
//   does not model this, so llGetNumberOfPrims and llGetLinkKey are mocked in
//   every script to append the seated avatars (in seating order).
// - In Second Life, animation permission requested from an avatar sitting on
//   the object is granted automatically. settle() grants those requests.

import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  loadLinkset,
  makeInventoryItem,
  InventoryType,
  World,
  NULL_KEY,
} from '@rezless/vitest'
import type { Script, LoadedLinkset } from '@rezless/vitest'

export const REPO = fileURLToPath(new URL('../../', import.meta.url))
export const LS2 = REPO + 'LuaSitter2/'
export const LS1 = REPO + 'LuaSitter1/'

export const OWNER = '00000000-0000-0000-0000-0000000000a1'
export const REGION = 'Test'

/** Source files of the LuaSitter2 scripts, by inventory name. */
export const LS2_SCRIPTS: Record<string, string> = {
  '[LS]sit': LS2 + '[LS]sit.luau',
  '[LS]select': LS2 + '[LS]select.luau',
  '[LS]adjuster': LS2 + '[LS]adjuster.luau',
  '[LS]root-security': LS2 + '[LS]root-security.luau',
  '[LS]plugins': LS2 + 'Plugins/LSplugins/[LS]plugins.luau',
  '[LS]faces-camera': LS2 + 'Plugins/LSfaces-camera/[LS]faces-camera.luau',
  '[LS]root-control': LS2 + 'Plugins/LScontrol/[LS]root-control.luau',
  '[LS]root-RLV': LS2 + 'Plugins/LScontrol/[LS]root-RLV.luau',
  '[LS]Xcite!': LS2 + 'Plugins/LScontrol/Xcite!-Sensations/[LS]Xcite!.luau',
  '[LS]commands': LS2 + 'Plugins/LScommands/[LS]commands.luau',
  '[LS]chains': LS2 + 'Plugins/LScontrol/Chains/[LS]chains.luau',
  '[LS]options': LS2 + 'Plugins/LSoptions/[LS]options.luau',
  'LS-setup-checker': LS2 + 'Utilities/LS-setup-checker.luau',
  'LS-notecard-tools': LS2 + 'Utilities/LS-notecard-tools.luau',
  '[LS]object': LS2 + 'Plugins/LSplugins/[LS]object.luau',
  '[LS]menu': LS2 + 'Plugins/LSplugins/[LS]menu.luau',
  '[LS]root': LS2 + '[LS]root.luau',
  '[LS]helperscript': LS2 + '[LS]helperscript.luau',
  '[LS]LockGuard': LS2 + 'Plugins/LScontrol/LockGuard/[LS]LockGuard.luau',
  '[LS]LockMeister': LS2 + 'Plugins/LScontrol/LockMeister/[LS]LockMeister.luau',
  'LS-update-sender': LS2 + 'Utilities/Updater/LS-update-sender.luau',
  'update receiver (auto removing)': LS2 + 'Utilities/Updater/LS-update-receiver.luau',
}

/** Source files of the LuaSitter1 scripts, by inventory name. */
export const LS1_SCRIPTS: Record<string, string> = {
  LSsit: LS1 + 'LSsit.luau',
  LSselect: LS1 + 'LSselect.luau',
  LSplus: LS1 + 'LSplus.luau',
  LSadjuster: LS1 + 'LSadjuster.luau',
  LSprop: LS1 + 'LSprop.luau',
  LSroot: LS1 + 'LSroot.luau',
  'LSroot-security': LS1 + 'LSroot-security.luau',
}

/** An inline script that does nothing: stands in for scripts whose presence is all that matters. */
export const INERT = { source: '-- placeholder', filename: 'inert.luau' }

export interface FurnitureOptions {
  /** Scripts in the root prim: inventory name -> source file. Copies like "[LS]sit 1" use the base script's file. */
  scripts: string[]
  /** Script sources to use, LS2_SCRIPTS or LS1_SCRIPTS. */
  sources: Record<string, string>
  /** Notecards in the root prim: name -> text. */
  notecards?: Record<string, string>
  /** Animation names in the root prim. */
  animations?: string[]
  /** Number of prims (one sit target per sitter needs one prim per sitter). Default: 1. */
  prims?: number
  /** Scripts that are only present (inert placeholders), for example extra "[LS]sit N" copies. */
  placeholders?: string[]
  /** Objects in the root prim that can be rezzed (props): object name -> scripts inside it (from `sources`). */
  objects?: Record<string, string[]>
  /** Scripts in a child prim instead of the root (the root prim then holds `scripts`): link number -> script names. */
  childScripts?: Record<number, string[]>
  /** Put the notecards and animations in this link instead of the root (with `childScripts`). */
  contentsLink?: number
  /** Names of prims by link number (default "Furniture", "Prim 2", ...), for example LockGuard rings. */
  primNames?: Record<number, string>
}

export interface Furniture extends LoadedLinkset {
  world: World
  /** Avatars sitting on the object, in seating order (their link numbers follow the prims). */
  seated: Avatar[]
  avatar(name: string): Avatar
  start(): void
  advance(ms: number): void
  sit(av: Avatar, link?: number): void
  stand(av: Avatar): void
  /** Grant permission requests from seated avatars and let timers run. */
  settle(ms?: number): void
  script(name: string): Script
  /** Every dialog shown to an avatar, oldest first, across all scripts. */
  dialogsFor(av: Avatar): { script: string; agent: string; message: string; buttons: string[]; channel: number }[]
  lastDialog(av: Avatar): { script: string; agent: string; message: string; buttons: string[]; channel: number }
  /** Click a button of the last dialog shown to an avatar. */
  click(av: Avatar, button: string): void
  /** Every link message sent by any script. */
  linked(): { num: number; str: string; id: string }[]
  /** print() output of a script. */
  printed(name: string): string[]
  /** Key of an inventory item of the root prim. */
  itemKey(name: string): string
  /**
   * Replace, add (text) or delete (null) an item of the contents prim, then send
   * CHANGED_INVENTORY to the scripts in that prim, as Second Life does when an
   * item is saved, dropped in or deleted. (rezless does not send it by itself.)
   */
  setNotecard(name: string, text: string | null): void
  setItem(name: string, type: 'animation' | 'notecard' | null): void
  /** An avatar says a message on a channel, heard by the listens of every script (like "/5 cleanup"). */
  say(av: Avatar, channel: number, message: string): void
  /** Objects rezzed by the furniture (props) that still exist. */
  rezzed(): LoadedLinkset['linkset'][]
  /** Names of the inventory animations an avatar is playing. */
  playing(av: Avatar): string[]
  /** Send a link message to a script as if from its own prim. */
  sendLinked(script: string, num: number, str: string, id: string): void
  /** Click the furniture (link 1, or a given link) as an avatar. */
  touch(av: Avatar, link?: number): void
  /** Send a link message to every script (like llMessageLinked(LINK_SET, ...) from a plugin in the root prim). */
  broadcast(num: number, str: string, id: string): void
}

export interface Avatar {
  key: string
  name: string
}

let avatarCounter = 0
function avatarKey(): string {
  avatarCounter += 1
  return `00000000-0000-0000-0000-${avatarCounter.toString(16).padStart(12, '0')}`
}

export function stripCR(text: string): string {
  return text.replace(/\r/g, '')
}

export function notecardFile(path: string): string {
  return stripCR(readFileSync(path, 'utf8'))
}

export async function buildFurniture(opts: FurnitureOptions): Promise<Furniture> {
  const world = new World({ startUnixTime: 1_700_000_000 })
  world.addRegion(REGION, { x: 0, y: 0 })
  world.addAvatar({ region: REGION, key: OWNER, username: 'owner.resident', name: 'Owner Resident' })

  const inventory = []
  for (const [name, text] of Object.entries(opts.notecards ?? {})) {
    inventory.push(makeInventoryItem({
      name,
      type: InventoryType.NOTECARD,
      key: `11111111-0000-0000-0000-${(inventory.length + 1).toString(16).padStart(12, '0')}`,
      notecardLines: text.split('\n'),
      creator: OWNER,
    }))
  }
  for (const name of opts.animations ?? []) {
    inventory.push(makeInventoryItem({
      name,
      type: InventoryType.ANIMATION,
      key: `22222222-0000-0000-0000-${(inventory.length + 1).toString(16).padStart(12, '0')}`,
      creator: OWNER,
    }))
  }

  const scripts = opts.scripts.map((name) => {
    const base = name.replace(/ \d+$/, '')
    const source = opts.sources[base]
    if (!source) throw new Error(`no source for script ${name}`)
    // one spelling per file (mixed / and \ would split its coverage in two)
    return { name, source: path.normalize(source) }
  })
  const allScripts: { name: string; source: string | typeof INERT }[] = [...scripts]
  for (const name of opts.placeholders ?? []) allScripts.push({ name, source: INERT })

  const objects: Record<string, { prims: { name: string; scripts: { name: string; source: string }[] }[] }> = {}
  for (const [name, inside] of Object.entries(opts.objects ?? {})) {
    objects[name] = {
      prims: [{ name, scripts: inside.map((s) => ({ name: s, source: path.normalize(opts.sources[s]!) })) }],
    }
  }

  const primCount = opts.prims ?? 1
  const contentsLink = opts.contentsLink ?? 1
  const prims: { name: string; scripts: typeof allScripts; inventory: typeof inventory; objects?: typeof objects }[] = []
  for (let i = 1; i <= primCount; i++) {
    const child = (opts.childScripts?.[i] ?? []).map((name) => {
      const source = opts.sources[name.replace(/ \d+$/, '')]
      if (!source) throw new Error(`no source for script ${name}`)
      return { name, source: path.normalize(source) }
    })
    prims.push({
      name: opts.primNames?.[i] ?? (i === 1 ? 'Furniture' : `Prim ${i}`),
      scripts: i === 1 ? [...allScripts, ...child] : child,
      inventory: i === contentsLink ? inventory : [],
      ...(i === 1 ? { objects } : {}),
    })
  }

  const loaded = await loadLinkset({ world, region: REGION, owner: OWNER, prims, position: { x: 128, y: 128, z: 25 } })
  const seated: Avatar[] = []
  const avatars = new Map<string, Avatar>()

  const all = (): Script[] => Object.values(loaded.scripts)

  // All dialogs in the order they were shown (rezless keeps one list per script).
  type Shown = { script: string; agent: string; message: string; buttons: string[]; channel: number }
  const dialogLog: Shown[] = []
  const seen = new Map<string, number>()
  const syncDialogs = () => {
    for (const [name, s] of Object.entries(loaded.scripts)) {
      const list = s.dialogs
      for (let i = seen.get(name) ?? 0; i < list.length; i++) {
        const d = list[i]!
        dialogLog.push({ script: name, agent: d.agent.toLowerCase(), message: d.message, buttons: [...d.buttons], channel: d.channel })
      }
      seen.set(name, list.length)
    }
  }

  // Seated avatars as extra links (see the header comment).
  for (const s of all()) {
    s.mock('llGetNumberOfPrims', (ctx) => ctx.linkset.prims.length + seated.length)
    s.mock('llGetLinkKey', (ctx, args) => {
      const link = args[0] as number
      const n = ctx.linkset.prims.length
      if (link > n && link <= n + seated.length) return seated[link - n - 1]!.key
      if (link === 0) return n === 1 ? ctx.linkset.prims[0]!.key : NULL_KEY
      if (link === -4) return ctx.prim.key // LINK_THIS
      const prim = ctx.linkset.prims.find((p) => p.linkNumber === link)
      return prim ? prim.key : NULL_KEY
    })
  }

  let itemCounter = 0
  const editInventory = (name: string, item: ReturnType<typeof makeInventoryItem> | null) => {
    const prim = loaded.prims[contentsLink - 1]!
    const i = prim.inventory.findIndex((it) => it.name === name)
    if (i >= 0) prim.inventory.splice(i, 1)
    if (item) prim.addInventory({ ...item, acquireTimeMs: loaded.linkset.clock.now })
    for (const s of all()) {
      if (s.host.linkNumber === prim.linkNumber) s.fire('changed', { changes: 0x1 }) // CHANGED_INVENTORY
    }
    f.settle(2_000)
  }

  const f: Furniture = {
    ...loaded,
    world,
    seated,
    avatar(name: string): Avatar {
      let av = avatars.get(name)
      if (!av) {
        av = { key: avatarKey(), name: `${name} Resident` }
        world.addAvatar({ region: REGION, key: av.key, username: `${name.toLowerCase()}.resident`, name: av.name })
        avatars.set(name, av)
      }
      return av
    },
    start() {
      for (const s of all()) s.start()
      f.settle(2_000)
    },
    advance(ms: number) {
      loaded.linkset.advanceTime(ms)
    },
    sit(av: Avatar, link?: number) {
      const wa = world.avatars.find((a) => a.key === av.key)!
      let prim
      if (link !== undefined) {
        prim = loaded.prims[link - 1]!
      } else {
        // the first prim with an enabled, free sit target (as when clicking "Sit" on the object);
        // when every sit target is taken, Second Life still seats the avatar on the object
        // (AVsitter1 relies on this), so use a free prim without one
        const free = (p: (typeof loaded.prims)[number]) => !world.avatars.some((a) => a.sittingOn === p)
        prim = loaded.prims.find((p) => p.params.sitTarget.enabled && free(p))
          ?? loaded.prims.find(free)
          ?? loaded.prims[0]!
      }
      seated.push(av)
      if (!world.sitAvatar(wa, prim)) {
        seated.pop()
        throw new Error(`rezless refused to seat ${av.name} on link ${prim.linkNumber}`)
      }
      f.settle()
    },
    stand(av: Avatar) {
      const wa = world.avatars.find((a) => a.key === av.key)!
      const i = seated.findIndex((a) => a.key === av.key)
      if (i >= 0) seated.splice(i, 1)
      world.standAvatar(wa)
      f.settle()
    },
    settle(ms = 1_000) {
      // Advance in steps of at most 100 ms, granting permission requests of seated
      // avatars at every step (a request made late in the period is granted too).
      const grant = () => {
        // avatars unseated by a script (llUnSit) stop being links
        for (let i = seated.length - 1; i >= 0; i--) {
          const wa = world.avatars.find((a) => a.key === seated[i]!.key)
          if (wa && !wa.sittingOn) seated.splice(i, 1)
        }
        for (const s of all()) {
          const req = s.permissionRequests.at(-1)
          if (req && !req.answered && seated.some((a) => a.key === req.agent)) s.grantPermissions()
        }
      }
      let left = ms
      while (left > 0) {
        grant()
        const step = Math.min(100, left)
        loaded.linkset.advanceTime(step)
        left -= step
        syncDialogs()
      }
      grant()
      loaded.linkset.advanceTime(0)
      syncDialogs()
    },
    script(name: string): Script {
      const s = loaded.scripts[name]
      if (!s) throw new Error(`no script ${name}`)
      return s
    },
    dialogsFor(av: Avatar) {
      syncDialogs()
      return dialogLog.filter((d) => d.agent === av.key)
    },
    lastDialog(av: Avatar) {
      const d = f.dialogsFor(av).at(-1)
      if (!d) throw new Error(`no dialog for ${av.name}`)
      return d
    },
    click(av: Avatar, button: string) {
      const d = f.lastDialog(av)
      if (!d.buttons.includes(button)) {
        throw new Error(`button "${button}" not in the last dialog of ${av.name} (${d.script}): ${JSON.stringify(d.buttons)}`)
      }
      f.script(d.script).answerDialog(button, { name: av.name })
      f.settle()
    },
    linked() {
      return loaded.linkset.linkedMessages.map((m) => ({ num: m.num, str: String(m.str), id: String(m.id) }))
    },
    setNotecard(name: string, text: string | null) {
      editInventory(name, text === null ? null : makeInventoryItem({
        name,
        type: InventoryType.NOTECARD,
        key: `33333333-0000-0000-0000-${(++itemCounter).toString(16).padStart(12, '0')}`,
        notecardLines: text.split(String.fromCharCode(10)),
        creator: OWNER,
      }))
    },
    setItem(name: string, type: 'animation' | 'notecard' | null) {
      editInventory(name, type === null ? null : makeInventoryItem({
        name,
        type: type === 'animation' ? InventoryType.ANIMATION : InventoryType.NOTECARD,
        key: `33333333-0000-0000-0000-${(++itemCounter).toString(16).padStart(12, '0')}`,
        notecardLines: [],
        creator: OWNER,
      }))
    },
    say(av: Avatar, channel: number, message: string) {
      for (const s of all()) {
        ;(s as unknown as { matchChatListens(o: object): boolean })
          .matchChatListens({ channel, name: av.name, key: av.key, message })
      }
      f.settle()
    },
    rezzed() {
      return world.linksets.filter((l) => l !== loaded.linkset)
    },
    itemKey(name: string) {
      const item = loaded.prims[contentsLink - 1]!.inventory.find((i) => i.name === name)
      if (!item) throw new Error(`no item ${name}`)
      return item.key
    },
    playing(av: Avatar) {
      const keys = new Set(all()[0]!.getPlayingAnimations(av.key))
      return loaded.prims[contentsLink - 1]!.inventory.filter((i) => i.type === InventoryType.ANIMATION && keys.has(i.key)).map((i) => i.name)
    },
    sendLinked(script: string, num: number, str: string, id: string) {
      const s = f.script(script)
      s.fire('link_message', { sender_num: s.host.linkNumber, num, str, id })
      f.settle()
    },
    touch(av: Avatar, link?: number) {
      const prim = link === undefined ? loaded.prims[0]! : loaded.prims[link - 1]!
      loaded.linkset.touch(prim.linkNumber, { avatar: { key: av.key, name: av.name } })
      f.settle()
    },
    broadcast(num: number, str: string, id: string) {
      for (const s of all()) s.fire('link_message', { sender_num: loaded.prims[0]!.linkNumber, num, str, id })
      f.settle()
    },
    printed(name: string) {
      return [...(f.script(name) as unknown as { printed: string[] }).printed]
    },
  }
  return f
}

/** Button labels of a dialog in reading order (rezless gives them in llDialog order). */
export function buttonsOf(d: { buttons: string[] }): string[] {
  return d.buttons
}

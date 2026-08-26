/**
 * Pinned-terminal resolver (v0.17.0) — pure functions over cached session
 * states. Covers the visibility matrix (global / workspace × cwd match /
 * mismatch / both undefined / viewer-only undefined) and the cross-session
 * collection (multi-session, exclusion of the viewer's own session, stable
 * tree order, floats).
 */
import { describe, expect, it } from 'vitest'
import {
  floatTab, makeDefaultState, openTabInActivePane, setTabPin, toggleBottomPanel,
  type SidebarState,
} from '../src/client/state.ts'
import { collectPinnedTabs, pinnedVisibleTo, type PinnedViewer } from '../src/client/pinned.ts'

/** A pinned terminal tab in a fresh state, opened and pinned in one go. */
function stateWithPinnedTerminal(
  id: string,
  pin: { scope: 'workspace' | 'global'; homeCwd?: string },
): SidebarState {
  let s = makeDefaultState()
  s = openTabInActivePane(s, { id, type: 'terminal', title: id })
  return setTabPin(s, id, pin)
}

const viewer = (sessionId: string, cwd?: string): PinnedViewer => ({ sessionId, cwd })

describe('pinnedVisibleTo', () => {
  it('returns false for an unpinned tab', () => {
    const tab = { id: 't', type: 'terminal', title: 'T' }
    expect(pinnedVisibleTo(tab, viewer('s', '/p'))).toBe(false)
  })

  it('global pin is visible to any session regardless of cwd', () => {
    const tab = { id: 't', type: 'terminal', title: 'T', pin: { scope: 'global' as const } }
    expect(pinnedVisibleTo(tab, viewer('s', '/other'))).toBe(true)
    expect(pinnedVisibleTo(tab, viewer('s', undefined))).toBe(true)
  })

  it('workspace pin matches when cwds are equal', () => {
    const tab = { id: 't', type: 'terminal', title: 'T', pin: { scope: 'workspace' as const, homeCwd: '/p' } }
    expect(pinnedVisibleTo(tab, viewer('s', '/p'))).toBe(true)
    expect(pinnedVisibleTo(tab, viewer('s', '/q'))).toBe(false)
  })

  it('workspace pin without homeCwd is visible everywhere (pin set before cwd resolved)', () => {
    const tab = { id: 't', type: 'terminal', title: 'T', pin: { scope: 'workspace' as const } }
    expect(pinnedVisibleTo(tab, viewer('s', '/anywhere'))).toBe(true)
    expect(pinnedVisibleTo(tab, viewer('s', undefined))).toBe(true)
  })

  it('workspace pin is conservatively visible when viewer.cwd is unknown (no hydration flash)', () => {
    const tab = { id: 't', type: 'terminal', title: 'T', pin: { scope: 'workspace' as const, homeCwd: '/p' } }
    expect(pinnedVisibleTo(tab, viewer('s', undefined))).toBe(true)
  })

  it('both undefined cwds match (legacy pin + unhydrated viewer)', () => {
    const tab = { id: 't', type: 'terminal', title: 'T', pin: { scope: 'workspace' as const, homeCwd: undefined } }
    expect(pinnedVisibleTo(tab, viewer('s', undefined))).toBe(true)
  })
})

describe('collectPinnedTabs', () => {
  it('returns an empty array when no other session has pinned terminals', () => {
    const bySession = new Map<string, SidebarState>([
      ['s1', stateWithPinnedTerminal('terminal:1', { scope: 'global' })],
    ])
    expect(collectPinnedTabs(bySession, viewer('s1', '/p'))).toEqual([])
  })

  it('returns an empty array for an empty session cache', () => {
    expect(collectPinnedTabs(new Map(), viewer('s1', '/p'))).toEqual([])
  })

  it('collects a global pin from another session', () => {
    const bySession = new Map<string, SidebarState>([
      ['home', stateWithPinnedTerminal('terminal:1', { scope: 'global' })],
    ])
    const entries = collectPinnedTabs(bySession, viewer('viewer', '/anywhere'))
    expect(entries).toHaveLength(1)
    expect(entries[0]!.tab.id).toBe('terminal:1')
    expect(entries[0]!.homeSessionId).toBe('home')
  })

  it('collects a workspace pin only when the viewer cwd matches homeCwd', () => {
    const home = stateWithPinnedTerminal('terminal:1', { scope: 'workspace', homeCwd: '/proj' })
    const bySession = new Map<string, SidebarState>([['home', home]])
    expect(collectPinnedTabs(bySession, viewer('viewer', '/proj'))).toHaveLength(1)
    expect(collectPinnedTabs(bySession, viewer('viewer', '/elsewhere'))).toHaveLength(0)
  })

  it('excludes the viewer\'s own session (its pinned tabs are on its own strip)', () => {
    const bySession = new Map<string, SidebarState>([
      ['viewer', stateWithPinnedTerminal('terminal:1', { scope: 'global' })],
      ['home', stateWithPinnedTerminal('terminal:2', { scope: 'global' })],
    ])
    const entries = collectPinnedTabs(bySession, viewer('viewer', '/p'))
    expect(entries.map(e => e.tab.id)).toEqual(['terminal:2'])
  })

  it('collects in stable tree order: splits → bottomSplits → floats', () => {
    let home = makeDefaultState()
    // Right tree tab first.
    home = openTabInActivePane(home, { id: 'terminal:right', type: 'terminal', title: 'R' })
    home = setTabPin(home, 'terminal:right', { scope: 'global' })
    // Bottom tree tab second.
    home = toggleBottomPanel(home)
    const bottomPane = (home.bottomSplits as { id: string }).id
    home = { ...home, activePane: bottomPane }
    home = openTabInActivePane(home, { id: 'terminal:bottom', type: 'terminal', title: 'B' })
    home = setTabPin(home, 'terminal:bottom', { scope: 'global' })
    // Float last.
    home = openTabInActivePane(home, { id: 'terminal:float', type: 'terminal', title: 'F' })
    home = setTabPin(home, 'terminal:float', { scope: 'global' })
    home = floatTab(home, 'terminal:float', 50, 50)

    const bySession = new Map<string, SidebarState>([['home', home]])
    const entries = collectPinnedTabs(bySession, viewer('viewer', '/p'))
    expect(entries.map(e => e.tab.id)).toEqual(['terminal:right', 'terminal:bottom', 'terminal:float'])
  })

  it('keeps stable insertion order across multiple home sessions', () => {
    const bySession = new Map<string, SidebarState>([
      ['homeA', stateWithPinnedTerminal('terminal:a', { scope: 'global' })],
      ['homeB', stateWithPinnedTerminal('terminal:b', { scope: 'global' })],
    ])
    const entries = collectPinnedTabs(bySession, viewer('viewer', '/p'))
    expect(entries.map(e => e.tab.id)).toEqual(['terminal:a', 'terminal:b'])
    expect(entries.map(e => e.homeSessionId)).toEqual(['homeA', 'homeB'])
  })

  it('ignores unpinned terminals and non-terminal tabs in other sessions', () => {
    let home = makeDefaultState()
    home = openTabInActivePane(home, { id: 'terminal:unpinned', type: 'terminal', title: 'U' })
    home = openTabInActivePane(home, { id: 'editor:1', type: 'editor', title: 'E', path: '/e' })
    home = setTabPin(home, 'editor:1', { scope: 'global' }) // defensive: pin only targets terminals
    home = openTabInActivePane(home, { id: 'terminal:pinned', type: 'terminal', title: 'P' })
    home = setTabPin(home, 'terminal:pinned', { scope: 'global' })
    const bySession = new Map<string, SidebarState>([['home', home]])
    const entries = collectPinnedTabs(bySession, viewer('viewer', '/p'))
    expect(entries.map(e => e.tab.id)).toEqual(['terminal:pinned'])
  })
})

/**
 * Cross-session pinned-terminal resolution (v0.17.0+).
 *
 * A pinned terminal tab lives in its HOME session's state (the only
 * authoritative copy) — switching sessions never copies or projects it.
 * The PinnedRail renders the tabs OTHER sessions have pinned that should
 * surface in the CURRENT (viewer) session, so it needs a read-only
 * resolution pass over every cached session state.
 *
 * Visibility rule:
 *
 * | pin.scope | visible when |
 * |-----------|--------------|
 * | `global`  | any session (cwd-independent) |
 * | `workspace` | `viewer.cwd === tab.pin.homeCwd` (both undefined match; viewer.cwd unknown → conservative visible) |
 *
 * The "viewer.cwd unknown → visible" branch is intentional: during
 * hydration the session summary may carry no cwd yet, and hiding pinned
 * workspace tabs on first paint would flash them away. Once the cwd
 * resolves, the next store notify re-runs the resolver with the real cwd.
 *
 * The viewer's OWN session is excluded: its pinned tabs are already on its
 * tab strip, so rendering them again in the rail would double-show. Tabs
 * whose `pin` field is missing or whose `type` is not `'terminal'` are
 * ignored — only terminal tabs can be pinned.
 */
import type { SidebarState, SidebarTab } from './state.ts'

/** A pinned terminal surfaced to the viewer, paired with its home session. */
export interface PinnedTabEntry {
  tab: SidebarTab
  homeSessionId: string
}

/** A viewer's session identity for visibility resolution. */
export interface PinnedViewer {
  sessionId: string
  cwd: string | undefined
}

/**
 * Whether a pinned tab is visible to the viewer session. Conservative on
 * unknown cwd: a `workspace` pin with no `homeCwd` is visible everywhere
 * (the pin was set before the home session's cwd resolved), and a viewer
 * whose cwd is unknown sees every workspace pin (avoids hydration flash).
 */
export function pinnedVisibleTo(tab: SidebarTab, viewer: PinnedViewer): boolean {
  const pin = tab.pin
  if (pin === undefined) return false
  if (pin.scope === 'global') return true
  // workspace scope
  const home = pin.homeCwd
  if (home === undefined) return true
  if (viewer.cwd === undefined) return true
  return viewer.cwd === home
}

/**
 * Collect every pinned terminal visible to the viewer across ALL cached
 * session states. Excludes the viewer's own session (those tabs are on its
 * own strip). Order is stable: sessions in the cache's insertion order,
 * tabs in tree order (splits → bottomSplits → floats) within each session
 * — the order tabs were opened/pinned, so the rail never reorders between
 * renders.
 */
export function collectPinnedTabs(
  bySession: ReadonlyMap<string, SidebarState>,
  viewer: PinnedViewer,
): PinnedTabEntry[] {
  const entries: PinnedTabEntry[] = []
  for (const [homeSessionId, state] of bySession) {
    if (homeSessionId === viewer.sessionId) continue
    collectFromTree(state.splits, homeSessionId, viewer, entries)
    collectFromTree(state.bottomSplits, homeSessionId, viewer, entries)
    for (const float of state.floats) {
      if (float.tab.type === 'terminal' && pinnedVisibleTo(float.tab, viewer)) {
        entries.push({ tab: float.tab, homeSessionId })
      }
    }
  }
  return entries
}

/** Walk one split tree depth-first, collecting visible pinned terminals. */
function collectFromTree(
  node: SidebarState['splits'],
  homeSessionId: string,
  viewer: PinnedViewer,
  out: PinnedTabEntry[],
): void {
  if (node.kind === 'leaf') {
    for (const tab of node.tabs) {
      if (tab.type === 'terminal' && pinnedVisibleTo(tab, viewer)) {
        out.push({ tab, homeSessionId })
      }
    }
    return
  }
  for (const child of node.children) collectFromTree(child, homeSessionId, viewer, out)
}

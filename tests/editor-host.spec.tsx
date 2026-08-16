/**
 * Merged-mode EditorHost (the editorExplorer pref): the seeded path-less
 * "Files" home tab renders the empty-state hint (never the viewer loading
 * flow) with the tree panel open, and the header's tree toggle persists its
 * flag through ctx.betterSidebar.updateTab (meta.treeOpen rides the tab's
 * persisted layout).
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { Context } from '../src/context-types.ts'
import { EditorHost } from '../src/client/EditorHost.tsx'
import { createBetterSidebarService } from '../src/client/service.ts'
import { allLeaves, createSidebarStore, type SidebarTab } from '../src/client/state.ts'

// The act() environment flag (React 18.2 reads it before flushing effects).
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** A store with the seeded editor-home tab (default prefs: merged mode on). */
function setup(): {
  store: ReturnType<typeof createSidebarStore>
  ctx: Context
  homeTab: () => SidebarTab
} {
  const store = createSidebarStore()
  const service = createBetterSidebarService(store)
  store.setSession('editor-home-session')
  const homeTab = (): SidebarTab =>
    allLeaves(store.getSnapshot().state!.splits).flatMap(leaf => leaf.tabs)
      .find(tab => tab.type === 'editor')!
  return { store, ctx: { betterSidebar: service } as unknown as Context, homeTab }
}

/** Mount the host for one tab; returns the container and an unmount helper. */
function mountHost(ctx: Context, store: ReturnType<typeof createSidebarStore>, tab: () => SidebarTab): {
  container: HTMLDivElement
  rerender: () => void
  unmount: () => void
} {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = (): void => {
    root.render(createElement(EditorHost, {
      ctx,
      store,
      scope: { sessionId: 'editor-home-session' },
      tab: tab(),
      expanded: [],
      onToggleDir: () => {},
      onOpenFile: () => {},
      onReferenceFile: () => {},
    }))
  }
  act(render)
  return {
    container,
    // The real app re-renders the host with the fresh tab on every store
    // change (Sidebar subscribes); mirror that after mutating the store.
    rerender: () => { act(render) },
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

describe('EditorHost merged mode (editorExplorer on)', () => {
  it('a path-less tab renders the empty-state hint with the tree panel open', () => {
    const { store, ctx, homeTab } = setup()
    const { container, unmount } = mountHost(ctx, store, homeTab)
    try {
      const html = container.innerHTML
      // The empty-state hint renders instead of the viewer loading flow.
      expect(html).toContain('Pick a file from the tree panel')
      expect(html).not.toContain('Loading…')
      // The header carries the path input and the pressed tree toggle; the
      // docked panel (search box) is open by default for path-less tabs.
      expect(container.querySelector('input')).not.toBeNull()
      const toggle = container.querySelector('button[aria-pressed]')
      expect(toggle?.getAttribute('aria-pressed')).toBe('true')
      // No cwd: the embedded tree renders its no-session placeholder
      // instead of touching the network.
      expect(html).toContain('Select a conversation')
    } finally {
      unmount()
    }
  })

  it('the tree toggle persists meta.treeOpen through updateTab', () => {
    const { store, ctx, homeTab } = setup()
    expect(homeTab().meta).toEqual({ treeOpen: true })
    const { container, rerender, unmount } = mountHost(ctx, store, homeTab)
    try {
      act(() => {
        container.querySelector('button[aria-pressed]')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(homeTab().meta).toEqual({ treeOpen: false })
      // The store change re-renders the host with the fresh tab (Sidebar's
      // subscription in the real app); the second click flips it back.
      rerender()
      expect(container.querySelector('button[aria-pressed]')?.getAttribute('aria-pressed')).toBe('false')
      act(() => {
        container.querySelector('button[aria-pressed]')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(homeTab().meta).toEqual({ treeOpen: true })
    } finally {
      unmount()
    }
  })

  it('merged mode off restores the plain header (no path input, no tree)', () => {
    const { store, ctx, homeTab } = setup()
    store.setPrefs({ ...store.getPrefs(), editorExplorer: false })
    const { container, unmount } = mountHost(ctx, store, homeTab)
    try {
      // The plain editor shows the title span; no path input, no toggle.
      expect(container.querySelector('input')).toBeNull()
      expect(container.querySelector('button[aria-pressed]')).toBeNull()
      expect(container.innerHTML).toContain('Files')
    } finally {
      unmount()
    }
  })
})

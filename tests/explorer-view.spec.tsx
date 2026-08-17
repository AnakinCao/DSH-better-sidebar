/**
 * The explorer tab's two presentations of the merged tree surface: with the
 * editorExplorer pref on (default) the tab IS the tree window (the shared
 * TreePanel with its global search box fills the body — no legacy header);
 * off restores the pre-merge shell (root basename header + refresh + tree).
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// The act() environment flag (React 18.2 reads it before flushing effects).
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
import { ExplorerView } from '../src/client/ExplorerView.tsx'
import { createSidebarStore } from '../src/client/state.ts'

/** Mount the explorer tab; cwd stays undefined so the tree never fetches. */
function mount(node: ReactNode): { container: HTMLDivElement; unmount: () => void } {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  act(() => { root.render(node) })
  return {
    container,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

function view(store: ReturnType<typeof createSidebarStore>): ReactNode {
  return createElement(ExplorerView, {
    store,
    sessionId: 's1',
    cwd: undefined,
    expanded: [],
    onToggle: () => {},
    onOpenFile: () => {},
    onReferenceFile: () => {},
  })
}

describe('ExplorerView merged presentation', () => {
  it('merged mode (default): the tree window fills the tab (search box, no legacy header)', () => {
    const store = createSidebarStore()
    const { container, unmount } = mount(view(store))
    try {
      // The TreePanel search box renders (the legacy shell has no input).
      expect(container.querySelector('input')?.getAttribute('placeholder')).toBe('Search files by name…')
      // No cwd: the embedded tree renders its no-session placeholder.
      expect(container.textContent).toContain('Select a conversation')
    } finally {
      unmount()
    }
  })

  it('merged mode off: the pre-merge header (root basename + refresh) returns', () => {
    const store = createSidebarStore()
    store.setPrefs({ ...store.getPrefs(), editorExplorer: false })
    const { container, unmount } = mount(view(store))
    try {
      // The legacy shell: no search input, the header span carries the cwd
      // tooltip (undefined cwd renders the no-session label).
      expect(container.querySelector('input')).toBeNull()
      expect(container.textContent).toContain('Select a conversation')
    } finally {
      unmount()
    }
  })
})

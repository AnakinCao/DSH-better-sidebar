/**
 * PinnedRail component tests (v0.17.0+). The rail is a pure presentation
 * component: it renders the entries passed to it and fires callbacks. The
 * cross-session resolution (collectPinnedTabs) and the jump-back effect are
 * tested elsewhere (pinned.spec.ts, state.spec.ts). These tests cover the
 * rail's render conditions, tooltip, click/focus, right-click menu, and
 * middle-click close.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { PinnedRail } from '../src/client/PinnedRail.tsx'
import type { PinnedTabEntry } from '../src/client/pinned.ts'

/** Point the browser-language fallback at Chinese so the labels assert. */
function stubZh(): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { language: 'zh-CN' },
    configurable: true,
  })
}

function makeEntry(overrides: Partial<PinnedTabEntry> & { tabId?: string } = {}): PinnedTabEntry {
  const tabId = overrides.tabId ?? 'terminal:1'
  return {
    tab: {
      id: tabId,
      type: 'terminal',
      title: 'My Terminal',
      pin: { scope: 'global' },
      ...(overrides.tab?.pin ? { pin: overrides.tab.pin } : {}),
    },
    homeSessionId: 'home-session',
    ...overrides,
  } as PinnedTabEntry
}

function mountRail(entries: readonly PinnedTabEntry[]): {
  rail: HTMLElement | null
  entryEls: HTMLElement[]
  onFocus: ReturnType<typeof vi.fn>
  onUnpin: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
  unmount: () => void
} {
  const container = document.createElement('div')
  document.body.append(container)
  const onFocus = vi.fn()
  const onUnpin = vi.fn()
  const onClose = vi.fn()
  const root: Root = createRoot(container)
  act(() => {
    root.render(createElement(PinnedRail, { entries, onFocus, onUnpin, onClose }))
  })
  const rail = container.querySelector<HTMLElement>('[data-dsh-pinned-rail]')
  const entryEls = [...container.querySelectorAll<HTMLElement>('[data-dsh-pinned-tab]')]
  return { rail, entryEls, onFocus, onUnpin, onClose, unmount: () => { act(() => { root.unmount() }); container.remove() } }
}

/** The portaled menu rows (empty when the menu is closed). */
function menuItems(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('PinnedRail', () => {
  it('renders nothing when there are no entries', () => {
    stubZh()
    const { rail } = mountRail([])
    expect(rail).toBeNull()
  })

  it('renders the label and one entry per pinned tab with a tooltip', () => {
    stubZh()
    const entries = [
      makeEntry({ tabId: 'terminal:1' }),
      makeEntry({ tabId: 'terminal:2', tab: { id: 'terminal:2', type: 'terminal', title: 'T2', pin: { scope: 'workspace', homeCwd: '/proj' } } }),
    ]
    const { rail, entryEls } = mountRail(entries)
    expect(rail).not.toBeNull()
    expect(entryEls).toHaveLength(2)
    // The label is present.
    expect(rail!.textContent).toContain('固定终端')
    // The tooltip carries the kind/scope/cwd info.
    expect(entryEls[0]!.title).toContain('UI 终端')
    expect(entryEls[0]!.title).toContain('固定到全局')
    expect(entryEls[1]!.title).toContain('固定到工作区')
    expect(entryEls[1]!.title).toContain('/proj')
  })

  it('uses the Agent label for agent terminal tabs', () => {
    stubZh()
    const entries = [makeEntry({ tabId: 'agent:abc-123', tab: { id: 'agent:abc-123', type: 'terminal', title: 'Agent T', pin: { scope: 'global' } } })]
    const { entryEls } = mountRail(entries)
    expect(entryEls[0]!.title).toContain('Agent 终端')
  })

  it('click fires onFocus with the home session id and tab id', () => {
    stubZh()
    const entries = [makeEntry({ tabId: 'terminal:1', homeSessionId: 'home-A' })]
    const { entryEls, onFocus, unmount } = mountRail(entries)
    try {
      act(() => { entryEls[0]!.click() })
      expect(onFocus).toHaveBeenCalledTimes(1)
      expect(onFocus).toHaveBeenCalledWith('home-A', 'terminal:1')
    } finally {
      unmount()
    }
  })

  it('right-click opens a menu with Unpin and Close, and clicking Unpin fires onUnpin', () => {
    stubZh()
    const entries = [makeEntry({ tabId: 'terminal:1', homeSessionId: 'home-A' })]
    const { entryEls, onUnpin, unmount } = mountRail(entries)
    try {
      act(() => {
        entryEls[0]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 30 }))
      })
      expect(menuItems().map(item => item.textContent)).toEqual(['取消固定', '关闭终端'])
      act(() => { menuItems()[0]!.click() })
      expect(onUnpin).toHaveBeenCalledWith('home-A', 'terminal:1')
    } finally {
      unmount()
    }
  })

  it('right-click Close fires onClose with the home session id and tab id', () => {
    stubZh()
    const entries = [makeEntry({ tabId: 'terminal:1', homeSessionId: 'home-A' })]
    const { entryEls, onClose, unmount } = mountRail(entries)
    try {
      act(() => {
        entryEls[0]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 30 }))
      })
      act(() => { menuItems()[1]!.click() })
      expect(onClose).toHaveBeenCalledWith('home-A', 'terminal:1')
    } finally {
      unmount()
    }
  })

  it('the per-entry X button fires onClose and stops propagation (no focus)', () => {
    stubZh()
    const entries = [makeEntry({ tabId: 'terminal:1', homeSessionId: 'home-A' })]
    const { entryEls, onFocus, onClose, unmount } = mountRail(entries)
    try {
      const closeBtn = entryEls[0]!.querySelector<HTMLButtonElement>('[class*="pinnedTabClose"]')!
      act(() => { closeBtn.click() })
      expect(onClose).toHaveBeenCalledWith('home-A', 'terminal:1')
      expect(onFocus).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })

  it('middle-click close fires onClose (release on the same entry)', () => {
    stubZh()
    const entries = [makeEntry({ tabId: 'terminal:1', homeSessionId: 'home-A' })]
    const { entryEls, onClose, unmount } = mountRail(entries)
    try {
      act(() => {
        entryEls[0]!.dispatchEvent(new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true }))
      })
      act(() => {
        // mouseup must land on the pressed entry's node.
        entryEls[0]!.dispatchEvent(new MouseEvent('mouseup', { button: 1, bubbles: true }))
      })
      expect(onClose).toHaveBeenCalledWith('home-A', 'terminal:1')
    } finally {
      unmount()
    }
  })

  it('middle-click press then release elsewhere cancels the close', () => {
    stubZh()
    const entries = [makeEntry({ tabId: 'terminal:1', homeSessionId: 'home-A' })]
    const { entryEls, onClose, unmount } = mountRail(entries)
    try {
      act(() => {
        entryEls[0]!.dispatchEvent(new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true }))
      })
      act(() => {
        // Release on a different target (document.body, not the entry).
        document.body.dispatchEvent(new MouseEvent('mouseup', { button: 1, bubbles: true }))
      })
      expect(onClose).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })
})

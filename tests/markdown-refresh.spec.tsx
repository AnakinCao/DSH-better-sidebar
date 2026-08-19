/**
 * Markdown freshness behavior: clean previews follow an external edit, while
 * dirty previews keep the user's draft until an explicit confirmed refresh.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { Context } from '../src/context-types.ts'
import { EditorHost } from '../src/client/EditorHost.tsx'
import { api } from '../src/client/api.ts'
import { createBetterSidebarService, type FileViewerProps } from '../src/client/service.ts'
import { allLeaves, createSidebarStore, type SidebarTab } from '../src/client/state.ts'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function toolbar(dirty: boolean) {
  return {
    modes: true,
    mode: 'preview' as const,
    dirty,
    editable: true,
    saveState: 'idle' as const,
  }
}

let markDirty: (() => void) | undefined

/** A tiny viewer that exposes the host toolbar and renders the loaded source. */
function FakeMarkdownViewer(props: FileViewerProps) {
  useEffect(() => {
    props.onToolbarControls?.({ setMode: () => {}, save: () => {} })
    props.onToolbarState?.(toolbar(false))
    markDirty = () => { props.onToolbarState?.(toolbar(true)) }
    return () => {
      markDirty = undefined
      props.onToolbarControls?.(null)
    }
  }, [props.onToolbarControls, props.onToolbarState])
  return createElement('div', { 'data-testid': 'markdown-content' }, props.content ?? '')
}

function setup(): {
  store: ReturnType<typeof createSidebarStore>
  ctx: Context
  tab: SidebarTab
} {
  const store = createSidebarStore()
  const service = createBetterSidebarService(store)
  service.registerTab({ id: 'editor', title: 'Editor', component: () => null })
  service.registerFileViewer({
    id: 'markdown',
    exts: ['md'],
    fetchStrategy: 'fsRead',
    component: FakeMarkdownViewer,
  })
  store.setSession('markdown-refresh-session')
  const home = allLeaves(store.getSnapshot().state!.splits)
    .flatMap(leaf => leaf.tabs)
    .find(candidate => candidate.type === 'editor')!
  const tab: SidebarTab = { ...home, path: '/tmp/notes.md', title: 'notes.md' }
  const ctx = { betterSidebar: service } as unknown as Context
  return { store, ctx, tab }
}

function mount(ctx: Context, store: ReturnType<typeof createSidebarStore>, tab: SidebarTab) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(EditorHost, {
      ctx,
      store,
      scope: { sessionId: 'markdown-refresh-session', cwd: '/tmp' },
      tab,
      expanded: [],
      onToggleDir: () => {},
      onReferenceFile: () => {},
      visible: true,
    }))
  })
  return {
    container,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

afterEach(() => {
  markDirty = undefined
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Markdown external refresh', () => {
  it('reloads a clean visible preview after the file version changes', async () => {
    vi.useFakeTimers()
    let disk = { content: 'before', version: { mtimeMs: 1, size: 6 } }
    const read = vi.spyOn(api, 'fsRead').mockImplementation(async () => ({
      kind: 'text', content: disk.content, truncated: false, version: disk.version,
    }))
    const stat = vi.spyOn(api, 'fsStat').mockImplementation(async () => ({ version: disk.version }))
    const { store, ctx, tab } = setup()
    const view = mount(ctx, store, tab)
    try {
      await flush()
      expect(view.container.querySelector('[data-testid="markdown-content"]')?.textContent).toBe('before')
      const initialReads = read.mock.calls.length
      disk = { content: 'after', version: { mtimeMs: 2, size: 5 } }
      await act(async () => {
        vi.advanceTimersByTime(1000)
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(stat).toHaveBeenCalled()
      expect(read.mock.calls.length).toBeGreaterThan(initialReads)
      expect(view.container.querySelector('[data-testid="markdown-content"]')?.textContent).toBe('after')
    } finally {
      view.unmount()
    }
  })

  it('keeps dirty content and requires confirmation before manual refresh', async () => {
    vi.useFakeTimers()
    let disk = { content: 'before', version: { mtimeMs: 1, size: 6 } }
    const read = vi.spyOn(api, 'fsRead').mockImplementation(async () => ({
      kind: 'text', content: disk.content, truncated: false, version: disk.version,
    }))
    vi.spyOn(api, 'fsStat').mockImplementation(async () => ({ version: disk.version }))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { store, ctx, tab } = setup()
    const view = mount(ctx, store, tab)
    try {
      await flush()
      expect(markDirty).toBeDefined()
      act(() => { markDirty?.() })
      await flush()
      const before = read.mock.calls.length
      disk = { content: 'external', version: { mtimeMs: 2, size: 8 } }
      await act(async () => {
        vi.advanceTimersByTime(1000)
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(view.container.querySelector('[data-testid="markdown-content"]')?.textContent).toBe('before')
      expect(view.container.textContent).toMatch(/文件已更新|File changed on disk/)

      const refresh = view.container.querySelector<HTMLButtonElement>('button[aria-label="刷新"], button[aria-label="Refresh"]')
      expect(refresh).not.toBeNull()
      act(() => { refresh!.click() })
      await flush()
      expect(confirm).toHaveBeenCalled()
      expect(read.mock.calls.length).toBe(before)

      confirm.mockReturnValue(true)
      act(() => { refresh!.click() })
      await flush()
      expect(read.mock.calls.length).toBeGreaterThan(before)
      expect(view.container.querySelector('[data-testid="markdown-content"]')?.textContent).toBe('external')
    } finally {
      view.unmount()
    }
  })
})

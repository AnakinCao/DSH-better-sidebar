/**
 * The editor tab host: resolves a file's previewer through the sidebar
 * registry (`matchFileViewer`), fetches bytes per the matched viewer's
 * fetch strategy, and renders its component — or the shared download pane
 * when nothing can render the file.
 *
 * Two modes, gated by the `editorExplorer` pref (read reactively off the
 * store so toggling it re-renders without a reload):
 * - OFF: the plain editor — a single-title header and the viewer body
 *   (exactly the pre-merge layout).
 * - ON (merged mode): the header is a PATH INPUT (Enter opens the typed
 *   path, Esc/blur restores) plus a tree-panel toggle, and a fixed-width
 *   file tree docks at the tab's right edge (search box on top: empty query
 *   shows the shared FileTree, a query shows a flat global name search).
 *   A tab without a path (the seeded "Files" home) renders an empty-state
 *   hint instead of the viewer loading flow. Every open still funnels
 *   through `openSidebarFile` (the descriptor's per-path dedupe) — this
 *   tab's own path never retargets in place.
 *
 * The strategy dispatch is pure (planFirstMatch / planFsReadOutcome in
 * editor-load.ts); this component only wires it to the host APIs.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { createElement } from 'react'
import clsx from 'clsx'
import { IconFolderOpen16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '../context-types.ts'
import { api, mediaUrl, type SessionScope } from './api.ts'
import { BinaryDownload } from './binary-download.tsx'
import { planFirstMatch, planFsReadOutcome, type EditorLoadAction } from './editor-load.ts'
import { FileTree } from './FileTree.tsx'
import { t } from './locales.ts'
import { relativeTo } from './paths.ts'
import { resolveSidebarPath } from './produced-files.ts'
import type { FileViewerDescriptor } from './service.ts'
import type { SidebarStore, SidebarTab } from './state.ts'
import css from './sidebar.module.css'

type EditorLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; viewer: FileViewerDescriptor; content?: string; truncated?: boolean; mediaUrl?: string; customData?: unknown }
  | { status: 'binary' }

/** Read the persisted tree-panel flag of one editor tab: an explicit
 *  boolean meta wins; otherwise path-less tabs (the seeded home) default
 *  open and file tabs default closed. A malformed meta is ignored. */
function treeOpenOf(tab: SidebarTab): boolean {
  const meta = tab.meta !== null && typeof tab.meta === 'object' && !Array.isArray(tab.meta)
    ? tab.meta as Record<string, unknown>
    : undefined
  return typeof meta?.treeOpen === 'boolean' ? meta.treeOpen : (tab.path === undefined || tab.path === '')
}

export function EditorHost(props: {
  ctx: Context
  store: SidebarStore
  scope: SessionScope
  tab: SidebarTab
  expanded: string[]
  onToggleDir: (path: string) => void
  onOpenFile: (path: string) => void
  onReferenceFile: (path: string) => void
}) {
  const { ctx, store, scope, tab, expanded, onToggleDir, onOpenFile, onReferenceFile } = props
  const path = tab.path ?? ''
  const title = tab.title
  const [load, setLoad] = useState<EditorLoad>({ status: 'loading' })

  // Reactive prefs read: flipping editorExplorer in the settings re-renders
  // this tab (in and out of merged mode) with no reload. The snapshot is the
  // bare boolean so unrelated store churn never re-renders the editor.
  const merged = useSyncExternalStore(
    useCallback((callback: () => void) => store.subscribe(callback), [store]),
    useCallback(() => store.getSnapshot().prefs.editorExplorer, [store]),
  )
  // A path-less tab (the seeded home) shows the empty-state hint in BOTH
  // modes — the user may have disabled merged mode after the seed landed.
  const showEmpty = path === ''

  useEffect(() => {
    // The seeded home tab (no path) never loads a viewer — the empty-state
    // hint renders until the user picks a file (which opens a NEW editor
    // tab through the per-path dedupe).
    if (showEmpty) return
    let cancelled = false
    // Aborts the matched viewer's `load` when the editor tears down (tab
    // closed, path changed, session switched) or re-matches the viewer.
    const controller = new AbortController()
    setLoad({ status: 'loading' })
    const mediaUrlOf = (): string => mediaUrl(scope, path)
    const apply = (action: EditorLoadAction): void => {
      if (cancelled) return
      switch (action.kind) {
        case 'binary':
          setLoad({ status: 'binary' })
          return
        case 'render':
          setLoad({
            status: 'ready',
            viewer: action.viewer,
            content: action.content,
            truncated: action.truncated,
            mediaUrl: action.mediaUrl,
            customData: action.customData,
          })
          return
        case 'customLoad':
          void action.viewer.load?.(path, scope, controller.signal).then((data) => {
            if (cancelled) return
            setLoad({ status: 'ready', viewer: action.viewer, customData: data })
          }).catch((error: unknown) => {
            if (cancelled) return
            setLoad({ status: 'error', message: error instanceof Error ? error.message : String(error) })
          })
          return
        case 'fetchFsRead':
          api.fsRead(scope, path).then((result) => {
            if (cancelled) return
            // Binary reads carry the head bytes for the detect re-match.
            const outcome = planFsReadOutcome(action.viewer, {
              binary: result.kind === 'binary',
              content: result.kind === 'text' ? result.content : '',
              truncated: result.truncated,
              head: result.kind === 'binary' ? result.head : undefined,
            }, (head) => ctx.betterSidebar?.matchFileViewer(path, head), mediaUrlOf)
            apply(outcome)
          }).catch((error: unknown) => {
            if (cancelled) return
            setLoad({ status: 'error', message: error instanceof Error ? error.message : String(error) })
          })
          return
      }
    }
    apply(planFirstMatch(ctx.betterSidebar?.matchFileViewer(path), mediaUrlOf))
    return () => { cancelled = true; controller.abort() }
  }, [scope.sessionId, scope.cwd, path, ctx, showEmpty])

  if (!merged) {
    // The plain editor: the pre-merge layout, untouched.
    return (
      <div className={css.editor}>
        <div className={css.editorHeader}>
          <span className={css.editorTitle} title={path}>{title}</span>
        </div>
        {showEmpty && <div className={css.editorPlaceholder}>{t('editorEmptyHint')}</div>}
        {!showEmpty && load.status === 'loading' && <div className={css.editorPlaceholder}>{t('loading')}</div>}
        {!showEmpty && load.status === 'error' && <div className={css.editorError}>{load.message}</div>}
        {!showEmpty && load.status === 'binary' && <BinaryDownload scope={scope} path={path} />}
        {!showEmpty && load.status === 'ready' && createElement(load.viewer.component, {
          ctx, store, scope, path, title,
          viewerId: load.viewer.id,
          content: load.content,
          truncated: load.truncated,
          mediaUrl: load.mediaUrl,
          customData: load.customData,
        })}
      </div>
    )
  }

  const treeOpen = treeOpenOf(tab)
  /** Persist the panel flag on the tab (survives reloads with the layout). */
  const toggleTree = (): void => {
    const meta = tab.meta !== null && typeof tab.meta === 'object' && !Array.isArray(tab.meta)
      ? tab.meta as Record<string, unknown>
      : {}
    ctx.betterSidebar?.updateTab(tab.id, { meta: { ...meta, treeOpen: !treeOpen } })
  }

  return (
    <div className={css.editor}>
      <div className={css.editorHeader}>
        <EditorPathInput path={path} cwd={scope.cwd} onOpenFile={onOpenFile} />
        <button
          type="button"
          className={clsx(css.iconButton, treeOpen && css.editorTreeToggleActive)}
          aria-label={t('editorTreeToggle')}
          title={t('editorTreeToggle')}
          aria-pressed={treeOpen}
          onClick={toggleTree}
        >
          <IconFolderOpen16 size={14} />
        </button>
      </div>
      <div className={css.editorBody}>
        <div className={css.editorMain}>
          {showEmpty && <div className={css.editorPlaceholder}>{t('editorEmptyHint')}</div>}
          {!showEmpty && load.status === 'loading' && <div className={css.editorPlaceholder}>{t('loading')}</div>}
          {!showEmpty && load.status === 'error' && <div className={css.editorError}>{load.message}</div>}
          {!showEmpty && load.status === 'binary' && <BinaryDownload scope={scope} path={path} />}
          {!showEmpty && load.status === 'ready' && createElement(load.viewer.component, {
            ctx, store, scope, path, title,
            viewerId: load.viewer.id,
            content: load.content,
            truncated: load.truncated,
            mediaUrl: load.mediaUrl,
            customData: load.customData,
          })}
        </div>
        {treeOpen && (
          <EditorTreePanel
            sessionId={scope.sessionId}
            cwd={scope.cwd}
            expanded={expanded}
            onToggle={onToggleDir}
            onOpenFile={onOpenFile}
            onReferenceFile={onReferenceFile}
          />
        )}
      </div>
    </div>
  )
}

/**
 * The merged-mode header's path input: shows the current file relative to
 * the session cwd (absolute when outside it). Enter resolves the typed path
 * (relative input joins onto the cwd — the same resolution `openSidebarFile`
 * uses) and opens it through the per-path dedupe; Escape/blur restores the
 * current value. Keyed by `path` from the parent so a newly opened file
 * reseeds the draft.
 */
function EditorPathInput(props: { path: string; cwd: string | undefined; onOpenFile: (path: string) => void }) {
  const { path, cwd, onOpenFile } = props
  const display = path === '' ? '' : relativeTo(cwd ?? '', path)
  const [value, setValue] = useState(display)

  const commit = (): void => {
    const input = value.trim()
    if (input === '' || input === display) {
      setValue(display)
      return
    }
    onOpenFile(resolveSidebarPath(cwd, input))
    // The open lands in a NEW/deduped editor tab — THIS tab's path stays,
    // so the input falls back to its own display value.
    setValue(display)
  }

  return (
    <input
      key={path}
      className={css.editorPathInput}
      value={value}
      placeholder={t('editorPathPlaceholder')}
      title={path}
      spellCheck={false}
      onChange={(event) => { setValue(event.target.value) }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        } else if (event.key === 'Escape') {
          setValue(display)
        }
      }}
      onBlur={() => { setValue(display) }}
    />
  )
}

/**
 * The merged-mode docked tree panel: a global file-name search box on top
 * (300ms debounce; an in-flight search is aborted by the next keystroke)
 * over either the shared controlled FileTree (empty query) or the flat
 * result list (relative paths, click opens through the per-path dedupe).
 */
function EditorTreePanel(props: {
  sessionId: string
  cwd: string | undefined
  expanded: string[]
  onToggle: (path: string) => void
  onOpenFile: (path: string) => void
  onReferenceFile: (path: string) => void
}) {
  const { sessionId, cwd, expanded, onToggle, onOpenFile, onReferenceFile } = props
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ matches: string[]; truncated: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const needle = query.trim()
  useEffect(() => {
    if (needle === '') {
      setResults(null)
      setError(null)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      api.fsSearch({ sessionId, cwd }, needle, controller.signal).then((found) => {
        setResults(found)
        setError(null)
      }).catch((failure: unknown) => {
        if (controller.signal.aborted) return
        setResults(null)
        setError(failure instanceof Error ? failure.message : String(failure))
      })
    }, 300)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [sessionId, cwd, needle])

  return (
    <div className={css.editorTreePanel}>
      <div className={css.editorTreeSearch}>
        <input
          className={css.editorSearchInput}
          value={query}
          placeholder={t('editorSearchPlaceholder')}
          spellCheck={false}
          onChange={(event) => { setQuery(event.target.value) }}
        />
      </div>
      {needle === '' ? (
        <FileTree
          sessionId={sessionId}
          cwd={cwd}
          expanded={expanded}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
          onReferenceFile={onReferenceFile}
          refreshTick={0}
        />
      ) : (
        <div className={css.explorerBody}>
          {error !== null && <div className={clsx(css.editorSearchHint, css.editorError)}>{error}</div>}
          {error === null && results === null && <div className={css.editorSearchHint}>{t('loading')}</div>}
          {error === null && results !== null && results.matches.length === 0 && (
            <div className={css.editorSearchHint}>{t('editorSearchNoResults')}</div>
          )}
          {error === null && results !== null && results.matches.map(rel => (
            <button
              key={rel}
              type="button"
              className={css.editorSearchResult}
              title={rel}
              onClick={() => { onOpenFile(resolveSidebarPath(cwd, rel)) }}
            >
              {rel}
            </button>
          ))}
          {error === null && results?.truncated === true && (
            <div className={css.editorSearchHint}>{t('editorSearchTruncated')}</div>
          )}
        </div>
      )}
    </div>
  )
}

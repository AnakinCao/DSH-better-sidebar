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
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createElement } from 'react'
import clsx from 'clsx'
import { IconCheckOutline16, IconFolderOpen16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '../context-types.ts'
import { api, mediaUrl, type SessionScope } from './api.ts'
import { BinaryDownload } from './binary-download.tsx'
import { planFirstMatch, planFsReadOutcome, type EditorLoadAction } from './editor-load.ts'
import { TreePanel } from './TreePanel.tsx'
import { t } from './locales.ts'
import { relativeTo } from './paths.ts'
import { resolveSidebarPath } from './produced-files.ts'
import type { EditorToolbarControls, EditorToolbarState, FileViewerDescriptor } from './service.ts'
import type { SidebarStore, SidebarTab } from './state.ts'
import css from './sidebar.module.css'

type EditorLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; viewer: FileViewerDescriptor; content?: string; truncated?: boolean; mediaUrl?: string; customData?: unknown }
  | { status: 'binary' }

/** The docked tree panel's width bounds (drag-resize clamps into them). */
const TREE_WIDTH_DEFAULT = 240
const TREE_WIDTH_MIN = 160
const TREE_WIDTH_MAX = 480

/** The tab's persisted meta object (a malformed meta reads as empty). */
function metaOf(tab: SidebarTab): Record<string, unknown> {
  return tab.meta !== null && typeof tab.meta === 'object' && !Array.isArray(tab.meta)
    ? tab.meta as Record<string, unknown>
    : {}
}

/** Read the persisted tree-panel flag of one editor tab: an explicit
 *  boolean meta wins; otherwise path-less tabs (the seeded home) default
 *  open and file tabs default closed. */
function treeOpenOf(tab: SidebarTab): boolean {
  const treeOpen = metaOf(tab).treeOpen
  return typeof treeOpen === 'boolean' ? treeOpen : (tab.path === undefined || tab.path === '')
}

/** Read the persisted tree-panel width (clamped; default 240). */
function treeWidthOf(tab: SidebarTab): number {
  const width = metaOf(tab).treeWidth
  return typeof width === 'number' && Number.isFinite(width)
    ? Math.min(TREE_WIDTH_MAX, Math.max(TREE_WIDTH_MIN, Math.round(width)))
    : TREE_WIDTH_DEFAULT
}

/** Merge a patch into the tab's persisted meta (rides the layout). */
function patchMeta(ctx: Context, tab: SidebarTab, patch: Record<string, unknown>): void {
  ctx.betterSidebar?.updateTab(tab.id, { meta: { ...metaOf(tab), ...patch } })
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

  // The viewer's toolbar, hoisted into THIS header in merged mode: the text
  // editor reports its state and registers its commands (both null/absent
  // for viewers without a toolbar — image, pdf, binary download).
  const [toolbar, setToolbar] = useState<EditorToolbarState | null>(null)
  const controlsRef = useRef<EditorToolbarControls | null>(null)
  const onToolbarState = useCallback((next: EditorToolbarState) => {
    setToolbar(prev => prev !== null && JSON.stringify(prev) === JSON.stringify(next) ? prev : next)
  }, [])
  const onToolbarControls = useCallback((controls: EditorToolbarControls | null) => {
    controlsRef.current = controls
  }, [])

  // The docked panel's drag-resize: local width while dragging, persisted
  // into meta.treeWidth on release.
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const treeWidth = dragWidth ?? treeWidthOf(tab)

  /** Start a panel-width drag from the resize handle (panel docks right, so
   *  dragging LEFT widens it). */
  const startResize = (event: React.PointerEvent): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = treeWidth
    const clamp = (value: number): number => Math.min(TREE_WIDTH_MAX, Math.max(TREE_WIDTH_MIN, Math.round(value)))
    const onMove = (move: PointerEvent): void => { setDragWidth(clamp(startWidth + (startX - move.clientX))) }
    const onUp = (up: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDragWidth(null)
      const finalWidth = clamp(startWidth + (startX - up.clientX))
      if (finalWidth !== treeWidthOf(tab)) patchMeta(ctx, tab, { treeWidth: finalWidth })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  useEffect(() => {
    // A (re)load or a path-less tab clears any hoisted toolbar state — the
    // fresh viewer re-registers its own.
    setToolbar(null)
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
  const toggleTree = (): void => { patchMeta(ctx, tab, { treeOpen: !treeOpen }) }
  const saveLabel = toolbar === null ? ''
    : toolbar.saveState === 'saving' ? t('loading')
      : toolbar.saveState === 'saved' ? t('saved')
        : toolbar.saveState === 'failed' ? t('saveFailed') : ''

  return (
    <div className={css.editor}>
      <div className={css.editorHeader}>
        <EditorPathInput path={path} cwd={scope.cwd} onOpenFile={onOpenFile} />
        {toolbar?.modes === true && (
          <div className={css.editorModeToggle}>
            <button
              type="button"
              className={clsx(css.editorModeButton, toolbar.mode === 'preview' && css.editorModeActive)}
              onClick={() => { controlsRef.current?.setMode('preview') }}
            >
              {t('preview')}
            </button>
            <button
              type="button"
              className={clsx(css.editorModeButton, toolbar.mode === 'edit' && css.editorModeActive)}
              onClick={() => { controlsRef.current?.setMode('edit') }}
            >
              {t('edit')}
            </button>
          </div>
        )}
        {toolbar?.dirty === true && <span className={css.dirtyDot} title={t('unsaved')} />}
        {toolbar?.editable === true && (
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('save')}
            title={`${t('save')} (Ctrl/Cmd+S)`}
            onClick={() => { controlsRef.current?.save() }}
          >
            <IconCheckOutline16 size={14} />
          </button>
        )}
        {saveLabel !== '' && (
          <span className={clsx(css.editorStatus, toolbar?.saveState === 'failed' && css.editorStatusError)}>{saveLabel}</span>
        )}
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
            // Merged mode hoists the viewer's toolbar into the header above.
            toolbar: 'host',
            onToolbarState,
            onToolbarControls,
          })}
        </div>
        {treeOpen && (
          <div className={css.editorTreeDock} style={{ width: treeWidth }}>
            <div
              className={css.editorTreeResize}
              role="separator"
              aria-orientation="vertical"
              aria-label={t('editorTreeToggle')}
              onPointerDown={startResize}
            />
            <TreePanel
              sessionId={scope.sessionId}
              cwd={scope.cwd}
              expanded={expanded}
              onToggle={onToggleDir}
              onOpenFile={onOpenFile}
              onReferenceFile={onReferenceFile}
            />
          </div>
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


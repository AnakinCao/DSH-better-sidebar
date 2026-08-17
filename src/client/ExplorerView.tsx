/**
 * The file explorer tab. Two presentations of the SAME merged tree surface:
 * - merged mode (the editorExplorer pref, default on): the tab IS the tree
 *   window — the shared TreePanel (global name search + FileTree + refresh)
 *   fills the body, the same component the editor docks as its side panel;
 * - plain mode: the pre-merge shell — a header (root basename + refresh)
 *   over the shared controlled FileTree.
 * Clicking a file opens an editor tab in both modes.
 */
import { useCallback, useState, useSyncExternalStore } from 'react'
import { IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { FileTree, baseName } from './FileTree.tsx'
import { TreePanel } from './TreePanel.tsx'
import { t } from './locales.ts'
import type { SidebarStore } from './state.ts'
import css from './sidebar.module.css'

export function ExplorerView(props: {
  store: SidebarStore
  sessionId: string
  cwd: string | undefined
  expanded: string[]
  onToggle: (path: string) => void
  onOpenFile: (path: string) => void
  /** Insert `@<relative path>` into the composer draft. */
  onReferenceFile: (path: string) => void
}) {
  const { store, sessionId, cwd, expanded, onToggle, onOpenFile, onReferenceFile } = props
  const [refreshTick, setRefreshTick] = useState(0)

  // Reactive pref read (boolean snapshot): flipping the merged mode in the
  // settings re-renders this tab with no reload.
  const merged = useSyncExternalStore(
    useCallback((callback: () => void) => store.subscribe(callback), [store]),
    useCallback(() => store.getSnapshot().prefs.editorExplorer, [store]),
  )

  if (merged) {
    return (
      <div className={css.explorer}>
        <TreePanel
          full
          sessionId={sessionId}
          cwd={cwd}
          expanded={expanded}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
          onReferenceFile={onReferenceFile}
        />
      </div>
    )
  }

  return (
    <div className={css.explorer}>
      <div className={css.explorerHeader}>
        <span className={css.explorerRoot} title={cwd}>{cwd === undefined ? t('noSession') : baseName(cwd)}</span>
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('refresh')}
          title={t('refresh')}
          onClick={() => { setRefreshTick(tick => tick + 1) }}
        >
          <IconRefreshOutline16 size={14} />
        </button>
      </div>
      <FileTree
        sessionId={sessionId}
        cwd={cwd}
        expanded={expanded}
        onToggle={onToggle}
        onOpenFile={onOpenFile}
        onReferenceFile={onReferenceFile}
        refreshTick={refreshTick}
      />
    </div>
  )
}

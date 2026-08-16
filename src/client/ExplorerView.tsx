/**
 * The file explorer tab: a thin shell over {@link FileTree} — the header
 * (root basename + refresh button) owns the refresh tick; the tree body
 * (lazy levels, context menu, @-reference buttons) lives in the shared
 * controlled component, also reused by the editor's merged-mode side panel.
 * Clicking a file opens an editor tab.
 */
import { useState } from 'react'
import { IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { FileTree, baseName } from './FileTree.tsx'
import { t } from './locales.ts'
import css from './sidebar.module.css'

export function ExplorerView(props: {
  sessionId: string
  cwd: string | undefined
  expanded: string[]
  onToggle: (path: string) => void
  onOpenFile: (path: string) => void
  /** Insert `@<relative path>` into the composer draft. */
  onReferenceFile: (path: string) => void
}) {
  const { sessionId, cwd, expanded, onToggle, onOpenFile, onReferenceFile } = props
  const [refreshTick, setRefreshTick] = useState(0)

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

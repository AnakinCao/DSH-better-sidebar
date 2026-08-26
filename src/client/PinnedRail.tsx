/**
 * The PinnedRail (v0.17.0+): a compact strip above the tab bar showing
 * terminal tabs pinned in OTHER sessions that should surface in the current
 * session (global pins, or workspace pins whose homeCwd matches the viewer's
 * cwd). The rail is the only cross-session surface — pinned tabs themselves
 * live in their home session's state (the authoritative copy), and the rail
 * just renders a clickable affordance to jump back to them.
 *
 * Click navigates to the home session and activates the tab (or raises its
 * free window). Right-click offers unpin / close; middle-click closes. The
 * rail hides itself when no pinned tabs are visible.
 */
import { useEffect, useRef, useState } from 'react'
import { IconCloseFill14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PinnedTabEntry } from './pinned.ts'
import { isAgentTabId } from './state.ts'
import { IconPinOutline16, IconTerminalOutline16 } from './icons.tsx'
import { t } from './locales.ts'
import css from './sidebar.module.css'

/** The kind label for the tooltip (UI vs Agent terminal). */
function kindLabel(tabId: string): string {
  return isAgentTabId(tabId) ? t('pinnedTerminalKindAgent') : t('pinnedTerminalKindUi')
}

/** The scope label for the tooltip. */
function scopeLabel(scope: 'workspace' | 'global'): string {
  return scope === 'global' ? t('pinnedTerminalScopeGlobal') : t('pinnedTerminalScopeWorkspace')
}

/** Build the tooltip string: "{kind} · {scope} · {cwd}". */
function tooltipOf(entry: PinnedTabEntry): string {
  const pin = entry.tab.pin
  if (pin === undefined) return entry.tab.title
  const cwd = pin.homeCwd ?? '—'
  return t('pinnedTerminalTooltip', {
    kind: kindLabel(entry.tab.id),
    scope: scopeLabel(pin.scope),
    cwd,
  })
}

export function PinnedRail(props: {
  entries: readonly PinnedTabEntry[]
  onFocus: (homeSessionId: string, tabId: string) => void
  onUnpin: (homeSessionId: string, tabId: string) => void
  onClose: (homeSessionId: string, tabId: string) => void
}) {
  const { entries, onFocus, onUnpin, onClose } = props
  const [menu, setMenu] = useState<{ homeSessionId: string; tabId: string; x: number; y: number } | null>(null)

  // Middle-click close (mirrors TabBar's middlePressed pattern): the press
  // target is recorded on middle mousedown (preventDefaulted to disarm
  // Chrome's autoscroll) and the close settles on the first middle mouseup
  // OVER that same entry. Release-position semantics match VS Code.
  const middlePressed = useRef<{ homeSessionId: string; tabId: string; node: HTMLElement } | null>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    const onMouseUp = (event: MouseEvent): void => {
      if (event.button !== 1) return
      const pressed = middlePressed.current
      middlePressed.current = null
      if (pressed !== null && pressed.node.isConnected && pressed.node.contains(event.target as Node)) {
        closeRef.current(pressed.homeSessionId, pressed.tabId)
      }
    }
    window.addEventListener('mouseup', onMouseUp)
    return () => { window.removeEventListener('mouseup', onMouseUp) }
  }, [])

  if (entries.length === 0) return null

  return (
    <div className={css.pinnedRail} data-dsh-pinned-rail>
      <span className={css.pinnedRailLabel}>{t('pinnedRailLabel')}</span>
      {entries.map(entry => (
        <div
          key={`${entry.homeSessionId}:${entry.tab.id}`}
          className={css.pinnedTab}
          data-dsh-pinned-tab={entry.tab.id}
          title={tooltipOf(entry)}
          onClick={() => { onFocus(entry.homeSessionId, entry.tab.id) }}
          onMouseDown={(event) => {
            if (event.button === 1) {
              event.preventDefault()
              middlePressed.current = { homeSessionId: entry.homeSessionId, tabId: entry.tab.id, node: event.currentTarget }
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            setMenu({ homeSessionId: entry.homeSessionId, tabId: entry.tab.id, x: event.clientX, y: event.clientY })
          }}
        >
          <IconPinOutline16 size={12} />
          <IconTerminalOutline16 size={14} />
          <span className={css.pinnedTabTitle}>{entry.tab.title}</span>
          <button
            type="button"
            className={css.pinnedTabClose}
            aria-label={t('closePinnedTerminal')}
            onClick={(event) => {
              event.stopPropagation()
              onClose(entry.homeSessionId, entry.tab.id)
            }}
          >
            <IconCloseFill14 />
          </button>
        </div>
      ))}
      <Menu
        open={menu !== null}
        onClose={() => { setMenu(null) }}
        items={[
          { id: 'unpin', label: t('unpinTerminal') },
          { id: 'close', label: t('closePinnedTerminal') },
        ]}
        onSelect={(id) => {
          const target = menu
          if (target === null) return
          setMenu(null)
          if (id === 'unpin') onUnpin(target.homeSessionId, target.tabId)
          else if (id === 'close') onClose(target.homeSessionId, target.tabId)
        }}
        portal
        align="start"
        getAnchorRect={() => (menu === null ? null : new DOMRect(menu.x, menu.y, 0, 0))}
        anchor={<span />}
      />
    </div>
  )
}

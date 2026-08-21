/**
 * Size written to `--dsh-sidebar-width` / `--dsh-sidebar-height`.
 * The conversation column (output + composer) must keep at least
 * {@link PANEL_MIN} of the viewport after the bottom panel claims height.
 */
import { BOTTOM_MIN, PANEL_MIN } from './state.ts'

export interface LayoutPushInput {
  narrow: boolean
  panelOpen: boolean
  bottomOpen: boolean
  width: number
  bottomHeight: number
  viewportWidth: number
  viewportHeight: number
}

export interface LayoutPushSize {
  width: number
  height: number
}

/** Compute the live layout-push size. Narrow drawers float and push 0. */
export function layoutPushSize(input: LayoutPushInput): LayoutPushSize {
  if (input.narrow) return { width: 0, height: 0 }
  const maxWidth = Math.max(PANEL_MIN, input.viewportWidth)
  const maxHeight = Math.max(BOTTOM_MIN, input.viewportHeight - PANEL_MIN)
  return {
    width: input.panelOpen ? Math.min(Math.max(0, input.width), maxWidth) : 0,
    height: input.bottomOpen ? Math.min(Math.max(0, input.bottomHeight), maxHeight) : 0,
  }
}

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/client/Sidebar.tsx', 'utf8')

describe('Sidebar layout-push integration', () => {
  it('does not bypass the shared bottom-height cap during width drags', () => {
    expect(source).not.toContain('Math.min(state.bottomHeight, window.innerHeight)')
    expect(source.match(/pushedBottomHeight\(/g)).toHaveLength(3)
  })

  it('caps panel geometry against the viewport visible above the keyboard', () => {
    expect(source).toContain('viewport.height - keyboardInset')
    expect(source.match(/viewportHeight: layoutViewportHeight/g)).toHaveLength(4)
    expect(source).toContain('viewport.width, layoutViewportHeight]')
  })
})

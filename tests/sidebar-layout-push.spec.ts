import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/client/Sidebar.tsx', 'utf8')

describe('Sidebar layout-push integration', () => {
  it('does not bypass the shared bottom-height cap during width drags', () => {
    expect(source).not.toContain('Math.min(state.bottomHeight, window.innerHeight)')
    expect(source.match(/pushedBottomHeight\(/g)).toHaveLength(3)
  })
})

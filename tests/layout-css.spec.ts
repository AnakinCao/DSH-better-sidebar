/**
 * layout.css must let the DSH conversation column shrink below its content
 * size. Without min-height:0 a long unbreakable URL grows the grid item
 * past the viewport and clips the composer.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/client/layout.css', 'utf8')

describe('layout.css conversation column', () => {
  it('targets the AppFrame center column', () => {
    expect(css).toContain('[data-pane="conversation"]')
    expect(css).toContain('[data-slot="conversation"]')
  })

  it('allows the center column to shrink and wrap long tokens', () => {
    expect(css).toMatch(/min-height:\s*0/)
    expect(css).toMatch(/overflow:\s*hidden/)
    expect(css).toMatch(/overflow-wrap:\s*anywhere/)
  })
})

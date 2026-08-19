import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseWorktreeList, resolveWorktree, status, worktrees } from '../src/git.ts'

const IDENTITY = {
  GIT_AUTHOR_NAME: 'dsh-better-sidebar-test',
  GIT_AUTHOR_EMAIL: 'test@dsh.invalid',
  GIT_COMMITTER_NAME: 'dsh-better-sidebar-test',
  GIT_COMMITTER_EMAIL: 'test@dsh.invalid',
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...IDENTITY },
  })
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`)
  return result.stdout
}

describe('linked Git worktrees', () => {
  it('parses porcelain records with spaces in checkout paths', () => {
    expect(parseWorktreeList([
      'worktree C:/repo/main checkout',
      'HEAD abc',
      'branch refs/heads/main',
      '',
      'worktree C:/repo/agent checkout',
      'HEAD def',
      'detached',
      '',
    ].join('\n'))).toEqual([
      { path: 'C:/repo/main checkout', branch: 'main' },
      { path: 'C:/repo/agent checkout', branch: 'HEAD' },
    ])
  })

  it('discovers dirty linked checkouts and fences selected targets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-sidebar-worktrees-'))
    const main = join(root, 'main')
    const agent = join(root, 'agent worktree')
    try {
      git(root, ['init', '-q', main])
      git(main, ['checkout', '-q', '-b', 'main'])
      writeFileSync(join(main, 'tracked.txt'), 'base\n')
      git(main, ['add', '-A'])
      git(main, ['commit', '-q', '-m', 'base'])
      git(main, ['worktree', 'add', '-q', '-b', 'agent', agent])
      writeFileSync(join(agent, 'tracked.txt'), 'changed by agent\n')

      const listed = await worktrees(main)
      expect(listed).toHaveLength(2)
      expect(listed.find(entry => entry.current)).toMatchObject({ branch: 'main', changes: 0 })
      expect(listed.find(entry => !entry.current)).toMatchObject({ branch: 'agent', changes: 1 })
      expect(resolve(await resolveWorktree(main, agent))).toBe(resolve(agent))
      expect((await status(await resolveWorktree(main, agent))).entries).toEqual([
        { path: 'tracked.txt', xy: ' M' },
      ])
      await expect(resolveWorktree(main, root)).rejects.toThrow('unknown linked worktree')
    } finally {
      try { git(main, ['worktree', 'remove', '--force', agent]) } catch { /* fixture may not be fully initialized */ }
      rmSync(root, { recursive: true, force: true })
    }
  })
})

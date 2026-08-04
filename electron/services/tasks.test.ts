import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectSummary } from '../../shared/types'
import { extractLocalUrl, isSafeLocalUrl, TaskManager } from './tasks'

function project(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'project-1',
    name: 'demo',
    path: '/tmp/demo',
    relativePath: 'demo',
    brands: ['ot888', 'rojs'],
    scripts: [
      { name: 'dev', command: 'node scripts/dev.js', brandAware: true },
      { name: 'build', command: 'vite build', brandAware: false },
    ],
    ...overrides,
  }
}

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    pid: number
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  child.pid = 4321
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn(() => true)
  return child
}

describe('TaskManager', () => {
  it('validates registry, brands, and one active command per project', () => {
    const child = fakeChild()
    const spawnTask = vi.fn(() => child)
    const manager = new TaskManager(spawnTask as never)
    manager.setProjects([project()])

    const first = manager.startTask({ projectId: 'project-1', script: 'dev', brand: 'rojs' })
    const duplicate = manager.startTask({ projectId: 'project-1', script: 'build' })

    expect(first.ok).toBe(true)
    expect(spawnTask).toHaveBeenCalledWith(
      'npm',
      ['run', 'dev', '--', 'rojs'],
      expect.objectContaining({ cwd: '/tmp/demo', shell: false }),
    )
    expect(duplicate.ok).toBe(false)
    expect(manager.startTask({ projectId: 'missing', script: 'dev' }).ok).toBe(false)
  })

  it('streams output, detects URL, and records successful completion', () => {
    const child = fakeChild()
    const manager = new TaskManager((() => child) as never)
    const logs: string[] = []
    manager.on('log', (log) => logs.push(log.text))
    manager.setProjects([project()])

    const result = manager.startTask({ projectId: 'project-1', script: 'build' })
    child.stdout.emit('data', 'Local: http://localhost:5173/\n')
    child.emit('close', 0, null)

    const task = manager.listTasks()[0]
    expect(result.ok).toBe(true)
    expect(task?.url).toBe('http://localhost:5173/')
    expect(task?.status).toBe('succeeded')
    expect(logs.join('')).toContain('任務完成')
  })
})

describe('local URL parsing', () => {
  it('extracts supported local URLs and rejects external URLs', () => {
    expect(extractLocalUrl('\u001b[32m➜ Local: http://127.0.0.1:3000/app\u001b[0m')).toBe(
      'http://127.0.0.1:3000/app',
    )
    expect(isSafeLocalUrl('https://localhost:3000')).toBe(true)
    expect(isSafeLocalUrl('https://example.com')).toBe(false)
  })
})

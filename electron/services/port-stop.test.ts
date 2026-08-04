import { describe, expect, it, vi } from 'vitest'
import type { PortRecord } from '../../shared/types'
import { applyStopPolicy, stopPidGracefully } from './port-stop'

function port(overrides: Partial<PortRecord> = {}): PortRecord {
  return {
    port: 3000,
    pid: 123,
    processName: 'node',
    processUser: 'developer',
    protocol: 'TCP',
    address: '127.0.0.1',
    state: 'LISTEN',
    category: 'project',
    projectName: 'demo-app',
    ...overrides,
  }
}

describe('safe port stop policy', () => {
  it('allows managed tasks and current-user workspace Node processes', () => {
    expect(applyStopPolicy(port({ taskId: 'task-1' }), 'developer')).toEqual(
      expect.objectContaining({ canStop: true, stopMode: 'managed' }),
    )
    expect(applyStopPolicy(port(), 'developer')).toEqual(
      expect.objectContaining({ canStop: true, stopMode: 'graceful' }),
    )
  })

  it('blocks system, other-user, workspace-external Node, and other applications', () => {
    expect(applyStopPolicy(port({ category: 'system' }), 'developer').canStop).toBe(false)
    expect(applyStopPolicy(port({ processUser: 'someone-else' }), 'developer').canStop).toBe(false)
    expect(applyStopPolicy(port({ category: 'node', projectName: undefined }), 'developer').canStop).toBe(false)
    expect(applyStopPolicy(port({ category: 'other', processName: 'Cursor' }), 'developer').canStop).toBe(false)
  })

  it('uses SIGTERM and reports success when the process exits', async () => {
    let alive = true
    const signal = vi.fn((_pid: number, requestedSignal: NodeJS.Signals | 0) => {
      if (requestedSignal === 'SIGTERM') alive = false
      if (requestedSignal === 0 && !alive) throw Object.assign(new Error('gone'), { code: 'ESRCH' })
    })
    const result = await stopPidGracefully(123, {
      signal,
      wait: async () => undefined,
      attempts: 2,
      intervalMs: 0,
    })

    expect(result.ok).toBe(true)
    expect(signal).toHaveBeenCalledWith(123, 'SIGTERM')
    expect(signal).not.toHaveBeenCalledWith(123, 'SIGKILL')
  })

  it('never escalates to SIGKILL when a process ignores SIGTERM', async () => {
    const signal = vi.fn()
    const result = await stopPidGracefully(123, {
      signal,
      wait: async () => undefined,
      attempts: 2,
      intervalMs: 0,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('不會強制終止')
    expect(signal).not.toHaveBeenCalledWith(123, 'SIGKILL')
  })
})

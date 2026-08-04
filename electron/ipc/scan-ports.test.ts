import { describe, expect, it } from 'vitest'
import { runScanPorts } from './scan-ports'

describe('runScanPorts', () => {
  it('keeps successful scanner payload structure', async () => {
    const result = await runScanPorts(async () => ({
      ok: true,
      data: [
        {
          port: 5173,
          pid: 999,
          processName: 'vite',
          protocol: 'TCP',
          address: '127.0.0.1',
          state: 'LISTEN',
        },
      ],
    }))

    expect(result.ok).toBe(true)
    expect(Array.isArray(result.data)).toBe(true)
    expect(result.data[0]?.port).toBe(5173)
  })

  it('converts thrown errors into stable IPC response', async () => {
    const result = await runScanPorts(async () => {
      throw new Error('boom')
    })

    expect(result.ok).toBe(false)
    expect(result.data).toEqual([])
    expect(result.error).toContain('掃描失敗')
  })
})

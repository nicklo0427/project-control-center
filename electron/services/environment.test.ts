import { describe, expect, it, vi } from 'vitest'
import { collectEnvironmentDiagnostics, type EnvironmentRuntime } from './environment'

function runtime(overrides: Partial<EnvironmentRuntime> = {}): Partial<EnvironmentRuntime> {
  return {
    platform: 'darwin',
    architecture: 'arm64',
    osVersion: '24.6.0',
    pathValue: '/opt/homebrew/bin:/usr/bin',
    electronVersion: '43.2.0',
    bundledNodeVersion: '24.14.0',
    executableExists: vi.fn(async (executable: string) => [
      '/opt/homebrew/bin/node', '/opt/homebrew/bin/npm', '/usr/sbin/lsof', '/bin/ps',
    ].includes(executable)),
    commandVersion: vi.fn(async (executable: string) => executable.endsWith('npm') ? '11.8.0' : 'v22.14.0'),
    ...overrides,
  }
}

describe('environment diagnostics', () => {
  it('reports a healthy macOS Node toolchain', async () => {
    const result = await collectEnvironmentDiagnostics('1.0.0', '/opt/homebrew/bin/npm', runtime())

    expect(result).toMatchObject({ appVersion: '1.0.0', platform: 'darwin', architecture: 'arm64' })
    expect(result.checks.every((item) => item.status === 'ok')).toBe(true)
    expect(result.checks.find((item) => item.key === 'node')?.value).toContain('/opt/homebrew/bin/node')
  })

  it('provides repair guidance when tools are unavailable', async () => {
    const result = await collectEnvironmentDiagnostics('1.0.0', '/missing/npm', runtime({
      platform: 'linux',
      pathValue: '',
      executableExists: vi.fn(async () => false),
      commandVersion: vi.fn(async () => null),
    }))

    expect(result.checks.find((item) => item.key === 'platform')).toMatchObject({ status: 'error' })
    expect(result.checks.find((item) => item.key === 'node')?.message).toContain('安裝 Node.js LTS')
    expect(result.checks.find((item) => item.key === 'npm')?.status).toBe('error')
    expect(result.checks.find((item) => item.key === 'lsof')?.status).toBe('error')
    expect(result.checks.find((item) => item.key === 'ps')?.status).toBe('error')
  })
})

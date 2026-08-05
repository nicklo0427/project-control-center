import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const childProcessMocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock('node:child_process', () => childProcessMocks)

import afterSign, { notarizeAndStaple } from './notarize-macos.mjs'

const originalEnvironment = { ...process.env }

function successfulChild() {
  const child = new EventEmitter()
  queueMicrotask(() => child.emit('close', 0, null))
  return child
}

describe('macOS notarization helper', () => {
  beforeEach(() => {
    process.env.APPLE_API_KEY = '/tmp/AuthKey.p8'
    process.env.APPLE_API_KEY_ID = 'KEY1234567'
    process.env.APPLE_API_ISSUER = '00000000-0000-0000-0000-000000000000'

    childProcessMocks.spawn.mockImplementation(successfulChild)
    childProcessMocks.execFile.mockImplementation(
      (_command, args: string[], _options, callback) => {
        const response = args.includes('submit')
          ? { id: '11111111-1111-1111-1111-111111111111' }
          : { status: 'Accepted' }
        callback(null, JSON.stringify(response), '')
      },
    )
  })

  afterEach(() => {
    process.env = { ...originalEnvironment }
    vi.clearAllMocks()
  })

  it('records the submission, waits with a timeout, and staples the requested target', async () => {
    await expect(
      notarizeAndStaple('/tmp/Project.zip', {
        label: 'Project.app',
        staplePath: '/tmp/Project.app',
        timeout: '45m',
      }),
    ).resolves.toBe('11111111-1111-1111-1111-111111111111')

    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      'xcrun',
      expect.arrayContaining(['notarytool', 'wait', '11111111-1111-1111-1111-111111111111', '--timeout', '45m']),
      { stdio: 'inherit' },
    )
    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      'xcrun',
      ['stapler', 'staple', '/tmp/Project.app'],
      { stdio: 'inherit' },
    )
    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      'xcrun',
      ['stapler', 'validate', '/tmp/Project.app'],
      { stdio: 'inherit' },
    )
  })

  it('archives and staples the signed app from the electron-builder hook', async () => {
    await afterSign({
      electronPlatformName: 'darwin',
      appOutDir: '/tmp/mac-universal',
      packager: { appInfo: { productFilename: 'Project Control Center' } },
    })

    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      'ditto',
      expect.arrayContaining([
        '-c',
        '-k',
        '--keepParent',
        '/tmp/mac-universal/Project Control Center.app',
      ]),
      { stdio: 'inherit' },
    )
    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      'xcrun',
      ['stapler', 'staple', '/tmp/mac-universal/Project Control Center.app'],
      { stdio: 'inherit' },
    )
  })

  it('reports the submission ID and status when Apple rejects a file', async () => {
    childProcessMocks.execFile.mockImplementation(
      (_command, args: string[], _options, callback) => {
        const response = args.includes('submit')
          ? { id: '22222222-2222-2222-2222-222222222222' }
          : { status: 'Invalid' }
        callback(null, JSON.stringify(response), '')
      },
    )

    await expect(notarizeAndStaple('/tmp/Invalid.dmg')).rejects.toThrow(
      /Submission ID: 22222222-2222-2222-2222-222222222222; status: Invalid/,
    )
    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      'xcrun',
      expect.arrayContaining(['notarytool', 'log', '22222222-2222-2222-2222-222222222222']),
      { stdio: 'inherit' },
    )
  })

  it('fails before running system commands when credentials are missing', async () => {
    delete process.env.APPLE_API_KEY

    await expect(notarizeAndStaple('/tmp/Project.dmg')).rejects.toThrow(
      'Missing required environment variable: APPLE_API_KEY',
    )
    expect(childProcessMocks.execFile).not.toHaveBeenCalled()
    expect(childProcessMocks.spawn).not.toHaveBeenCalled()
  })
})

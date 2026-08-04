import { describe, expect, it } from 'vitest'
import {
  parseCwdOutput,
  parseLsofOutput,
  parsePsOutput,
  redactCommandLine,
  scanPorts,
} from './ports'

describe('parseLsofOutput', () => {
  it('parses, deduplicates, and sorts valid lsof rows', () => {
    const stdout = [
      'COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME',
      'node    12345 dev   22u  IPv4 0xabc      0t0  TCP *:3000 (LISTEN)',
      'node    12345 dev   23u  IPv4 0xabc      0t0  TCP *:3000 (LISTEN)',
      'nginx   77777 root  16u  IPv6 0xdef      0t0  TCP [::1]:8080 (LISTEN)',
    ].join('\n')

    const result = parseLsofOutput(stdout)

    expect(result).toEqual([
      {
        port: 3000,
        pid: 12345,
        processName: 'node',
        protocol: 'TCP',
        address: '0.0.0.0',
        state: 'LISTEN',
        processUser: 'dev',
      },
      {
        port: 8080,
        pid: 77777,
        processName: 'nginx',
        protocol: 'TCP',
        address: '::1',
        state: 'LISTEN',
        processUser: 'root',
      },
    ])
  })

  it('filters malformed rows and returns empty list safely', () => {
    const stdout = [
      'COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME',
      'malformed-line',
      'python 111 me 1u IPv4 0xabc 0t0 TCP localhost:http (LISTEN)',
    ].join('\n')

    const result = parseLsofOutput(stdout)
    expect(result).toEqual([])
  })
})

describe('process metadata', () => {
  it('parses ps rows while preserving commands with spaces', () => {
    const result = parsePsOutput('  123  100  123  01:02:03 node /workspace/server.js --port 3000\n')

    expect(result.get(123)).toEqual({
      pid: 123,
      parentPid: 100,
      processGroupId: 123,
      elapsedTime: '01:02:03',
      commandLine: 'node /workspace/server.js --port 3000',
    })
  })

  it('parses cwd field records for multiple processes', () => {
    const output = ['p123', 'fcwd', 'n/workspace/app', 'p456', 'fcwd', 'n/Users/dev'].join('\n')
    expect([...parseCwdOutput(output)]).toEqual([
      [123, '/workspace/app'],
      [456, '/Users/dev'],
    ])
  })

  it('redacts secrets in environment values, flags, and URLs', () => {
    const result = redactCommandLine(
      'node api.js TOKEN=plain --password secret --api-key=abc https://user:pass@example.test',
    )
    expect(result).toContain('TOKEN=[已隱藏]')
    expect(result).toContain('--password [已隱藏]')
    expect(result).toContain('--api-key=[已隱藏]')
    expect(result).toContain('https://user:[已隱藏]@example.test')
    expect(result).not.toContain('plain')
  })

  it('treats lsof exit code 1 with no listeners as an empty success', async () => {
    const result = await scanPorts(async () => {
      throw Object.assign(new Error('no matches'), { code: 1, stdout: '' })
    })
    expect(result).toEqual({ ok: true, data: [] })
  })

  it('keeps basic port data when ps and cwd access are unavailable', async () => {
    const lsofOutput = [
      'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME',
      'node 123 dev 22u IPv4 0xabc 0t0 TCP *:3000 (LISTEN)',
    ].join('\n')
    const result = await scanPorts(async (_executable, args) => {
      if (args.includes('-iTCP')) return { stdout: lsofOutput }
      throw new Error('operation not permitted')
    })

    expect(result.ok).toBe(true)
    expect(result.data[0]).toEqual(expect.objectContaining({
      port: 3000,
      processName: 'node',
      category: 'node',
      description: 'Node.js 服務',
    }))
  })
})

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PortCategory, PortRecord, ScanPortsResult } from '../../shared/types'

const execFileAsync = promisify(execFile)

export type { PortRecord, ScanPortsResult } from '../../shared/types'

const LSOF_ARGS = ['-nP', '-iTCP', '-sTCP:LISTEN']
const PROCESS_BATCH_SIZE = 100

export interface ProcessDetails {
  pid: number
  parentPid: number | null
  processGroupId: number | null
  elapsedTime: string
  commandLine: string
  cwd?: string
}

export type ExecRunner = (
  executable: string,
  args: string[],
) => Promise<{ stdout: string }>

const defaultRunner: ExecRunner = async (executable, args) => {
  const { stdout } = await execFileAsync(executable, args, { maxBuffer: 4 * 1024 * 1024 })
  return { stdout: String(stdout) }
}

function normalizeAddress(rawName: string): { address: string; port: number | null } {
  const arrowPart = rawName.includes('->') ? rawName.split('->')[0] : rawName
  const tokens = arrowPart.trim().split(/\s+/)
  const endpoint = tokens.find((token) => /:\d+$/.test(token)) ?? ''
  const endpointMatch = endpoint.match(/^(?:\[(?<ipv6>.+)\]|(?<host>[^:]+)):(?<port>\d+)$/)

  if (!endpointMatch?.groups) {
    return { address: endpoint || '-', port: null }
  }

  const host = endpointMatch.groups.ipv6 ?? endpointMatch.groups.host ?? '-'
  const port = endpointMatch.groups.port
  return {
    address: host === '*' ? '0.0.0.0' : host || '-',
    port: Number(port),
  }
}

export function parseLsofOutput(stdout: string): PortRecord[] {
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length <= 1) return []

  const records: PortRecord[] = []
  const dedupe = new Set<string>()

  for (const line of lines.slice(1)) {
    const columns = line.split(/\s+/)
    if (columns.length < 9) continue

    const pidValue = Number(columns[1])
    const pid = Number.isNaN(pidValue) ? null : pidValue
    const protocol = columns[7] || 'TCP'
    const rawName = columns.slice(8).join(' ')
    const { address, port } = normalizeAddress(rawName)
    if (port == null || Number.isNaN(port)) continue

    const record: PortRecord = {
      port,
      pid,
      processName: columns[0] || '-',
      protocol,
      address,
      state: rawName.match(/\(([^)]+)\)/)?.[1] ?? 'LISTEN',
      processUser: columns[2] || undefined,
    }
    const key = `${record.port}:${record.pid ?? 'na'}:${record.protocol}:${record.address}`
    if (!dedupe.has(key)) {
      dedupe.add(key)
      records.push(record)
    }
  }

  return records.sort((a, b) => a.port - b.port || (a.pid ?? 0) - (b.pid ?? 0))
}

export function parsePsOutput(stdout: string): Map<number, ProcessDetails> {
  const result = new Map<number, ProcessDetails>()
  for (const line of stdout.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/)
    if (!match) continue
    const pid = Number(match[1])
    result.set(pid, {
      pid,
      parentPid: Number(match[2]),
      processGroupId: Number(match[3]),
      elapsedTime: match[4] ?? '-',
      commandLine: redactCommandLine(match[5] ?? ''),
    })
  }
  return result
}

export function parseCwdOutput(stdout: string): Map<number, string> {
  const result = new Map<number, string>()
  let currentPid: number | null = null
  let isCwdRecord = false

  for (const line of stdout.split('\n')) {
    if (line.startsWith('p')) {
      const pid = Number(line.slice(1))
      currentPid = Number.isNaN(pid) ? null : pid
      isCwdRecord = false
    } else if (line === 'fcwd') {
      isCwdRecord = true
    } else if (line.startsWith('n') && currentPid != null && isCwdRecord) {
      result.set(currentPid, line.slice(1))
      isCwdRecord = false
    }
  }

  return result
}

export function redactCommandLine(commandLine: string): string {
  return commandLine
    .replace(
      /\b((?:api[-_]?key|access[-_]?token|auth[-_]?token|token|password|passwd|secret)=)("[^"]*"|'[^']*'|[^\s]+)/gi,
      '$1[已隱藏]',
    )
    .replace(
      /(\s--?(?:api[-_]?key|access[-_]?token|auth[-_]?token|token|password|passwd|secret)(?:=|\s+))("[^"]*"|'[^']*'|[^\s]+)/gi,
      '$1[已隱藏]',
    )
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/]+:)[^@\s/]+@/gi, '$1[已隱藏]@')
}

function initialCategory(processName: string): PortCategory {
  const normalized = processName.toLowerCase()
  if (normalized === 'node' || normalized.startsWith('node')) return 'node'
  if (/^(rapportd|controlce|sharingd|airplay|coreaudiod|identitys)/.test(normalized)) return 'system'
  return 'other'
}

function initialDescription(record: PortRecord): string {
  const category = initialCategory(record.processName)
  if (category === 'node') return 'Node.js 服務'
  if (category === 'system') return 'macOS 系統服務'
  if (record.processName.toLowerCase().startsWith('cursor')) return 'Cursor 背景服務'
  return `${record.processName} 程序${record.pid == null ? '' : `（PID ${record.pid}）`}`
}

export function mergeProcessDetails(
  records: PortRecord[],
  psDetails: Map<number, ProcessDetails>,
  cwdByPid: Map<number, string>,
): PortRecord[] {
  return records.map((record) => {
    const details = record.pid == null ? undefined : psDetails.get(record.pid)
    const cwd = record.pid == null ? undefined : cwdByPid.get(record.pid)
    return {
      ...record,
      description: initialDescription(record),
      category: initialCategory(record.processName),
      commandLine: details?.commandLine,
      cwd,
      parentPid: details?.parentPid,
      processGroupId: details?.processGroupId,
      elapsedTime: details?.elapsedTime,
    }
  })
}

function chunks<T>(values: T[], size: number): T[][] {
  const output: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size))
  }
  return output
}

async function collectProcessDetails(
  pids: number[],
  runner: ExecRunner,
): Promise<{ ps: Map<number, ProcessDetails>; cwd: Map<number, string> }> {
  const ps = new Map<number, ProcessDetails>()
  const cwd = new Map<number, string>()

  await Promise.all(chunks(pids, PROCESS_BATCH_SIZE).map(async (batch) => {
    const pidList = batch.join(',')
    const [psResult, cwdResult] = await Promise.allSettled([
      runner('ps', ['-ww', '-o', 'pid=,ppid=,pgid=,etime=,command=', '-p', pidList]),
      runner('lsof', ['-a', '-p', pidList, '-d', 'cwd', '-Fn']),
    ])

    if (psResult.status === 'fulfilled') {
      for (const [pid, details] of parsePsOutput(psResult.value.stdout)) ps.set(pid, details)
    }
    if (cwdResult.status === 'fulfilled') {
      for (const [pid, directory] of parseCwdOutput(cwdResult.value.stdout)) cwd.set(pid, directory)
    }
  }))

  return { ps, cwd }
}

function errorStdout(error: unknown): string {
  if (typeof error !== 'object' || error == null || !('stdout' in error)) return ''
  return String((error as { stdout?: string | Buffer }).stdout ?? '')
}

export async function scanPorts(runner: ExecRunner = defaultRunner): Promise<ScanPortsResult> {
  let stdout = ''
  try {
    stdout = (await runner('lsof', LSOF_ARGS)).stdout
  } catch (error) {
    stdout = errorStdout(error)
    if (!stdout.trim()) {
      const code = typeof error === 'object' && error != null && 'code' in error
        ? Number((error as { code?: number }).code)
        : null
      if (code === 1) return { ok: true, data: [] }
      const message = error instanceof Error ? error.message : 'Failed to scan ports'
      return { ok: false, data: [], error: `掃描失敗：${message}` }
    }
  }

  const records = parseLsofOutput(stdout)
  const pids = [...new Set(records.flatMap((record) => record.pid == null ? [] : [record.pid]))]
  if (pids.length === 0) return { ok: true, data: mergeProcessDetails(records, new Map(), new Map()) }

  const details = await collectProcessDetails(pids, runner)
  return { ok: true, data: mergeProcessDetails(records, details.ps, details.cwd) }
}

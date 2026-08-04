import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { arch, release } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { DiagnosticCheck, EnvironmentDiagnostics } from '../../shared/types'

const execFileAsync = promisify(execFile)

async function executableExists(executable: string): Promise<boolean> {
  if (!path.isAbsolute(executable)) return false
  try {
    await access(executable, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function commandVersion(executable: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(executable, ['--version'], { timeout: 5_000 })
    return `${stdout}${stderr}`.trim().split('\n')[0] ?? null
  } catch {
    return null
  }
}

function check(
  key: DiagnosticCheck['key'],
  label: string,
  status: DiagnosticCheck['status'],
  value: string,
  message: string,
): DiagnosticCheck {
  return { key, label, status, value, message }
}

export interface EnvironmentRuntime {
  platform: NodeJS.Platform
  architecture: string
  osVersion: string
  pathValue: string
  electronVersion: string
  bundledNodeVersion: string
  executableExists: (executable: string) => Promise<boolean>
  commandVersion: (executable: string) => Promise<string | null>
}

function defaultRuntime(): EnvironmentRuntime {
  return {
    platform: process.platform,
    architecture: arch(),
    osVersion: release(),
    pathValue: process.env.PATH ?? '',
    electronVersion: process.versions.electron ?? '-',
    bundledNodeVersion: process.versions.node,
    executableExists,
    commandVersion,
  }
}

export async function collectEnvironmentDiagnostics(
  appVersion: string,
  npmExecutable: string,
  runtimeOverrides: Partial<EnvironmentRuntime> = {},
): Promise<EnvironmentDiagnostics> {
  const runtime = { ...defaultRuntime(), ...runtimeOverrides }
  const pathValue = runtime.pathValue
  const npmVersion = await runtime.commandVersion(npmExecutable)
  const npmDirectory = path.isAbsolute(npmExecutable) ? path.dirname(npmExecutable) : ''
  const nodeCandidates = [
    npmDirectory ? path.join(npmDirectory, 'node') : '',
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
  ].filter(Boolean)
  let nodeExecutable = ''
  for (const candidate of nodeCandidates) {
    if (await runtime.executableExists(candidate)) {
      nodeExecutable = candidate
      break
    }
  }

  const nodeVersion = nodeExecutable ? await runtime.commandVersion(nodeExecutable) : null
  const lsofPath = '/usr/sbin/lsof'
  const psPath = '/bin/ps'
  const lsofAvailable = await runtime.executableExists(lsofPath)
  const psAvailable = await runtime.executableExists(psPath)
  const npmInPath = npmDirectory
    ? pathValue.split(path.delimiter).includes(npmDirectory)
    : Boolean(npmVersion)
  const isMac = runtime.platform === 'darwin'

  const checks: DiagnosticCheck[] = [
    check('platform', '作業系統', isMac ? 'ok' : 'error', `${runtime.platform} ${runtime.architecture}`,
      isMac ? '支援的 macOS 執行環境。' : '目前公開版本只支援 macOS。'),
    check('node', 'Node.js', nodeVersion ? 'ok' : 'error',
      nodeVersion ? `${nodeVersion} · ${nodeExecutable}` : '找不到',
      nodeVersion ? '可用於執行工作區專案。' : '請安裝 Node.js LTS，然後重新啟動 App。'),
    check('npm', 'npm', npmVersion ? 'ok' : 'error',
      npmVersion ? `${npmVersion} · ${npmExecutable}` : '找不到',
      npmVersion ? 'npm 執行檔可用。' : '請確認 npm 已隨 Node.js 安裝。'),
    check('path', 'PATH', npmInPath ? 'ok' : 'warning', pathValue || '空白',
      npmInPath ? 'npm 所在目錄已包含在 App 的 PATH。' : 'App 已從登入 shell 找到 npm，但建議將該目錄加入 PATH。'),
    check('lsof', 'lsof', lsofAvailable ? 'ok' : 'error', lsofAvailable ? lsofPath : '找不到',
      lsofAvailable ? '可掃描監聽中的 TCP Port。' : 'Port 監控需要 macOS 內建的 lsof。'),
    check('ps', 'ps', psAvailable ? 'ok' : 'error', psAvailable ? psPath : '找不到',
      psAvailable ? '可讀取程序命令與程序群組。' : '程序詳情需要 macOS 內建的 ps。'),
  ]

  return {
    appVersion,
    electronVersion: runtime.electronVersion,
    bundledNodeVersion: runtime.bundledNodeVersion,
    platform: runtime.platform,
    architecture: runtime.architecture,
    osVersion: runtime.osVersion,
    pathValue,
    checks,
  }
}

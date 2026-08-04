import type { PortRecord } from '../../shared/types'

export function applyStopPolicy(record: PortRecord, currentUsername: string): PortRecord {
  if (record.taskId) {
    return {
      ...record,
      canStop: true,
      stopMode: 'managed',
      stopReason: '由控制台管理，會先正常停止完整任務程序群組。',
    }
  }

  const isWorkspaceNode = (
    record.category === 'project' &&
    Boolean(record.projectName) &&
    record.processName.toLowerCase().startsWith('node') &&
    record.processUser === currentUsername
  )
  if (isWorkspaceNode) {
    return {
      ...record,
      canStop: true,
      stopMode: 'graceful',
      stopReason: '工作區內的 Node 開發程序，只會傳送安全的 SIGTERM。',
    }
  }

  let stopReason = '為避免影響電腦，只允許停止工作區內的 Node 開發程序。'
  if (record.category === 'system') stopReason = 'macOS 系統服務不可從控制台停止。'
  else if (record.processUser && record.processUser !== currentUsername) stopReason = '不可停止其他使用者的程序。'
  else if (record.category === 'node') stopReason = '工作區外的 Node 程序不可從控制台停止。'
  else if (record.category === 'other') stopReason = '一般應用程式或未知程序不可從控制台停止。'

  return { ...record, canStop: false, stopMode: undefined, stopReason }
}

interface StopDependencies {
  signal: (pid: number, signal: NodeJS.Signals | 0) => void
  wait: (milliseconds: number) => Promise<void>
  attempts: number
  intervalMs: number
}

const defaultDependencies: StopDependencies = {
  signal: (pid, signal) => process.kill(pid, signal),
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  attempts: 15,
  intervalMs: 200,
}

function isAlive(pid: number, signal: StopDependencies['signal']): boolean {
  try {
    signal(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}

export async function stopPidGracefully(
  pid: number,
  overrides: Partial<StopDependencies> = {},
): Promise<{ ok: boolean; error?: string }> {
  const dependencies = { ...defaultDependencies, ...overrides }
  try {
    dependencies.signal(pid, 'SIGTERM')
  } catch (error) {
    const message = error instanceof Error ? error.message : '無法傳送停止訊號'
    return { ok: false, error: `無法停止程序：${message}` }
  }

  for (let attempt = 0; attempt < dependencies.attempts; attempt += 1) {
    await dependencies.wait(dependencies.intervalMs)
    if (!isAlive(pid, dependencies.signal)) return { ok: true }
  }

  return {
    ok: false,
    error: '程序未回應安全停止訊號。為避免影響系統，控制台不會強制終止；請回到原終端手動停止。',
  }
}

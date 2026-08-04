import type { ScanPortsResult } from '../services/ports'
import { scanPorts } from '../services/ports'

function normalizeScanPortsResult(result: ScanPortsResult): ScanPortsResult {
  if (!result.ok) {
    return {
      ok: false,
      data: [],
      error: result.error ?? '掃描失敗：未知錯誤',
    }
  }

  return {
    ok: true,
    data: Array.isArray(result.data) ? result.data : [],
  }
}

export async function runScanPorts(
  scanner: () => Promise<ScanPortsResult> = scanPorts,
): Promise<ScanPortsResult> {
  try {
    const result = await scanner()
    return normalizeScanPortsResult(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    return {
      ok: false,
      data: [],
      error: `掃描失敗：${message}`,
    }
  }
}

export async function handleScanPorts(): Promise<ScanPortsResult> {
  return runScanPorts(scanPorts)
}

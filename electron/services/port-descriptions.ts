import path from 'node:path'
import type { PortRecord, ProjectSummary, TaskRecord } from '../../shared/types'

const SYSTEM_PROCESS_LABELS: Array<[RegExp, string]> = [
  [/^controlce/i, 'macOS 控制中心服務'],
  [/^rapportd/i, 'macOS 裝置連續互通服務'],
  [/^sharingd/i, 'macOS 分享服務'],
  [/^airplay/i, 'macOS AirPlay 服務'],
  [/^coreaudiod/i, 'macOS 音訊服務'],
  [/^identitys/i, 'macOS 身分服務'],
]

function isPathWithin(directory: string, parent: string): boolean {
  const relative = path.relative(parent, directory)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function findProjectByCwd(
  cwd: string | undefined,
  projects: ProjectSummary[],
): ProjectSummary | null {
  if (!cwd) return null
  return projects
    .filter((project) => isPathWithin(cwd, project.path))
    .sort((a, b) => b.path.length - a.path.length)[0] ?? null
}

export function describePortRecord(
  record: PortRecord,
  projects: ProjectSummary[],
  task: TaskRecord | null,
): PortRecord {
  if (task) {
    const brand = task.brand ? ` · ${task.brand}` : ''
    return {
      ...record,
      category: 'project',
      description: `${task.projectName} · npm run ${task.script}${brand}`,
      taskId: task.taskId,
      projectName: task.projectName,
    }
  }

  const project = findProjectByCwd(record.cwd, projects)
  const normalizedName = record.processName.toLowerCase()
  const isNode = normalizedName.startsWith('node') || /(?:^|\/)node(?:\s|$)/i.test(record.commandLine ?? '')

  if (project) {
    return {
      ...record,
      category: 'project',
      description: `${project.name} · ${isNode ? 'Node.js 服務' : `${record.processName} 程序`}`,
      projectName: project.name,
    }
  }

  if (isNode) {
    const location = record.cwd && record.cwd !== '/'
      ? ` · ${path.basename(record.cwd)}`
      : ''
    return { ...record, category: 'node', description: `Node.js 服務${location}` }
  }

  const systemLabel = SYSTEM_PROCESS_LABELS.find(([pattern]) => pattern.test(record.processName))?.[1]
  if (systemLabel) return { ...record, category: 'system', description: systemLabel }

  if (normalizedName.startsWith('cursor')) {
    return { ...record, category: 'other', description: 'Cursor 編輯器背景服務' }
  }

  return {
    ...record,
    category: record.category ?? 'other',
    description: record.description ?? `${record.processName} 程序${record.pid == null ? '' : `（PID ${record.pid}）`}`,
  }
}


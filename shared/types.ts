export type TaskStatus =
  | 'starting'
  | 'running'
  | 'stopping'
  | 'succeeded'
  | 'failed'
  | 'stopped'

export interface ProjectScript {
  name: string
  command: string
  brandAware: boolean
}

export interface ProjectSummary {
  id: string
  name: string
  originalName: string
  path: string
  relativePath: string
  scripts: ProjectScript[]
  brands: string[]
  isPinned: boolean
  pinnedAt: string | null
}

export interface ProjectPreference {
  displayName?: string
  pinnedAt?: string
}

export type ProjectPreferenceMap = Record<string, ProjectPreference>

export interface UpdateProjectPreferenceInput {
  projectId: string
  isPinned?: boolean
  displayName?: string | null
}

export interface ProjectPreferenceResult {
  ok: boolean
  project?: ProjectSummary
  error?: string
}

export interface ScanProjectsResult {
  ok: boolean
  rootPath: string
  projects: ProjectSummary[]
  warnings: string[]
  error?: string
}

export interface TaskRecord {
  taskId: string
  projectId: string
  projectName: string
  script: string
  brand: string | null
  pid: number | null
  status: TaskStatus
  startedAt: string
  finishedAt: string | null
  exitCode: number | null
  url: string | null
  error?: string
}

export interface TaskLog {
  taskId: string
  stream: 'stdout' | 'stderr' | 'system'
  text: string
  timestamp: string
}

export interface StartTaskInput {
  projectId: string
  script: string
  brand?: string
}

export interface TaskResult {
  ok: boolean
  task?: TaskRecord
  error?: string
}

export type PortCategory = 'project' | 'node' | 'system' | 'other'

export interface PortRecord {
  port: number
  pid: number | null
  processName: string
  protocol: string
  address: string
  state: string
  description?: string
  category?: PortCategory
  commandLine?: string
  cwd?: string
  parentPid?: number | null
  processGroupId?: number | null
  elapsedTime?: string
  processUser?: string
  taskId?: string
  projectName?: string
  canStop?: boolean
  stopMode?: 'managed' | 'graceful'
  stopReason?: string
}

export interface ScanPortsResult {
  ok: boolean
  data: PortRecord[]
  error?: string
}

export interface StopPortInput {
  port: number
  pid: number
}

export interface StopPortResult {
  ok: boolean
  stopped?: boolean
  error?: string
}

export interface WorkspaceSelectionResult {
  ok: boolean
  canceled?: boolean
  rootPath?: string
  error?: string
}

export type DiagnosticStatus = 'ok' | 'warning' | 'error'

export interface DiagnosticCheck {
  key: 'platform' | 'node' | 'npm' | 'path' | 'lsof' | 'ps'
  label: string
  status: DiagnosticStatus
  value: string
  message: string
}

export interface EnvironmentDiagnostics {
  appVersion: string
  electronVersion: string
  bundledNodeVersion: string
  platform: string
  architecture: string
  osVersion: string
  pathValue: string
  checks: DiagnosticCheck[]
}

export type ProjectPage = 'repository' | 'releases' | 'issues' | 'license'

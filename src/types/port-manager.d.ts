import type {
  EnvironmentDiagnostics,
  ProjectPage,
  ProjectPreferenceResult,
  ScanPortsResult,
  ScanProjectsResult,
  StartTaskInput,
  StopPortInput,
  StopPortResult,
  TaskLog,
  TaskRecord,
  TaskResult,
  UpdateProjectPreferenceInput,
  WorkspaceSelectionResult,
} from '../../shared/types'

declare global {
  interface Window {
    portManager: {
      scanWorkspace: () => Promise<ScanProjectsResult>
      selectWorkspace: () => Promise<WorkspaceSelectionResult>
      updateProjectPreference: (input: UpdateProjectPreferenceInput) => Promise<ProjectPreferenceResult>
      startTask: (input: StartTaskInput) => Promise<TaskResult>
      stopTask: (taskId: string) => Promise<TaskResult>
      listTasks: () => Promise<TaskRecord[]>
      getTaskLogs: (taskId: string) => Promise<TaskLog[]>
      scanPorts: () => Promise<ScanPortsResult>
      stopPortSafely: (input: StopPortInput) => Promise<StopPortResult>
      getEnvironmentDiagnostics: () => Promise<EnvironmentDiagnostics>
      openProjectPage: (page: ProjectPage) => Promise<{ ok: boolean; error?: string }>
      openLocalUrl: (url: string) => Promise<{ ok: boolean; error?: string }>
      onTaskLog: (callback: (log: TaskLog) => void) => () => void
      onTaskState: (callback: (task: TaskRecord) => void) => () => void
    }
  }
}

export {}

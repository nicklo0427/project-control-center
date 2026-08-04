import { ipcRenderer, contextBridge } from 'electron'
import type { ProjectPage, StartTaskInput, StopPortInput, TaskLog, TaskRecord } from '../shared/types'

contextBridge.exposeInMainWorld('portManager', {
  scanWorkspace: () => ipcRenderer.invoke('workspace:scan'),
  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  startTask: (input: StartTaskInput) => ipcRenderer.invoke('tasks:start', input),
  stopTask: (taskId: string) => ipcRenderer.invoke('tasks:stop', taskId),
  listTasks: () => ipcRenderer.invoke('tasks:list'),
  getTaskLogs: (taskId: string) => ipcRenderer.invoke('tasks:logs', taskId),
  scanPorts: () => ipcRenderer.invoke('ports:scan'),
  stopPortSafely: (input: StopPortInput) => ipcRenderer.invoke('ports:stop-safe', input),
  getEnvironmentDiagnostics: () => ipcRenderer.invoke('environment:get'),
  openProjectPage: (page: ProjectPage) => ipcRenderer.invoke('project:open-page', page),
  openLocalUrl: (url: string) => ipcRenderer.invoke('system:open-local-url', url),
  onTaskLog: (callback: (log: TaskLog) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, log: TaskLog) => callback(log)
    ipcRenderer.on('tasks:log', listener)
    return () => ipcRenderer.removeListener('tasks:log', listener)
  },
  onTaskState: (callback: (task: TaskRecord) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, task: TaskRecord) => callback(task)
    ipcRenderer.on('tasks:state', listener)
    return () => ipcRenderer.removeListener('tasks:state', listener)
  },
})

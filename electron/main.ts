import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { userInfo } from 'node:os'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { handleScanPorts } from './ipc/scan-ports'
import { collectEnvironmentDiagnostics } from './services/environment'
import { describePortRecord } from './services/port-descriptions'
import { applyStopPolicy, stopPidGracefully } from './services/port-stop'
import { scanProjects } from './services/projects'
import { applyProjectPreferences, updateProjectPreference } from './services/project-preferences'
import { SettingsStore } from './services/settings'
import { isSafeLocalUrl, TaskManager } from './services/tasks'
import type {
  PortRecord,
  ProjectPage,
  ProjectPreferenceMap,
  ProjectPreferenceResult,
  ProjectSummary,
  ScanPortsResult,
  StartTaskInput,
  StopPortInput,
  StopPortResult,
  TaskLog,
  TaskRecord,
  UpdateProjectPreferenceInput,
} from '../shared/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
const execFileAsync = promisify(execFile)
const taskManager = new TaskManager()
const currentUsername = userInfo().username
let settingsStore: SettingsStore
let currentWorkspaceRoot: string | null = null
let resolvedNpmExecutable = 'npm'
let currentProjects: ProjectSummary[] = []
let currentProjectPreferences: ProjectPreferenceMap = {}
let projectPreferenceUpdateQueue: Promise<void> = Promise.resolve()
let isCleanupInProgress = false

app.setName('Project Control Center')

const PROJECT_PAGES: Record<ProjectPage, string> = {
  repository: 'https://github.com/nicklo0427/project-control-center',
  releases: 'https://github.com/nicklo0427/project-control-center/releases',
  issues: 'https://github.com/nicklo0427/project-control-center/issues',
  license: 'https://github.com/nicklo0427/project-control-center/blob/main/LICENSE',
}

async function resolveNpmExecutable(): Promise<string> {
  const pathCandidates = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, 'npm'))

  for (const candidate of ['/usr/local/bin/npm', '/opt/homebrew/bin/npm', ...pathCandidates]) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Try the next known installation location.
    }
  }

  const loginShell = process.env.SHELL || '/bin/zsh'
  try {
    const { stdout } = await execFileAsync(loginShell, ['-lic', 'command -v npm'])
    const lines = stdout.trim().split('\n')
    const candidate = lines[lines.length - 1] ?? ''
    if (path.isAbsolute(candidate)) {
      await access(candidate, constants.X_OK)
      return candidate
    }
  } catch {
    // TaskManager will fall back to resolving npm from the inherited PATH.
  }

  return 'npm'
}

function broadcast(channel: string, payload: TaskLog | TaskRecord) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}

async function scanCurrentWorkspace() {
  if (!currentWorkspaceRoot) {
    currentProjects = []
    taskManager.setProjects([])
    return { ok: true, rootPath: '', projects: [], warnings: [] }
  }
  const result = await scanProjects(currentWorkspaceRoot, process.env.APP_ROOT)
  if (result.ok) {
    currentWorkspaceRoot = result.rootPath
    currentProjectPreferences = await settingsStore.getProjectPreferences()
    currentProjects = applyProjectPreferences(result.projects, currentProjectPreferences)
    result.projects = currentProjects
    taskManager.setProjects(currentProjects)
  }
  return result
}

async function scanPortsWithTasks(): Promise<ScanPortsResult> {
  const result = await handleScanPorts()
  if (!result.ok) return result

  return {
    ...result,
    data: result.data.map(enrichPortRecord),
  }
}

function enrichPortRecord(record: PortRecord): PortRecord {
  const task = record.pid == null
    ? null
    : taskManager.findTaskForProcess(record.pid, record.processGroupId)
  return applyStopPolicy(describePortRecord(record, currentProjects, task), currentUsername)
}

async function stopPortSafely(input: StopPortInput): Promise<StopPortResult> {
  if (!Number.isInteger(input?.pid) || input.pid <= 0 || !Number.isInteger(input?.port) || input.port <= 0) {
    return { ok: false, error: '停止要求無效。' }
  }

  // Rescan immediately before signaling to prevent stale rows or PID reuse from targeting another process.
  const freshResult = await handleScanPorts()
  if (!freshResult.ok) return { ok: false, error: freshResult.error ?? '無法重新驗證程序。' }
  const rawRecord = freshResult.data.find((record) => record.pid === input.pid && record.port === input.port)
  if (!rawRecord) return { ok: false, error: '程序已結束或 Port 已由其他程序接手，請重新掃描。' }

  const record = enrichPortRecord(rawRecord)
  if (!record.canStop) return { ok: false, error: record.stopReason ?? '基於安全政策，此程序不可停止。' }

  if (record.stopMode === 'managed' && record.taskId) {
    const result = await taskManager.stopTask(record.taskId)
    return result.ok
      ? { ok: true, stopped: true }
      : { ok: false, error: result.error ?? '控制台任務停止失敗。' }
  }

  const result = await stopPidGracefully(input.pid)
  return result.ok
    ? { ok: true, stopped: true }
    : { ok: false, error: result.error }
}

function handleUpdateProjectPreference(
  input: UpdateProjectPreferenceInput,
): Promise<ProjectPreferenceResult> {
  const operation = projectPreferenceUpdateQueue.then(async () => {
    const result = updateProjectPreference(currentProjects, currentProjectPreferences, input)
    if (!result.ok || !result.projects || !result.preferences || !result.project) {
      return { ok: false, error: result.error ?? '無法更新專案偏好。' }
    }

    try {
      await settingsStore.setProjectPreferences(result.preferences)
    } catch {
      return { ok: false, error: '無法保存專案偏好，請確認 App 的資料目錄可寫入。' }
    }

    currentProjects = result.projects
    currentProjectPreferences = result.preferences
    taskManager.setProjects(currentProjects)
    taskManager.updateProjectName(result.project.id, result.project.name)
    return { ok: true, project: result.project }
  })
  projectPreferenceUpdateQueue = operation.then(() => undefined, () => undefined)
  return operation
}

function registerIpcHandlers() {
  ipcMain.handle('workspace:scan', scanCurrentWorkspace)
  ipcMain.handle('workspace:select', async () => {
    const result = await dialog.showOpenDialog({
      title: '選擇專案工作區',
      defaultPath: currentWorkspaceRoot ?? app.getPath('home'),
      properties: ['openDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return { ok: true, canceled: true }

    currentWorkspaceRoot = result.filePaths[0]
    await settingsStore.setWorkspaceRoot(currentWorkspaceRoot)
    const scanResult = await scanCurrentWorkspace()
    if (!scanResult.ok) return { ok: false, error: scanResult.error }
    return { ok: true, rootPath: currentWorkspaceRoot }
  })
  ipcMain.handle('projects:update-preference', (_event, input: UpdateProjectPreferenceInput) => (
    handleUpdateProjectPreference(input)
  ))
  ipcMain.handle('tasks:start', (_event, input: StartTaskInput) => taskManager.startTask(input))
  ipcMain.handle('tasks:stop', (_event, taskId: string) => taskManager.stopTask(taskId))
  ipcMain.handle('tasks:list', () => taskManager.listTasks())
  ipcMain.handle('tasks:logs', (_event, taskId: string) => taskManager.getTaskLogs(taskId))
  ipcMain.handle('ports:scan', scanPortsWithTasks)
  ipcMain.handle('ports:stop-safe', (_event, input: StopPortInput) => stopPortSafely(input))
  ipcMain.handle('environment:get', () => collectEnvironmentDiagnostics(app.getVersion(), resolvedNpmExecutable))
  ipcMain.handle('project:open-page', async (_event, page: ProjectPage) => {
    const url = PROJECT_PAGES[page]
    if (!url) return { ok: false, error: '不允許的專案連結。' }
    await shell.openExternal(url)
    return { ok: true }
  })
  ipcMain.handle('system:open-local-url', async (_event, url: string) => {
    if (!isSafeLocalUrl(url)) return { ok: false, error: '只允許開啟本機開發網址。' }
    await shell.openExternal(url)
    return { ok: true }
  })

  taskManager.on('log', (log: TaskLog) => broadcast('tasks:log', log))
  taskManager.on('state', (task: TaskRecord) => broadcast('tasks:state', task))
}

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'project-control-center.svg'),
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    title: 'Project Control Center',
    backgroundColor: '#0b1020',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('before-quit', (event) => {
  if (isCleanupInProgress || taskManager.listTasks().every((task) => !['starting', 'running', 'stopping'].includes(task.status))) {
    return
  }

  event.preventDefault()
  isCleanupInProgress = true
  void taskManager.stopAll().finally(() => app.quit())
})

app.whenReady().then(async () => {
  settingsStore = new SettingsStore(app.getPath('userData'))
  currentWorkspaceRoot = await settingsStore.getWorkspaceRoot()
  resolvedNpmExecutable = await resolveNpmExecutable()
  taskManager.setNpmExecutable(resolvedNpmExecutable)
  registerIpcHandlers()
  createWindow()
})

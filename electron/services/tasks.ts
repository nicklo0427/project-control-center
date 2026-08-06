import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { Readable } from 'node:stream'
import type {
  ProjectSummary,
  StartTaskInput,
  TaskLog,
  TaskRecord,
  TaskResult,
} from '../../shared/types'

const MAX_LOG_ENTRIES = 2_000
const LOCAL_URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s\u001b]*)?/i

type SpawnTask = typeof spawn

interface ManagedTask {
  record: TaskRecord
  child: ChildProcessByStdio<null, Readable, Readable>
  logs: TaskLog[]
  urlBuffer: string
}

function now(): string {
  return new Date().toISOString()
}

function publicRecord(record: TaskRecord): TaskRecord {
  return { ...record }
}

export function extractLocalUrl(output: string): string | null {
  const cleanOutput = output.replace(/\u001b\[[0-9;]*m/g, '')
  const match = cleanOutput.match(LOCAL_URL_PATTERN)?.[0]
  return match?.replace(/[),.;]+$/, '') ?? null
}

export function isSafeLocalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(url.hostname)
    )
  } catch {
    return false
  }
}

export class TaskManager extends EventEmitter {
  private readonly spawnTask: SpawnTask
  private npmExecutable = 'npm'
  private projects = new Map<string, ProjectSummary>()
  private tasks = new Map<string, ManagedTask>()
  private activeByProject = new Map<string, string>()

  constructor(spawnTask: SpawnTask = spawn) {
    super()
    this.spawnTask = spawnTask
  }

  setNpmExecutable(executable: string): void {
    if (executable.trim()) this.npmExecutable = executable
  }

  setProjects(projects: ProjectSummary[]): void {
    this.projects = new Map(projects.map((project) => [project.id, project]))
  }

  updateProjectName(projectId: string, projectName: string): void {
    for (const managed of this.tasks.values()) {
      if (managed.record.projectId !== projectId || managed.record.projectName === projectName) continue
      managed.record.projectName = projectName
      this.emitState(managed.record)
    }
  }

  listTasks(): TaskRecord[] {
    return [...this.tasks.values()]
      .map((task) => publicRecord(task.record))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  getTaskLogs(taskId: string): TaskLog[] {
    return this.tasks.get(taskId)?.logs.map((log) => ({ ...log })) ?? []
  }

  startTask(input: StartTaskInput): TaskResult {
    const project = this.projects.get(input.projectId)
    if (!project) return { ok: false, error: '找不到專案，請重新掃描工作區。' }

    const script = project.scripts.find((item) => item.name === input.script)
    if (!script) return { ok: false, error: '此專案不存在指定的 npm script。' }
    if (this.activeByProject.has(project.id)) {
      return { ok: false, error: '此專案已有命令執行中，請先停止或等待完成。' }
    }

    const brand = input.brand?.trim() || null
    if (brand && (!script.brandAware || !project.brands.includes(brand))) {
      return { ok: false, error: '品牌參數不適用或不在允許清單中。' }
    }

    const args = ['run', script.name]
    if (brand) args.push('--', brand)

    const taskId = randomUUID()
    let child: ChildProcessByStdio<null, Readable, Readable>
    try {
      child = this.spawnTask(this.npmExecutable, args, {
        cwd: project.path,
        detached: process.platform !== 'win32',
        env: process.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '無法啟動 npm'
      return { ok: false, error: `啟動失敗：${message}` }
    }

    const record: TaskRecord = {
      taskId,
      projectId: project.id,
      projectName: project.name,
      script: script.name,
      brand,
      pid: child.pid ?? null,
      status: 'starting',
      startedAt: now(),
      finishedAt: null,
      exitCode: null,
      url: null,
    }
    const managed: ManagedTask = { record, child, logs: [], urlBuffer: '' }
    this.tasks.set(taskId, managed)
    this.activeByProject.set(project.id, taskId)

    this.appendLog(managed, 'system', `$ npm ${args.join(' ')}\n`)
    record.status = 'running'
    this.emitState(record)

    child.stdout.on('data', (chunk: Buffer | string) => this.handleOutput(managed, 'stdout', String(chunk)))
    child.stderr.on('data', (chunk: Buffer | string) => this.handleOutput(managed, 'stderr', String(chunk)))
    child.on('error', (error) => {
      record.error = error.message
      this.finishTask(managed, 'failed', null)
    })
    child.on('close', (code, signal) => {
      if (record.status === 'stopping' || signal) {
        this.finishTask(managed, 'stopped', code)
      } else {
        this.finishTask(managed, code === 0 ? 'succeeded' : 'failed', code)
      }
    })

    return { ok: true, task: publicRecord(record) }
  }

  async stopTask(taskId: string): Promise<TaskResult> {
    const managed = this.tasks.get(taskId)
    if (!managed) return { ok: false, error: '找不到指定任務。' }
    if (!['starting', 'running'].includes(managed.record.status)) {
      return { ok: true, task: publicRecord(managed.record) }
    }

    managed.record.status = 'stopping'
    this.appendLog(managed, 'system', '\n正在停止程序…\n')
    this.emitState(managed.record)
    this.signalProcess(managed, 'SIGTERM')

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (managed.record.status === 'stopping') this.signalProcess(managed, 'SIGKILL')
        resolve()
      }, 3_000)
      managed.child.once('close', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    return { ok: true, task: publicRecord(managed.record) }
  }

  async stopAll(): Promise<void> {
    const activeIds = [...this.activeByProject.values()]
    await Promise.all(activeIds.map((taskId) => this.stopTask(taskId)))
  }

  findTaskForProcess(pid: number, processGroupId: number | null | undefined): TaskRecord | null {
    for (const managed of this.tasks.values()) {
      if (!['starting', 'running', 'stopping'].includes(managed.record.status)) continue
      if (managed.record.pid === pid) return publicRecord(managed.record)
      if (managed.record.pid != null && managed.record.pid === processGroupId) {
        return publicRecord(managed.record)
      }
    }
    return null
  }

  private handleOutput(managed: ManagedTask, stream: 'stdout' | 'stderr', text: string): void {
    this.appendLog(managed, stream, text)
    managed.urlBuffer = `${managed.urlBuffer}${text}`.slice(-8_000)
    if (!managed.record.url) {
      const url = extractLocalUrl(managed.urlBuffer)
      if (url) {
        managed.record.url = url
        this.emitState(managed.record)
      }
    }
  }

  private appendLog(managed: ManagedTask, stream: TaskLog['stream'], text: string): void {
    const log: TaskLog = { taskId: managed.record.taskId, stream, text, timestamp: now() }
    managed.logs.push(log)
    if (managed.logs.length > MAX_LOG_ENTRIES) managed.logs.shift()
    this.emit('log', log)
  }

  private emitState(record: TaskRecord): void {
    this.emit('state', publicRecord(record))
  }

  private finishTask(
    managed: ManagedTask,
    status: 'succeeded' | 'failed' | 'stopped',
    exitCode: number | null,
  ): void {
    if (['succeeded', 'failed', 'stopped'].includes(managed.record.status)) return
    managed.record.status = status
    managed.record.exitCode = exitCode
    managed.record.finishedAt = now()
    this.activeByProject.delete(managed.record.projectId)
    this.appendLog(
      managed,
      'system',
      `\n任務${status === 'succeeded' ? '完成' : status === 'stopped' ? '已停止' : '失敗'}${exitCode == null ? '' : `（exit ${exitCode}）`}。\n`,
    )
    this.emitState(managed.record)
  }

  private signalProcess(managed: ManagedTask, signal: NodeJS.Signals): void {
    const pid = managed.record.pid
    if (!pid) return
    try {
      if (process.platform === 'win32') {
        managed.child.kill(signal)
      } else {
        process.kill(-pid, signal)
      }
    } catch {
      try {
        managed.child.kill(signal)
      } catch {
        // Already stopped.
      }
    }
  }
}

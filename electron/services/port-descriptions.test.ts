import { describe, expect, it } from 'vitest'
import type { PortRecord, ProjectSummary, TaskRecord } from '../../shared/types'
import { describePortRecord, findProjectByCwd } from './port-descriptions'

const project: ProjectSummary = {
  id: 'project-1',
  name: 'activity-vue3',
  originalName: 'activity-vue3',
  path: '/workspace/activity_vue3',
  relativePath: 'activity_vue3',
  scripts: [],
  brands: ['ot888'],
  isPinned: false,
  pinnedAt: null,
}

function port(overrides: Partial<PortRecord> = {}): PortRecord {
  return {
    port: 8866,
    pid: 999,
    processName: 'node',
    protocol: 'TCP',
    address: '0.0.0.0',
    state: 'LISTEN',
    category: 'node',
    description: 'Node.js 服務',
    ...overrides,
  }
}

describe('port descriptions', () => {
  it('prioritizes a managed task and includes script and brand', () => {
    const task: TaskRecord = {
      taskId: 'task-1', projectId: project.id, projectName: project.name,
      script: 'dev', brand: 'rojs', pid: 900, status: 'running',
      startedAt: new Date().toISOString(), finishedAt: null, exitCode: null, url: null,
    }
    const result = describePortRecord(port(), [project], task)
    expect(result.category).toBe('project')
    expect(result.description).toBe('activity-vue3 · npm run dev · rojs')
  })

  it('associates an externally started process by its deepest cwd project', () => {
    const nested = { ...project, id: 'nested', name: 'nested', path: `${project.path}/packages/nested` }
    expect(findProjectByCwd(`${nested.path}/src`, [project, nested])?.name).toBe('nested')

    const result = describePortRecord(port({ cwd: `${project.path}/src` }), [project], null)
    expect(result.category).toBe('project')
    expect(result.description).toBe('activity-vue3 · Node.js 服務')
  })

  it('describes Node, Cursor, macOS, and unknown processes safely', () => {
    expect(describePortRecord(port({ cwd: '/tmp/api' }), [], null).description).toBe('Node.js 服務 · api')
    expect(describePortRecord(port({ processName: 'Cursor', category: 'other' }), [], null).description)
      .toBe('Cursor 編輯器背景服務')
    expect(describePortRecord(port({ processName: 'ControlCe', category: 'system' }), [], null).description)
      .toBe('macOS 控制中心服務')
    expect(describePortRecord(port({ processName: 'nginx', category: 'other', description: undefined }), [], null).description)
      .toBe('nginx 程序（PID 999）')
  })
})

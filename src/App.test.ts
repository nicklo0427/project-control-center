// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PortRecord, ProjectSummary } from '../shared/types'
import App from './App.vue'

const demoProject: ProjectSummary = {
  id: 'demo-id',
  name: 'brand-app',
  originalName: 'brand-app',
  path: '/workspace/brand-app',
  relativePath: 'brand-app',
  isPinned: false,
  pinnedAt: null,
  brands: ['ot888', 'rojs'],
  scripts: [
    { name: 'dev', command: 'node scripts/dev.js', brandAware: true },
    { name: 'build', command: 'vite build', brandAware: false },
  ],
}

function installApi(
  portData: PortRecord[] = [],
  workspaceRoot = '/workspace',
  projectData: ProjectSummary[] = [demoProject],
) {
  const startTask = vi.fn().mockResolvedValue({
    ok: true,
    task: {
      taskId: 'task-1', projectId: 'demo-id', projectName: 'brand-app', script: 'dev',
      brand: 'rojs', pid: 123, status: 'running', startedAt: new Date().toISOString(),
      finishedAt: null, exitCode: null, url: null,
    },
  })
  const stopPortSafely = vi.fn().mockResolvedValue({ ok: true, stopped: true })
  const selectWorkspace = vi.fn().mockResolvedValue({ canceled: true })
  const preferenceProjects = new Map(projectData.map((project) => [project.id, { ...project }]))
  const updateProjectPreference = vi.fn().mockImplementation(async (input) => {
    const current = preferenceProjects.get(input.projectId)
    if (!current) return { ok: false, error: 'missing' }
    const next = {
      ...current,
      name: Object.prototype.hasOwnProperty.call(input, 'displayName')
        ? input.displayName?.trim() || current.originalName
        : current.name,
      isPinned: input.isPinned ?? current.isPinned,
      pinnedAt: Object.prototype.hasOwnProperty.call(input, 'isPinned')
        ? input.isPinned ? current.pinnedAt ?? '2026-08-06T00:00:00.000Z' : null
        : current.pinnedAt,
    }
    preferenceProjects.set(current.id, next)
    return { ok: true, project: next }
  })
  Object.defineProperty(window, 'portManager', {
    configurable: true,
    value: {
      scanWorkspace: vi.fn().mockResolvedValue({
        ok: true, rootPath: workspaceRoot, projects: workspaceRoot ? projectData : [], warnings: [],
      }),
      selectWorkspace,
      updateProjectPreference,
      startTask,
      stopTask: vi.fn(),
      listTasks: vi.fn().mockResolvedValue([]),
      getTaskLogs: vi.fn().mockResolvedValue([]),
      scanPorts: vi.fn().mockResolvedValue({ ok: true, data: portData }),
      stopPortSafely,
      openLocalUrl: vi.fn(),
      getEnvironmentDiagnostics: vi.fn().mockResolvedValue({
        appVersion: '1.1.0', electronVersion: '43.2.0', bundledNodeVersion: '24.14.0',
        platform: 'darwin', architecture: 'arm64', osVersion: '24.6.0', pathValue: '/opt/homebrew/bin',
        checks: [
          { key: 'node', label: 'Node.js', status: 'ok', value: 'v22.14.0', message: '可用於執行工作區專案。' },
        ],
      }),
      openProjectPage: vi.fn(),
      onTaskLog: vi.fn(() => vi.fn()),
      onTaskState: vi.fn(() => vi.fn()),
    },
  })
  return { startTask, stopPortSafely, selectWorkspace, updateProjectPreference }
}

afterEach(() => vi.restoreAllMocks())

describe('Project Control Center UI', () => {
  it('renders discovered projects and passes the selected brand to npm dev', async () => {
    const { startTask } = installApi()
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.text()).toContain('brand-app')
    const brandSelect = wrapper.get('.brandSelect select')
    await brandSelect.setValue('rojs')
    const devButton = wrapper.findAll('.scriptCard').find((button: { text: () => string }) => button.text().includes('npm run dev'))
    expect(devButton).toBeDefined()
    await devButton!.trigger('click')
    await flushPromises()

    expect(startTask).toHaveBeenCalledWith({ projectId: 'demo-id', script: 'dev', brand: 'rojs' })
    expect(wrapper.find('.stopButton').exists()).toBe(true)
  })

  it('shows pinned projects once in pin order and updates pins from the list and heading', async () => {
    const projects: ProjectSummary[] = [
      { ...demoProject, id: 'later', name: 'Later', originalName: 'Later', isPinned: true, pinnedAt: '2026-08-06T02:00:00.000Z' },
      { ...demoProject, id: 'regular', name: 'Regular', originalName: 'Regular' },
      { ...demoProject, id: 'earlier', name: 'Earlier', originalName: 'Earlier', isPinned: true, pinnedAt: '2026-08-06T01:00:00.000Z' },
    ]
    const { updateProjectPreference } = installApi([], '/workspace', projects)
    const wrapper = mount(App)
    await flushPromises()

    const sections = wrapper.findAll('.projectSection')
    expect(sections).toHaveLength(2)
    expect(sections[0]!.text()).toContain('已釘選')
    expect(sections[0]!.findAll('.projectMeta strong').map((item) => item.text())).toEqual(['Earlier', 'Later'])
    expect(wrapper.findAll('.projectMeta strong').filter((item) => item.text() === 'Earlier')).toHaveLength(1)

    await wrapper.findAll('.projectPinButton')[0]!.trigger('click')
    await flushPromises()
    expect(updateProjectPreference).toHaveBeenCalledWith({ projectId: 'earlier', isPinned: false })

    await wrapper.get('.headingPinButton').trigger('click')
    await flushPromises()
    expect(updateProjectPreference).toHaveBeenLastCalledWith({ projectId: 'later', isPinned: false })
  })

  it('edits and resets the display name inline while searching original names', async () => {
    const customized = { ...demoProject, name: '我的前端', originalName: 'brand-app' }
    const { updateProjectPreference } = installApi([], '/workspace', [customized])
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('.editProjectNameButton').trigger('click')
    const input = wrapper.get('.projectNameInput')
    await input.setValue(' 新名稱 ')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(updateProjectPreference).toHaveBeenCalledWith({ projectId: 'demo-id', displayName: ' 新名稱 ' })
    expect(wrapper.get('.projectHeading h2').text()).toBe('新名稱')

    await wrapper.get('.searchBox input').setValue('brand-app')
    expect(wrapper.findAll('.projectItem')).toHaveLength(1)

    await wrapper.get('.editProjectNameButton').trigger('click')
    await wrapper.get('.projectNameInput').setValue('   ')
    await wrapper.get('.projectNameInput').trigger('blur')
    await flushPromises()
    expect(wrapper.get('.projectHeading h2').text()).toBe('brand-app')
  })

  it('cancels inline name editing with Escape', async () => {
    const { updateProjectPreference } = installApi()
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('.editProjectNameButton').trigger('click')
    await wrapper.get('.projectNameInput').setValue('不要保存')
    await wrapper.get('.projectNameInput').trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(wrapper.find('.projectNameInput').exists()).toBe(false)
    expect(updateProjectPreference).not.toHaveBeenCalled()
    expect(wrapper.get('.projectHeading h2').text()).toBe('brand-app')
  })

  it('filters ports and expands process details', async () => {
    const { stopPortSafely } = installApi([
      {
        port: 8866, pid: 123, processName: 'node', protocol: 'TCP', address: '0.0.0.0',
        state: 'LISTEN', category: 'project', description: 'brand-app · npm run dev · rojs',
        commandLine: 'node scripts/dev.js --token [已隱藏]', cwd: '/workspace/brand-app',
        parentPid: 100, processGroupId: 100, elapsedTime: '00:12:00', projectName: 'brand-app',
        processUser: 'developer', canStop: true, stopMode: 'managed', stopReason: '由控制台管理。',
      },
      {
        port: 3000, pid: 456, processName: 'node', protocol: 'TCP', address: '127.0.0.1',
        state: 'LISTEN', category: 'node', description: 'Node.js 服務 · api', cwd: '/tmp/api',
      },
      {
        port: 5000, pid: 637, processName: 'ControlCe', protocol: 'TCP', address: '0.0.0.0',
        state: 'LISTEN', category: 'system', description: 'macOS 控制中心服務',
      },
    ])
    const wrapper = mount(App)
    await flushPromises()
    await wrapper.findAll('.viewTabs button')[1]!.trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.portRow')).toHaveLength(3)
    const projectFilter = wrapper.findAll('.portFilters button').find((button) => button.text().includes('專案'))
    await projectFilter!.trigger('click')
    expect(wrapper.findAll('.portRow')).toHaveLength(1)
    expect(wrapper.get('.portRow').text()).toContain('brand-app · npm run dev · rojs')

    await wrapper.get('.portRow').trigger('click')
    expect(wrapper.get('.portDetails').text()).toContain('node scripts/dev.js --token [已隱藏]')
    expect(wrapper.get('.portDetails').text()).toContain('/workspace/brand-app')

    await wrapper.get('.stopPortButton').trigger('click')
    expect(wrapper.get('.portStopDialog').text()).toContain('停用 Port 8866')
    await wrapper.get('.confirmStopButton').trigger('click')
    await flushPromises()
    expect(stopPortSafely).toHaveBeenCalledWith({ port: 8866, pid: 123 })
  })

  it('opens the folder chooser on first launch and stays safe when canceled', async () => {
    const { selectWorkspace } = installApi([], '')
    const wrapper = mount(App)
    await flushPromises()

    expect(selectWorkspace).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('尚未選擇')
    expect(wrapper.text()).toContain('選擇工作區')
  })

  it('shows local environment diagnostics and public project links', async () => {
    installApi()
    const wrapper = mount(App)
    await flushPromises()
    await wrapper.findAll('.viewTabs button')[2]!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('環境診斷')
    expect(wrapper.text()).toContain('43.2.0')
    expect(wrapper.text()).toContain('Node.js')
    expect(wrapper.text()).toContain('GitHub Repository')
  })
})

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type {
  EnvironmentDiagnostics,
  PortCategory,
  PortRecord,
  ProjectScript,
  ProjectSummary,
  ProjectPage,
  TaskLog,
  TaskRecord,
} from '../shared/types'

type ViewName = 'projects' | 'ports' | 'diagnostics'
type PortFilter = 'all' | PortCategory

const projects = ref<ProjectSummary[]>([])
const tasks = ref<TaskRecord[]>([])
const logsByTask = ref<Record<string, TaskLog[]>>({})
const ports = ref<PortRecord[]>([])
const workspaceRoot = ref('')
const selectedProjectId = ref('')
const selectedTaskId = ref('')
const searchQuery = ref('')
const activeView = ref<ViewName>('projects')
const brandSelections = ref<Record<string, string>>({})
const workspaceWarnings = ref<string[]>([])
const errorMessage = ref('')
const toastMessage = ref('')
const isScanning = ref(false)
const isScanningPorts = ref(false)
const lastPortScanAt = ref<Date | null>(null)
const portFilter = ref<PortFilter>('all')
const expandedPortKey = ref('')
const pendingStopRecord = ref<PortRecord | null>(null)
const isStoppingPort = ref(false)
const diagnostics = ref<EnvironmentDiagnostics | null>(null)
const isLoadingDiagnostics = ref(false)
const terminalElement = ref<HTMLElement | null>(null)
const editingProjectId = ref('')
const projectNameDraft = ref('')
const savingPreferenceProjectId = ref('')

let removeLogListener: (() => void) | null = null
let removeStateListener: (() => void) | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null

const runningStatuses = new Set(['starting', 'running', 'stopping'])
const commonScriptNames = ['dev', 'serve', 'build', 'build_sit', 'preview']
const portFilterOptions: Array<{ value: PortFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'project', label: '專案' },
  { value: 'node', label: 'Node' },
  { value: 'system', label: '系統' },
  { value: 'other', label: '其他' },
]

const filteredProjects = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return projects.value
  return projects.value.filter((project) =>
    `${project.name} ${project.originalName} ${project.relativePath}`.toLowerCase().includes(query),
  )
})

const pinnedProjects = computed(() => filteredProjects.value
  .filter((project) => project.isPinned)
  .sort((a, b) => (a.pinnedAt ?? '').localeCompare(b.pinnedAt ?? '')))

const regularProjects = computed(() => filteredProjects.value.filter((project) => !project.isPinned))

const projectSections = computed(() => [
  { key: 'pinned', label: '已釘選', projects: pinnedProjects.value },
  { key: 'all', label: pinnedProjects.value.length ? '所有專案' : '', projects: regularProjects.value },
].filter((section) => section.projects.length > 0))

const selectedProject = computed(() =>
  projects.value.find((project) => project.id === selectedProjectId.value) ?? null,
)

const projectTasks = computed(() =>
  tasks.value.filter((task) => task.projectId === selectedProjectId.value),
)

const activeProjectTask = computed(() =>
  projectTasks.value.find((task) => runningStatuses.has(task.status)) ?? null,
)

const selectedTask = computed(() =>
  tasks.value.find((task) => task.taskId === selectedTaskId.value) ?? null,
)

const selectedLogs = computed(() =>
  selectedTaskId.value ? logsByTask.value[selectedTaskId.value] ?? [] : [],
)

const commonScripts = computed(() => {
  if (!selectedProject.value) return []
  return selectedProject.value.scripts.filter((script) => commonScriptNames.includes(script.name))
})

const otherScripts = computed(() => {
  if (!selectedProject.value) return []
  return selectedProject.value.scripts.filter((script) => !commonScriptNames.includes(script.name))
})

const filteredPorts = computed(() => {
  if (portFilter.value === 'all') return ports.value
  return ports.value.filter((record) => record.category === portFilter.value)
})

const portCounts = computed<Record<PortFilter, number>>(() => ({
  all: ports.value.length,
  project: ports.value.filter((record) => record.category === 'project').length,
  node: ports.value.filter((record) => record.category === 'node').length,
  system: ports.value.filter((record) => record.category === 'system').length,
  other: ports.value.filter((record) => record.category === 'other').length,
}))

function showToast(message: string) {
  toastMessage.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastMessage.value = ''
  }, 2_600)
}

function setProjects(nextProjects: ProjectSummary[]) {
  projects.value = nextProjects
  for (const project of nextProjects) {
    if (!brandSelections.value[project.id] && project.brands.length > 0) {
      brandSelections.value[project.id] = project.brands.includes('ot888')
        ? 'ot888'
        : project.brands[0] ?? ''
    }
  }

  if (!nextProjects.some((project) => project.id === selectedProjectId.value)) {
    selectProject(nextProjects[0]?.id ?? '')
  }
}

function replaceProject(nextProject: ProjectSummary) {
  projects.value = projects.value.map((project) => (
    project.id === nextProject.id ? nextProject : project
  ))
}

async function toggleProjectPin(project: ProjectSummary) {
  if (savingPreferenceProjectId.value) return
  savingPreferenceProjectId.value = project.id
  errorMessage.value = ''
  try {
    const result = await window.portManager.updateProjectPreference({
      projectId: project.id,
      isPinned: !project.isPinned,
    })
    if (!result.ok || !result.project) {
      errorMessage.value = result.error ?? '無法更新釘選狀態。'
      return
    }
    replaceProject(result.project)
    showToast(result.project.isPinned ? '專案已釘選' : '已取消釘選')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '無法更新釘選狀態。'
  } finally {
    savingPreferenceProjectId.value = ''
  }
}

async function beginProjectNameEdit() {
  const project = selectedProject.value
  if (!project || savingPreferenceProjectId.value) return
  editingProjectId.value = project.id
  projectNameDraft.value = project.name
  await nextTick()
  document.querySelector<HTMLInputElement>('.projectNameInput')?.focus()
  document.querySelector<HTMLInputElement>('.projectNameInput')?.select()
}

function cancelProjectNameEdit() {
  editingProjectId.value = ''
  projectNameDraft.value = ''
}

async function commitProjectName() {
  const project = selectedProject.value
  if (!project || editingProjectId.value !== project.id || savingPreferenceProjectId.value) return
  savingPreferenceProjectId.value = project.id
  errorMessage.value = ''
  try {
    const result = await window.portManager.updateProjectPreference({
      projectId: project.id,
      displayName: projectNameDraft.value,
    })
    if (!result.ok || !result.project) {
      errorMessage.value = result.error ?? '無法更新專案名稱。'
      return
    }
    replaceProject(result.project)
    cancelProjectNameEdit()
    showToast(result.project.name === result.project.originalName ? '已恢復原始名稱' : '專案名稱已更新')
    if (lastPortScanAt.value !== null) void scanPorts()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '無法更新專案名稱。'
  } finally {
    savingPreferenceProjectId.value = ''
  }
}

async function scanWorkspace() {
  if (isScanning.value) return
  isScanning.value = true
  errorMessage.value = ''
  try {
    const result = await window.portManager.scanWorkspace()
    if (!result.ok) {
      errorMessage.value = result.error ?? '工作區掃描失敗。'
      return
    }
    workspaceRoot.value = result.rootPath
    workspaceWarnings.value = result.warnings
    setProjects(result.projects)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '工作區掃描失敗。'
  } finally {
    isScanning.value = false
  }
}

async function selectWorkspace() {
  const result = await window.portManager.selectWorkspace()
  if (!result.ok) {
    errorMessage.value = result.error ?? '無法選擇工作區。'
    return
  }
  if (!result.canceled) await scanWorkspace()
}

function selectProject(projectId: string) {
  if (editingProjectId.value && editingProjectId.value !== projectId) cancelProjectNameEdit()
  selectedProjectId.value = projectId
  const latest = tasks.value.find((task) => task.projectId === projectId)
  selectedTaskId.value = latest?.taskId ?? ''
  if (latest) void loadTaskLogs(latest.taskId)
}

async function selectTask(taskId: string) {
  selectedTaskId.value = taskId
  await loadTaskLogs(taskId)
  await scrollTerminal()
}

async function loadTaskLogs(taskId: string) {
  if (logsByTask.value[taskId]) return
  logsByTask.value[taskId] = await window.portManager.getTaskLogs(taskId)
}

function upsertTask(task: TaskRecord) {
  const index = tasks.value.findIndex((item) => item.taskId === task.taskId)
  if (index === -1) {
    tasks.value = [task, ...tasks.value]
  } else {
    tasks.value[index] = task
    tasks.value = [...tasks.value]
  }
}

async function startScript(script: ProjectScript) {
  const project = selectedProject.value
  if (!project || activeProjectTask.value) return

  errorMessage.value = ''
  const brand = script.brandAware ? brandSelections.value[project.id] : undefined
  const result = await window.portManager.startTask({
    projectId: project.id,
    script: script.name,
    brand,
  })
  if (!result.ok || !result.task) {
    errorMessage.value = result.error ?? '任務啟動失敗。'
    return
  }

  upsertTask(result.task)
  selectedTaskId.value = result.task.taskId
  await loadTaskLogs(result.task.taskId)
  await scrollTerminal()
}

async function stopActiveTask() {
  const task = activeProjectTask.value
  if (!task) return
  const result = await window.portManager.stopTask(task.taskId)
  if (!result.ok) errorMessage.value = result.error ?? '停止任務失敗。'
}

async function openTaskUrl(task: TaskRecord) {
  if (!task.url) return
  const result = await window.portManager.openLocalUrl(task.url)
  if (!result.ok) errorMessage.value = result.error ?? '無法開啟網址。'
}

async function copyLogs() {
  const text = selectedLogs.value.map((log) => stripAnsi(log.text)).join('')
  await navigator.clipboard.writeText(text)
  showToast('日誌已複製')
}

function clearLogs() {
  if (!selectedTaskId.value) return
  logsByTask.value[selectedTaskId.value] = []
}

async function scanPorts() {
  if (isScanningPorts.value) return
  isScanningPorts.value = true
  errorMessage.value = ''
  try {
    const result = await window.portManager.scanPorts()
    if (!result.ok) {
      errorMessage.value = result.error ?? 'Port 掃描失敗。'
      return
    }
    ports.value = result.data
    if (expandedPortKey.value && !result.data.some((record) => portRowKey(record) === expandedPortKey.value)) {
      expandedPortKey.value = ''
    }
    lastPortScanAt.value = new Date()
  } finally {
    isScanningPorts.value = false
  }
}

function requestStopPort(record: PortRecord) {
  if (!record.canStop || record.pid == null) return
  pendingStopRecord.value = record
}

async function confirmStopPort() {
  const record = pendingStopRecord.value
  if (!record || record.pid == null || isStoppingPort.value) return

  isStoppingPort.value = true
  errorMessage.value = ''
  try {
    const result = await window.portManager.stopPortSafely({ port: record.port, pid: record.pid })
    if (!result.ok) {
      errorMessage.value = result.error ?? '安全停止失敗。'
      pendingStopRecord.value = null
      return
    }
    pendingStopRecord.value = null
    expandedPortKey.value = ''
    showToast(`Port ${record.port} 的服務已安全停止`)
    await scanPorts()
  } finally {
    isStoppingPort.value = false
  }
}

function portRowKey(record: PortRecord): string {
  return `${record.port}-${record.pid ?? 'na'}-${record.address}`
}

function togglePortDetails(record: PortRecord) {
  const key = portRowKey(record)
  expandedPortKey.value = expandedPortKey.value === key ? '' : key
}

function categoryLabel(category: PortCategory | undefined): string {
  return {
    project: '專案',
    node: 'Node',
    system: '系統',
    other: '其他',
  }[category ?? 'other']
}

function switchView(view: ViewName) {
  activeView.value = view
  if (view === 'ports' && lastPortScanAt.value == null) void scanPorts()
  if (view === 'diagnostics' && diagnostics.value == null) void loadDiagnostics()
}

async function loadDiagnostics() {
  if (isLoadingDiagnostics.value) return
  isLoadingDiagnostics.value = true
  try {
    diagnostics.value = await window.portManager.getEnvironmentDiagnostics()
  } finally {
    isLoadingDiagnostics.value = false
  }
}

async function openProjectPage(page: ProjectPage) {
  const result = await window.portManager.openProjectPage(page)
  if (!result.ok) errorMessage.value = result.error ?? '無法開啟專案頁面。'
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '')
}

function statusLabel(status: TaskRecord['status']): string {
  return {
    starting: '啟動中',
    running: '執行中',
    stopping: '停止中',
    succeeded: '已完成',
    failed: '失敗',
    stopped: '已停止',
  }[status]
}

function scriptTone(name: string): string {
  if (name === 'dev' || name === 'serve') return 'green'
  if (name.startsWith('build')) return 'violet'
  if (name === 'preview') return 'blue'
  return 'neutral'
}

async function scrollTerminal() {
  await nextTick()
  if (terminalElement.value) terminalElement.value.scrollTop = terminalElement.value.scrollHeight
}

onMounted(async () => {
  removeLogListener = window.portManager.onTaskLog((log) => {
    const current = logsByTask.value[log.taskId] ?? []
    logsByTask.value[log.taskId] = [...current, log].slice(-2_000)
    if (log.taskId === selectedTaskId.value) void scrollTerminal()
  })
  removeStateListener = window.portManager.onTaskState((task) => {
    upsertTask(task)
  })

  tasks.value = await window.portManager.listTasks()
  await scanWorkspace()
  if (!workspaceRoot.value) await selectWorkspace()
})

onBeforeUnmount(() => {
  removeLogListener?.()
  removeStateListener?.()
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<template>
  <div class="appShell">
    <header class="topbar">
      <div class="brandBlock">
        <div class="brandMark">PC</div>
        <div>
          <h1>Project Control Center</h1>
          <p>本機專案啟動與監控中心</p>
        </div>
      </div>

      <nav class="viewTabs" aria-label="主選單">
        <button :class="{ active: activeView === 'projects' }" @click="switchView('projects')">
          專案控制台
        </button>
        <button :class="{ active: activeView === 'ports' }" @click="switchView('ports')">
          Port 監控
        </button>
        <button :class="{ active: activeView === 'diagnostics' }" @click="switchView('diagnostics')">
          環境診斷
        </button>
      </nav>

      <div class="workspaceActions">
        <div class="workspacePath" :title="workspaceRoot">
          <span>工作區</span>
          <strong>{{ workspaceRoot || '尚未選擇' }}</strong>
        </div>
        <button class="iconButton" title="重新掃描" :disabled="isScanning" @click="scanWorkspace">↻</button>
        <button class="secondaryButton" @click="selectWorkspace">更換資料夾</button>
      </div>
    </header>

    <div v-if="errorMessage" class="alert errorAlert">
      <span>{{ errorMessage }}</span>
      <button @click="errorMessage = ''">×</button>
    </div>
    <div v-if="workspaceWarnings.length" class="alert warningAlert">
      已略過 {{ workspaceWarnings.length }} 個無法解析的項目。
      <span :title="workspaceWarnings.join('\n')">查看詳細</span>
    </div>

    <main v-if="activeView === 'projects'" class="workspaceLayout">
      <aside class="sidebar">
        <div class="sidebarHeader">
          <div>
            <span class="eyebrow">PROJECTS</span>
            <strong>{{ projects.length }} 個專案</strong>
          </div>
          <span class="runningCount">{{ tasks.filter((task) => runningStatuses.has(task.status)).length }} 執行中</span>
        </div>
        <label class="searchBox">
          <span>⌕</span>
          <input v-model="searchQuery" type="search" placeholder="搜尋專案…" />
        </label>
        <div class="projectList">
          <section v-for="section in projectSections" :key="section.key" class="projectSection">
            <div v-if="section.label" class="projectSectionTitle">
              <span>{{ section.label }}</span>
              <small>{{ section.projects.length }}</small>
            </div>
            <div v-for="project in section.projects" :key="project.id" class="projectItemRow">
              <button
                class="projectItem"
                :class="{ selected: project.id === selectedProjectId }"
                @click="selectProject(project.id)"
              >
                <span class="projectIcon">{{ project.name.slice(0, 2).toUpperCase() }}</span>
                <span class="projectMeta">
                  <strong>{{ project.name }}</strong>
                  <small>{{ project.relativePath }}</small>
                </span>
                <span
                  v-if="tasks.some((task) => task.projectId === project.id && runningStatuses.has(task.status))"
                  class="liveDot"
                  title="執行中"
                ></span>
              </button>
              <button
                class="projectPinButton"
                :class="{ pinned: project.isPinned }"
                :disabled="Boolean(savingPreferenceProjectId)"
                :aria-label="project.isPinned ? `取消釘選 ${project.name}` : `釘選 ${project.name}`"
                :title="project.isPinned ? '取消釘選' : '釘選專案'"
                @click="toggleProjectPin(project)"
              >★</button>
            </div>
          </section>
          <div v-if="filteredProjects.length === 0" class="emptyState compact">找不到符合的專案</div>
        </div>
      </aside>

      <section v-if="selectedProject" class="contentArea">
        <div class="projectHeading">
          <div class="projectIdentity">
            <span class="eyebrow">SELECTED PROJECT</span>
            <div class="projectNameRow">
              <button
                class="headingPinButton"
                :class="{ pinned: selectedProject.isPinned }"
                :disabled="Boolean(savingPreferenceProjectId)"
                :aria-label="selectedProject.isPinned ? '取消釘選專案' : '釘選專案'"
                @click="toggleProjectPin(selectedProject)"
              >★</button>
              <input
                v-if="editingProjectId === selectedProject.id"
                v-model="projectNameDraft"
                class="projectNameInput"
                maxlength="80"
                aria-label="自訂專案名稱"
                @keydown.enter.prevent="commitProjectName"
                @keydown.escape.prevent="cancelProjectNameEdit"
                @blur="commitProjectName"
              />
              <h2 v-else>{{ selectedProject.name }}</h2>
              <button
                v-if="editingProjectId !== selectedProject.id"
                class="editProjectNameButton"
                title="編輯顯示名稱"
                aria-label="編輯顯示名稱"
                @click="beginProjectNameEdit"
              >✎</button>
            </div>
            <small v-if="selectedProject.name !== selectedProject.originalName" class="originalProjectName">
              原始名稱：{{ selectedProject.originalName }}
            </small>
            <p>{{ selectedProject.path }}</p>
          </div>
          <div v-if="activeProjectTask" class="activeTaskBadge">
            <span class="pulse"></span>
            npm run {{ activeProjectTask.script }}
            <template v-if="activeProjectTask.brand"> · {{ activeProjectTask.brand }}</template>
          </div>
          <div v-else class="idleBadge">目前閒置</div>
        </div>

        <section class="commandSection">
          <div class="sectionTitle">
            <div>
              <h3>常用指令</h3>
              <p>點擊即可在此專案目錄執行 npm script</p>
            </div>
            <label v-if="selectedProject.brands.length" class="brandSelect">
              <span>品牌</span>
              <select v-model="brandSelections[selectedProject.id]" :disabled="Boolean(activeProjectTask)">
                <option v-for="brand in selectedProject.brands" :key="brand" :value="brand">{{ brand }}</option>
              </select>
            </label>
          </div>

          <div v-if="commonScripts.length" class="scriptGrid">
            <button
              v-for="script in commonScripts"
              :key="script.name"
              class="scriptCard"
              :class="scriptTone(script.name)"
              :disabled="Boolean(activeProjectTask)"
              @click="startScript(script)"
            >
              <span class="scriptGlyph">{{ script.name.startsWith('build') ? '◆' : script.name === 'preview' ? '◉' : '▶' }}</span>
              <span>
                <strong>npm run {{ script.name }}</strong>
                <small v-if="script.brandAware">使用 {{ brandSelections[selectedProject.id] }} 品牌</small>
                <small v-else>{{ script.command }}</small>
              </span>
            </button>
          </div>
          <div v-else class="emptyState compact">此專案沒有常用啟動或建置指令。</div>

          <details v-if="otherScripts.length" class="otherScripts">
            <summary>其他 scripts（{{ otherScripts.length }}）</summary>
            <div class="scriptChips">
              <button
                v-for="script in otherScripts"
                :key="script.name"
                :disabled="Boolean(activeProjectTask)"
                :title="script.command"
                @click="startScript(script)"
              >
                npm run {{ script.name }}
              </button>
            </div>
          </details>
        </section>

        <section class="terminalPanel">
          <header class="terminalHeader">
            <div class="terminalTitle">
              <span class="terminalDots"><i></i><i></i><i></i></span>
              <strong>執行終端</strong>
              <select v-if="projectTasks.length" v-model="selectedTaskId" @change="selectTask(selectedTaskId)">
                <option v-for="task in projectTasks" :key="task.taskId" :value="task.taskId">
                  {{ task.script }}{{ task.brand ? ` · ${task.brand}` : '' }} — {{ statusLabel(task.status) }}
                </option>
              </select>
            </div>
            <div class="terminalActions">
              <button v-if="selectedTask?.url" @click="openTaskUrl(selectedTask)">↗ 開啟網站</button>
              <button :disabled="!selectedLogs.length" @click="copyLogs">複製</button>
              <button :disabled="!selectedLogs.length" @click="clearLogs">清除</button>
              <button v-if="activeProjectTask" class="stopButton" @click="stopActiveTask">■ 停止</button>
            </div>
          </header>
          <div ref="terminalElement" class="terminalBody">
            <template v-if="selectedTask">
              <div class="terminalStatusLine">
                <span class="statusPill" :class="selectedTask.status">{{ statusLabel(selectedTask.status) }}</span>
                <span>PID {{ selectedTask.pid ?? '—' }}</span>
                <span>{{ new Date(selectedTask.startedAt).toLocaleString() }}</span>
                <span v-if="selectedTask.exitCode != null">exit {{ selectedTask.exitCode }}</span>
              </div>
              <pre><template v-for="log in selectedLogs" :key="`${log.timestamp}-${log.stream}-${log.text}`"><span :class="`log-${log.stream}`">{{ stripAnsi(log.text) }}</span></template></pre>
            </template>
            <div v-else class="terminalEmpty">
              <span>›_</span>
              <strong>尚未執行任何指令</strong>
              <p>從上方選擇一個 npm script 開始。</p>
            </div>
          </div>
        </section>
      </section>

      <section v-else class="contentArea emptyState">
        <span class="emptyIcon">⌘</span>
        <h2>尚未找到專案</h2>
        <p>選擇含有 package.json 的工作區，或重新掃描目前資料夾。</p>
        <button class="primaryButton" @click="selectWorkspace">選擇工作區</button>
      </section>
    </main>

    <main v-else-if="activeView === 'ports'" class="portsView">
      <div class="portsHeading">
        <div>
          <span class="eyebrow">LOCAL NETWORK</span>
          <h2>Port 監控</h2>
          <p>查看目前正在監聽的 TCP Port，並辨識由控制台啟動的專案。</p>
        </div>
        <div class="portActions">
          <span>最後更新：{{ lastPortScanAt?.toLocaleString() ?? '—' }}</span>
          <button class="primaryButton" :disabled="isScanningPorts" @click="scanPorts">
            {{ isScanningPorts ? '掃描中…' : '重新掃描' }}
          </button>
        </div>
      </div>
      <div class="portTableWrap">
        <div class="portFilters" aria-label="Port 程序分類">
          <button
            v-for="filter in portFilterOptions"
            :key="filter.value"
            :class="{ active: portFilter === filter.value }"
            @click="portFilter = filter.value"
          >
            {{ filter.label }} <span>{{ portCounts[filter.value] }}</span>
          </button>
        </div>
        <table>
          <thead><tr><th>Port</th><th>正在執行</th><th>分類</th><th>Process</th><th>PID</th><th>Address</th><th>狀態</th><th></th></tr></thead>
          <tbody>
            <template v-for="record in filteredPorts" :key="portRowKey(record)">
              <tr
                class="portRow"
                :class="{ expanded: expandedPortKey === portRowKey(record) }"
                tabindex="0"
                @click="togglePortDetails(record)"
                @keydown.enter.prevent="togglePortDetails(record)"
              >
                <td><strong class="portNumber">{{ record.port }}</strong></td>
                <td>
                  <div class="portDescription">
                    <strong>{{ record.description ?? `${record.processName} 程序` }}</strong>
                    <small v-if="record.projectName">{{ record.projectName }}</small>
                  </div>
                </td>
                <td><span class="categoryBadge" :class="record.category">{{ categoryLabel(record.category) }}</span></td>
                <td>{{ record.processName }}</td>
                <td>{{ record.pid ?? '—' }}</td>
                <td>{{ record.address }}</td>
                <td><span class="listenBadge">{{ record.state }}</span></td>
                <td>
                  <div class="portRowActions">
                    <button
                      class="stopPortButton"
                      :disabled="!record.canStop"
                      :title="record.stopReason"
                      aria-label="安全停止此 Port 的服務"
                      @click.stop="requestStopPort(record)"
                    >停用</button>
                    <button class="detailToggle" :aria-label="expandedPortKey === portRowKey(record) ? '收合程序詳情' : '展開程序詳情'">⌄</button>
                  </div>
                </td>
              </tr>
              <tr v-if="expandedPortKey === portRowKey(record)" class="portDetailsRow">
                <td colspan="8">
                  <div class="portDetails">
                    <div><span>完整命令</span><code>{{ record.commandLine || '無權限取得或程序已結束' }}</code></div>
                    <div><span>執行目錄</span><code>{{ record.cwd || '無權限取得' }}</code></div>
                    <dl>
                      <div><dt>PID</dt><dd>{{ record.pid ?? '—' }}</dd></div>
                      <div><dt>父 PID</dt><dd>{{ record.parentPid ?? '—' }}</dd></div>
                      <div><dt>程序群組</dt><dd>{{ record.processGroupId ?? '—' }}</dd></div>
                      <div><dt>執行時間</dt><dd>{{ record.elapsedTime || '—' }}</dd></div>
                      <div><dt>協定</dt><dd>{{ record.protocol }}</dd></div>
                      <div><dt>關聯專案</dt><dd>{{ record.projectName || '—' }}</dd></div>
                      <div><dt>程序使用者</dt><dd>{{ record.processUser || '—' }}</dd></div>
                    </dl>
                    <p class="redactionNote">敏感命令列參數會自動隱藏。{{ record.stopReason }}</p>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <div v-if="!isScanningPorts && filteredPorts.length === 0" class="emptyState compact">
          {{ ports.length === 0 ? '目前沒有偵測到監聽中的 TCP Port。' : '此分類目前沒有監聽中的程序。' }}
        </div>
      </div>
    </main>

    <main v-else class="diagnosticsView">
      <div class="diagnosticsHeading">
        <div>
          <span class="eyebrow">SYSTEM READINESS</span>
          <h2>環境診斷</h2>
          <p>確認 Project Control Center 執行 npm 專案與 Port 監控所需的本機工具。</p>
        </div>
        <button class="primaryButton" :disabled="isLoadingDiagnostics" @click="loadDiagnostics">
          {{ isLoadingDiagnostics ? '檢查中…' : '重新檢查' }}
        </button>
      </div>

      <template v-if="diagnostics">
        <section class="versionSummary">
          <div><span>App</span><strong>v{{ diagnostics.appVersion }}</strong></div>
          <div><span>Electron</span><strong>{{ diagnostics.electronVersion }}</strong></div>
          <div><span>Bundled Node</span><strong>{{ diagnostics.bundledNodeVersion }}</strong></div>
          <div><span>macOS Kernel</span><strong>{{ diagnostics.osVersion }}</strong></div>
          <div><span>Architecture</span><strong>{{ diagnostics.architecture }}</strong></div>
          <div><span>License</span><strong>MIT</strong></div>
        </section>

        <section class="diagnosticGrid">
          <article v-for="item in diagnostics.checks" :key="item.key" class="diagnosticCard" :class="item.status">
            <header>
              <span class="diagnosticIndicator">{{ item.status === 'ok' ? '✓' : item.status === 'warning' ? '!' : '×' }}</span>
              <strong>{{ item.label }}</strong>
              <span class="diagnosticStatus">{{ item.status === 'ok' ? '正常' : item.status === 'warning' ? '注意' : '錯誤' }}</span>
            </header>
            <code>{{ item.value }}</code>
            <p>{{ item.message }}</p>
          </article>
        </section>

        <section class="projectLinksPanel">
          <div>
            <h3>Project Control Center</h3>
            <p>開源於 MIT License。第一版透過 GitHub Releases 手動下載更新。</p>
          </div>
          <div class="projectLinkActions">
            <button @click="openProjectPage('repository')">GitHub Repository</button>
            <button @click="openProjectPage('releases')">下載更新</button>
            <button @click="openProjectPage('issues')">回報問題</button>
            <button @click="openProjectPage('license')">MIT License</button>
          </div>
        </section>
      </template>
      <div v-else class="emptyState compact">正在取得環境資訊…</div>
    </main>

    <div v-if="pendingStopRecord" class="portStopOverlay" @click.self="pendingStopRecord = null">
      <section class="portStopDialog" role="dialog" aria-modal="true" aria-labelledby="stop-port-title">
        <div class="stopDialogIcon">■</div>
        <div>
          <span class="eyebrow">SAFE STOP</span>
          <h2 id="stop-port-title">停用 Port {{ pendingStopRecord.port }} 的服務？</h2>
          <p>{{ pendingStopRecord.description }}</p>
        </div>
        <dl>
          <div><dt>PID</dt><dd>{{ pendingStopRecord.pid }}</dd></div>
          <div><dt>專案</dt><dd>{{ pendingStopRecord.projectName || '—' }}</dd></div>
          <div><dt>方式</dt><dd>{{ pendingStopRecord.stopMode === 'managed' ? '停止控制台任務' : '安全 SIGTERM' }}</dd></div>
        </dl>
        <div class="safeStopNotice">
          只會停止已重新驗證的工作區開發程序。系統服務、其他應用程式及工作區外程序不會受到影響。
        </div>
        <div class="stopDialogActions">
          <button :disabled="isStoppingPort" @click="pendingStopRecord = null">取消</button>
          <button class="confirmStopButton" :disabled="isStoppingPort" @click="confirmStopPort">
            {{ isStoppingPort ? '安全停止中…' : '確認停用' }}
          </button>
        </div>
      </section>
    </div>

    <div v-if="toastMessage" class="toast">✓ {{ toastMessage }}</div>
  </div>
</template>

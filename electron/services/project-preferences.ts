import type {
  ProjectPreferenceMap,
  ProjectSummary,
  UpdateProjectPreferenceInput,
} from '../../shared/types'

const MAX_DISPLAY_NAME_LENGTH = 80
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

export interface PreferenceUpdate {
  ok: boolean
  projects?: ProjectSummary[]
  preferences?: ProjectPreferenceMap
  project?: ProjectSummary
  error?: string
}

export function applyProjectPreferences(
  projects: ProjectSummary[],
  preferences: ProjectPreferenceMap,
): ProjectSummary[] {
  return projects.map((project) => {
    const preference = preferences[project.id]
    const originalName = project.originalName || project.name
    const displayName = validStoredDisplayName(preference?.displayName)
    const pinnedAt = validTimestamp(preference?.pinnedAt)
    return {
      ...project,
      originalName,
      name: displayName ?? originalName,
      isPinned: pinnedAt !== null,
      pinnedAt,
    }
  })
}

export function updateProjectPreference(
  projects: ProjectSummary[],
  preferences: ProjectPreferenceMap,
  input: UpdateProjectPreferenceInput,
  timestamp = new Date().toISOString(),
): PreferenceUpdate {
  if (!input || typeof input.projectId !== 'string') {
    return { ok: false, error: '專案偏好設定要求無效。' }
  }
  const project = projects.find((item) => item.id === input.projectId)
  if (!project) return { ok: false, error: '找不到專案，請重新掃描工作區。' }

  const updatesPin = Object.prototype.hasOwnProperty.call(input, 'isPinned')
  const updatesName = Object.prototype.hasOwnProperty.call(input, 'displayName')
  if (!updatesPin && !updatesName) return { ok: false, error: '沒有可更新的專案偏好。' }
  if (updatesPin && typeof input.isPinned !== 'boolean') {
    return { ok: false, error: '釘選狀態無效。' }
  }

  const nextPreference = { ...preferences[project.id] }
  if (updatesName) {
    if (input.displayName !== null && typeof input.displayName !== 'string') {
      return { ok: false, error: '自訂名稱格式無效。' }
    }
    const displayName = input.displayName?.trim() ?? ''
    if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      return { ok: false, error: `自訂名稱不可超過 ${MAX_DISPLAY_NAME_LENGTH} 個字元。` }
    }
    if (CONTROL_CHARACTER_PATTERN.test(displayName)) {
      return { ok: false, error: '自訂名稱不可包含換行或控制字元。' }
    }
    if (displayName) nextPreference.displayName = displayName
    else delete nextPreference.displayName
  }

  if (updatesPin) {
    if (input.isPinned) nextPreference.pinnedAt ??= timestamp
    else delete nextPreference.pinnedAt
  }

  const nextPreferences = { ...preferences }
  if (Object.keys(nextPreference).length > 0) nextPreferences[project.id] = nextPreference
  else delete nextPreferences[project.id]

  const nextProjects = applyProjectPreferences(projects, nextPreferences)
  return {
    ok: true,
    projects: nextProjects,
    preferences: nextPreferences,
    project: nextProjects.find((item) => item.id === project.id),
  }
}

function validStoredDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_DISPLAY_NAME_LENGTH || CONTROL_CHARACTER_PATTERN.test(trimmed)) {
    return null
  }
  return trimmed
}

function validTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value || Number.isNaN(Date.parse(value))) return null
  return value
}

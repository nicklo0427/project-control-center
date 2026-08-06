import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ProjectPreferenceMap } from '../../shared/types'

interface SettingsFile {
  workspaceRoot?: string
  projectPreferences?: ProjectPreferenceMap
}

export class SettingsStore {
  private readonly settingsPath: string
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(userDataPath: string) {
    this.settingsPath = path.join(userDataPath, 'project-control-center.json')
  }

  async getWorkspaceRoot(): Promise<string | null> {
    const settings = await this.readSettings()
    return typeof settings.workspaceRoot === 'string' && settings.workspaceRoot
      ? settings.workspaceRoot
      : null
  }

  async setWorkspaceRoot(workspaceRoot: string): Promise<void> {
    await this.updateSettings((settings) => ({ ...settings, workspaceRoot }))
  }

  async getProjectPreferences(): Promise<ProjectPreferenceMap> {
    const settings = await this.readSettings()
    if (!settings.projectPreferences || typeof settings.projectPreferences !== 'object') return {}
    return structuredClone(settings.projectPreferences)
  }

  async setProjectPreferences(projectPreferences: ProjectPreferenceMap): Promise<void> {
    await this.updateSettings((settings) => ({
      ...settings,
      projectPreferences: structuredClone(projectPreferences),
    }))
  }

  private async readSettings(): Promise<SettingsFile> {
    await this.writeQueue.catch(() => undefined)
    try {
      const parsed = JSON.parse(await readFile(this.settingsPath, 'utf8')) as SettingsFile
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  private async updateSettings(
    updater: (settings: SettingsFile) => SettingsFile,
  ): Promise<void> {
    const operation = this.writeQueue.catch(() => undefined).then(async () => {
      let current: SettingsFile = {}
      try {
        const parsed = JSON.parse(await readFile(this.settingsPath, 'utf8')) as SettingsFile
        if (parsed && typeof parsed === 'object') current = parsed
      } catch {
        // Missing and malformed settings are safely replaced by the next valid update.
      }

      await mkdir(path.dirname(this.settingsPath), { recursive: true })
      const temporaryPath = `${this.settingsPath}.tmp`
      await writeFile(temporaryPath, JSON.stringify(updater(current), null, 2), 'utf8')
      await rename(temporaryPath, this.settingsPath)
    })
    this.writeQueue = operation
    await operation
  }
}

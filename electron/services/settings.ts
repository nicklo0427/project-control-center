import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

interface SettingsFile {
  workspaceRoot?: string
}

export class SettingsStore {
  private readonly settingsPath: string

  constructor(userDataPath: string) {
    this.settingsPath = path.join(userDataPath, 'project-control-center.json')
  }

  async getWorkspaceRoot(): Promise<string | null> {
    try {
      const parsed = JSON.parse(await readFile(this.settingsPath, 'utf8')) as SettingsFile
      return typeof parsed.workspaceRoot === 'string' && parsed.workspaceRoot
        ? parsed.workspaceRoot
        : null
    } catch {
      return null
    }
  }

  async setWorkspaceRoot(workspaceRoot: string): Promise<void> {
    await mkdir(path.dirname(this.settingsPath), { recursive: true })
    const temporaryPath = `${this.settingsPath}.tmp`
    await writeFile(temporaryPath, JSON.stringify({ workspaceRoot }, null, 2), 'utf8')
    await rename(temporaryPath, this.settingsPath)
  }
}

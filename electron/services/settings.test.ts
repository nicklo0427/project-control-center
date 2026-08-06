import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsStore } from './settings'

const temporaryDirectories: string[] = []

async function createStore() {
  const directory = await mkdtemp(path.join(tmpdir(), 'project-control-settings-'))
  temporaryDirectories.push(directory)
  return {
    directory,
    settingsPath: path.join(directory, 'project-control-center.json'),
    store: new SettingsStore(directory),
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

describe('SettingsStore', () => {
  it('upgrades a workspace-only settings file without losing its value', async () => {
    const { settingsPath, store } = await createStore()
    await writeFile(settingsPath, JSON.stringify({ workspaceRoot: '/workspace' }), 'utf8')

    await store.setProjectPreferences({ one: { displayName: 'My App' } })

    expect(await store.getWorkspaceRoot()).toBe('/workspace')
    expect(await store.getProjectPreferences()).toEqual({ one: { displayName: 'My App' } })
  })

  it('safely replaces malformed settings on the next valid update', async () => {
    const { settingsPath, store } = await createStore()
    await writeFile(settingsPath, '{ invalid', 'utf8')

    expect(await store.getWorkspaceRoot()).toBeNull()
    await store.setWorkspaceRoot('/workspace')

    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({ workspaceRoot: '/workspace' })
  })

  it('serializes concurrent updates so workspace and preferences are both retained', async () => {
    const { settingsPath, store } = await createStore()

    await Promise.all([
      store.setWorkspaceRoot('/workspace'),
      store.setProjectPreferences({ one: { pinnedAt: '2026-08-06T01:00:00.000Z' } }),
    ])

    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({
      workspaceRoot: '/workspace',
      projectPreferences: { one: { pinnedAt: '2026-08-06T01:00:00.000Z' } },
    })
  })
})

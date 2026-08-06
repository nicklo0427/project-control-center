import { describe, expect, it } from 'vitest'
import type { ProjectSummary } from '../../shared/types'
import { applyProjectPreferences, updateProjectPreference } from './project-preferences'

function project(id: string, name = id): ProjectSummary {
  return {
    id,
    name,
    originalName: name,
    path: `/workspace/${id}`,
    relativePath: id,
    scripts: [],
    brands: [],
    isPinned: false,
    pinnedAt: null,
  }
}

describe('project preferences', () => {
  it('applies valid names and pin timestamps while ignoring malformed stored values', () => {
    const projects = applyProjectPreferences([project('one'), project('two')], {
      one: { displayName: '  My App  ', pinnedAt: '2026-08-06T01:00:00.000Z' },
      two: { displayName: 'bad\nname', pinnedAt: 'invalid' },
    })

    expect(projects[0]).toMatchObject({ name: 'My App', originalName: 'one', isPinned: true })
    expect(projects[1]).toMatchObject({ name: 'two', isPinned: false, pinnedAt: null })
  })

  it('rejects unknown projects and invalid display names', () => {
    const projects = [project('one')]

    expect(updateProjectPreference(projects, {}, { projectId: 'missing', isPinned: true }).ok).toBe(false)
    expect(updateProjectPreference(projects, {}, { projectId: 'one', displayName: 'x'.repeat(81) }).ok).toBe(false)
    expect(updateProjectPreference(projects, {}, { projectId: 'one', displayName: 'bad\nname' }).ok).toBe(false)
  })

  it('allows duplicate names, resets empty names, and moves a re-pinned project to a new timestamp', () => {
    const projects = [project('one'), project('two')]
    const renamedOne = updateProjectPreference(projects, {}, { projectId: 'one', displayName: 'Shared' })
    const renamedTwo = updateProjectPreference(
      renamedOne.projects!,
      renamedOne.preferences!,
      { projectId: 'two', displayName: 'Shared' },
    )
    expect(renamedTwo.projects?.map((item) => item.name)).toEqual(['Shared', 'Shared'])

    const reset = updateProjectPreference(
      renamedTwo.projects!,
      renamedTwo.preferences!,
      { projectId: 'one', displayName: '   ' },
    )
    expect(reset.project?.name).toBe('one')

    const pinned = updateProjectPreference(
      reset.projects!, reset.preferences!, { projectId: 'one', isPinned: true }, '2026-08-06T01:00:00.000Z',
    )
    const unpinned = updateProjectPreference(
      pinned.projects!, pinned.preferences!, { projectId: 'one', isPinned: false },
    )
    const repinned = updateProjectPreference(
      unpinned.projects!, unpinned.preferences!, { projectId: 'one', isPinned: true }, '2026-08-06T02:00:00.000Z',
    )
    expect(repinned.project?.pinnedAt).toBe('2026-08-06T02:00:00.000Z')
  })
})

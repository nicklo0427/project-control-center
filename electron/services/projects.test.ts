import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectBrands, isBrandAwareScript, scanProjects } from './projects'

async function writePackage(directory: string, value: unknown) {
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify(value), 'utf8')
}

describe('project discovery', () => {
  it('discovers npm projects and excludes node_modules and the controller itself', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'project-control-'))
    const ownPath = path.join(root, 'port-manager')
    await writePackage(path.join(root, 'web-app'), { name: 'web-app', scripts: { dev: 'vite' } })
    await writePackage(path.join(root, 'node_modules', 'ignored'), { scripts: { dev: 'vite' } })
    await writePackage(ownPath, { name: 'project-control-center', scripts: { dev: 'vite' } })

    const result = await scanProjects(root, ownPath)

    expect(result.ok).toBe(true)
    expect(result.projects.map((project) => project.name)).toEqual(['web-app'])
  })

  it('excludes the packaged controller by package name when its source path is unavailable', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'project-control-'))
    await writePackage(path.join(root, 'port-manager'), {
      name: 'project-control-center',
      scripts: { dev: 'vite' },
    })

    const result = await scanProjects(root, '/Applications/Project Control Center.app')

    expect(result.projects).toEqual([])
  })

  it('reports invalid package files without failing the full scan', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'project-control-'))
    const invalidPath = path.join(root, 'broken')
    await mkdir(invalidPath, { recursive: true })
    await writeFile(path.join(invalidPath, 'package.json'), '{ nope', 'utf8')

    const result = await scanProjects(root, path.join(root, 'controller'))

    expect(result.ok).toBe(true)
    expect(result.projects).toEqual([])
    expect(result.warnings[0]).toContain('package.json')
  })

  it('detects directory, script-name, and environment brands', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'project-control-'))
    await mkdir(path.join(root, 'src', 'brands', 'ot888'), { recursive: true })
    await mkdir(path.join(root, 'public', 'rojs'), { recursive: true })

    const brands = await detectBrands(root, {
      'dev:demo': 'vite',
      serve: 'cross-env BRAND=tq88 vite',
    })

    expect(brands).toEqual(['ot888', 'demo', 'rojs', 'tq88'])
    expect(isBrandAwareScript('dev', 'node scripts/dev.js', brands)).toBe(true)
    expect(isBrandAwareScript('lint', 'eslint .', brands)).toBe(false)
  })
})

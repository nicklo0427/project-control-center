import { createHash } from 'node:crypto'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ProjectScript, ProjectSummary, ScanProjectsResult } from '../../shared/types'

const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'dist-electron',
  'build',
  'coverage',
  'release',
  '.nuxt',
  '.output',
  '.git',
])

const GENERIC_PUBLIC_DIRECTORIES = new Set([
  'assets',
  'css',
  'fonts',
  'icons',
  'images',
  'img',
  'js',
  'static',
])

interface PackageJsonShape {
  name?: unknown
  scripts?: unknown
}

function stableProjectId(projectPath: string): string {
  return createHash('sha1').update(projectPath).digest('hex').slice(0, 16)
}

async function listChildDirectories(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

export async function detectBrands(
  projectPath: string,
  scripts: Record<string, string>,
): Promise<string[]> {
  const brands = new Set<string>()
  const sourceBrands = await listChildDirectories(path.join(projectPath, 'src', 'brands'))
  sourceBrands.forEach((brand) => brands.add(brand))

  const publicDirectories = await listChildDirectories(path.join(projectPath, 'public'))
  publicDirectories
    .filter((name) => !GENERIC_PUBLIC_DIRECTORIES.has(name.toLowerCase()))
    .forEach((brand) => brands.add(brand))

  for (const [scriptName, command] of Object.entries(scripts)) {
    const devBrandMatch = scriptName.match(/^dev:([a-zA-Z0-9_-]+)$/)
    if (devBrandMatch?.[1]) {
      brands.add(devBrandMatch[1])
    }

    for (const match of command.matchAll(/(?:VITE_)?BRAND=([a-zA-Z0-9_-]+)/g)) {
      if (match[1]) {
        brands.add(match[1])
      }
    }
  }

  return [...brands].sort((a, b) => {
    if (a === 'ot888') return -1
    if (b === 'ot888') return 1
    return a.localeCompare(b)
  })
}

export function isBrandAwareScript(scriptName: string, command: string, brands: string[]): boolean {
  if (brands.length === 0 || !/^(dev|build|build_sit)$/.test(scriptName)) {
    return false
  }

  return /node\s+(?:\.\/)?scripts\/(?:dev|build|build_sit)\.js(?:\s|$)/.test(command)
}

async function parseProject(
  packagePath: string,
  rootPath: string,
  warnings: string[],
): Promise<ProjectSummary | null> {
  try {
    const raw = await readFile(packagePath, 'utf8')
    const parsed = JSON.parse(raw) as PackageJsonShape
    if (!parsed.scripts || typeof parsed.scripts !== 'object' || Array.isArray(parsed.scripts)) {
      return null
    }

    const rawScripts = Object.fromEntries(
      Object.entries(parsed.scripts).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )
    if (Object.keys(rawScripts).length === 0) {
      return null
    }

    const projectPath = path.dirname(packagePath)
    const brands = await detectBrands(projectPath, rawScripts)
    const scripts: ProjectScript[] = Object.entries(rawScripts).map(([name, command]) => ({
      name,
      command,
      brandAware: isBrandAwareScript(name, command, brands),
    }))

    return {
      id: stableProjectId(projectPath),
      name: typeof parsed.name === 'string' && parsed.name.trim()
        ? parsed.name
        : path.basename(projectPath),
      path: projectPath,
      relativePath: path.relative(rootPath, projectPath) || '.',
      scripts,
      brands,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知錯誤'
    warnings.push(`${packagePath}: ${message}`)
    return null
  }
}

export async function scanProjects(
  rootPath: string,
  ownProjectPath: string,
): Promise<ScanProjectsResult> {
  const warnings: string[] = []

  try {
    const rootStats = await stat(rootPath)
    if (!rootStats.isDirectory()) {
      throw new Error('選擇的工作區不是資料夾')
    }

    const normalizedRoot = await realpath(rootPath)
    const normalizedOwnPath = await realpath(ownProjectPath).catch(() => path.resolve(ownProjectPath))
    const queue = [normalizedRoot]
    const projects: ProjectSummary[] = []

    while (queue.length > 0) {
      const currentPath = queue.shift()
      if (!currentPath) continue

      let entries
      try {
        entries = await readdir(currentPath, { withFileTypes: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : '無法讀取'
        warnings.push(`${currentPath}: ${message}`)
        continue
      }

      const packageEntry = entries.find((entry) => entry.isFile() && entry.name === 'package.json')
      if (packageEntry && path.resolve(currentPath) !== path.resolve(normalizedOwnPath)) {
        const project = await parseProject(path.join(currentPath, packageEntry.name), normalizedRoot, warnings)
        if (project && project.name !== 'project-control-center') projects.push(project)
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith('.') || EXCLUDED_DIRECTORIES.has(entry.name)) continue
        const nextPath = path.join(currentPath, entry.name)
        if (path.resolve(nextPath) === path.resolve(normalizedOwnPath)) continue
        queue.push(nextPath)
      }
    }

    projects.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    return { ok: true, rootPath: normalizedRoot, projects, warnings }
  } catch (error) {
    const message = error instanceof Error ? error.message : '掃描失敗'
    return { ok: false, rootPath, projects: [], warnings, error: `掃描專案失敗：${message}` }
  }
}

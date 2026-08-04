import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import png2icons from 'png2icons'
import sharp from 'sharp'

const projectRoot = path.resolve(import.meta.dirname, '..')
const sourcePath = path.join(projectRoot, 'public', 'project-control-center.svg')
const buildPath = path.join(projectRoot, 'build')
const outputPath = path.join(buildPath, 'icon.icns')
const source = await readFile(sourcePath)

await mkdir(buildPath, { recursive: true })
const sourcePng = await sharp(source).resize(1024, 1024).png().toBuffer()
const icon = png2icons.createICNS(sourcePng, png2icons.BICUBIC2, 0)
if (!icon) throw new Error('Unable to create macOS icon from the SVG source.')
await writeFile(outputPath, icon)
console.log(`Generated ${outputPath}`)

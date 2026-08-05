import { execFile, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
const DEFAULT_TIMEOUT = '45m'

function requireEnvironment(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function authenticationArguments() {
  return [
    '--key',
    requireEnvironment('APPLE_API_KEY'),
    '--key-id',
    requireEnvironment('APPLE_API_KEY_ID'),
    '--issuer',
    requireEnvironment('APPLE_API_ISSUER'),
  ]
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })

    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }

      const reason = signal ? `signal ${signal}` : `exit code ${code}`
      reject(new Error(`${command} failed with ${reason}`))
    })
  })
}

async function runJson(command, args) {
  const { stdout, stderr } = await new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
      (error, commandStdout, commandStderr) => {
        if (error) {
          reject(error)
          return
        }
        resolve({ stdout: commandStdout, stderr: commandStderr })
      },
    )
  })

  if (stderr.trim()) {
    process.stderr.write(stderr)
  }

  return JSON.parse(stdout)
}

async function submissionInfo(submissionId, authArgs) {
  return runJson('xcrun', [
    'notarytool',
    'info',
    submissionId,
    ...authArgs,
    '--output-format',
    'json',
  ])
}

async function printFailureLog(submissionId, authArgs) {
  try {
    await run('xcrun', ['notarytool', 'log', submissionId, ...authArgs])
  } catch (error) {
    console.warn(`Could not retrieve Apple notarization log for ${submissionId}: ${error.message}`)
  }
}

export async function notarizeAndStaple(filePath, options = {}) {
  const label = options.label ?? basename(filePath)
  const staplePath = options.staplePath ?? filePath
  const timeout = options.timeout ?? DEFAULT_TIMEOUT
  const authArgs = authenticationArguments()

  console.log(`Submitting ${label} to Apple Notary service...`)
  const submission = await runJson('xcrun', [
    'notarytool',
    'submit',
    filePath,
    ...authArgs,
    '--output-format',
    'json',
    '--no-progress',
  ])

  const submissionId = submission.id
  if (!submissionId) {
    throw new Error(`Apple did not return a submission ID for ${label}`)
  }

  console.log(`Apple notarization submission ID (${label}): ${submissionId}`)
  console.log(`Waiting up to ${timeout} for Apple notarization...`)

  let waitError
  try {
    await run('xcrun', [
      'notarytool',
      'wait',
      submissionId,
      ...authArgs,
      '--timeout',
      timeout,
    ])
  } catch (error) {
    waitError = error
  }

  const info = await submissionInfo(submissionId, authArgs)
  console.log(`Apple notarization status (${label}): ${info.status ?? 'Unknown'}`)

  if (info.status !== 'Accepted') {
    if (info.status === 'Invalid') {
      await printFailureLog(submissionId, authArgs)
    }

    const suffix = waitError ? ` ${waitError.message}.` : ''
    throw new Error(
      `Apple notarization did not finish successfully for ${label}.${suffix} ` +
        `Submission ID: ${submissionId}; status: ${info.status ?? 'Unknown'}`,
    )
  }

  await run('xcrun', ['stapler', 'staple', staplePath])
  await run('xcrun', ['stapler', 'validate', staplePath])
  console.log(`Notarization accepted and ticket stapled (${label}): ${submissionId}`)

  return submissionId
}

export default async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }

  const productName = context.packager.appInfo.productFilename
  const appPath = join(context.appOutDir, `${productName}.app`)
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'project-control-center-notary-'))
  const archivePath = join(temporaryDirectory, `${productName}.zip`)

  try {
    console.log(`Creating notarization archive: ${archivePath}`)
    await run('ditto', ['-c', '-k', '--keepParent', appPath, archivePath])
    await notarizeAndStaple(archivePath, {
      label: `${productName}.app`,
      staplePath: appPath,
      timeout: process.env.APPLE_NOTARY_TIMEOUT ?? DEFAULT_TIMEOUT,
    })
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

async function main() {
  const filePath = process.argv[2]
  if (!filePath) {
    throw new Error('Usage: node scripts/notarize-macos.mjs <file> [label]')
  }

  await notarizeAndStaple(filePath, {
    label: process.argv[3] ?? basename(filePath),
    timeout: process.env.APPLE_NOTARY_TIMEOUT ?? DEFAULT_TIMEOUT,
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { statSync } from 'node:fs'
import { sha256FileSync } from './local-release-lib.mjs'
import { validateExactZipMembers } from './release-artifact-provenance-lib.mjs'

// The full .NET payload is sealed by the native gate, not just its apphost.
export function validateWindowsPortableArchive(path, receipt, expectedTag) {
  const portable = receipt.portable
  const name = `nostr-vpn-${expectedTag}-windows-x64.zip`
  if (!portable || portable.name !== name || basename(path) !== name
      || portable.launched !== true || !/^[0-9a-f]{64}$/.test(portable.smokeReceiptSha256 ?? '')
      || portable.sha256 !== sha256FileSync(path) || portable.size !== statSync(path).size) {
    throw new Error('Windows portable archive lacks matching native launch evidence.')
  }
  const files = portable.files ?? {}
  const names = Object.keys(files)
  if (names.length === 0 || names.some(name => !name || name.startsWith('/')
      || name.includes('\\') || name.includes(':') || /[\r\n\0]/.test(name)
      || name.split('/').some(part => !part || part === '.' || part === '..'))
      || new Set(names.map(name => name.toLowerCase())).size !== names.length) {
    throw new Error('Windows portable payload has invalid or colliding file paths.')
  }
  validateExactZipMembers(path, names)
  const required = { app: 'NostrVpn.Windows.exe', appCore: 'nostr_vpn_app_core.dll',
    cli: 'nvpn.exe', wintun: 'binaries/wintun.dll' }
  for (const [key, file] of Object.entries(required)) {
    if (!files[file] || files[file].sha256 !== receipt.payloads?.[key]?.sha256
        || files[file].size !== receipt.payloads?.[key]?.size) {
      throw new Error(`Windows portable payload differs from installed ${key}.`)
    }
  }
  for (const file of ['Assets/nostr-vpn.ico', 'coreclr.dll', 'hostfxr.dll', 'NostrVpn.Windows.dll']) {
    if (!files[file]) throw new Error(`Windows portable payload is missing ${file}.`)
  }
  for (const [file, value] of Object.entries(files)) {
    const extracted = spawnSync('unzip', ['-p', path, file], { maxBuffer: 1024 * 1024 * 1024 })
    if (!/^[0-9a-f]{64}$/.test(value.sha256 ?? '') || !Number.isSafeInteger(value.size)
        || value.size < 0 || extracted.status !== 0 || extracted.stdout.length !== value.size
        || createHash('sha256').update(extracted.stdout).digest('hex') !== value.sha256) {
      throw new Error(`Windows portable file differs from native gate: ${file}`)
    }
  }
  return Object.fromEntries(Object.entries(files).map(([file, value]) => [file, value.sha256]))
}

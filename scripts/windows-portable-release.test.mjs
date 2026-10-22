import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { validateWindowsPortableArchive } from './windows-portable-release.mjs'
import { validateReleaseAssetSet } from './local-release-lib.mjs'
const hash = data => createHash('sha256').update(data).digest('hex')

test('portable publication checks every runtime file against the installed and launched payload', () => {
  const root = mkdtempSync(join(tmpdir(), 'nvpn-portable-'))
  try {
    const required = { app: 'NostrVpn.Windows.exe', appCore: 'nostr_vpn_app_core.dll', cli: 'nvpn.exe', wintun: 'binaries/wintun.dll' }
    const names = [...Object.values(required), 'Assets/nostr-vpn.ico', 'coreclr.dll', 'hostfxr.dll', 'NostrVpn.Windows.dll']
    const files = {}
    for (const name of names) {
      const data = Buffer.from(`installed ${name}`)
      mkdirSync(dirname(join(root, name)), { recursive: true })
      writeFileSync(join(root, name), data)
      files[name] = { sha256: hash(data), size: data.length }
    }
    const archive = join(root, 'nostr-vpn-v4.1.20-windows-x64.zip')
    assert.equal(spawnSync('zip', ['-q', archive, ...names], { cwd: root }).status, 0)
    const bytes = readFileSync(archive)
    const receipt = { payloads: Object.fromEntries(Object.entries(required).map(([key, name]) => [key, files[name]])),
      portable: { name: 'nostr-vpn-v4.1.20-windows-x64.zip', sha256: hash(bytes), size: bytes.length, launched: true, smokeReceiptSha256: hash('smoke'), files } }
    assert.equal(Object.keys(validateWindowsPortableArchive(archive, receipt, 'v4.1.20')).length, names.length)
    const changed = structuredClone(receipt)
    changed.portable.files['coreclr.dll'].sha256 = hash('compromised runtime')
    assert.throws(() => validateWindowsPortableArchive(archive, changed, 'v4.1.20'), /differs from native gate/)
    const wrongSize = structuredClone(receipt)
    wrongSize.portable.files['coreclr.dll'].size += 1
    assert.throws(() => validateWindowsPortableArchive(archive, wrongSize, 'v4.1.20'), /differs from native gate/)
    const missing = structuredClone(receipt)
    delete missing.portable.files['coreclr.dll']
    assert.throws(() => validateWindowsPortableArchive(archive, missing, 'v4.1.20'), /member set differs/)
    const unlaunched = structuredClone(receipt)
    unlaunched.portable.launched = false
    assert.throws(() => validateWindowsPortableArchive(archive, unlaunched, 'v4.1.20'), /native launch evidence/)
    const wrongInstalled = structuredClone(receipt)
    wrongInstalled.payloads.app = { ...wrongInstalled.payloads.app, sha256: hash('different installer') }
    assert.throws(() => validateWindowsPortableArchive(archive, wrongInstalled, 'v4.1.20'), /differs from installed app/)
    writeFileSync(join(root, 'extra.dll'), 'unreviewed')
    assert.equal(spawnSync('zip', ['-q', archive, 'extra.dll'], { cwd: root }).status, 0)
    assert.throws(() => validateWindowsPortableArchive(archive, receipt, 'v4.1.20'), /native launch evidence/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('complete releases require the portable GUI, not only the installer or CLI', () => {
  assert.throws(() => validateReleaseAssetSet(['nostr-vpn-v4.1.20-windows-x64-setup.exe', 'nvpn-v4.1.20-x86_64-pc-windows-msvc.zip'], { requireCompleteAppRelease: true }), /Windows x64 portable app/)
})

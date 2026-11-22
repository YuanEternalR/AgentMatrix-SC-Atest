/**
 * 把 AgentMatrix 工具包安装进 DSH profile（或卸载）。
 *
 * 做三件事：
 *   1. 备份 profile 的 package.json / cordis.patch.yml 到 .backup-<时间戳>/
 *   2. 用 DSH 自带的 pnpm 把插件装进 profile（file: 依赖，不改仓库代码）
 *   3. 把 bundle 名写进 dsh.profile.bundles
 *
 * 用法：
 *   node dsh-plugins/install.mjs              # 安装到 desktop profile
 *   node dsh-plugins/install.mjs --dry-run    # 只打印将要做什么
 *   node dsh-plugins/install.mjs --uninstall  # 卸载并恢复 package.json
 *
 * 安装后需要重启 DSH 才会加载插件。
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const uninstall = args.includes('--uninstall')
const profileArg = args.indexOf('--profile')
const profileName = profileArg >= 0 ? args[profileArg + 1] : 'desktop'

const PLUGIN_NAME = 'dsh-agentmatrix-tools'
const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const PLUGIN_DIR = path.join(REPO_ROOT, 'dsh-plugins', 'agentmatrix-tools')
const PROFILE_DIR = path.join(process.env.USERPROFILE ?? process.env.HOME, '.dsh', 'profiles', profileName)
const PNPM = 'D:/Softwares/AI/DS Harness/Root/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs'

function log(msg) {
  console.log(msg)
}

if (!fs.existsSync(PROFILE_DIR)) {
  console.error(`找不到 profile：${PROFILE_DIR}`)
  process.exit(1)
}
if (!fs.existsSync(PNPM)) {
  console.error(`找不到 DSH 自带的 pnpm：${PNPM}`)
  process.exit(1)
}

const pkgPath = path.join(PROFILE_DIR, 'package.json')
const raw = fs.readFileSync(pkgPath, 'utf8')
const pkg = JSON.parse(raw)
const bundles = pkg.dsh?.profile?.bundles ?? []
const installed = bundles.includes(PLUGIN_NAME)

function backup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join(PROFILE_DIR, `.backup-${stamp}`)
  if (dryRun) {
    log(`[dry-run] 会备份到 ${dir}`)
    return dir
  }
  fs.mkdirSync(dir, { recursive: true })
  for (const file of ['package.json', 'cordis.patch.yml']) {
    const src = path.join(PROFILE_DIR, file)
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, file))
  }
  log(`已备份 profile 配置到 ${dir}`)
  return dir
}

function runPnpm(argv) {
  log(`[pnpm] ${argv.join(' ')}`)
  if (dryRun) return
  execFileSync(process.execPath, [PNPM, ...argv], {
    cwd: PROFILE_DIR,
    stdio: 'inherit',
    env: { ...process.env, npm_config_yes: 'true' },
  })
}

function writePkg(next) {
  if (dryRun) {
    log(`[dry-run] 会写入 package.json：bundles=${JSON.stringify(next.dsh.profile.bundles)}`)
    return
  }
  fs.writeFileSync(pkgPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

if (uninstall) {
  log(`== 卸载 ${PLUGIN_NAME}（profile: ${profileName}）==`)
  backup()
  const next = JSON.parse(JSON.stringify(pkg))
  next.dsh.profile.bundles = (next.dsh?.profile?.bundles ?? []).filter((b) => b !== PLUGIN_NAME)
  if (next.dependencies) delete next.dependencies[PLUGIN_NAME]
  writePkg(next)
  runPnpm(['remove', PLUGIN_NAME])
  log('\n已卸载。重启 DSH 生效。')
  process.exit(0)
}

log(`== 安装 ${PLUGIN_NAME} ==`)
log(`  插件目录：${PLUGIN_DIR}`)
log(`  profile ：${PROFILE_DIR}`)
log(`  当前 bundles：${bundles.join(', ') || '(空)'}`)

if (installed) {
  log('\n已经安装过（bundles 里已有该包），跳过。如需重装先 --uninstall。')
  process.exit(0)
}

const backupDir = backup()
// 用 link: 而不是 file:，让 profile 里的包直接指向本仓库目录：
// 改仓库代码即生效（配合 DSH 的 HMR，无需反复重装）
runPnpm(['add', `link:${PLUGIN_DIR.replace(/\\/g, '/')}`])

const next = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
next.dsh = next.dsh ?? {}
next.dsh.profile = next.dsh.profile ?? {}
next.dsh.profile.bundles = [...(next.dsh.profile.bundles ?? []), PLUGIN_NAME]
writePkg(next)

log('\n完成。请重启 DSH 使其加载插件。')
log(`回滚：删除 package.json 里的 "${PLUGIN_NAME}" 相关条目，或执行`)
log(`  node dsh-plugins/install.mjs --uninstall`)
log(`  备份目录：${backupDir}`)

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

import { spawnSync } from 'node:child_process'
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
// 换机器 / 工作台专用家目录：设 DSH_HOME 即可（工作台是 引擎/.dsh，桌面端默认 ~/.dsh）
const DSH_HOME = process.env.DSH_HOME ?? path.join(process.env.USERPROFILE ?? process.env.HOME, '.dsh')
const PROFILE_DIR = path.join(DSH_HOME, 'profiles', profileName)
// pnpm 解析顺序：PNPM_BIN（指向 pnpm.mjs 或 pnpm 可执行文件）→ PATH 里的 pnpm
const PNPM = process.env.PNPM_BIN ?? ''

function log(msg) {
  console.log(msg)
}

if (!fs.existsSync(PROFILE_DIR)) {
  console.error(`找不到 profile：${PROFILE_DIR}`)
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
  const command = PNPM ? process.execPath : 'pnpm'
  const commandArgs = PNPM ? [PNPM, ...argv] : argv
  const result = spawnSync(command, commandArgs, {
    cwd: PROFILE_DIR,
    stdio: 'inherit',
    // Windows 上 pnpm 是 .cmd，必须经 shell 才能启动；PNPM_BIN 直接指向 js/exe 时不走 shell
    shell: !PNPM,
    env: { ...process.env, npm_config_yes: 'true' },
  })
  if (result.error) {
    console.error(`调用 pnpm 失败：${result.error.message}`)
    console.error('先安装 pnpm（npm install -g --allow-scripts=pnpm pnpm），或用 PNPM_BIN 指向 pnpm.mjs')
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
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

#!/usr/bin/env node
/**
 * 铁律（Iron Rule）—— 个人开源项目敏感信息扫描
 *
 * 本项目是个人开源项目。仓库内（源码、文档、示例、测试、构建产物、发布包）
 * 禁止出现任何公司信息与敏感信息：公司名称/品牌/域名/邮箱、员工姓名与花名、
 * 内部系统代号、内网地址、机器绝对路径等。对外团队署名统一为
 * "Paper 团队（paper team）"，不出现任何公司身份。
 *
 * 本文件是规则的唯一事实来源：
 *   - `pnpm rule:scan`（包含在 `pnpm check` 中、构建之后执行）全仓扫描，
 *     含 `dist/` 构建产物；
 *   - `pnpm test` 里的 `tests/repo/iron-rule.spec.ts` 以 `--source-only`
 *     对源码树执行同一规则。
 * 发现违规即失败。新增需要拦截的模式，请维护 FORBIDDEN_PATTERNS。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = resolve(fileURLToPath(import.meta.url))

/** 永不发布的本地/构建目录，跳过。 */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.vitest', 'coverage', '.paper'])
/** 规则定义文件自身必然包含关键字，扫描时跳过。 */
const RULE_FILES = new Set(['scripts/iron-rule.mjs'])
const MAX_FILE_BYTES = 2 * 1024 * 1024

export const FORBIDDEN_PATTERNS = [
  { name: 'company:lilith', note: '公司名 Lilith / Lilith Games / 莉莉丝', regex: /\blilith(?:games?)?\b/i },
  { name: 'company:lilith-cn', note: '公司中文名 莉莉丝', regex: /莉莉丝/ },
  { name: 'path:home-unix', note: 'macOS/Linux 用户绝对路径（用户名 ≥2 字符），请改用 ~/ 或相对路径', regex: /\/(?:Users|home)\/[A-Za-z0-9._-]{2,}(?=\/|")/ },
  { name: 'path:home-windows', note: 'Windows 用户绝对路径', regex: /[A-Za-z]:\\Users\\[A-Za-z0-9._-]{2,}/ },
  { name: 'net:private-ip', note: '内网私有 IP（10.x.x.x / 172.16-31.x.x / 192.168.x.x）', regex: /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/ },
]

/** 递归收集目录下的全部文件路径（跳过 SKIP_DIRS）。 */
export function walkTextFiles(dir = ROOT, out = [], depth = 0) {
  if (depth > 10) return out
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkTextFiles(full, out, depth + 1)
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
  return out
}

/** 对给定文件集执行规则，返回命中列表 [{file, line, pattern, note}]。 */
export function findViolations(files, patterns = FORBIDDEN_PATTERNS) {
  const hits = []
  for (const file of files) {
    const rel = relative(ROOT, file)
    if (RULE_FILES.has(rel)) continue
    let stat
    try {
      stat = statSync(file)
    } catch {
      continue
    }
    if (stat.size > MAX_FILE_BYTES) continue
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (text.includes('\u0000')) continue // 二进制
    const lines = text.split('\n')
    for (const { name, note, regex } of patterns) {
      for (let index = 0; index < lines.length; index++) {
        regex.lastIndex = 0
        if (regex.test(lines[index])) hits.push({ file: rel, line: index + 1, pattern: name, note })
      }
    }
  }
  return hits
}

// CLI 入口：pnpm rule:scan 全仓含 dist；--source-only 跳过构建产物。
if (resolve(process.argv[1] ?? '') === ENTRY) {
  const sourceOnly = process.argv.includes('--source-only')
  const files = sourceOnly
    ? walkTextFiles(ROOT).filter(file => !relative(ROOT, file).startsWith(`dist${sep}`))
    : walkTextFiles(ROOT)
  const hits = findViolations(files)
  if (hits.length > 0) {
    console.error(`[iron-rule] ${hits.length} 处敏感信息违规：`)
    for (const hit of hits) console.error(`  ${hit.file}:${hit.line}  <${hit.pattern}> ${hit.note}`)
    console.error('[iron-rule] 铁律：个人开源项目，禁止任何公司信息与敏感信息；团队署名统一为 Paper 团队。')
    process.exit(1)
  }
  console.log(`[iron-rule] 通过：扫描 ${files.length} 个文件，无公司/敏感信息。`)
}

#!/usr/bin/env node
/**
 * verify.mjs — 用真实请求验证 11128 补丁是否生效
 *
 * 做法：从 pack.js 里**取出实际会被加载的那个清洗函数**（不是另抄一份），
 * 喂一段含全部已知指纹的 system，发两次真实请求对照：
 *   A 未清洗 → 期望 400 / 11128
 *   B 清洗后 → 期望 200
 *
 * 用法：
 *   node verify.mjs                       # 测本仓库的 vendor/channel-pack/pack.js
 *   OFM_PACK=<路径> node verify.mjs       # 测别处的文件
 *
 * 需要：本机已登录 buddy 渠道（凭据在 ~/.dsh/.credentials.yaml）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PACK = process.env.OFM_PACK ||
  path.join(HERE, 'vendor', 'channel-pack', 'pack.js')
const CRED = path.join(os.homedir(), '.dsh', '.credentials.yaml')
const MODEL = process.env.OFM_MODEL || 'kimi-k2.6'
const ENDPOINT = 'https://copilot.tencent.com/v2/chat/completions'

// ── 1. 从 pack.js 提取真实的清洗函数 ──────────────────────────────────────
const src = fs.readFileSync(PACK, 'utf8')
const a = src.indexOf('var DSH_HARNESS_IDENTITY_RE')
const b = src.indexOf('function scrubBuddySystemMessages')
if (a < 0 || b < 0 || b < a) {
  console.error('❌ 在 pack.js 里找不到清洗函数（补丁没打上？）')
  console.error('   期望命中：var DSH_HARNESS_IDENTITY_RE … function scrubBuddySystemMessages')
  process.exit(2)
}
const scrub = new Function(src.slice(a, b) + '\nreturn scrubDshHarnessIdentity;')()

// ── 2. 凭据 ───────────────────────────────────────────────────────────────
if (!fs.existsSync(CRED)) {
  console.error(`❌ 找不到凭据：${CRED}`)
  console.error('   先在 DSH 里登录 buddy 渠道。')
  process.exit(2)
}
const credRaw = fs.readFileSync(CRED, 'utf8')
const ref = credRaw.match(/\n\s+(BUDDY_\w+): '([\s\S]*?)'[ \t]*$/m)
if (!ref) {
  console.error('❌ 凭据里没有 BUDDY_* 账号，无法验证')
  process.exit(2)
}
const accessToken = JSON.parse(ref[2].replace(/\n\s*/g, ' ').trim()).access_token

const headers = new Headers()
headers.set('Authorization', `Bearer ${accessToken}`)
headers.set('Accept', 'text/event-stream')
headers.set('Content-Type', 'application/json')
headers.set('x-domain', 'copilot.tencent.com')
headers.set('x-product-code', 'codebuddy')
headers.set('X-Agent-Purpose', 'conversation')
headers.set('X-IDE-Name', 'CodeBuddy')
headers.set('X-IDE-Type', 'CodeBuddy')
headers.set('X-IDE-Version', '1.106.1')
headers.set('X-Product', 'CodeBuddy')
headers.set('User-Agent', 'CodeBuddyIDE/1.106.1')

// ── 3. 构造含全部已知指纹的 system ────────────────────────────────────────
const IDENTITY = 'You are an AI agent powered by DeepSeek Harness.'
const WEB = 'You are interacting with the user through the DeepSeek Harness Web GUI whose URL the runtime context names. When the user refers to "this page", "this GUI", or "this app" without naming another target, they mean this GUI. The browser provides no implicit DOM, route, or screenshot context. The client-plugin HMR receiver is active, but client-plugin changes reload without a refresh only while `pnpm run dev:web` is also running from this same checkout to rebuild their bundles; verify that watcher before promising automatic updates. Every other change — the apps/web shell and plain packages — requires rebuilding the affected Web artifacts and verifying this existing URL after a page refresh. Starting another server does not update this GUI. The apps/web Vite entry builds the shell but is not a standalone application because only dsh web injects window.__DSH_BOOT__. Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.'
const ATPATH = 'Tokens prefixed with @ are paths the user explicitly referenced. Relative paths resolve from the workspace root; absolute paths identify files or directories on the host. @"..." quotes a path containing spaces.'
const CTX = 'The runtime context names the DeepSeek Harness implementation checkout. The checkout location and current working directory are separate values and may differ.\n\nCurrent DeepSeek Harness implementation checkout: "C:\\appinstall\\dsh".\n\nCurrent DeepSeek Harness Web GUI URL: "http://127.0.0.1:5173/".'

const rawSystem = [
  IDENTITY,
  'You are a helpful coding agent.',
  WEB,
  ATPATH,
  CTX
].join('\n\n')

// ── 4. 发真实请求 ─────────────────────────────────────────────────────────
async function send(label, system) {
  let status, body = ''
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: 'say OK' }
        ],
        stream: true,
        max_tokens: 32
      }),
      signal: AbortSignal.timeout(60000)
    })
    status = res.status
    body = await res.text()
  } catch (err) {
    console.log(`⚠️  ${label}：请求异常 ${err.message}`)
    return null
  }
  const blocked = body.includes('11128')
  console.log(`${status === 200 ? '✅ 200' : '❌ ' + status}  ${blocked ? '11128 被拦' : '放行  '}  ${label}`)
  return { status, blocked }
}

const scrubbed = scrub(rawSystem)
console.log(`pack.js : ${PACK}`)
console.log(`system  : ${rawSystem.length} → ${scrubbed.length} 字符`)
console.log(`残留    : DeepSeek Harness=${/DeepSeek Harness/.test(scrubbed)}  workspace root=${/workspace root/.test(scrubbed)}  @paths=${/explicitly referenced/.test(scrubbed)}\n`)

const A = await send('A 未清洗（应 400 / 11128）', rawSystem)
const B = await send('B 清洗后（应 200）', scrubbed)

console.log('')
if (B && B.status === 200) {
  console.log('✅ 补丁有效')
} else if (A && A.status === 200) {
  console.log('⚠️ 未清洗也能过——上游校验可能已放松，或规则已过期')
} else {
  console.log('❌ 清洗后仍被拦，规则需要更新（见文档第六节排错流程）')
  console.log('\n--- 清洗后全文 ---\n' + scrubbed)
  process.exit(1)
}

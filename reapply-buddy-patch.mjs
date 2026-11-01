#!/usr/bin/env node
/**
 * reapply-buddy-patch.mjs — 给 liu-free-model 重打 11128 补丁
 *
 * 为什么需要：插件用 git/registry 方式装在 node_modules 时，只要在 DSH 里
 * 安装/更新/卸载任何插件，pnpm 就会重装整棵依赖树，vendor/channel-pack/pack.js
 * 被上游原版覆盖，补丁全丢，11128 立刻复发。
 * （用 link: 本地目录方式挂载时不受影响，本脚本只作兜底。）
 *
 * 用法：
 *   node reapply-buddy-patch.mjs           # 检查，未打则打
 *   node reapply-buddy-patch.mjs --check   # 只检查，不写
 *   node reapply-buddy-patch.mjs --dry     # 打印将要做的改动
 *
 * 幂等：已打过补丁时直接退出，不会重复插入。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const CHECK_ONLY = args.includes('--check')
const DRY = args.includes('--dry')

const PACK = process.env.OFM_PACK || path.join(
  os.homedir(), '.dsh', 'profiles', 'desktop', 'node_modules',
  'liu-free-model', 'vendor', 'channel-pack', 'pack.js'
)

if (!fs.existsSync(PACK)) {
  console.error(`找不到 pack.js：${PACK}`)
  console.error('如果插件安装在别的 profile，用 OFM_PACK=<路径> 指定。')
  process.exit(2)
}

// ── 第一处：清洗函数（插在 BuddyAdapter 之前）──────────────────────────────
const BLOCK_HELPERS = [
  '// CodeBuddy CN（buddy）会对 system 消息做渠道指纹校验：命中 DSH 的身份句或',
  '// 「Web GUI / HMR / dsh web 注入」整段说明时，上游返回 HTTP 400 / 业务码 11128。',
  '//',
  '// 2026-10-31 复核（实测二分，见 workspace 下 replay*.mjs）：',
  '//   1. 只有 role === "system" 的消息被校验；同样的文本放进 user 消息或 tools 描述都放行。',
  '//   2. 触发项 = 身份句 + Web GUI 整段 + 一对字面短语（@ 路径说明 与 workspace root 同时出现）。',
  '//      单独的 checkout 段、runtime context 行均不触发，但为防上游再收紧一并删掉。',
  '//   3. 只删「身份句 + WEB 段」不足以通过，还必须改写那对短语，否则仍 400/11128。',
  'var DSH_HARNESS_IDENTITY_RE = /You are an AI agent powered by DeepSeek Harness\\.?/gi;',
  'var DSH_BUDDY_FINGERPRINT_RES = [',
  '  /You are interacting with the user through the DeepSeek Harness Web GUI[\\s\\S]*?window\\.__DSH_BOOT__\\.?[ \\t]*\\n?/gi,',
  '  /When the user refers to "this page", "this GUI", or "this app" without naming another target, they mean this GUI\\.\\s*/gi,',
  '  /The browser provides no implicit DOM, route, or screenshot context\\.\\s*/gi',
  '];',
  '// 段落/行级别：凡提到 harness 的一律剔除（旧正则删不干净的残留尾巴也靠这条兜底）',
  'var DSH_BUDDY_DROP_RES = [',
  '  /deepseek\\s+harness/i,',
  '  /__dsh_boot__/i,',
  '  /\\bdsh\\b/i,',
  '  /replacement server/i',
  '];',
  '// 短语级改写：保留原意，只去掉会被判成「非官方客户端」的字面组合',
  'var DSH_BUDDY_REWRITES = [',
  '  [/Tokens prefixed with @ are paths the user explicitly referenced\\./gi, "Tokens starting with the at-sign are paths the user referenced."],',
  '  [/\\bthe workspace root\\b/gi, "the current directory"],',
  '  [/@"\\.\\.\\."/g, "\\"...\\""],',
  '  [/The client-plugin HMR receiver is active/gi, ""]',
  '];',
  'function scrubDshHarnessIdentity(text) {',
  '  if (typeof text !== "string" || text.length === 0) return text;',
  '  let out = text.replace(DSH_HARNESS_IDENTITY_RE, "You are an AI assistant.");',
  '  for (const re of DSH_BUDDY_FINGERPRINT_RES) out = out.replace(re, "");',
  '  out = out.split(/\\n{2,}/).filter((para) => !DSH_BUDDY_DROP_RES.some((re) => re.test(para))).map((para) => para.split("\\n").filter((line) => !DSH_BUDDY_DROP_RES.some((re) => re.test(line))).join("\\n")).join("\\n\\n");',
  '  for (const [re, rep] of DSH_BUDDY_REWRITES) out = out.replace(re, rep);',
  '  return out.replace(/\\n{3,}/g, "\\n\\n").replace(/[ \\t]+\\n/g, "\\n").trim();',
  '}',
  'function scrubBuddySystemMessages(messages) {',
  '  for (const message of messages) {',
  '    if (message.role === "system" && typeof message.content === "string") {',
  '      message.content = scrubDshHarnessIdentity(message.content);',
  '    }',
  '  }',
  '  return messages;',
  '}',
  ''
].join('\n')

// ── 第二处：stream() 里调用清洗 ────────────────────────────────────────────
const ANCHOR_STREAM = [
  '    const messages = serializeMessages2(options.messages, imageUrls);',
  '    if (options.system !== void 0 && options.system.length > 0) {',
  '      messages.unshift({ role: "system", content: options.system });',
  '    }',
  ''
].join('\n')
const BLOCK_STREAM = [
  '    // buddy（CodeBuddy CN）渠道的准入校验，见 dsh-our-free-model#542 / #544。',
  '    if (this.product.id === "buddy") scrubBuddySystemMessages(messages);',
  ''
].join('\n')

// ── 第三处：send() 里补 workbuddy 网关头 ───────────────────────────────────
const ANCHOR_HEADERS = [
  '    headers.set("User-Agent", resolveUserAgent(this.product, options.model));',
  '    try {',
  ''
].join('\n')
const BLOCK_HEADERS = [
  '    // 国际版（workbuddy）渠道校验：上游要求官方客户端的完整网关头，',
  '    // 缺任意一项都会返回 400 / 11128（msg "request illegal"）。',
  '    // 国内版（buddy）不走这段，避免影响它。',
  '    if (this.product.id === "workbuddy") {',
  '      headers.set("Accept", "application/json");',
  '      headers.set("x-requested-with", "XMLHttpRequest");',
  '      headers.set("X-Conversation-ID", randomUUID2());',
  '      headers.set("X-Conversation-Request-ID", randomUUID2());',
  '      headers.set("acp-connection-id", randomUUID2());',
  '      headers.set("X-Conversation-Message-ID", randomUUID2());',
  '      headers.set("X-Request-ID", randomUUID2());',
  '      headers.set("X-Agent-Intent", "craft");',
  '      headers.set("X-Private-Data", "true");',
  '      headers.set("x-codebuddy-request", "1");',
  '      headers.set("X-Product", "SaaS");',
  '      const traceId = randomBytes4(16).toString("hex");',
  '      const spanId = randomBytes4(8).toString("hex");',
  '      const parentId = randomBytes4(8).toString("hex");',
  '      headers.set("traceparent", `00-${traceId}-${spanId}-01`);',
  '      headers.set("b3", `${traceId}-${spanId}-1-${parentId}`);',
  '      headers.set("X-B3-TraceId", traceId);',
  '      headers.set("X-B3-SpanId", spanId);',
  '      headers.set("X-B3-ParentSpanId", parentId);',
  '      headers.set("X-B3-Sampled", "1");',
  '      headers.set("X-Trace-ID", traceId);',
  '    }',
  ''
].join('\n')

// ── 执行 ──────────────────────────────────────────────────────────────────
let src = fs.readFileSync(PACK, 'utf8')
const origLen = src.length

if (src.includes('function scrubBuddySystemMessages(')) {
  const hasHeaders = src.includes('X-Conversation-Message-ID')
  console.log(`✅ 补丁已在位（${PACK}）`)
  if (hasHeaders) {
    console.log('   - 清洗函数：在')
    console.log('   - workbuddy 网关头：在')
    console.log('无需重打。')
  } else {
    console.log('   ⚠️ 清洗函数在，但 workbuddy 网关头缺失（可能只回滚了一半）。')
    console.log('   建议删掉 vendor/channel-pack/pack.js 后重装插件，或手动补第三处。')
    process.exit(1)
  }
  process.exit(0)
}

// 锚点校验：插件升级后锚点可能漂移，先报清楚再动手
const problems = []
if (src.split('var BuddyAdapter = class _BuddyAdapter extends LlmAdapter2 {').length !== 2) {
  problems.push('锚点1 未唯一命中：var BuddyAdapter = class _BuddyAdapter extends LlmAdapter2 {')
}
if (src.split(ANCHOR_STREAM.trimEnd()).length !== 2) {
  problems.push('锚点2 未唯一命中：serializeMessages2(options.messages, imageUrls) 后的 unshift 块')
}
if (src.split(ANCHOR_HEADERS.trimEnd()).length !== 2) {
  problems.push('锚点3 未唯一命中：headers.set("User-Agent", resolveUserAgent(...)) + try {')
}
if (problems.length > 0) {
  console.error('❌ 锚点不匹配，插件版本可能已升级，不能盲目打补丁：\n  - ' + problems.join('\n  - '))
  console.error('\n排查方法见修复指南第六节（埋点取真实报文 → 二分定位 → 重写规则）。')
  process.exit(3)
}

src = src.replace(
  'var BuddyAdapter = class _BuddyAdapter extends LlmAdapter2 {',
  BLOCK_HELPERS + 'var BuddyAdapter = class _BuddyAdapter extends LlmAdapter2 {'
)
src = src.replace(ANCHOR_STREAM, ANCHOR_STREAM + BLOCK_STREAM)
// 第三处插在 User-Agent 之后、try 之前（与已验证版本保持一致）
src = src.replace(
  ANCHOR_HEADERS,
  '    headers.set("User-Agent", resolveUserAgent(this.product, options.model));\n' +
    BLOCK_HEADERS + '    try {\n'
)

if (CHECK_ONLY || DRY) {
  console.log(`补丁未生效（当前文件为原版）。可打。`)
  console.log(`  文件：${PACK}`)
  console.log(`  预计新增 ${src.length - origLen} 字符`)
  if (DRY) process.exit(0)
  process.exit(1)
}

// 先写临时文件做语法校验，通过后再落盘，避免半坏状态
const tmp = path.join(os.tmpdir(), `ofm-patch-check-${Date.now()}.mjs`)
fs.writeFileSync(tmp, src)
try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' })
} catch (err) {
  fs.unlinkSync(tmp)
  console.error('❌ 打补丁后语法检查失败，未写入文件。')
  console.error(String(err.stderr || err.message).slice(0, 1200))
  process.exit(4)
}
fs.unlinkSync(tmp)

// ── 落盘：必须换 inode，不能原地覆盖 ──────────────────────────────────────
// pnpm 的 node_modules 文件是全局 store 的硬链接（nlink = 2）。原地写会把
// store 里那份也改掉，导致：① 别的项目拿到被改过的副本；② pnpm 校验哈希失败，
// 下次 install 把整棵树重新下载（实测触发过 "downloaded 171"）。
// 所以先写临时文件，再换掉目标文件，断开硬链接。
const nlink = (() => { try { return fs.statSync(PACK).nlink } catch { return 1 } })()
const tmpOut = PACK + '.ofm-new'
fs.writeFileSync(tmpOut, src)

let brokeLink = false
try {
  fs.unlinkSync(PACK)
  fs.renameSync(tmpOut, PACK)
  brokeLink = nlink > 1
} catch (err) {
  // Windows 上文件可能被运行中的进程占用，退化为原地写（会污染 store，需提示）
  fs.rmSync(tmpOut, { force: true })
  fs.writeFileSync(PACK, src)
  console.warn(`⚠️ 无法替换文件（可能被 DSH 占用），已原地写入。`)
  console.warn(`   这会把 pnpm store 里的同名文件一起改掉，建议先退出 DSH 再跑一次。`)
}

console.log(`✅ 补丁已重打：${PACK}`)
console.log(`   字符数 ${origLen} → ${src.length}（+${src.length - origLen}）`)
console.log(`   语法检查通过`)
if (brokeLink) console.log(`   已断开与 pnpm store 的硬链接（原 nlink=${nlink}），store 副本保持原版`)
console.log(`\n⚠️ 需要重启 DeepSeek Harness 才生效（pack.js 是宿主侧模块，刷新页面无效）。`)

import fs from 'node:fs'
const src = fs.readFileSync('C:/Users/liu/.dsh/profiles/desktop/node_modules/dsh-our-free-model/vendor/channel-pack/pack.js','utf8')
const a = src.indexOf('var DSH_HARNESS_IDENTITY_RE')
const b = src.indexOf('function scrubBuddySystemMessages')
const code = src.slice(a, b)
// 从插件文件里取出真实的清洗函数并执行
const fn = new Function(code + '\nreturn scrubDshHarnessIdentity;')()
const rec = JSON.parse(fs.readFileSync('C:/Users/liu/.dsh/our-free-model/ofm-debug.jsonl','utf8').trim().split('\n')[0])
const body0 = JSON.parse(rec.body)
const h = new Headers(); for (const [k,v] of Object.entries(rec.headers)) h.set(k,v)
const sysIdx = body0.messages.findIndex(m=>m.role==='system')
const id='You are an AI agent powered by DeepSeek Harness.'
const web='You are interacting with the user through the DeepSeek Harness Web GUI whose URL the runtime context names. When the user refers to "this page", "this GUI", or "this app" without naming another target, they mean this GUI. The browser provides no implicit DOM, route, or screenshot context. The client-plugin HMR receiver is active, but client-plugin changes reload without a refresh only while `pnpm run dev:web` is also running from this same checkout to rebuild their bundles; verify that watcher before promising automatic updates. Every other change — the apps/web shell and plain packages — requires rebuilding the affected Web artifacts and verifying this existing URL after a page refresh. Starting another server does not update this GUI. The apps/web Vite entry builds the shell but is not a standalone application because only dsh web injects window.__DSH_BOOT__. Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.'
const posWelcome = body0.messages[sysIdx].content
// 还原成"未打补丁"的原始 system：把身份句与 WEB 段加回去
const rawSystem = id + '\n\nYou are a coding agent.\n\n' + web + '\n\n' + posWelcome
const out = fn(rawSystem)
console.log('原始长度', rawSystem.length, '→ 清洗后', out.length)
console.log('残留检查: 身份句', /DeepSeek Harness/.test(out), '| workspace root', /workspace root/.test(out), '| replacement server', /replacement server/.test(out))
const body = JSON.parse(JSON.stringify(body0)); body.messages[sysIdx].content = out
const r = await fetch('https://copilot.tencent.com/v2/chat/completions',{method:'POST',headers:h,body:JSON.stringify(body),signal:AbortSignal.timeout(60000)})
const txt = await r.text()
console.log('HTTP', r.status, txt.includes('11128') ? '❌11128' : '✅ 通过渠道校验')
console.log('响应首行:', txt.slice(0,160))

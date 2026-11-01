# dsh-our-free-model fork

在 DSH 里用的二次开发版本，本体来自 npm `dsh-our-free-model@2.1.0`。

## 由来

上游**没有公开仓库**（npm 上无 `repository` 字段），发布包里也不含构建脚本，
所以只能基于发布产物做修改，改完直接生效。

## 提交历史

| commit | 内容 |
|---|---|
| `54e3478` | 上游 2.1.0 原样，未改一字节（升级时用来 rebase） |
| `89be153` | 修 11128：仅改 `vendor/channel-pack/pack.js`，+72 行 / -0 行 |

## 改的是什么

buddy（CodeBuddy 国内版）和 workbuddy（国际版）会对 system 消息做渠道指纹校验，
命中就返回 HTTP 400 + 业务码 11128。清洗逻辑在 `pack.js` 的：

- `scrubDshHarnessIdentity()` — 三层清洗（身份句 / Web GUI 段 / @ 路径与 workspace root 短语）
- `scrubBuddySystemMessages()` — 挂在 buddy 的 stream 上
- `send()` 里的 `workbuddy` 分支 — 补齐 20 个官方客户端请求头

完整背景和方法论：`../解决buddy的两个渠道问题/DSH两个buddy渠道11128修复指南.md`

## 哪些文件能改

| 路径 | 性质 | 改完生效吗 |
|---|---|---|
| `index.js`、`client.js` | 宿主端 / 前端打包产物 | ✅ 直接改（可读，未压缩） |
| `vendor/channel-pack/pack.js` | 渠道包产物 | ✅ 直接改（本仓库的改动就在这） |
| `src/`（59 个文件） | 真源码 | ❌ 不生效——没有构建脚本，运行时加载的是上面两个产物 |

所以本仓库的实际修改策略是：**改产物，改完用真实请求验证**。不要指望改 `src/` 起作用，
它只能当参考读物。

## 挂到 profile

把 `~/.dsh/profiles/desktop/package.json` 里的依赖改成链接：

```json
"dsh-our-free-model": "link:D:/原来的备份/liushuang/dsh-our-free-model-fork"
```

然后 `pnpm install`。之后 `node_modules/dsh-our-free-model` 是指向本目录的符号链接，
改这里的文件即时生效（重启 DSH 后）。

⚠️ 代价：**插件不再跟随 npm 自动更新**。上游发新版要手动合。

## 上游升级怎么办

1. `npm pack dsh-our-free-model@<新版本>` 解包，覆盖到本目录
2. `git add -A && git commit -m "baseline: <新版本>"` —— 先留住上游原样
3. 重放补丁：`OFM_PACK=<本目录>/vendor/channel-pack/pack.js node reapply-buddy-patch.mjs`
   - 脚本会预检三个锚点；锚点漂移会报错退出，**不会**盲目插入
4. 真实请求验证（不要只看代码对不对）

## 验证

`verify-fork.mjs` / `verify2.mjs` 会从 `pack.js` 里取出真实的清洗函数，
喂一段"未清洗"的 system 发真请求，期望：未清洗 → 400/11128，清洗后 → 200。

只测脚本自己写的版本没意义——必须测**文件里实际会被加载的那份代码**。

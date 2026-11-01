# dsh-our-free-model fork

在 DSH 里用的二次开发版本，本体来自 npm `dsh-our-free-model@2.1.0`（MIT）。

> 非官方版本，与上游作者无关。上游没有公开仓库，本仓库是**基于发布产物**做的修改。
>
> `package.json` 的 `name` / `version` 刻意保持 `dsh-our-free-model` / `2.1.0` 不变：
> `link:` 安装要求依赖名与包名一致，改版本号还可能让插件管理器误判成"旧版本、待更新"。

## 这个仓库解决什么问题

buddy（CodeBuddy 国内版）和 workbuddy（国际版）会对 `system` 消息做渠道指纹校验，
命中就返回 HTTP 400 + 业务码 **11128**，界面上的表现是"请求被拦截，请重新发送"。

清洗逻辑在 `vendor/channel-pack/pack.js`：

- `scrubDshHarnessIdentity()` — 三层清洗（身份句 / Web GUI 段 / `@` 路径与 `workspace root` 短语）
- `scrubBuddySystemMessages()` — 挂在 buddy 的 stream 上
- `send()` 里的 `workbuddy` 分支 — 补齐 20 个官方客户端请求头

## 提交历史

| commit | 内容 |
|---|---|
| `54e3478` | 上游 2.1.0 原样，未改一字节（升级时用来 rebase） |
| `89be153` | 修 11128：仅改 `vendor/channel-pack/pack.js`，+72 行 / -0 行 |
| `93937a2` | 文档 + 脚本 |

## 哪些文件能改

| 路径 | 性质 | 改完生效吗 |
|---|---|---|
| `index.js`、`client.js` | 宿主端 / 前端打包产物 | ✅ 直接改（可读，未压缩） |
| `vendor/channel-pack/pack.js` | 渠道包产物（约 3.5 万行，格式化过） | ✅ 直接改，本仓库的改动就在这 |
| `src/`（59 个文件） | 真源码 | ❌ **不生效**——没有构建脚本，运行时只加载上面两个产物 |

所以修改策略是：**改产物，改完用真实请求验证**。不要指望改 `src/` 起作用，它只能当参考读物。

## 装到自己的 DSH 里

### 1. 拿到代码

```bash
git clone https://github.com/<用户名>/<仓库名>.git
```

### 2. 挂进 profile

编辑 `~/.dsh/profiles/desktop/package.json`，把 `dsh-our-free-model` 那行改成
指向 clone 下来的目录（**用绝对路径，Windows 上斜杠写成 `/` 或 `\\`**）：

```json
"dsh-our-free-model": "link:/path/to/dsh-our-free-model-fork"
```

> Linux / macOS 例：`"link:/home/you/plugins/dsh-our-free-model-fork"`
> Windows 例：`"link:D:/plugins/dsh-our-free-model-fork"`

### 3. 安装

```bash
cd ~/.dsh/profiles/desktop
pnpm install
```

DSH 内置的 pnpm 版本是 11.x，如果系统里的 pnpm 不在 PATH：

```bash
npx --yes pnpm@11.28.5 install
```

装完 `node_modules/dsh-our-free-model` 应该是一个**符号链接**：

```bash
ls -la ~/.dsh/profiles/desktop/node_modules/ | grep our-free
# dsh-our-free-model -> /path/to/dsh-our-free-model-fork
```

如果还是普通目录，说明 `link:` 没生效——检查路径是否写错、`package.json` 是否存盘。

### 4. 重启 DSH

`pack.js` 是宿主侧模块，**刷新网页无效，必须重启进程**。

### 5. 验证

```bash
node verify.mjs
```

期望输出 `A 未清洗 → ❌ 400 / 11128` 和 `B 清洗后 → ✅ 200`。

⚠️ 代价：**插件不再跟随 npm 自动更新**。上游发新版要手动合（见下）。

## 上游升级怎么办

1. `npm pack dsh-our-free-model@<新版本>` 解包，覆盖到本目录
2. 先提交基线，留住上游原样：`git add -A && git commit -m "baseline: <新版本>"`
3. 重放补丁：

   ```bash
   OFM_PACK=$PWD/vendor/channel-pack/pack.js node reapply-buddy-patch.mjs
   ```

   脚本会预检三个锚点；锚点漂移会**报错退出，不会盲目插入**。
   不带 `OFM_PACK` 时默认找 `~/.dsh/profiles/desktop/node_modules/...`，
   装了 `link:` 之后那条路径指向本仓库，所以直接跑也行。
4. 跑 `node verify.mjs` 做真实请求验证——**不要只看代码对不对**。

## 想撤销

`package.json` 里把 `link:...` 改回 `"^2.1.0"`，再 `pnpm install` 即可回到 npm 版。

## 两个必须知道的坑

**一、别在原地覆盖 `node_modules` 里的 `pack.js`。**
pnpm 那边的文件是全局 store 的**硬链接**（`nlink = 2`），原地 write 会把 store 里那份
一起改掉：① 本机其他项目装同版本会拿到被改过的副本；② pnpm 校验哈希失败，
下次 install 把整棵树重新下载。`reapply-buddy-patch.mjs` 已经改成"写临时文件 + rename"
换 inode，不会再污染 store。

**二、本仓库用了 `link:` 就不要把目录删掉或改名。**
符号链接会悬空，插件直接加载失败。真要挪位置，改 `package.json` 里的 `link:` 路径再 `pnpm install`。

## 许可证

- 本仓库：MIT，见 `LICENSE`（Copyright (c) 2026 Ebony-Vinyl，上游声明）
- `vendor/channel-pack/`：来自 `dsh-codearts-auth`（MIT），出处与吸收的 commit 见
  `vendor/channel-pack/NOTICE.md`，**不要删除该文件**

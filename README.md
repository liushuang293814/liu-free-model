# dsh-our-free-model-fork

DSH 插件的**独立二次开发版**，基于 npm `dsh-our-free-model@2.1.0`（MIT）。

包名 `dsh-our-free-model-fork`、版本 `2.1.0-fork.1`，与上游是两个不同的包：
装了这个就不会同时装上游版，插件管理器也不会再提示"有新版本可更新"。

> 非官方版本，与上游作者无关。上游没有公开仓库，本仓库是**基于发布产物**做的修改。

## 这个仓库解决什么问题

buddy（CodeBuddy 国内版）和 workbuddy（国际版）会对 `system` 消息做渠道指纹校验，
命中就返回 HTTP 400 + 业务码 **11128**，界面上的表现是"请求被拦截，请重新发送"。

清洗逻辑在 `vendor/channel-pack/pack.js`：

- `scrubDshHarnessIdentity()` — 三层清洗（身份句 / Web GUI 段 / `@` 路径与 `workspace root` 短语）
- `scrubBuddySystemMessages()` — 挂在 buddy 的 stream 上
- `send()` 里的 `workbuddy` 分支 — 补齐 20 个官方客户端请求头

## 包名出现在哪四处（改名前必读）

DSH 靠**包名**把插件挂进加载树，改名必须同步这四处，漏一处就是白屏或插件不加载：

| 位置 | 字段 | 作用 |
|---|---|---|
| `package.json` | `name` | pnpm 安装、bundle 注册的依据 |
| `cordis.patch.yml` | `insert[].name` | 宿主半身挂载点。**客户端界面绑定在 `name` 为裸包名的这一行上** |
| `client.js` | `__ModuleLoader__.load({ id })` | 浏览器端模块 id，必须等于包名——Shell 按 `<包名>/client` 请求它 |
| profile 的 `package.json` | `dependencies` 键 + `dsh.profile.bundles` 条目 | 声明装什么、加载什么 |

另外 `client.js` 里 `style.setAttribute('data-plugin', ...)` 也写了包名，那只是清理样式用的标记，
改不改都行，本仓库一并改了。

**好在这几处之外没有别的耦合**：`index.js`（宿主端，13 万行）里一次都没出现包名字符串；
运行时数据目录是硬编码的 `~/.dsh/our-free-model/`，**不随包名变化**，所以改名不会丢配置。

## 提交历史

| commit | 内容 |
|---|---|
| `54e3478` | 上游 2.1.0 原样，未改一字节（升级时用来 rebase） |
| `89be153` | 修 11128：仅改 `vendor/channel-pack/pack.js`，+72 行 / -0 行 |
| `93937a2` | 文档 + 脚本 |
| `f4c630a` | 整理为可分享版本 |
| 之后 | 重命名为独立包 `dsh-our-free-model-fork` |

## 哪些文件能改

| 路径 | 性质 | 改完生效吗 |
|---|---|---|
| `index.js`、`client.js` | 宿主端 / 前端打包产物 | ✅ 直接改（可读，未压缩） |
| `vendor/channel-pack/pack.js` | 渠道包产物（约 3.5 万行，格式化过） | ✅ 直接改，本仓库的改动就在这 |
| `src/`（59 个文件） | 真源码 | ❌ **不生效**——没有构建脚本，运行时只加载上面两个产物 |

所以修改策略是：**改产物，改完用真实请求验证**。不要指望改 `src/` 起作用，它只能当参考读物。

## 装到 DSH 里

### 方式一：插件管理器（推荐）

DSH 的**设置 → 插件 → 添加插件**支持三种来源：npm 包名、Git 地址、**本地绝对路径**。

clone 到本地后，在输入框里填这个目录的绝对路径即可。管理器会把它按 `path` 类型安装，
等价于写 `link:` 依赖。

### 方式二：手动改 profile

```bash
git clone https://github.com/liushuang293814/dsh-our-free-model-fork.git
```

编辑 `~/.dsh/profiles/desktop/package.json`，两处都要改：

```json
{
  "dependencies": {
    "dsh-our-free-model-fork": "link:D:/plugins/dsh-our-free-model-fork"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-our-free-model-fork",
        "dsh-better-sidebar"
      ]
    }
  }
}
```

> Linux / macOS 例：`"link:/home/you/plugins/dsh-our-free-model-fork"`
> Windows 例：`"link:D:/plugins/dsh-our-free-model-fork"`（斜杠写 `/` 或 `\\`）

然后：

```bash
cd ~/.dsh/profiles/desktop
npx --yes pnpm@11.28.5 install
```

装完 `node_modules/dsh-our-free-model-fork` 应该是一个**符号链接**：

```bash
ls -la ~/.dsh/profiles/desktop/node_modules/ | grep our-free
# dsh-our-free-model-fork -> /path/to/dsh-our-free-model-fork
```

**重启 DSH**（`pack.js` 是宿主侧模块，刷新网页无效），然后验证：

```bash
node verify.mjs
```

期望输出 `A 未清洗 → ❌ 400 / 11128` 和 `B 清洗后 → ✅ 200`。

⚠️ 代价：**不再跟随 npm 自动更新**。上游发新版要手动合（见下）。

## 上游升级怎么办

1. `npm pack dsh-our-free-model@<新版本>` 解包，覆盖到本目录
   —— 但**不要**覆盖 `package.json` 的 `name` / `version`，否则又变回上游包名
2. 先提交基线，留住上游原样：`git add -A && git commit -m "baseline: <新版本>"`
3. 重放补丁：

   ```bash
   OFM_PACK=$PWD/vendor/channel-pack/pack.js node reapply-buddy-patch.mjs
   ```

   脚本会预检三个锚点；锚点漂移会**报错退出，不会盲目插入**。
4. 跑 `node verify.mjs` 做真实请求验证——**不要只看代码对不对**。

## 想撤销

profile 的 `dependencies` 和 `bundles` 里删掉 `dsh-our-free-model-fork`，
把 `dsh-our-free-model` 加回来指向 npm 版（`"^2.1.0"`），再 `pnpm install`。

## 两个必须知道的坑

**一、别在原地覆盖 `node_modules` 里的 `pack.js`。**
pnpm 那边的文件是全局 store 的**硬链接**（`nlink = 2`），原地 write 会把 store 里那份
一起改掉：① 本机其他项目装同版本会拿到被改过的副本；② pnpm 校验哈希失败，
下次 install 把整棵树重新下载。`reapply-buddy-patch.mjs` 已经改成"写临时文件 + rename"
换 inode，不会再污染 store。

**二、用了 `link:` 就不要把目录删掉或改名。**
符号链接会悬空，插件直接加载失败。真要挪位置，改 profile 里的 `link:` 路径再 `pnpm install`。

## 许可证

- 本仓库：MIT，见 `LICENSE`（Copyright (c) 2026 Ebony-Vinyl，沿用上游声明）
- `vendor/channel-pack/`：来自 `dsh-codearts-auth`（MIT），出处与吸收的 commit 见
  `vendor/channel-pack/NOTICE.md`，**不要删除该文件**

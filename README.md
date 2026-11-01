# dsh-our-free-model-fork

DSH 插件 `dsh-our-free-model` 的二次开发版，修掉 buddy / workbuddy 渠道的 **11128 拦截**。

> 非官方版本，与上游作者无关。基于 npm `dsh-our-free-model@2.1.0`（MIT）的发布产物修改。

## 作用

buddy（CodeBuddy 国内版）和 workbuddy（国际版）会检查 `system` 消息里的内容指纹，
一旦认出"这不是官方客户端发的"，就返回 400 + 业务码 **11128**，界面上显示"请求被拦截，请重新发送"。

这个插件在请求发出前清洗掉这些指纹，其余功能与上游一致。

## 安装

需要 DSH 桌面端（DeepSeek Harness）。

> **建议先卸载官方的 `dsh-our-free-model`。** 两者命名空间已经完全隔离（包名、插件 id、
> LLM 路由、API 前缀、数据目录都不同），可以共存；但同时装会在模型列表里出现两份重复模型。

**1. 克隆**

```bash
git clone https://github.com/liushuang293814/dsh-our-free-model-fork.git
```

**2. 添加插件**

DSH 里打开 **设置 → 插件 → 添加插件**，填上面那个目录的**绝对路径**，例如：

```
D:/plugins/dsh-our-free-model-fork
```

装完自动完成依赖安装和启用。

**3. 重启 DSH**

`pack.js` 是宿主侧模块，刷新网页无效，必须重启客户端。

**4. 验证（可选）**

```bash
cd dsh-our-free-model-fork
node verify.mjs
```

期望看到 `A 未清洗 → ❌ 400 / 11128`、`B 清洗后 → ✅ 200`。

## 卸载

插件页里点卸载即可。想回到 npm 原版，把 profile 的 `~/.dsh/profiles/desktop/package.json`
里依赖改回 `"dsh-our-free-model": "^2.1.0"`，再 `npx --yes pnpm@11.28.5 install`。

## 注意

- **不再跟随 npm 更新**，这是二次开发版的代价。插件自带的上游自更新已关闭（`distribution: managed`）。
- 用 `link:` 方式安装的，**别删或改名这个目录**，否则符号链接悬空、插件加载失败。
- 配置和模型数据在 `~/.dsh/dsh-our-free-model-fork/`，与包名一致，卸载插件不会删除。
- 可以直接改 `src/`：`index.js` 实际 import 了其中 29 个模块，都是运行时加载的。`vendor/channel-pack/pack.js` 同理。

## 许可证

本仓库 MIT，见 `LICENSE`。`vendor/channel-pack/` 来自 `dsh-codearts-auth`（MIT），
出处见 `vendor/channel-pack/NOTICE.md`，请勿删除。

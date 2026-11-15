# 发布清单

本文件记录**已经做完的事**和**下次发版要照着做的事**。账号是 `18874530790`，
npm 用户名是 `chenjingze`，插件名 `dsh-default-full-permission`。

## 状态一览（2026-11-15）

| 环节 | 状态 |
| --- | --- |
| 代码 / 脚本 / guard | 完成，`node --check` 全过 |
| npm 1.0.0 | **已发布**（`https://registry.npmjs.org/dsh-default-full-permission`） |
| GitHub 仓库 | **已建** `18874530790/dsh-default-full-permission`，main 与 `v1.0.0` 都是 `755c388` |
| topics | 已加 `dsh-plugin` 等 6 个 |
| 市场 PR | **#15240** open，gate 已 success，等维护者合并 |
| 市场索引 | **未收录**（合并 + 一次成功 nightly 后才会出现） |
| npm 1.0.1 | **待发布**（修 repository 指向，见下节） |

## 为什么要发 1.0.1：repository 必须指回被收录的仓库

市场构建脚本 `scripts/probe-npm.mjs:117-135` 用这段逻辑把 npm 包和仓库关联：

```js
const linked = repoField.toLowerCase().includes(repo.toLowerCase())
if (!linked) return { npm: null, version: null, checkedAt: today }
```

`repo` 是**被收录仓库**的 `owner/repo`，即 `18874530790/dsh-default-full-permission`；
`repoField` 是 npm 上 latest 版本的 `repository.url`。

**1.0.0 发布时填的是 `Minglink/dsh-default-full-permission`** —— 那个仓库根本不存在
（`GET /repos/Minglink/dsh-default-full-permission` → 404），字符串也对不上，
于是 `includes` 为 false → 永远解析不出 npm → 条目永远进不了 `index.json`
（站内能浏览，但搜索和安装索引里没有）。

所以必须在 1.0.1 里把 `repository` / `homepage` / `bugs` 改成 `18874530790/...`，
重新发布。registry 不允许覆盖已有版本号，只能发新版本。

## 1. 发 1.0.1

package.json 已改好（version 1.0.1，三处 URL 与 author 都是 `18874530790`）：

```bash
cd ~/.dsh/plugins/dsh-default-full-permission
npm config set registry https://registry.npmjs.org/   # 全局默认是腾讯镜像，发布必须走官方
npm publish --access public
```

token 已在全局 `~/.npmrc` 的 `//registry.npmjs.org/:_authToken=`，无需再登录。
发布后等 45 秒左右索引刷新，再看：

```bash
npm view dsh-default-full-permission@1.0.1 repository.url
# 期望 git+https://github.com/18874530790/dsh-default-full-permission.git
```

## 2. 把 package.json 的改动同步到 GitHub

远端不能直接 `git push`（GitHub 443 在本机被阻断，gh-proxy 只读），
只能走 Git Data API。当前 token 存于 `~/.dsh/tmp-gh/.gh-token`，scope 只有 `repo`。

```bash
# 1) 取当前 main 的 head 与 tree
GET  https://gh-proxy.com/https://api.github.com/repos/18874530790/dsh-default-full-permission/branches/main
GET  https://gh-proxy.com/https://api.github.com/repos/18874530790/dsh-default-full-permission/git/commits/<sha>
# 2) 建新 blob（package.json / README.md 的新内容，base64）
POST .../git/blobs
# 3) 建新 tree（在旧 tree 上替换这两个 path）
POST .../git/trees      {"base_tree": <tree>, "tree": [{"path":"package.json","mode":"100644","type":"blob","sha":<new>}, ...]}
# 4) 建 commit
POST .../git/commits    {"message":"chore: point repository urls at this account (1.0.1)","tree":<new tree>,"parents":[<head>]}
# 5) 推进 main（非 force）与标签
PATCH .../git/refs/heads/main  {"sha": <new commit>, "force": false}
POST  .../git/refs             {"ref":"refs/tags/v1.0.1","sha":<new commit>}
```

注意：`v1.0.0` 标签不要动，它对应 npm 上已发布的 1.0.0 内容。

## 3. 市场收录链路（为什么搜不到）

1. **PR 合并** —— 人工批量操作。2026-11-14 一天合了 276 个，11-15 只有 3 个。
   队列里有 459 个 open PR，比 #15240 早的有 237 个。
2. **sync-readme**（push 到 main 触发）重新生成 README 并 commit。
3. **build-site** 监听 sync-readme 的完成事件，构建站点：
   - 更新 `index.json` / `plugins.json`
   - 部署 Pages
   - 探测 npm 关联（**只有 nightly 才 `PROBE_ALL`，push 构建不探测**）

`index.json` 只含解析出 npm 的条目：5635 条，全部 `source.type = "npm"`；
`plugins.json` 是全集 11137 条，其中 npm=null 的有 5502 条。

**当前全局故障**：nightly `#21536` 失败，报

```
MarketIndexError: $.plugins[1950].name duplicates dsh-dot-mcp
```

已有人开 issue **#15569**。在它修好之前，合并后的条目也进不了搜索索引。
`index.json` 的 `Last-Modified` 会冻结在最后一次成功构建的时间。

## 4. 装回本机验证

```bash
plugin_manager install_bundle target="dsh-default-full-permission@1.0.1"
# 或从 GitHub（需要能访问 github，本机不行）
plugin_manager install_bundle target="github:18874530790/dsh-default-full-permission#v1.0.1"
```

装完 `Ctrl+Q` 退出重启，新开会话发 `/permission`，应回
`current preset danger-full-access`。

## 5. 已知网络限制

| 目标 | 本机结果 |
| --- | --- |
| `registry.npmjs.org` | 200 |
| `www.npmjs.com` | 200（浏览器已登录 `chenjingze`） |
| `github.com` / `api.github.com` | **000 / ECONNRESET**（TLS 层阻断，非 DNS） |
| `gh-proxy.com` | 200，能代理 api.github.com，但**只读**（push 报 `No anonymous write access`） |
| SSH `github.com:22` / `ssh.github.com:443` | 握手成功，但 token 无 `admin:public_key`，`/user/keys` 返回 404，加不上公钥 |

因此所有写操作只能走 Git Data API + PAT。

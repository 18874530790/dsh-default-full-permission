# 发布清单

本插件已完成编码、语法检查与本地验证。剩下四步需要账号凭据，在能登录的
机器上按顺序执行即可。

## 0. 先确认一件事：市场只收 npm 包

`https://awesome-dsh-plugin.com/index.json` 当前有 5538 条记录，
`source.type` **全部是 `npm`，没有一条是 `github`**。所以：

- 只推到 GitHub → 别人能装，但**进不了市场索引**；
- 要进市场，`package.json` 的 `name` 必须真的发布到 npm 上。

`name` 字段目前是 `dsh-default-full-permission`，未被占用（建议发布前用
`npm view dsh-default-full-permission` 再确认一次）。

## 1. GitHub

已在本地建好仓库并打好 `v1.0.0` 标签，只差 remote：

```bash
cd ~/.dsh/plugins/dsh-default-full-permission

# 换成你自己的账号名（当前按 Minglink 填写，如不对则同步改 package.json）
git remote add origin https://github.com/Minglink/dsh-default-full-permission.git
git push -u origin main
git push origin v1.0.0
```

仓库建好之后，把 `package.json` 里 `repository` / `homepage` / `bugs`
三处的 `Minglink` 改成实际账号，再重新提交并移动标签：

```bash
git tag -d v1.0.0   # 仓库当前标签指向首版提交
git commit -am "chore: correct repository urls"
git tag v1.0.0
git push origin main --tags --force
```

## 2. npm（进市场必需）

```bash
cd ~/.dsh/plugins/dsh-default-full-permission
npm adduser                      # 或 npm login
npm config set registry https://registry.npmjs.org/   # 本机默认是腾讯镜像，发布必须走官方
npm publish --access public
```

发布完成后把 npm 上的仓库地址补齐：

```bash
npm pkg set repository.url=git+https://github.com/<你的账号>/dsh-default-full-permission.git
npm pkg set homepage=https://github.com/<你的账号>/dsh-default-full-permission#readme
npm pkg set bugs.url=https://github.com/<你的账号>/dsh-default-full-permission/issues
npm publish
```

## 3. 市场索引 PR

到 awesome-dsh-plugin.com 的索引仓库提 PR，往 `index.json` 的 `plugins`
数组加一条。按现有 5538 条的实际结构，`source` 只有 `{"type":"npm"}`
一种写法，版本号必须与 npm 上一致：

```json
{
  "name": "dsh-default-full-permission",
  "title": "Minglink/dsh-default-full-permission",
  "description": {
    "en": "Makes every new and existing DSH session resolve to the danger-full-access preset (full file access, no approval prompts) by appending the session-level override that outranks the deployment default. Includes guarded scripts for sessions that already pinned a stricter preset.",
    "zh": "让新建与既有的 DSH 会话都解析为 danger-full-access 预设（完全文件访问、不弹审批）。核心是追加会话级覆盖事件——会话覆盖优先于部署默认值，所以只改配置管不到已存在的会话；附带带运行检测的脚本处理已钉死旧值的会话。"
  },
  "homepage": "https://awesome-dsh-plugin.com/p/Minglink/dsh-default-full-permission/",
  "repository": { "url": "https://github.com/Minglink/dsh-default-full-permission" },
  "metadata": { "category": "security", "keywords": [], "labels": [], "sortKeys": {} },
  "versions": [
    { "version": "1.0.0", "publishTimestamp": 1794642000, "source": { "type": "npm" }, "engines": {} }
  ]
}
```

`publishTimestamp` 填 npm 实际发布时间（`npm view ... time.1.0.0` 可查，
秒级 Unix 时间戳）。上面这个是占位值，别照抄。

## 4. 装回本机验证

```bash
plugin_manager install_bundle target="dsh-default-full-permission@1.0.0"
```

装完重启（Ctrl+Q），新开会话发 `/permission`，应回
`current preset danger-full-access`。

## 已完成的本地工作

- 插件源码、三个脚本、guard、README、LICENSE、.gitignore
- `node --check` 四个文件全通过
- guard 实测：运行时拦截 exit=2 / `--dry-run` 放行 / 路径错 exit=3
- `npm pack --dry-run` 确认发布 8 个文件、24 kB
- git 仓库初始化、首次提交、`v1.0.0` 标签
- profile 三处注册（dependencies / bundles / cordis.patch.yml 三层 config）

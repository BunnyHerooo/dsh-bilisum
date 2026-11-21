# REBUILD_STATUS

复刻依据：`F:\联想浏览器下载\BiliSum_DSH插件复刻规格书_REPRODUCTION_SPEC.md`
（SHA256 `1AE803270C899B01B4995B182B98912196619BAE14E0C7F2C785EE1587C2C42A`，11333 行）

输出目录：`F:\Deepseek-Harness\BiliSum`（沿用现有插件目录，按用户选择）
复刻方式：**机械提取**（`bilisum-repro-tools/extract-spec.mjs`），不靠模型重写。
备份：`F:\Deepseek-Harness\.bilisum-backup-20261121_114615`（同步前的旧版本，21 个文件）。
隔离暂存：`F:\Deepseek-Harness\.repro-staging`（提取结果，用于哈希校验）。

---

## 1. 文件恢复

| 来源 | 区块 | 数量 |
|---|---|---|
| §1.5 资源 | `### 资源：` + `~~~~~text` | 11 |
| §2.13 源码 | `### AST文件：` + `~~~~javascript`/`~~~~python` | 12 |
| **合计** | | **23** |

结果：**23/23 写入，23/23 SHA256 与规格书记录一致，0 处差异**。
提取时对围栏尾部空行做了三种候选（原样 / 去尾空行 / 删最后一空行），全部命中 `as-is`，未做任何内容修补。

第一方文件清单（与规格书逐字节一致）：

```
.gitignore                    package.json                 cordis.patch.yml
icon.svg                      LICENSE                      README.md
client.js                     docs/DETAIL.md                docs/RETROSPECTIVE.md
locale/en.json                locale/zh.json                vendor/requirements.txt
lib/account.js                lib/home.js                   lib/index.js
lib/layout.js                 lib/links.js                  lib/pipeline.js
lib/report.js                 lib/worker.js                 scripts/account.test.mjs
scripts/setup-env.js          python/bilisum_worker.py
```

相对同步前的旧版本：新增 `lib/account.js`（116 行，账号只读库）、`scripts/account.test.mjs`（64 行）；差异文件 8 个（client.js / lib/index.js / lib/pipeline.js / lib/report.js / python/bilisum_worker.py / package.json / README.md / docs/DETAIL.md）。规格书版本包含此前所有修复（惰性服务、设置持久化、日志按需渲染、路径省略、番剧解析），故为超集，无回退。

## 2. 静态检查

| 检查 | 结果 |
|---|---|
| JS/MJS 语法（11 个文件，`node --check`） | 全部 exit 0 |
| JSON（package.json、locale/en.json、locale/zh.json） | 全部可解析 |
| YAML（cordis.patch.yml，pyyaml） | OK |
| SVG（icon.svg，XML 解析） | OK |
| Python（`compile()` 内存编译，未生成 pyc） | OK |
| `__pycache__` 目录 | 0 个 |

> 注：PowerShell 的 `ConvertFrom-Json` 曾把 `zh.json` 判为失败，是控制台 GBK 编码误报；Node 与 Python 均解析通过。

## 3. 自带测试

```
命令：node F:\Deepseek-Harness\BiliSum\scripts\account.test.mjs
运行时：Node v24.18.0
退出码：0
结果：tests 9 / pass 9 / fail 0（耗时 16.6 ms）
```

测试项：登录要求与参数校验、未知/过期授权、目录分页与 Cookie 编码、收藏归一化与分页、拒绝他人账号目录、稍后再看本地分页、空列表、上游鉴权失败不泄露信息、账号切换拒绝过期响应。

## 4. 签名覆盖（附录 A.1 校验器）

```
JS parser: Acorn 8.16.0（Node v24.18.0 内嵌）
JS files=11 functions=540 classes=2
JS missing/mismatched=[]   JS extra=[]
Python AST: 3.12.0
Python files=1 functions=44 classes=1
Python missing/mismatched=[]   Python extra=[]
ALL SIGNATURE SETS MATCH   exit=0
```

合计 **587 条**（540 + 2 + 44 + 1），与规格书基线一致；ID（文件:节点类型:行:列）与签名文本均逐条相等，无多余记录。

## 5. 依赖与宿主兼容

| 项 | 规格书 | 本机 | 处理 |
|---|---|---|---|
| Node.js | 26.4.0（取证快照） | 24.18.0 | 语法/测试/审计均通过；DSH Host 实际使用自身运行时 |
| Python | 3.12.16（受管 venv） | 3.12.0 | worker 未改动，编译通过 |
| qrcode（npm） | `^1.5.4` | 未安装 → 已装 **1.5.4** | `npm install --omit=dev`，共 29 个包，`node_modules` 已在 .gitignore |
| bilibili-api-python / aiohttp / yt-dlp / imageio-ffmpeg | 17.4.2 / 3.14.5 / 2026.10.26 / 0.8.1 | 同版本（已在受管 venv 中） | 无需操作 |
| DSH | `>=0.2.0` | 当前版本未在源码确认 | 未修改 DSH 本体 |

宿主集成：`lib/index.js` 导入校验通过（`exports: apply, inject; inject: ["tools"]`）。
`include:bilisum` 当前 `enabled=true`、`fiberPhase=null` —— **需要重启 DSH 才会激活**（插件管理器返回 `restart-required / package-moved`）。

## 6. 待办

- [ ] 用户重启 DSH，确认侧边栏出现 BiliSum 且面板可用
- [ ] GUI 视觉验收（宽屏顶部状态栏同行、窄屏折行、结果元数据合并、路径省略）
- [ ] 扫码登录（`/bilisum/qrcode`）由用户本人完成
- [ ] 真实抓取：字幕含高赞评论、无失败时不出现「解析失败列表 - 无」、字幕「打开文件夹」指向父目录
- [ ] 付费模型报告（需用户确认模型与费用）

## 7. 已知偏差与疑点

1. **输出目录选择**：按用户要求直接写入现有插件目录，而非新建目录；因此 `REBUILD_STATUS.md` 本身不在规格书文件清单内（仅交付文档，不参与打包）。
2. **qrcode 依赖需联网安装**：规格书把它声明为 npm 依赖，但复刻环境的插件目录原本没有 `node_modules`，必须执行一次 `npm install`。
3. **Node 版本差异**（24.18.0 vs 26.4.0）：审计脚本注释要求"若 Node 未携带内嵌 Acorn 必须失败"，本机 Node 24 携带 Acorn 8.16.0（规格书记为 8.17.0），校验通过但版本号不同。
4. **A/B 逐字节 diff 未执行**：原实现不可运行，无法做双向对比；本报告只声明"参考文件恢复一致 + 自带测试通过 + 签名集合匹配"。
5. **GUI 验证未完成**：需要重启后由用户在现有界面确认，未另启替代服务器。

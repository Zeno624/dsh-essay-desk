# 随笔工坊 · Essay Desk

在 **DeepSeek Harness** 的 Web GUI 里写随笔、按主题归档、沉淀思想脉络的插件。

- **写作面板**：左侧栏「随笔」图标 → 整页面板。左栏是「未分类」草稿与「主题」列表，右栏是标题 + 正文编辑区：手动保存、`Ctrl/Cmd+S`、停止输入约 1 秒自动保存、删除（移入归档备份）、实时字数。
- **主题归档**：在对话里说「帮我整理随笔」，DSH 会通读未分类草稿，归纳主题，把每篇归档进 `主题/<主题名>.md`，原稿移入 `未分类/_已整理/` 留档。
- **思想脉络**：说「总结一下我的思想变化」或「帮我梳理关于 xx 的想法」，DSH 会跨篇提炼，把阶段性总结追加到 `思想脉络.md`，并在对话里给出观察。
- **写作指导**：基于已有随笔给出针对性的写作建议。

## 安装

这是一个标准 DSH bundle（含 `cordis.patch.yml` 与 `dsh.client` 声明）：

```text
dsh-essay-desk/
├── index.js          Host 半侧：存储 + HTTP API + Agent 工具 + 系统提示段落
├── client.js         Client 半侧：Web GUI 面板（main 槽 + sidebar.panellist 图标）
├── package.json      bundle 清单（dsh.bundle / dsh.client）
├── cordis.patch.yml  Loader 行声明
├── locale/{zh,en}.json  插件管理器显示用的标题与描述
└── icon.svg
```

把本目录放到任意工作目录，然后用 Harness 的插件管理安装这个本地 bundle
（或把包名加入 profile 的 `dsh.profile.bundles`）。安装后刷新 Web 页面，侧栏会出现「随笔」图标。

## 数据位置

默认根目录：`<DSH_HOME>/essays`（未设置 `DSH_HOME` 时为 `~/.dsh/essays`），首次启动自动创建。

```
essays/
├── 未分类/<id>.md           草稿（# 标题 + 正文）
├── 未分类/_已整理/<id>.md   归档后的原稿备份
├── 主题/<主题名>.md         每个主题一个文件
└── 思想脉络.md              按日期追加的阶段性总结
```

### 修改存放位置

优先级：环境变量 `ESSAY_DESK_ROOT`（绝对路径）> `<DSH_HOME>/essay-desk.json` 中的 `{ "root": "..." }` > 默认目录。

```json
{ "root": "D:/我的文档/随笔" }
```

## Agent 工具

工具 `essay`：

| action | 作用 |
|---|---|
| `list` | 未分类草稿（id / 标题 / 字数 / 日期）与主题（篇数）总览 |
| `read` | 读一篇草稿、某个主题文件或 `思想脉络.md` |
| `write` | 新建或修改未分类草稿 |
| `classify` | 把草稿归档进主题，支持 `items` 批量；可轻微润色标题、不改正文 |
| `note` | 向 `思想脉络.md` 追加一段按日期的总结 |

插件还会注入一段系统提示，告诉 Agent 这个随笔库的约定，任何会话都能直接整理。

## 文件格式

草稿：`# 标题` + 空行 + 正文。

主题文件由归档时自动维护：

```markdown
# 主题名

## 随笔标题

*2026-10-28 20:30*

正文……

---
```

## 开发与校验

纯 ESM + 纯 JS，无构建步骤、无外部依赖。

```bash
node --check index.js
node --check client.js
```

Host 半侧的全部纯函数（`resolveRoot` / `listState` / `saveDraft` / `classifyDraft` / `appendNote` …）均已导出，便于在临时目录中做单元测试。

## 说明

- HTTP 接口只监听回环地址请求，并限制请求体 2 MB。
- 归档不删除原稿：原文件移动到 `未分类/_已整理/`。
- 面板内不可归档；归档由 Agent 在对话中通过 `essay` 工具完成，保证主题归纳的一致性。

## License

MIT

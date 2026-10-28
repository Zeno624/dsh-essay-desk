// 随笔工坊（dsh-essay-desk）Host 半侧：文件存储 + HTTP API + Agent 工具 + 系统提示段落。
// 数据模型（与 client.js 共享，见 CONTRACT.md §1）：
//   <root>/未分类/<id>.md           一篇未分类草稿
//   <root>/未分类/_已整理/<id>.md   归档（delete/classify）后的草稿备份，不对外列出
//   <root>/主题/<主题名>.md         每个主题一个合集文件
//   <root>/思想脉络.md              思想变化总结
// 关键不变量：
//   1. id / 主题名都不带路径分隔符，拼出的绝对路径一律经 assertInside 确认仍在 <root> 内；
//   2. 时间是本地时区（+08:00）表述，markdown 内用 `yyyy-MM-dd HH:mm`，API 用带偏移的 ISO；
//   3. 所有对外文案、错误信息都用中文。
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, renameSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'

export const name = 'essay-desk'
export const inject = ['webServer', 'tools', 'systemPrompt']

const DEFAULT_ROOT = 'essays'
const API_PATH = '/essay-desk/api'
const BODY_LIMIT = 2 * 1024 * 1024 // 2MB
const DRAFT_DIR = '未分类'
const ARCHIVE_DIR = '_已整理'
const TOPIC_DIR = '主题'
const NOTES_FILE = '思想脉络.md'
const NOTES_TITLE = '思想脉络'
const UNTITLED = '无题'
const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
// birthtime 比「现在」晚超过这个量时视为不可信（见 fileTimes）
const BIRTHTIME_FUTURE_TOLERANCE = 10 * 60 * 1000

// ---------------- 时间 ----------------

const pad2 = (n) => String(n).padStart(2, '0')

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`时间格式不正确：${value}`)
  return date
}

/** 本地时区日期：yyyy-MM-dd */
export function formatDate(value = new Date()) {
  const date = asDate(value)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 本地时区时间：yyyy-MM-dd HH:mm（主题文件条目时间用这个） */
export function formatTime(value = new Date()) {
  return `${formatDate(value)} ${pad2(asDate(value).getHours())}:${pad2(asDate(value).getMinutes())}`
}

/** 带本地时区偏移的 ISO 时间：2026-10-28T20:24:47+08:00（API / 工具返回用） */
function localIso(value) {
  const date = asDate(value)
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const offset = `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  return `${formatDate(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}${offset}`
}

/** yyyyMMdd-HHmmss，用于新建草稿与归档重名后缀 */
function timestamp(newDate = new Date()) {
  const date = asDate(newDate)
  return `${formatDate(date).replace(/-/g, '')}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
}

// ---------------- 根目录解析（CONTRACT §2） ----------------

/**
 * 优先 ESSAY_DESK_ROOT（绝对路径）→ <DSH_HOME 或 ~/.dsh>/essay-desk.json 的 { root }
 * → 默认 <DSH_HOME 或 ~/.dsh>/essays。同级来源不可用时静默回落，保证插件一定能启动。
 */
export function resolveRoot() {
  const fromEnv = String(process.env.ESSAY_DESK_ROOT || '').trim()
  if (fromEnv && isAbsolute(fromEnv)) return resolve(fromEnv)

  const dshHome = String(process.env.DSH_HOME || '').trim()
  const home = dshHome || join(homedir(), '.dsh')
  const configPath = join(home, 'essay-desk.json')
  try {
    if (existsSync(configPath)) {
      const settings = JSON.parse(readFileSync(configPath, 'utf8'))
      const fromConfig = settings && typeof settings.root === 'string' ? settings.root.trim() : ''
      if (fromConfig && isAbsolute(fromConfig)) return resolve(fromConfig)
    }
  } catch (error) {
    // 配置文件损坏不该让插件加载失败：回落到默认根目录，具体读写错误由各操作报出
  }
  return resolve(join(home, DEFAULT_ROOT))
}

/**
 * 确保数据目录存在。失败直接抛出（apply 里会吞掉并让具体操作报错）。
 */
export function ensureDirs(root = resolveRoot()) {
  const base = resolve(String(root))
  mkdirSync(join(base, DRAFT_DIR), { recursive: true })
  mkdirSync(join(base, TOPIC_DIR), { recursive: true })
  mkdirSync(join(base, DRAFT_DIR, ARCHIVE_DIR), { recursive: true })
  return base
}

// ---------------- 路径与校验 ----------------

/** 拒绝空值、路径分隔符与 `..`（id / 主题名共用） */
function safeName(value, label) {
  const candidate = String(value ?? '').trim()
  if (!candidate) throw new Error(`${label}不能为空`)
  if (candidate.includes('/') || candidate.includes('\\') || candidate.includes('..') || candidate.includes('\0')) {
    throw new Error(`${label}包含非法字符：${candidate}`)
  }
  return candidate
}

/** 兜底防穿越：拼出的路径必须仍在 root 内 */
function assertInside(root, target) {
  const rootAbs = resolve(root)
  const targetAbs = resolve(target)
  if (targetAbs !== rootAbs && !targetAbs.startsWith(rootAbs + sep)) throw new Error('路径越界')
  return targetAbs
}

function draftFile(root, id) {
  return assertInside(root, join(resolve(root), DRAFT_DIR, `${safeName(id, '草稿 id')}.md`))
}

function draftDir(root) {
  return join(resolve(root), DRAFT_DIR)
}

/** 主题名只保留文件名安全字符：`\ / : * ? " < > |`、换行等替换为 `-` */
export function sanitizeTopic(value) {
  const topic = String(value ?? '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '-')
    .trim()
  if (!topic || /^\.+$/.test(topic)) throw new Error('主题名不能为空')
  return topic
}

function topicFile(root, name) {
  return assertInside(root, join(resolve(root), TOPIC_DIR, `${sanitizeTopic(name)}.md`))
}

// ---------------- 草稿文件读写 ----------------

/** 草稿正文（不含标题），返回去掉首尾空白的 text；落盘的 `# 无题` 还原成空标题 */
function parseDraft(content) {
  const lines = String(content).split(/\r?\n/)
  const first = lines[0] || ''
  const hasHeading = first.startsWith('# ')
  const title = hasHeading ? first.slice(2).trim() : ''
  const body = (hasHeading ? lines.slice(1).join('\n') : lines.join('\n')).trim()
  return { title: title === UNTITLED ? '' : title, text: body }
}

/** 落盘格式：`# 标题\n\n正文\n`；标题为空写 `# 无题` */
function renderDraft(title, text) {
  const heading = String(title || '').replace(/[\r\n]+/g, ' ').trim() || UNTITLED
  const body = String(text ?? '').trim()
  return body ? `# ${heading}\n\n${body}\n` : `# ${heading}\n`
}

/** created / updated：birthtime 非法（0 或未来 10 分钟以上）时退回 mtime */
function fileTimes(file) {
  const stat = statSync(file)
  const modified = typeof stat.mtimeMs === 'number' ? stat.mtimeMs : stat.mtime.getTime()
  const birth = typeof stat.birthtimeMs === 'number' ? stat.birthtimeMs : stat.birthtime ? stat.birthtime.getTime() : 0
  const created = birth > 0 && birth <= Date.now() + BIRTHTIME_FUTURE_TOLERANCE ? birth : modified
  return { created, updated: modified }
}

function draftMeta(file) {
  const parsed = parseDraft(readFileSync(file, 'utf8'))
  const times = fileTimes(file)
  return {
    id: basename(file, '.md'),
    title: parsed.title,
    created: localIso(times.created),
    updated: localIso(times.updated),
    chars: parsed.text.length,
    preview: parsed.text.replace(/\r?\n/g, ' ').slice(0, 80),
  }
}

/** 未分类草稿列表，按 updated 倒序；目录不存在视为空 */
export function listDrafts(root = resolveRoot()) {
  const dir = draftDir(root)
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
  const drafts = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    try {
      drafts.push(draftMeta(join(dir, entry.name)))
    } catch (error) {
      // 只容忍「列举期间文件被删」的竞态，其余 IO 错误照常抛出
      if (error && error.code === 'ENOENT') continue
      throw error
    }
  }
  drafts.sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated) || b.id.localeCompare(a.id))
  return drafts
}

/** 读一篇未分类草稿；不存在时抛中文错误 */
export function readDraft(root, id) {
  const file = draftFile(root, id)
  if (!existsSync(file)) throw new Error(`草稿不存在：${id}`)
  const parsed = parseDraft(readFileSync(file, 'utf8'))
  const times = fileTimes(file)
  return {
    id: basename(file, '.md'),
    title: parsed.title,
    text: parsed.text,
    created: localIso(times.created),
    updated: localIso(times.updated),
    chars: parsed.text.length,
  }
}

/**
 * 新建（无 id）或更新（有 id）草稿。
 * 更新时保留文件名与 created（created 来自 birthtime），只重写标题行与正文。
 */
export function saveDraft(root, { id, title, text } = {}) {
  const base = ensureDirs(root)
  const cleanTitle = String(title ?? '').replace(/[\r\n]+/g, ' ').trim()
  const body = String(text ?? '').trim()
  const content = renderDraft(cleanTitle, body)

  let draftId
  if (id !== undefined && id !== null && String(id).trim() !== '') {
    const file = draftFile(base, id)
    if (!existsSync(file)) throw new Error(`草稿不存在：${id}`)
    draftId = basename(file, '.md')
    writeFileSync(file, content, 'utf8')
  } else {
    draftId = createDraftId(base, cleanTitle)
    writeFileSync(draftFile(base, draftId), content, 'utf8')
  }

  const times = fileTimes(draftFile(base, draftId))
  return {
    id: draftId,
    title: cleanTitle,
    created: localIso(times.created),
    updated: localIso(times.updated),
    chars: body.length,
  }
}

/** yyyyMMdd-HHmmss-<slug>.md，同名追加 -2、-3…；id 一旦生成不再随标题变化 */
function createDraftId(root, title) {
  const stamp = timestamp()
  const slug = slugOf(title)
  const dir = draftDir(root)
  const archiveDir = join(dir, ARCHIVE_DIR)
  // 归档备份里的同名文件也算占用：保证 id 在整个随笔库里唯一（归档后同名新建不会复用旧 id）
  const occupied = (candidate) =>
    existsSync(join(dir, `${candidate}.md`)) || existsSync(join(archiveDir, `${candidate}.md`))
  let candidate = `${stamp}-${slug}`
  let suffix = 2
  while (occupied(candidate)) {
    candidate = `${stamp}-${slug}-${suffix}`
    suffix += 1
  }
  return candidate
}

/** 标题 → 文件名片段：去掉 Windows 禁用字符与换行、空白折叠成 -、截断 30 字符 */
function slugOf(title) {
  const slug = String(title ?? '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/^-+|-+$/g, '')
  return slug || '随笔'
}

/**
 * 软删除 / 归档：把草稿移进 未分类/_已整理/，返回归档文件名（含 .md）。
 * 重名时加时间后缀，绝不让 rename 覆盖已有备份（Windows 上 rename 到已存在文件会失败）。
 */
export function archiveDraft(root, id) {
  const base = resolve(root)
  const file = draftFile(base, id)
  if (!existsSync(file)) throw new Error(`草稿不存在：${id}`)
  const archiveDir = join(base, DRAFT_DIR, ARCHIVE_DIR)
  mkdirSync(archiveDir, { recursive: true })
  const draftId = basename(file, '.md')
  const archivedAs = uniqueArchiveName(archiveDir, draftId)
  renameSync(file, join(archiveDir, archivedAs))
  return archivedAs
}

function uniqueArchiveName(archiveDir, draftId) {
  if (!existsSync(join(archiveDir, `${draftId}.md`))) return `${draftId}.md`
  const stamp = timestamp()
  let candidate = `${draftId}-${stamp}.md`
  let suffix = 2
  while (existsSync(join(archiveDir, candidate))) {
    candidate = `${draftId}-${stamp}-${suffix}.md`
    suffix += 1
  }
  return candidate
}

// ---------------- 主题文件 ----------------

function countTopicEntries(content) {
  return String(content)
    .split(/\r?\n/)
    .filter((line) => line.startsWith('## ')).length
}

/** 主题列表，按名称本地化排序；count = `## ` 行数，chars = 文件内容长度 */
export function listTopics(root = resolveRoot()) {
  const dir = join(resolve(root), TOPIC_DIR)
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
  const topics = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const file = join(dir, entry.name)
    try {
      const content = readFileSync(file, 'utf8')
      topics.push({
        name: basename(entry.name, '.md'),
        count: countTopicEntries(content),
        chars: content.length,
        updated: localIso(fileTimes(file).updated),
      })
    } catch (error) {
      if (error && error.code === 'ENOENT') continue
      throw error
    }
  }
  topics.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return topics
}

/** 读一个主题合集文件（整份内容） */
export function readTopic(root, name) {
  const file = topicFile(root, name)
  if (!existsSync(file)) throw new Error(`主题不存在：${sanitizeTopic(name)}`)
  const content = readFileSync(file, 'utf8')
  const topicName = basename(file, '.md')
  return {
    name: topicName,
    title: topicName,
    text: content,
    updated: localIso(fileTimes(file).updated),
    count: countTopicEntries(content),
  }
}

// ---------------- 思想脉络 ----------------

function notesFile(root) {
  return join(resolve(root), NOTES_FILE)
}

function notesMeta(root) {
  const file = notesFile(root)
  if (!existsSync(file)) return { exists: false, chars: 0, updated: null }
  return { exists: true, chars: readFileSync(file, 'utf8').length, updated: localIso(fileTimes(file).updated) }
}

function readNotes(root) {
  const file = notesFile(root)
  if (!existsSync(file)) return { title: NOTES_TITLE, text: '', updated: null, exists: false }
  return { title: NOTES_TITLE, text: readFileSync(file, 'utf8'), updated: localIso(fileTimes(file).updated), exists: true }
}

/** 追加思想脉络条目：`## yyyy-MM-dd 标题` + 正文 + `---`；文件不存在先建 `# 思想脉络` */
export function appendNote(root, { text, title } = {}) {
  const base = ensureDirs(root)
  const body = String(text ?? '').trim()
  if (!body) throw new Error('总结内容不能为空')
  const headingTitle = String(title ?? '').replace(/[\r\n]+/g, ' ').trim()
  const date = formatDate(new Date())
  const file = notesFile(base)
  if (!existsSync(file)) writeFileSync(file, `# ${NOTES_TITLE}\n\n`, 'utf8')
  const heading = headingTitle ? `## ${date} ${headingTitle}` : `## ${date}`
  appendFileSync(file, `${heading}\n\n${body}\n\n---\n`, 'utf8')
  return { date, title: headingTitle, chars: body.length }
}

// ---------------- 归档进主题 ----------------

/**
 * 读草稿（title/text 参数可覆盖，用于润色标题或修订正文；空串视为没给）→
 * 追加进主题文件 → 把草稿移进 _已整理。返回主题归档后篇数。
 * 先追加后归档：归档失败时草稿仍在，代价是可能重复追加一次。
 */
export function classifyDraft(root, { id, topic, title, text } = {}) {
  const base = resolve(root)
  const draft = readDraft(base, safeName(id, '草稿 id'))
  const topicName = sanitizeTopic(topic)
  const finalTitle =
    typeof title === 'string' && title.trim() ? title.replace(/[\r\n]+/g, ' ').trim() : draft.title
  const overrideText = typeof text === 'string' ? text.trim() : ''
  const body = overrideText || draft.text
  if (!body) throw new Error(`草稿《${finalTitle || UNTITLED}》没有正文，无法归档`)

  const file = topicFile(base, topicName)
  mkdirSync(dirname(file), { recursive: true })
  // 主题文件不存在时先写标题行；条目时间用草稿最后修改时间，让合集按写作时间排列
  if (!existsSync(file)) writeFileSync(file, `# ${topicName}\n\n`, 'utf8')
  appendFileSync(
    file,
    `## ${finalTitle || UNTITLED}\n\n*${formatTime(draft.updated)}*\n\n${body}\n\n---\n`,
    'utf8',
  )

  const archivedAs = archiveDraft(base, draft.id)
  return {
    id: draft.id,
    topic: topicName,
    title: finalTitle,
    archivedAs,
    topicCount: countTopicEntries(readFileSync(file, 'utf8')),
  }
}

// ---------------- 汇总状态 ----------------

/** 面板 / 工具 list 用的完整状态；totals.chars = 未分类正文 + 主题合集内容的总字符数 */
export function listState(root = resolveRoot()) {
  const base = resolve(root)
  const drafts = listDrafts(base)
  const topics = listTopics(base)
  return {
    root: base,
    drafts,
    topics,
    notes: notesMeta(base),
    totals: {
      drafts: drafts.length,
      topics: topics.length,
      chars: drafts.reduce((sum, draft) => sum + draft.chars, 0) + topics.reduce((sum, topic) => sum + topic.chars, 0),
    },
  }
}

// ---------------- HTTP API（CONTRACT §3.2） ----------------

/** 只允许回环：socket 地址与 Host 头解析出的 hostname 都必须属于本机 */
function isLoopback(req) {
  const address = req && req.socket ? req.socket.remoteAddress : undefined
  if (address !== undefined && address !== null && !LOOPBACK_ADDRS.has(address)) return false
  const host = hostnameOf(req && req.headers ? req.headers.host : undefined)
  return LOOPBACK_HOSTS.has(host)
}

function hostnameOf(hostHeader) {
  const raw = String(hostHeader || '').trim()
  if (!raw) return ''
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(raw)
  if (bracketed) return bracketed[1]
  if (/^(?:[0-9a-fA-F]{0,4}:){2,}[0-9a-fA-F]{0,4}$/.test(raw)) return raw // 裸 IPv6（::1）
  const colon = raw.lastIndexOf(':')
  return colon >= 0 ? raw.slice(0, colon) : raw
}

/** 读 UTF-8 请求体，上限 2MB（超限直接 reject，随后由调用方回「内容过大」） */
function readBody(req, limit) {
  return new Promise((resolveBody, rejectBody) => {
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      rejectBody(error)
    }
    const declared = Number(req.headers && req.headers['content-length'])
    if (Number.isFinite(declared) && declared > limit) {
      fail(new Error('内容过大'))
      if (typeof req.resume === 'function') req.resume()
      return
    }
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > limit) {
        fail(new Error('内容过大'))
        if (typeof req.resume === 'function') req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolveBody(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', (error) => fail(error))
    req.on('aborted', () => fail(new Error('请求已中断')))
  })
}

async function handleApi(req, res) {
  const send = (status, payload) => {
    if (res.headersSent || res.writableEnded) return
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }
  try {
    if (!isLoopback(req)) return send(403, { ok: false, error: '仅允许本机访问' })
    if (!req.method || req.method !== 'POST') return send(200, { ok: false, error: '只接受 POST 请求' })
    const raw = await readBody(req, BODY_LIMIT)
    let request
    try {
      request = JSON.parse(raw || '{}')
    } catch (error) {
      return send(200, { ok: false, error: '请求不是合法 JSON' })
    }
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      return send(200, { ok: false, error: '请求格式不正确' })
    }
    return send(200, await runOp(resolveRoot(), request))
  } catch (error) {
    return send(200, { ok: false, error: errorMessage(error) })
  }
}

async function runOp(root, request) {
  switch (String(request.op || '')) {
    case 'state':
      return { ok: true, ...listState(root) }
    case 'read':
      return opRead(root, request)
    case 'save':
      return opSave(root, request)
    case 'delete':
      return opDelete(root, request)
    case 'classify':
      return opClassify(root, request)
    case 'note':
      return opNote(root, request)
    default:
      throw new Error(`未知操作：${request.op ? String(request.op) : '(空)'}`)
  }
}

function opRead(root, request) {
  switch (String(request.target || '')) {
    case 'draft': {
      const draft = readDraft(root, request.id)
      return { ok: true, kind: 'draft', id: draft.id, title: draft.title, text: draft.text, updated: draft.updated }
    }
    case 'topic': {
      const topic = readTopic(root, request.name)
      return { ok: true, kind: 'topic', name: topic.name, title: topic.title, text: topic.text, updated: topic.updated }
    }
    case 'notes': {
      // 思想脉络还没写时返回空文本而不是错误：面板左侧固定展示「思想脉络」入口
      const notes = readNotes(root)
      return { ok: true, kind: 'notes', title: notes.title, text: notes.text, updated: notes.updated }
    }
    default:
      throw new Error(`未知的读取目标：${request.target ? String(request.target) : '(空)'}`)
  }
}

function opSave(root, request) {
  const saved = saveDraft(root, { id: request.id, title: request.title, text: request.text })
  return { ok: true, id: saved.id, title: saved.title, created: saved.created, updated: saved.updated, chars: saved.chars }
}

function opDelete(root, request) {
  return { ok: true, archivedAs: archiveDraft(root, request.id) }
}

function opClassify(root, request) {
  const result = classifyDraft(root, { id: request.id, topic: request.topic, title: request.title, text: request.text })
  return { ok: true, id: result.id, topic: result.topic, archivedAs: result.archivedAs, topicCount: result.topicCount }
}

function opNote(root, request) {
  const result = appendNote(root, { text: request.text, title: request.title })
  return { ok: true, date: result.date }
}

// ---------------- Agent 工具 essay（CONTRACT §3.3） ----------------

const TOOL_DESCRIPTION =
  '管理用户的随笔库（随笔工坊）。action=list 列出未分类草稿与主题；read 读一篇草稿/某个主题/思想脉络；' +
  'write 新建或修改未分类草稿；classify 把未分类草稿归档进主题；note 在思想脉络中追加一段总结。'

function createEssayTool() {
  return {
    name: 'essay',
    description: TOOL_DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['list', 'read', 'write', 'classify', 'note'] },
        id: { type: 'string', description: '草稿 id（不带 .md）' },
        target: { type: 'string', enum: ['draft', 'topic', 'notes'] },
        name: { type: 'string', description: '主题名（读主题时用）' },
        title: { type: 'string' },
        text: { type: 'string' },
        items: {
          type: 'array',
          description: '批量归档：每项 {id, topic, title?, text?}',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              topic: { type: 'string' },
              title: { type: 'string' },
              text: { type: 'string' },
            },
            required: ['id', 'topic'],
          },
        },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          data: { type: 'object', additionalProperties: true },
        },
        required: ['text'],
      },
      render(args, value) {
        const text = value && typeof value.text === 'string' ? value.text : JSON.stringify(value, null, 2)
        return [{ type: 'text', text }]
      },
    },
    async execute(args) {
      const params = args && typeof args === 'object' ? args : {}
      const action = String(params.action || '')
      const root = resolveRoot()
      switch (action) {
        case 'list': {
          const state = listState(root)
          return { text: listToolText(state), data: state }
        }
        case 'read':
          return toolRead(root, params)
        case 'write':
          return toolWrite(root, params)
        case 'classify':
          return toolClassify(root, params)
        case 'note':
          return toolNote(root, params)
        default:
          throw new Error(`未知 action：${action || '(空)'}（可用 list/read/write/classify/note）`)
      }
    },
  }
}

function listToolText(state) {
  const lines = [`随笔根目录：${state.root}`, `未分类（${state.drafts.length} 篇）：`]
  if (state.drafts.length === 0) lines.push('（暂无）')
  for (const draft of state.drafts) {
    lines.push(`- ${draft.id} | ${draft.title || UNTITLED} | ${draft.chars} 字 | ${formatDate(draft.updated)}`)
  }
  lines.push(`主题（${state.topics.length} 个）：`)
  if (state.topics.length === 0) lines.push('（暂无）')
  for (const topic of state.topics) lines.push(`- ${topic.name}（${topic.count} 篇）`)
  if (state.notes.exists) lines.push(`思想脉络：${state.notes.chars} 字符`)
  return lines.join('\n')
}

function toolRead(root, params) {
  const target = String(params.target || (params.id ? 'draft' : params.name ? 'topic' : ''))
  if (target === 'draft') {
    if (!params.id) throw new Error('read 草稿需要 id')
    const draft = readDraft(root, params.id)
    return { text: `《${draft.title || UNTITLED}》\n\n${draft.text}`, data: { kind: 'draft', ...draft } }
  }
  if (target === 'topic') {
    if (!params.name) throw new Error('read 主题需要 name')
    const topic = readTopic(root, params.name)
    return { text: `《${topic.name}》\n\n${topic.text}`, data: { kind: 'topic', ...topic } }
  }
  if (target === 'notes') {
    const notes = readNotes(root)
    if (!notes.exists) {
      return {
        text: `${NOTES_FILE} 还不存在；可以先用 action=note 追加一段思想总结。`,
        data: { kind: 'notes', exists: false, title: NOTES_TITLE, text: '' },
      }
    }
    return { text: `《${NOTES_TITLE}》\n\n${notes.text}`, data: { kind: 'notes', ...notes } }
  }
  throw new Error('read 需要 target（draft/topic/notes），或给出 id / name')
}

function toolWrite(root, params) {
  const title = typeof params.title === 'string' ? params.title : ''
  const text = typeof params.text === 'string' ? params.text : ''
  if (!title.trim() && !text.trim()) throw new Error('write 需要 title 或 text')
  const saved = saveDraft(root, { id: params.id, title, text })
  return { text: `已保存：${saved.id}`, data: saved }
}

function toolClassify(root, params) {
  if (Array.isArray(params.items)) {
    if (params.items.length === 0) throw new Error('items 不能为空')
    const archived = []
    const failed = []
    for (const item of params.items) {
      const id = item && item.id
      try {
        archived.push(
          classifyDraft(root, { id, topic: item && item.topic, title: item && item.title, text: item && item.text }),
        )
      } catch (error) {
        failed.push({ id: id === undefined || id === null ? '' : String(id), error: errorMessage(error) })
      }
    }
    const lines = []
    if (archived.length) {
      lines.push(`已归档 ${archived.length} 篇：`)
      for (const result of archived) {
        lines.push(`- 《${result.title || UNTITLED}》→ 主题/${result.topic}（${result.topicCount} 篇）`)
      }
    }
    if (failed.length) {
      lines.push(`失败 ${failed.length} 篇：`)
      for (const failure of failed) lines.push(`- ✗ ${failure.id || '(无 id)'}：${failure.error}`)
    }
    return { text: lines.join('\n'), data: { archived, failed } }
  }

  if (!params.id) throw new Error('classify 需要 id')
  if (!params.topic) throw new Error('classify 需要 topic')
  const result = classifyDraft(root, { id: params.id, topic: params.topic, title: params.title, text: params.text })
  return {
    text: `《${result.title || UNTITLED}》→ 主题/${result.topic}（${result.topicCount} 篇）`,
    data: result,
  }
}

function toolNote(root, params) {
  const result = appendNote(root, { text: params.text, title: params.title })
  return { text: `已追加到 ${NOTES_FILE}（${result.date}）`, data: result }
}

function errorMessage(error) {
  const message = error && typeof error.message === 'string' ? error.message.trim() : ''
  return message || '未知错误'
}

// ---------------- 系统提示段落（CONTRACT §3.4） ----------------

function systemPromptText() {
  const root = resolveRoot()
  return [
    '## 随笔工坊',
    `用户的随笔库在 ${root}：`,
    '- 未分类/<id>.md：用户随手写的草稿；',
    '- 主题/<主题名>.md：已按主题归档的随笔合集（每主题一个文件）；',
    '- 思想脉络.md：阶段性的思想变化总结。',
    '处理规则：',
    '- 用户说「整理/归档/分类」随笔时：先 essay(action=list)，再逐篇 essay(action=read) 通读，归纳 2-6 个稳定主题（名词短语、2-6 字）后用 essay(action=classify)（可一次用 items 批量）归档；可以轻微润色标题，但不要改写用户正文。',
    '- 用户说「总结思想变化/梳理思想」时：通读全部草稿与主题，用 essay(action=note) 把阶段性总结（分点、引用具体篇目）追加到思想脉络.md，同时在对话里给出你的观察。',
    '- 用户想写作或继续写作时：引导他们用侧栏「随笔」面板；也可以直接把用户口述内容用 essay(action=write) 落成草稿。',
    '- 永远不要手工移动/删除随笔文件，统一走 essay 工具，保证格式一致。',
  ].join('\n')
}

// ---------------- 插件入口 ----------------

export function apply(ctx, config = {}) {
  // 根目录只按 CONTRACT §2 解析，行内 config 目前不参与
  try {
    ensureDirs(resolveRoot())
  } catch (error) {
    // 目录建不出来不该阻塞插件加载：API / 工具会各自返回清晰的中文错误
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: API_PATH, handler: handleApi }))
  ctx.effect(() => ctx.tools.register(createEssayTool()))
  ctx.effect(() => ctx.systemPrompt.section({ name: 'essay-desk', order: 3500, text: systemPromptText }))
}

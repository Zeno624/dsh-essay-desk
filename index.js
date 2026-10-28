// 随笔工坊（dsh-essay-desk）Host 半侧：文件存储 + HTTP API + Agent 工具 + 系统提示段落。
// 数据模型（与 client.js 共享，见 CONTRACT.md §1）：
//   <root>/未分类/<id>.md           一篇未分类草稿
//   <root>/未分类/_已整理/<id>.md   归档（delete/classify）后的草稿备份，不对外列出
//   <root>/主题/<主题名>.md         每个主题一个合集文件
//   <root>/思想脉络.md              思想变化总结
//   <root>/练习/任务/<YYYYMMDD>.md  写作练习的每日任务（front matter + 各节）
//   <root>/练习/积分.json           写作练习总积分与历史
// 关键不变量：
//   1. id / 主题名都不带路径分隔符，拼出的绝对路径一律经 assertInside 确认仍在 <root> 内；
//   2. 时间是本地时区（+08:00）表述，markdown 内用 `yyyy-MM-dd HH:mm`，API 用带偏移的 ISO；
//   3. 所有对外文案、错误信息都用中文。
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, renameSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'

export const name = 'essay-desk'
export const inject = ['webServer', 'tools', 'systemPrompt', 'timer']

const DEFAULT_ROOT = 'essays'
const API_PATH = '/essay-desk/api'
const BODY_LIMIT = 2 * 1024 * 1024 // 2MB
const DRAFT_DIR = '未分类'
const ARCHIVE_DIR = '_已整理'
const TOPIC_DIR = '主题'
const NOTES_FILE = '思想脉络.md'
const NOTES_TITLE = '思想脉络'
const UNTITLED = '无题'
const PRACTICE_DIR = '练习'
const PRACTICE_TASK_DIR = '任务'
const PRACTICE_POINTS_FILE = '积分.json'
const DEFAULT_PRACTICE_TIME = '09:00'
// 题型按日期日序轮换
const PRACTICE_TYPES = ['场景+冲突', '情绪', '关系', '场景']
const PRACTICE_STATUS_LABELS = { pending: '待写', written: '已写', submitted: '已交', scored: '已评' }
const PRACTICE_CHECK_INTERVAL = 60 * 1000
// 第三人称统一 ta：下面这些词里的「他」不是人称代词，先占位保护、最后原样还原
const PROTECTED_HE_WORDS = [
  '其他',
  '吉他',
  '他乡',
  '他日',
  '他处',
  '他国',
  '他方',
  '他者',
  '他物',
  '他人',
  '他杀',
  '他律',
  '利他',
  '排他',
  '无他',
]
// 出题时从 practice.keywords 里过滤掉的性少数题材词（大小写不敏感）
const BANNED_KEYWORD_PATTERN = /同性恋|同性愛|同性婚姻|同妻|同婚|出柜|跨性别|酷儿|lgbtq?|gay|lesbian|queer|transgender|homosexual/i
// 每期任务固定写入「约束」的写作约定。故意用「性少数 / 非异性恋」而非被禁词本身，
// 保证任务正文（含约束）不出现 BANNED_KEYWORD_PATTERN 里的词。
const PRACTICE_CONVENTIONS =
  '写作约定：角色不标注性别，第三人称统一用 ta；本期主视角见上；不写性少数 / 非异性恋关系题材；角色可用社会身份（职业/身份）设定，不必依赖性别关系。'
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

// ---------------- 配置文件 ----------------

/** 配置文件路径：<DSH_HOME 或 ~/.dsh>/essay-desk.json（root 与 practice 共用一个文件） */
function configFilePath() {
  const dshHome = String(process.env.DSH_HOME || '').trim()
  return join(dshHome || join(homedir(), '.dsh'), 'essay-desk.json')
}

/**
 * 读配置对象。strict=false 时（读 root / 读练习配置）坏文件回落到默认值；
 * strict=true 时（写配置）抛中文错误，避免把用户的其它字段写丢。
 */
function readConfigObject(strict = false) {
  const file = configFilePath()
  if (!existsSync(file)) return {}
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('配置文件内容不是对象')
    return data
  } catch (error) {
    if (strict) throw new Error(`配置文件不是合法 JSON，无法保存练习设置：${file}`)
    return {}
  }
}

function normalizePracticeConfig(raw) {
  const practice = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const time =
    typeof practice.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(practice.time.trim())
      ? practice.time.trim()
      : DEFAULT_PRACTICE_TIME
  return {
    enabled: typeof practice.enabled === 'boolean' ? practice.enabled : true,
    time,
    keywords: typeof practice.keywords === 'string' ? practice.keywords.trim() : '',
  }
}

/** 练习配置：缺省 enabled=true / time=09:00 / keywords=''；字段非法时回落默认值 */
export function readPracticeConfig() {
  return normalizePracticeConfig(readConfigObject(false).practice)
}

/** 只更新给定字段，保留 root 与其它未知字段（含 practice 下的未知子字段）；返回归一化后的配置 */
export function writePracticeConfig(patch = {}) {
  const updates = {}
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') throw new Error('enabled 需要 true 或 false')
    updates.enabled = patch.enabled
  }
  if (patch.time !== undefined) {
    const time = String(patch.time).trim()
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('推送时间格式应为 HH:mm（例如 09:00）')
    updates.time = time
  }
  if (patch.keywords !== undefined) {
    if (typeof patch.keywords !== 'string') throw new Error('keywords 需要是字符串')
    updates.keywords = patch.keywords.trim()
  }

  const file = configFilePath()
  const settings = readConfigObject(true)
  const base =
    settings.practice && typeof settings.practice === 'object' && !Array.isArray(settings.practice)
      ? settings.practice
      : {}
  const practice = { ...base, ...normalizePracticeConfig(base), ...updates }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ ...settings, practice }, null, 2)}\n`, 'utf8')
  return normalizePracticeConfig(practice)
}

// ---------------- 根目录解析（CONTRACT §2） ----------------

/**
 * 优先 ESSAY_DESK_ROOT（绝对路径）→ <DSH_HOME 或 ~/.dsh>/essay-desk.json 的 { root }
 * → 默认 <DSH_HOME 或 ~/.dsh>/essays。同级来源不可用时静默回落，保证插件一定能启动。
 */
export function resolveRoot() {
  const fromEnv = String(process.env.ESSAY_DESK_ROOT || '').trim()
  if (fromEnv && isAbsolute(fromEnv)) return resolve(fromEnv)

  const configPath = configFilePath()
  try {
    const settings = readConfigObject(false)
    const fromConfig = typeof settings.root === 'string' ? settings.root.trim() : ''
    if (fromConfig && isAbsolute(fromConfig)) return resolve(fromConfig)
  } catch (error) {
    // 配置文件损坏不该让插件加载失败：回落到默认根目录，具体读写错误由各操作报出
  }
  return resolve(join(dirname(configPath), DEFAULT_ROOT))
}

/**
 * 确保数据目录存在。失败直接抛出（apply 里会吞掉并让具体操作报错）。
 */
export function ensureDirs(root = resolveRoot()) {
  const base = resolve(String(root))
  mkdirSync(join(base, DRAFT_DIR), { recursive: true })
  mkdirSync(join(base, TOPIC_DIR), { recursive: true })
  mkdirSync(join(base, DRAFT_DIR, ARCHIVE_DIR), { recursive: true })
  mkdirSync(join(base, PRACTICE_DIR, PRACTICE_TASK_DIR), { recursive: true })
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

// ---------------- 写作练习：题目库 ----------------
// 每道题都是完整命题：命题 / 剧本节拍（4–6 条）/ 演绎方向 / 约束 / 反馈标准。
// types 可含多个题型；生成时按日期日序轮换题型（PRACTICE_TYPES），在匹配题目里挑选，
// 并优先避开最近 3 期用过的 motif。
export const QUESTION_LIBRARY = [
  {
    id: 'q01',
    type: '场景+冲突',
    types: ['场景+冲突', '情绪'],
    title: '末班地铁，捡到一张自己的照片',
    motif: '误会与自证',
    scene: '深夜的末班地铁车厢',
    conflict: '在座位上捡到一张自己的照片',
    emotion: '警觉 → 心虚 → 想解释清楚',
    tags: ['旧照片', '末班车', '误会', '深夜'],
    prompt: '深夜的末班地铁上，你捡到一张照片，照片里的人是你，可你完全不记得拍过它。',
    beats: [
      '末班车厢只剩三排乘客，你低头捡起脚边那张照片，画面里是你站在同样的车厢里。',
      '对面的乘客抬头看了你一眼又迅速移开视线，她的手机壳和照片背面的标记一模一样。',
      '你攥着照片走过去，她先开口：「你终于来还了。」',
      '她说照片是三天前你亲手交给她的，可你连三天前坐过这班车都不记得。',
      '到站提示音响起，你必须决定：是下车去查监控，还是留下听完她的解释。',
    ],
    directions: {
      view: '第一人称，贴着人物的心跳写，别急着解释设定',
      tension: '照片是谁拍的、她为什么认识你',
      ending: '让「自证」变成一次有代价的选择：留下道歉，或者带着照片离开',
    },
    constraints: '600–1500 字；第一人称；至少一次有代价的选择；不要用「梦」收尾。',
    feedback: [
      '冲突是否升级（疑问 → 压力 → 必须表态）',
      '关键选择是否有代价',
      '结尾是否回扣母题「误会与自证」',
      '哪句解释可以删',
    ],
  },
  {
    id: 'q02',
    type: '场景+冲突',
    types: ['场景+冲突'],
    title: '旧书店关门那天，我弄丢了朋友的托付',
    motif: '承诺与违约',
    scene: '挂牌转让的旧书店',
    conflict: '替朋友保管的绝版书不见了',
    emotion: '愧疚 → 辩解 → 承认',
    tags: ['书店', '承诺', '友情', '旧书'],
    prompt: '旧书店关门那天，你替朋友保管的绝版书不见了，而朋友明天就来取。',
    beats: [
      '书店里纸箱堆到天花板，老板催你最后清一次自己的寄存格。',
      '你把格子翻了两遍，那本用牛皮纸包好的绝版书始终没有出现。',
      '手机亮起，是朋友发来的消息：「我明天下午到，书还在吧？」',
      '你想起上周有个常客盯着那本书看了很久，还问过「这本卖不卖」。',
      '老板把卷帘门拉到一半，回头问你：「东西都拿齐了？我要锁门了。」',
    ],
    directions: {
      view: '第一人称，把「找书」的过程写成倒计时',
      tension: '是坦白书丢了，还是先编一个理由拖过明天',
      ending: '让坦白或撒谎都要付出代价：失去信任，或者失去书店最后一点人情',
    },
    constraints: '600–1500 字；第一人称；至少一次有代价的选择；不要用「梦」收尾。',
    feedback: [
      '冲突是否升级（疑问 → 压力 → 必须表态）',
      '关键选择是否有代价',
      '结尾是否回扣母题「承诺与违约」',
      '哪句解释可以删',
    ],
  },
  {
    id: 'q03',
    type: '场景+冲突',
    types: ['场景+冲突', '关系'],
    title: '医院走廊，队伍里那个熟人',
    motif: '规则与人情',
    scene: '医院挂号走廊',
    conflict: '熟人插队，你被夹在规则和人情中间',
    emotion: '犹豫 → 偏袒 → 后悔',
    tags: ['医院', '规则', '人情', '排队'],
    prompt: '医院挂号队伍里，一个熟人径直插到你前面，还回头冲你笑了笑。',
    beats: [
      '走廊里全是消毒水味，队伍排到楼梯口，你已经站了四十分钟。',
      '熟人从人群里挤过来，拍了下你的肩：「我赶时间，站你这儿了啊。」',
      '身后的大爷开始嘟囔，前面的人回头看你，等你说话。',
      '熟人压低声音：「就这一次，回头请你吃饭。」',
      '窗口叫号声响起，队伍必须往前挪了。',
    ],
    directions: {
      view: '第一人称，重点写「还没开口」那几秒的身体反应',
      tension: '你帮熟人说话，还是把他请回队尾',
      ending: '让选择的结果落在一个具体的人身上（大爷、熟人，或你自己）',
    },
    constraints: '600–1500 字；第一人称；至少一次有代价的选择；不要用旁白直接下道德结论。',
    feedback: [
      '冲突是否升级（犹豫 → 压力 → 必须表态）',
      '关键选择是否有代价',
      '结尾是否回扣母题「规则与人情」',
      '哪句解释可以删',
    ],
  },
  {
    id: 'q04',
    type: '情绪',
    types: ['情绪'],
    title: '便利店凌晨两点，我对店员说了真话',
    motif: '孤独与被看见',
    scene: '凌晨两点的便利店',
    conflict: '买饭团时对陌生店员说了不该说的真心话',
    emotion: '疲惫 → 失守 → 羞赧',
    tags: ['便利店', '孤独', '深夜', '真话'],
    prompt: '凌晨两点的便利店，收银员随口问「今天还好吗」，你突然说了很多。',
    beats: [
      '微波炉在身后转，货架灯白得刺眼，你的饭团是今天第一顿热饭。',
      '收银员扫完码，顺口问了句：「今天还好吗？」',
      '你先说了「还行」，又鬼使神差补了一句：「其实不太好。」',
      '他没催你，只是把加热好的饭团往前推了推，说：「慢慢说。」',
      '后面又进来一个客人，你突然意识到自己已经讲了十分钟。',
    ],
    directions: {
      view: '第一人称，允许叙述散一点，像深夜没整理过的念头',
      tension: '说出口的真心话会不会被当成笑话',
      ending: '用一个小动作收尾（递纸巾、找零、推门），别直接写「我释然了」',
    },
    constraints: '600–1500 字；第一人称；至少一次有代价的选择（说出口本身也算）；不要用「梦」收尾。',
    feedback: [
      '情绪是否有递进（疲惫 → 失守 → 羞赧）',
      '真心话是否带来代价或风险',
      '结尾是否回扣母题「孤独与被看见」',
      '哪句解释可以删',
    ],
  },
  {
    id: 'q05',
    type: '情绪',
    types: ['情绪'],
    title: '雨里被踩了一脚，我还说了对不起',
    motif: '愤怒与克制',
    scene: '雨天的公交站',
    conflict: '被陌生人踩了一脚还被骂，第一反应竟是道歉',
    emotion: '愤怒 → 克制 → 自嘲',
    tags: ['雨天', '公交站', '愤怒', '克制'],
    prompt: '雨天公交站，有人踩了你一脚，骂完你才反应过来：刚才说对不起的是你自己。',
    beats: [
      '雨斜着下，站台上的人都缩着肩，你的鞋全湿了。',
      '一个陌生人挤过来踩在你脚背上，回头先骂：「站这儿挡什么道？」',
      '你下意识说了句「不好意思」，说完才觉得不对。',
      '他还在嘟囔，你攥紧伞柄，指节发白，公交车的灯从雨里靠近。',
      '上车只有几秒，你要么挤上去，要么站在原地把话说完。',
    ],
    directions: {
      view: '第一人称，把愤怒写成身体反应（耳鸣、发烫、攥紧）而不是形容词',
      tension: '爆发还是咽回去，两种都难受',
      ending: '让「克制」有代价：要么自己消化，要么错过车',
    },
    constraints: '600–1500 字；第一人称；至少一次有代价的选择；不要写成长篇说教。',
    feedback: [
      '情绪是否有递进（愤怒 → 克制 → 自嘲）',
      '关键选择是否有代价',
      '结尾是否回扣母题「愤怒与克制」',
      '哪句解释可以删',
    ],
  },
  {
    id: 'q06',
    type: '情绪',
    types: ['情绪', '场景'],
    title: '搬家前夜，那件早该丢掉的东西',
    motif: '怀旧与告别',
    scene: '搬空一半的旧房间',
    conflict: '整理时翻出一件早该丢掉的东西',
    emotion: '怀念 → 犹豫 → 释然',
    tags: ['搬家', '旧物', '告别', '房间'],
    prompt: '搬家前一夜，你在空了一半的房间角落里翻出一件早该丢掉的东西。',
    beats: [
      '墙上留着没撕干净的胶带印，地上是打包到一半的纸箱。',
      '你伸手到床底，摸出一个落满灰的铁盒。',
      '盒子里是几封信、一张车票，和一件你以为早就扔了的东西。',
      '房东在门外问：「明早八点车来，你东西都收好了吧？」',
      '你坐在纸箱上，手里那件东西该进垃圾袋，还是进随身包。',
    ],
    directions: {
      view: '第一人称，用物件带出回忆，别写成回忆录',
      tension: '留下还是丢掉，都会失去一部分',
      ending: '让「告别」落在一个具体动作上（封箱、扔下、放进外套口袋）',
    },
    constraints: '600–1500 字；第一人称；至少一次有代价的选择；不要用「梦」收尾。',
    feedback: [
      '情绪是否有递进（怀念 → 犹豫 → 释然）',
      '关键选择是否有代价',
      '结尾是否回扣母题「怀旧与告别」',
      '哪句解释可以删',
    ],
  },
  {
    id: 'q07',
    type: '关系',
    types: ['关系'],
    title: '合租第三个月，我终于开口',
    motif: '亲密与边界',
    scene: '合租屋的厨房',
    conflict: '室友长期不打招呼用你的东西',
    emotion: '隐忍 → 试探 → 摊牌',
    tags: ['合租', '边界', '室友', '厨房'],
    prompt: '合租第三个月，你又一次在厨房看见自己的锅被人用过没洗，这次室友正站在旁边。',
    beats: [
      '水槽里泡着你的锅，锅底还沾着昨天的油。',
      '室友端着杯子进门，看见你，笑了笑：「哦，那个我等下洗。」',
      '这已经是这个月第四次，你想起自己上次也是这么被一句话堵回去的。',
      '他转身要走，你听见自己开口：「等一下。」',
      '他回过头，表情有点意外，厨房里只剩下冰箱的嗡嗡声。',
    ],
    directions: {
      view: '第一人称，把「边界」写成一次次被磨掉的细节，而不是一次争吵',
      tension: '说重了怕伤和气，说轻了等于没说',
      ending: '让摊牌的结果不完美：对方道歉但没改，或者你们真的吵了一架',
    },
    constraints: '600–1500 字；第一人称；对话至少占三分之一；不要用「断绝关系」草草收尾。',
    feedback: [
      '冲突是否升级（隐忍 → 试探 → 摊牌）',
      '关键选择是否有代价',
      '结尾是否回扣母题「亲密与边界」',
      '哪句解释可以删',
    ],
  },
  {
    id: 'q08',
    type: '关系',
    types: ['关系', '情绪'],
    title: '父亲在电话里说，回来考个编吧',
    motif: '理解与代沟',
    scene: '深夜的出租屋',
    conflict: '父亲劝你辞职回家考编，你第一次听出他声音里的老',
    emotion: '抵触 → 听见 → 沉默',
    tags: ['父亲', '电话', '代沟', '家人'],
    prompt: '深夜的电话里，父亲第三次说「回来考个编吧」，这一次他的声音有点哑。',
    beats: [
      '你刚加完班，出租屋的灯只开了一盏。',
      '父亲在电话那头咳了两声，说：「你妈让我问，今年还是没打算回来？」',
      '你熟练地说了那套理由：城市、机会、再等等。',
      '他沉默了一会儿，忽然说：「我最近耳朵不太好使了。」',
      '你握着手机，听见他那边电视机的声音，忽然不知道该接哪句。',
    ],
    directions: {
      view: '第一人称，重点写「听见他老了」的那个瞬间',
      tension: '坚持自己的人生，还是被这句话拽回去',
      ending: '让沉默本身成为选择，别急着给出答案',
    },
    constraints: '600–1500 字；第一人称；至少一次有代价的选择；不要写成两代人对错的辩论。',
    feedback: [
      '冲突是否升级（抵触 → 听见 → 沉默）',
      '关键选择是否有代价',
      '结尾是否回扣母题「理解与代沟」',
      '哪句解释可以删',
    ],
  },
  {
    id: 'q09',
    type: '关系',
    types: ['关系', '场景'],
    title: '同学婚礼上，十年没见的同桌',
    motif: '错过与重逢',
    scene: '同学婚礼的敬酒桌',
    conflict: '遇见十年没联系却曾无话不谈的旧同桌',
    emotion: '惊讶 → 客套 → 遗憾',
    tags: ['婚礼', '同学', '重逢', '遗憾'],
    prompt: '同学婚礼的敬酒桌上，你被安排坐在十年没见的旧同桌旁边。',
    beats: [
      '婚礼现场的灯光很亮，你被司仪喊到名字时正低头看手机。',
      '坐下的瞬间你认出了他，他也认出你，两个人同时说「好久不见」。',
      '寒暄从工作问到城市，问到「还跟以前那谁联系吗」。',
      '他笑着说了句「那时候真傻」，你发现这句话你练过很多年。',
      '新人开始敬酒，音乐声变大，你们中间那句最该说的话还悬着。',
    ],
    directions: {
      view: '第一人称，用婚礼的热闹反衬两个人的客套',
      tension: '要不要提起当年那件没说清的事',
      ending: '让「错过」保持未完成：一句没说完的话，比和解更有余味',
    },
    constraints: '600–1500 字；第一人称；对话要自然，别写成回忆清单；不要用「梦」收尾。',
    feedback: [
      '冲突是否升级（惊讶 → 客套 → 遗憾）',
      '关键选择是否有代价',
      '结尾是否回扣母题「错过与重逢」',
      '哪句解释可以删',
    ],
  },
  {
    id: 'q10',
    type: '场景',
    types: ['场景', '情绪'],
    title: '菜市场多找的五十块',
    motif: '陌生人的善意',
    scene: '清晨的菜市场',
    conflict: '摊主多找了五十块钱，你走出一段才发觉',
    emotion: '贪念 → 动摇 → 归还',
    tags: ['菜市场', '零钱', '善意', '清晨'],
    prompt: '清晨的菜市场，摊主一边打哈欠一边找你零钱，走出十几米你才发现多了五十块。',
    beats: [
      '市场刚开，地上还是湿的，摊主正在揉眼睛。',
      '你买了两把青菜，他数零钱时手有点抖。',
      '走到卖鱼的摊子前，你才发觉手里的钱不对，多了五十。',
      '回头能看见他还在原地，正给下一个人称菜。',
      '五十块不多，但对你和他都不算少；你站在原地，脚已经往回转了半步。',
    ],
    directions: {
      view: '第一人称，让「五十块」一直很具体，别升华成道德命题',
      tension: '还回去会不会显得刻意，不还又过不去',
      ending: '把归还或留下的后果写实：一句谢谢，或者一整天的别扭',
    },
    constraints: '600–1500 字；第一人称；至少一次有代价的选择；不要用「梦」收尾。',
    feedback: [
      '冲突是否升级（贪念 → 动摇 → 归还）',
      '关键选择是否有代价',
      '结尾是否回扣母题「陌生人的善意」',
      '哪句解释可以删',
    ],
  },
  {
    id: 'q11',
    type: '场景',
    types: ['场景'],
    title: '老电影院拆迁前，我听见一段放映声',
    motif: '声音与记忆',
    scene: '拆到一半的老电影院',
    conflict: '废墟里响起一段熟悉的放映机声',
    emotion: '恍惚 → 追索 → 放下',
    tags: ['电影院', '声音', '记忆', '拆迁'],
    prompt: '老电影院拆到一半，你站在围挡外，听见里面传来放映机转动的咔哒声。',
    beats: [
      '围挡上贴着「施工重地」，铁皮被风吹得咣咣响。',
      '你本来是路过，听见咔哒咔哒的声音，脚步就停了。',
      '透过缝隙能看见半面银幕，幕布垂着，像一块旧床单。',
      '声音停了一下，又响起来，像是有人还在放同一部片子。',
      '保安从远处走过来，问你要不要离开，你说再站一会儿。',
    ],
    directions: {
      view: '第一人称，用声音和光斑带出记忆，别直接交代回忆',
      tension: '声音是错觉，还是有人和你一样舍不得',
      ending: '让「放下」发生在一个很小的动作里：转身、点烟、跟保安道谢',
    },
    constraints: '600–1500 字；第一人称；至少一次有代价的选择；不要用「梦」收尾。',
    feedback: [
      '冲突是否升级（恍惚 → 追索 → 放下）',
      '关键选择是否有代价',
      '结尾是否回扣母题「声音与记忆」',
      '哪句解释可以删',
    ],
  },
  {
    id: 'q12',
    type: '场景',
    types: ['场景', '关系'],
    title: '机场到达层，我在等一个不确定会来的人',
    motif: '等待与错过',
    scene: '机场到达层的咖啡座',
    conflict: '接一个只发了「可能来」三个字的人',
    emotion: '期待 → 焦躁 → 平静',
    tags: ['机场', '等待', '航班', '咖啡'],
    prompt: '机场到达层的咖啡座，你要等的人只发来三个字：「可能来」。',
    beats: [
      '到达层的航班牌一块块翻，你已经喝完第二杯咖啡。',
      '手机屏幕停在三个字上：「可能来」。发出时间是下午两点。',
      '每批旅客出来，你都下意识站起来，又坐回去。',
      '广播开始播报晚点，你算着最后一班地铁的时间。',
      '出口又涌出一批人，你这次没有站起来。',
    ],
    directions: {
      view: '第一人称，用等待的动作和机场的广播节奏控制叙事',
      tension: '她会不会来，以及你还能等多久',
      ending: '让「平静」不是释怀，而是承认结果：走，或者继续坐一会儿',
    },
    constraints: '600–1500 字；第一人称；至少一次有代价的选择；不要用「梦」收尾。',
    feedback: [
      '冲突是否升级（期待 → 焦躁 → 平静）',
      '关键选择是否有代价',
      '结尾是否回扣母题「等待与错过」',
      '哪句解释可以删',
    ],
  },
  // ---- 社会身份题（角色用职业/身份指称，不依赖性别关系） ----
  {
    id: 'q13',
    type: '场景+冲突',
    types: ['场景+冲突', '关系'],
    title: '代驾的第一单，乘客不肯说目的地',
    motif: '职业与信任',
    scene: '凌晨的停车场出口',
    conflict: '代驾司机接到的乘客喝多了，只说往前开，不肯说地址',
    emotion: '耐心 → 警觉 → 为难',
    tags: ['代驾', '乘客', '深夜', '职业'],
    prompt: '凌晨的停车场出口，你是代驾司机，接到的乘客上了车只说「往前开」，却不肯说目的地。',
    beats: [
      '你在停车场出口等到第三批人，一个乘客拉开车门坐进后排，身上全是酒气。',
      '你问地址，乘客说：「往前开，到该拐的地方我告诉你。」',
      '开出两条街，导航一直空着，后排传来压抑的呼吸声。',
      '后视镜里，乘客攥着手机，屏幕上是一个没有拨出去的电话号码。',
      '前面路口在查酒驾，乘客忽然说：「别停，绕过去。」',
    ],
    directions: {
      view: '第一人称（司机视角），用后视镜和空着的导航制造张力',
      tension: '乘客到底要去哪、在躲谁',
      ending: '让「职业与信任」落在一个有代价的选择上：按规矩停车，还是照乘客说的绕路',
    },
    constraints: '600–1500 字；第一人称；至少一次有代价的选择；不要用「梦」收尾。',
    feedback: [
      '冲突是否升级（耐心 → 警觉 → 必须表态）',
      '关键选择是否有代价',
      '结尾是否回扣母题「职业与信任」',
      '哪句解释可以删',
    ],
  },
  {
    id: 'q14',
    type: '关系',
    types: ['关系', '情绪'],
    title: '夜班巡房，家属把我堵在走廊',
    motif: '照护与信任',
    scene: '医院住院部夜班走廊',
    conflict: '家属怀疑夜班护工没有照顾好病人',
    emotion: '委屈 → 克制 → 理解',
    tags: ['护工', '家属', '医院', '夜班'],
    prompt: '住院部夜班走廊，你是夜班护工，一位家属把你堵在墙边，质问病人为什么又疼了。',
    beats: [
      '凌晨两点半，走廊只亮着应急灯，你刚给三床翻完身。',
      '家属从陪护椅上站起来，挡在你面前：「白天还好好的，怎么到你这儿就疼得睡不着？」',
      '你解释止疼药有间隔时间，家属把病历本拍在护士台上：「我看不懂这些。」',
      '三床在病房里喊了一声，你们都停住，同时看向门口。',
      '值班医生还没到，家属盯着你，等你给个说法。',
    ],
    directions: {
      view: '第一人称（护工视角），用身体的疲惫写情绪',
      tension: '被误解时是解释、顶回去，还是先处理病人',
      ending: '让「信任」不是一次性和解，而是一个具体的让步',
    },
    constraints: '600–1500 字；第一人称；对话要自然；不要用「梦」收尾。',
    feedback: [
      '冲突是否升级（委屈 → 克制 → 理解）',
      '关键选择是否有代价',
      '结尾是否回扣母题「照护与信任」',
      '哪句解释可以删',
    ],
  },
  {
    id: 'q15',
    type: '关系',
    types: ['关系'],
    title: '交租日，租客发来一段很长的语音',
    motif: '契约与人情',
    scene: '出租屋楼下的旧沙发',
    conflict: '租客想缓交房租，房东自己也在等这笔钱',
    emotion: '为难 → 计较 → 松动',
    tags: ['房东', '租客', '房租', '合同'],
    prompt: '交租日晚上，你是房东，租客发来一段三分钟的语音，说这个月想缓一缓。',
    beats: [
      '你坐在出租屋楼下的旧沙发上，手机里是那段三分钟的语音。',
      '语音里租客说公司拖了工资，能不能月底再补，声音越说越低。',
      '你算着这个月的房贷，手指在计算器上按了两遍。',
      '楼上传来搬东西的动静，你不知道那是收拾行李还是刚下班。',
      '月底只剩三天，你需要决定怎么回这条消息。',
    ],
    directions: {
      view: '第一人称（房东视角），把「算钱」和「算人情」并排写',
      tension: '按合同收租，还是松口缓一缓',
      ending: '让松动或坚持都带来具体后果：一个数字、一顿饭，或者一段沉默',
    },
    constraints: '600–1500 字；第一人称；至少一次有代价的选择；不要用「梦」收尾。',
    feedback: [
      '冲突是否升级（为难 → 计较 → 松动）',
      '关键选择是否有代价',
      '结尾是否回扣母题「契约与人情」',
      '哪句解释可以删',
    ],
  },
  {
    id: 'q16',
    type: '场景',
    types: ['场景', '关系'],
    title: '超时两分钟，我被拦在小区门口',
    motif: '规则与体谅',
    scene: '老小区的铁门岗亭',
    conflict: '外卖快超时，保安按规矩要登记还要等业主确认',
    emotion: '焦急 → 争辩 → 妥协',
    tags: ['外卖', '保安', '小区', '超时'],
    prompt: '老小区的铁门岗亭前，订单还剩两分钟超时，保安说没有业主确认不能进。',
    beats: [
      '电动车在铁门前刹住，手机上的倒计时只剩两分钟。',
      '保安从岗亭里探出头：「登记，打电话让业主下来接。」',
      '你指着订单说楼上等着吃饭，保安指了指墙上的规定：「上周刚出过事。」',
      '业主的电话占线，倒计时跳到零，系统提示预计扣款。',
      '铁门开了一条缝，保安看着你，等你先动。',
    ],
    directions: {
      view: '第一人称（骑手视角），用倒计时和铁门的重量控制节奏',
      tension: '闯进去还是等下去，两边都有代价',
      ending: '让「体谅」不是口号：一个让路、一句解释，或者一次真的扣款',
    },
    constraints: '600–1500 字；第一人称；至少一次有代价的选择；不要用「梦」收尾。',
    feedback: [
      '冲突是否升级（焦急 → 争辩 → 妥协）',
      '关键选择是否有代价',
      '结尾是否回扣母题「规则与体谅」',
      '哪句解释可以删',
    ],
  },
]

// ---------------- 写作练习：任务文件 ----------------

function normalizeDate(value) {
  const text = String(value ?? '').trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) throw new Error('日期格式应为 YYYY-MM-DD')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const probe = new Date(year, month - 1, day)
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
    throw new Error(`日期不存在：${text}`)
  }
  return text
}

function normalizeTaskId(value) {
  const id = String(value ?? '').trim()
  if (!/^\d{8}$/.test(id)) throw new Error('练习任务 id 需要 8 位日期（YYYYMMDD）')
  normalizeDate(`${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}`)
  return id
}

function practiceTaskFile(root, id) {
  return assertInside(root, join(resolve(root), PRACTICE_DIR, PRACTICE_TASK_DIR, `${normalizeTaskId(id)}.md`))
}

function practicePointsFile(root) {
  return join(resolve(root), PRACTICE_DIR, PRACTICE_POINTS_FILE)
}

function dayNumber(dateText) {
  const [year, month, day] = dateText.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000)
}

/** 解析练习任务文件：front matter（简单 key: value）+ `## 节名` 分节 */
function parsePracticeFile(raw) {
  const lines = String(raw).split(/\r?\n/)
  const front = {}
  let bodyStart = 0
  if (lines[0] === '---') {
    let end = -1
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i] === '---') {
        end = i
        break
      }
    }
    if (end < 0) throw new Error('练习任务文件格式不正确：front matter 没有结束标记')
    for (let i = 1; i < end; i += 1) {
      const colon = lines[i].indexOf(':')
      if (colon <= 0) continue
      front[lines[i].slice(0, colon).trim()] = lines[i].slice(colon + 1).trim()
    }
    bodyStart = end + 1
  }
  const sections = {}
  let current = null
  let buffer = []
  const flush = () => {
    if (current === null) return
    sections[current] = buffer.join('\n').trim()
    buffer = []
  }
  for (let i = bodyStart; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.startsWith('## ')) {
      flush()
      current = line.slice(3).trim()
      continue
    }
    if (current !== null) buffer.push(line)
  }
  flush()
  return { front, sections }
}

/** 生成任务文件：front matter + 期号标题 + 固定顺序的八个节 */
function renderPracticeFile({ front, issue, sections }) {
  const lines = [
    '---',
    `id: ${front.id}`,
    `date: ${front.date}`,
    `title: ${front.title}`,
    `type: ${front.type}`,
    `pov: ${front.pov}`,
    `motif: ${front.motif}`,
    `keywords:${front.keywords ? ` ${front.keywords}` : ''}`,
    `status: ${front.status}`,
    `points: ${front.points}`,
    `created: ${front.created}`,
    '---',
    '',
    `# 第 ${pad2(issue)} 期 · ${front.title}`,
  ]
  for (const [name, value] of sections) {
    lines.push('', `## ${name}`, '')
    if (value) lines.push(...String(value).split('\n'))
  }
  return `${lines.join('\n')}\n`
}

/** 只改 front matter 里给定的字段（保住其余行和正文） */
function updatePracticeFrontMatter(raw, updates) {
  const lines = String(raw).split(/\r?\n/)
  if (lines[0] !== '---') throw new Error('练习任务文件格式不正确：缺少 front matter')
  let end = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---') {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('练习任务文件格式不正确：front matter 没有结束标记')
  for (let i = 1; i < end; i += 1) {
    const colon = lines[i].indexOf(':')
    if (colon <= 0) continue
    const key = lines[i].slice(0, colon).trim()
    if (Object.prototype.hasOwnProperty.call(updates, key)) lines[i] = `${key}: ${updates[key]}`
  }
  return lines.join('\n')
}

/** 只替换某一节的内容，其余节原样保留 */
function replacePracticeSection(raw, name, value) {
  const text = String(raw)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => line === `## ${name}`)
  if (start < 0) throw new Error(`练习任务文件缺少「${name}」一节`)
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) {
      end = i
      break
    }
  }
  const head = lines.slice(0, start + 1)
  const tail = lines.slice(end)
  while (head.length > start + 1 && head[head.length - 1] === '') head.pop()
  while (tail.length && tail[0] === '') tail.shift()
  const body = String(value ?? '').trim()
  const middle = body ? ['', ...body.split(/\r?\n/), ''] : ['']
  return [...head, ...middle, ...tail].join(eol)
}

// ---------------- 写作练习：积分 ----------------

function readPracticePoints(root) {
  const file = practicePointsFile(root)
  if (!existsSync(file)) return { version: 1, total: 0, history: [] }
  let data
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`积分文件不是合法 JSON：${file}`)
  }
  const history = Array.isArray(data && data.history) ? data.history.filter((entry) => entry && typeof entry === 'object') : []
  const total = Number.isFinite(data && data.total) ? data.total : history.reduce((sum, entry) => sum + (Number(entry.points) || 0), 0)
  return { version: 1, total, history }
}

function writePracticePoints(root, data) {
  const file = practicePointsFile(root)
  mkdirSync(dirname(file), { recursive: true })
  const payload = { version: 1, total: Number(data.total) || 0, history: Array.isArray(data.history) ? data.history : [] }
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

// ---------------- 写作练习：选题目与生成 ----------------

function parseKeywords(value) {
  const text = Array.isArray(value) ? value.join(',') : String(value ?? '')
  const list = text
    .split(/[,，、;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  return [...new Set(list)].slice(0, 12)
}

/**
 * 第三人称统一为 ta：`他们/她们 → ta们`，其余 `他 / 她 → ta`。
 * 「其他、吉他、他乡…」里的「他」不是人称代词：先替换成占位符，最后原样还原。
 */
export function neutralizePronouns(text) {
  let out = String(text ?? '')
  const placeholders = []
  for (const word of PROTECTED_HE_WORDS) {
    if (!out.includes(word)) continue
    const token = `\u0001${placeholders.length}\u0001`
    out = out.split(word).join(token)
    placeholders.push(word)
  }
  out = out.replace(/他们/g, 'ta们').replace(/她们/g, 'ta们').replace(/他/g, 'ta').replace(/她/g, 'ta')
  for (let i = 0; i < placeholders.length; i += 1) {
    out = out.split(`\u0001${i}\u0001`).join(placeholders[i])
  }
  return out
}

/** 过滤 practice.keywords 里的性少数题材词（大小写不敏感），返回逗号分隔的字符串 */
export function sanitizeKeywords(value) {
  const list = parseKeywords(value).filter((keyword) => !BANNED_KEYWORD_PATTERN.test(keyword))
  return list.join(', ')
}

function keywordHits(question, keywordList) {
  return keywordList.some((keyword) => question.tags.some((tag) => tag.includes(keyword) || keyword.includes(tag)))
}

/**
 * 选题目：题型按日序轮换；优先最近 3 期未用 motif；
 * 关键词命中 tags 优先（先当日题型、再全库）；全用过时复用最久未用的一题。
 */
function pickQuestion({ day, tasks, keywordList }) {
  const targetType = PRACTICE_TYPES[dayNumber(day) % PRACTICE_TYPES.length]
  const recentMotifs = new Set(tasks.slice(-3).map((task) => task.motif).filter(Boolean))
  const lastUsed = new Map()
  tasks.forEach((task, index) => {
    const question = QUESTION_LIBRARY.find((item) => item.title === task.title)
    if (question) lastUsed.set(question.id, index)
  })
  const fresh = (pool) => pool.filter((question) => !recentMotifs.has(question.motif))
  const typePool = QUESTION_LIBRARY.filter((question) => question.types.includes(targetType))
  const freshTypePool = fresh(typePool)
  const freshAll = fresh(QUESTION_LIBRARY)

  if (keywordList.length) {
    const hitInType = freshTypePool.filter((question) => keywordHits(question, keywordList))
    if (hitInType.length) return hitInType[dayNumber(day) % hitInType.length]
    const hitInAll = freshAll.filter((question) => keywordHits(question, keywordList))
    if (hitInAll.length) return hitInAll[dayNumber(day) % hitInAll.length]
    const randomPool = freshTypePool.length ? freshTypePool : freshAll
    if (randomPool.length) return randomPool[Math.floor(Math.random() * randomPool.length)]
    // 全部用过 → 落到下面的「复用最久未用」
  }

  if (freshTypePool.length) {
    return freshTypePool[Math.floor(dayNumber(day) / PRACTICE_TYPES.length) % freshTypePool.length]
  }
  if (freshAll.length) return freshAll[dayNumber(day) % freshAll.length]

  const lruPool = typePool.length ? typePool : QUESTION_LIBRARY
  let best = lruPool[0]
  let bestIndex = lastUsed.has(best.id) ? lastUsed.get(best.id) : Number.POSITIVE_INFINITY
  for (const question of lruPool.slice(1)) {
    const index = lastUsed.has(question.id) ? lastUsed.get(question.id) : Number.POSITIVE_INFINITY
    if (index < bestIndex) {
      best = question
      bestIndex = index
    }
  }
  return best
}

function promptWithKeywords(question, keywordList) {
  if (!keywordList.length) return question.prompt
  const quoted = keywordList.map((keyword) => `「${keyword}」`).join('、')
  return `${question.prompt}\n\n本期关键词：${quoted}。试着让它们在故事里自然出现，而不是硬塞进对话。`
}

/**
 * 生成某天的练习任务；文件已存在时直接返回（每天只生成一次）。
 * 篇号 = 已有任务数 + 1；题型按 date 的日序轮换。
 */
export function generatePracticeTask(root = resolveRoot(), { date, keywords } = {}) {
  const base = ensureDirs(root)
  const day = date === undefined || date === null || date === '' ? formatDate(new Date()) : normalizeDate(date)
  const id = day.replace(/-/g, '')
  const file = practiceTaskFile(base, id)
  if (existsSync(file)) return readPracticeTask(base, id)

  const config = readPracticeConfig()
  // 先过滤关键词里的性少数题材词，再用剩下的词匹配/注入题目
  const keywordList = parseKeywords(sanitizeKeywords(keywords === undefined ? config.keywords : keywords))
  const tasks = listPracticeTasks(base)
  const question = pickQuestion({ day, tasks, keywordList })
  // 当日轮换题型；关键词跨题型命中时退回题目自己的主类型，保证 front matter 的 type 与题目一致
  const targetType = PRACTICE_TYPES[dayNumber(day) % PRACTICE_TYPES.length]
  // 每期随机预设主视角性别（只影响叙事视角，不代表作者性别）
  const pov = Math.random() < 0.5 ? '男' : '女'
  const povLabel = pov === '男' ? '男性视角' : '女性视角'
  const neutral = (text) => neutralizePronouns(text)
  const title = neutral(question.title)
  const sections = [
    ['命题', neutral(promptWithKeywords(question, keywordList))],
    ['剧本节拍', neutral(question.beats.map((beat, index) => `${index + 1}. ${beat}`).join('\n'))],
    [
      '演绎方向',
      neutral(
        `- 视角：${question.directions.view}\n- 可放大的矛盾：${question.directions.tension}\n- 结尾尝试：${question.directions.ending}`,
      ),
    ],
    ['约束', neutral(`${question.constraints}\n本期主视角：第一人称（${povLabel}）。\n${PRACTICE_CONVENTIONS}`)],
    ['反馈标准', neutral(question.feedback.map((item, index) => `${index + 1}. ${item}`).join('\n'))],
    ['我的演绎', ''],
    ['评语', ''],
    ['积分', '+0（评分后填写）'],
  ]
  const raw = renderPracticeFile({
    front: {
      id,
      date: day,
      title,
      type: question.types.includes(targetType) ? targetType : question.type,
      pov,
      motif: question.motif,
      keywords: keywordList.join(', '),
      status: 'pending',
      points: 0,
      created: localIso(new Date()),
    },
    issue: tasks.length + 1,
    sections,
  })
  writeFileSync(file, raw, 'utf8')
  return readPracticeTask(base, id)
}

// ---------------- 写作练习：读取 / 保存 / 提交 / 评分 ----------------

/** 任务列表，按 id（日期）升序；目录不存在视为空 */
export function listPracticeTasks(root = resolveRoot()) {
  const base = resolve(root)
  const dir = join(base, PRACTICE_DIR, PRACTICE_TASK_DIR)
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
  const tasks = []
  for (const entry of entries) {
    if (!entry.isFile() || !/^\d{8}\.md$/.test(entry.name)) continue
    try {
      tasks.push(readPracticeTask(base, entry.name.slice(0, -3)))
    } catch (error) {
      if (error && error.code === 'ENOENT') continue
      throw error
    }
  }
  tasks.sort((a, b) => a.id.localeCompare(b.id))
  return tasks
}

/** 读一个练习任务：front matter + 五个只读节 + 我的演绎 + 评语 + 积分 + 原文 */
export function readPracticeTask(root, id) {
  const taskId = normalizeTaskId(id)
  const file = practiceTaskFile(root, taskId)
  if (!existsSync(file)) throw new Error(`练习任务不存在：${taskId}`)
  const raw = readFileSync(file, 'utf8')
  const { front, sections } = parsePracticeFile(raw)
  const draft = (sections['我的演绎'] || '').trim()
  const review = (sections['评语'] || '').trim()
  return {
    ...front,
    status: front.status || 'pending',
    points: Number(front.points) || 0,
    sections: {
      命题: sections['命题'] || '',
      剧本节拍: sections['剧本节拍'] || '',
      演绎方向: sections['演绎方向'] || '',
      约束: sections['约束'] || '',
      反馈标准: sections['反馈标准'] || '',
    },
    draft,
    review,
    chars: draft.length,
    raw,
  }
}

/** 保存草稿：只改「我的演绎」并置 written（pending → written；已提交的保持 submitted 不降级） */
export function savePracticeDraft(root, { id, text } = {}) {
  const base = resolve(root)
  const task = readPracticeTask(base, id)
  if (task.status === 'scored') throw new Error('任务已评分，不能再修改草稿')
  const body = String(text ?? '').trim()
  const status = task.status === 'submitted' ? 'submitted' : 'written'
  let raw = replacePracticeSection(task.raw, '我的演绎', body)
  raw = updatePracticeFrontMatter(raw, { status })
  writeFileSync(practiceTaskFile(base, task.id), raw, 'utf8')
  return { id: task.id, status }
}

/** 提交：校验草稿非空，置 submitted（已提交时幂等） */
export function submitPracticeTask(root, { id } = {}) {
  const base = resolve(root)
  const task = readPracticeTask(base, id)
  if (task.status === 'scored') throw new Error('任务已评分，不需要再次提交')
  if (task.status === 'submitted') return { id: task.id, status: 'submitted' }
  if (!task.draft) throw new Error('还没有写内容，不能提交')
  const raw = updatePracticeFrontMatter(task.raw, { status: 'submitted' })
  writeFileSync(practiceTaskFile(base, task.id), raw, 'utf8')
  return { id: task.id, status: 'submitted' }
}

function normalizePoints(value) {
  const score = Number(value)
  if (!Number.isInteger(score) || score < 10 || score > 20) {
    throw new Error('points 需要 10–20 的整数（基础 10 分 + 0–10 加分）')
  }
  return score
}

function reviewReason(review) {
  const line =
    String(review)
      .split(/\r?\n/)
      .map((item) => item.replace(/^[-*#>\d.、)\s]+/, '').trim())
      .find(Boolean) || '写作练习评分'
  return line.slice(0, 100)
}

/** 评分：校验状态（written/submitted）、评语与积分 → 写评语/积分/状态 → 追加积分历史 */
export function scorePracticeTask(root, { id, points, review } = {}) {
  const base = resolve(root)
  const task = readPracticeTask(base, id)
  if (task.status === 'scored') throw new Error('任务已经评过分了')
  if (task.status !== 'submitted' && task.status !== 'written') throw new Error('任务还没有写作内容，不能评分')
  const score = normalizePoints(points)
  const reviewText = String(review ?? '').trim()
  if (!reviewText) throw new Error('评语不能为空')

  // 先读积分文件：损坏时不该先把任务改成 scored
  const pointsData = readPracticePoints(base)
  pointsData.history.push({
    at: localIso(new Date()),
    taskId: task.id,
    points: score,
    reason: reviewReason(reviewText),
  })
  pointsData.total = pointsData.history.reduce((sum, entry) => sum + (Number(entry.points) || 0), 0)

  let raw = replacePracticeSection(task.raw, '评语', reviewText)
  raw = replacePracticeSection(raw, '积分', `+${score}`)
  raw = updatePracticeFrontMatter(raw, { points: score, status: 'scored' })
  writeFileSync(practiceTaskFile(base, task.id), raw, 'utf8')
  writePracticePoints(base, pointsData)
  return { id: task.id, points: score, total: pointsData.total, task: readPracticeTask(base, task.id) }
}

/** 练习面板状态：配置 + 任务摘要（日期倒序）+ 累计积分 + 今天日期 */
export function practiceState(root = resolveRoot()) {
  const config = readPracticeConfig()
  const tasks = listPracticeTasks(root)
    .map((task) => ({
      id: task.id,
      date: task.date,
      title: task.title,
      type: task.type,
      motif: task.motif,
      status: task.status,
      points: task.points,
      chars: task.chars,
    }))
    .sort((a, b) => b.id.localeCompare(a.id))
  const points = readPracticePoints(root)
  return { config, tasks, points: { total: points.total, history: points.history }, today: formatDate(new Date()) }
}

/**
 * 定时检查：enabled 且当前时间 ≥ 推送时间且当天任务不存在 → 生成当天任务
 * （启动晚于推送时间时也能补生成）。任何失败都吞掉，留给下一次 tick。
 */
function checkPractice(now = new Date()) {
  try {
    const config = readPracticeConfig()
    if (!config.enabled) return null
    const root = resolveRoot()
    const today = formatDate(now)
    if (existsSync(practiceTaskFile(root, today.replace(/-/g, '')))) return null
    const [hour, minute] = config.time.split(':').map(Number)
    if (now.getHours() * 60 + now.getMinutes() < hour * 60 + minute) return null
    return generatePracticeTask(root, { date: today, keywords: config.keywords })
  } catch (error) {
    return null
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
    case 'practice.state':
      return { ok: true, ...practiceState(root) }
    case 'practice.read':
      return { ok: true, task: readPracticeTask(root, request.id) }
    case 'practice.save': {
      const result = savePracticeDraft(root, { id: request.id, text: request.text })
      return { ok: true, status: result.status }
    }
    case 'practice.submit': {
      const result = submitPracticeTask(root, { id: request.id })
      return { ok: true, status: result.status }
    }
    case 'practice.config': {
      const patch = {}
      if (request.enabled !== undefined) patch.enabled = request.enabled
      if (request.time !== undefined) patch.time = request.time
      if (request.keywords !== undefined) patch.keywords = request.keywords
      const config = Object.keys(patch).length ? writePracticeConfig(patch) : readPracticeConfig()
      return { ok: true, config }
    }
    case 'practice.generate':
      return { ok: true, task: generatePracticeTask(root, { date: request.date }) }
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

// ---------------- Agent 工具 practice（写作练习） ----------------

const PRACTICE_TOOL_DESCRIPTION =
  '管理用户的写作练习（随笔工坊）。action=list 列出练习任务与累计积分；read 读某天任务全文（题目、我的演绎、评语）；' +
  'score 按任务里的「反馈标准」写评语并发积分；generate 生成/补生成某天的练习任务；config 读取当前练习配置。'

const PRACTICE_TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['list', 'read', 'score', 'generate', 'config'] },
    id: { type: 'string', description: '练习任务 id（YYYYMMDD，即任务文件名）' },
    points: { type: 'integer', description: '最终积分：基础 10 分 + 0–10 加分，范围 10–20' },
    review: { type: 'string', description: '评语：按任务「反馈标准」的 4 条逐条点评，最后给一句总体反馈' },
    date: { type: 'string', description: '生成日期 YYYY-MM-DD，默认今天' },
  },
  required: ['action'],
}

function createPracticeTool() {
  return {
    name: 'practice',
    description: PRACTICE_TOOL_DESCRIPTION,
    parameters: PRACTICE_TOOL_SCHEMA,
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
        case 'list':
          return toolPracticeList(root)
        case 'read':
          return toolPracticeRead(root, params)
        case 'score':
          return toolPracticeScore(root, params)
        case 'generate':
          return toolPracticeGenerate(root, params)
        case 'config':
          return toolPracticeConfig()
        default:
          throw new Error(`未知 action：${action || '(空)'}（可用 list/read/score/generate/config）`)
      }
    },
  }
}

function practiceStatusLabel(status) {
  return PRACTICE_STATUS_LABELS[status] || status
}

function toolPracticeList(root) {
  const state = practiceState(root)
  const lines = [`写作练习（今日 ${state.today}）`, `累计积分：${state.points.total}`]
  lines.push(`练习任务（${state.tasks.length} 个）：`)
  if (state.tasks.length === 0) lines.push('（暂无）')
  for (const task of state.tasks) {
    lines.push(`- ${task.id} | ${practiceStatusLabel(task.status)} | ${task.points} 分 | ${task.title}`)
  }
  const pending = state.tasks.filter((task) => task.status === 'submitted').length
  if (pending) lines.push(`待评分：${pending} 个（status=submitted）`)
  lines.push('', '提示：用户说「练习写完了 / 帮我评分」时，先 read 任务，再按「反馈标准」逐条写评语并 score。')
  return { text: lines.join('\n'), data: state }
}

function toolPracticeRead(root, params) {
  if (!params.id) throw new Error('read 需要练习任务 id（YYYYMMDD）')
  const task = readPracticeTask(root, params.id)
  return { text: task.raw, data: task }
}

function toolPracticeScore(root, params) {
  if (!params.id) throw new Error('score 需要练习任务 id（YYYYMMDD）')
  if (params.review === undefined || params.review === null || String(params.review).trim() === '') {
    throw new Error('score 需要评语 review')
  }
  if (params.points === undefined || params.points === null) throw new Error('score 需要积分 points（10–20 的整数）')
  const result = scorePracticeTask(root, { id: params.id, points: params.points, review: params.review })
  return {
    text: `已评分：${result.id} · ${result.points} 分（累计 ${result.total} 分）\n\n${result.task.review}`,
    data: result,
  }
}

function toolPracticeGenerate(root, params) {
  const task = generatePracticeTask(root, { date: params.date })
  return {
    text: `已生成练习任务：${task.id} · ${task.title}（${practiceStatusLabel(task.status)}）`,
    data: task,
  }
}

function toolPracticeConfig() {
  const config = readPracticeConfig()
  const lines = [
    `写作练习：${config.enabled ? '已开启' : '已关闭'}`,
    `推送时间：${config.time}`,
    `关键词：${config.keywords || '（未设置）'}`,
  ]
  return { text: lines.join('\n'), data: config }
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
    '',
    '写作练习：',
    '- 练习任务在 练习/任务/<YYYYMMDD>.md（每天到配置的推送时间自动生成），累计积分在 练习/积分.json。',
    '- 用户说「练习写完了 / 帮我评分」时：先 practice(action=list) 找出 status=submitted 的任务，practice(action=read, id) 通读题目与「我的演绎」，再严格按该任务「反馈标准」的 4 条逐条写评语，然后调用 practice(action=score, id, points, review)。points 传最终积分（基础 10 分 + 0–10 加分，范围 10–20）；review 逐条点评并在最后给一句总体反馈。评分时用 ta 指代角色，不要使用带性别的称呼；评分后告诉用户本次得分、当前累计积分，再给一句话反馈。',
    '- 出题约定：题目角色不标注性别，第三人称统一用 ta；每期会随机指定主视角（front matter 的 `pov: 男/女`，并在「约束」里写明「本期主视角：第一人称（男性/女性视角）」），pov 只表示叙事视角、不代表作者性别；角色可以用社会身份（职业/身份）设定，不必依赖性别关系；不写同性恋 / LGBT 等性少数题材，practice.keywords 里的相关词会在生成时被过滤。',
    '- 用户想看练习配置时用 practice(action=config)；要改关键词 / 推送时间 / 开关，引导用户用面板的「练习设置」。',
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

  // 启动时先补查一次：插件晚于推送时间启动时也能生成当天任务
  checkPractice()

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: API_PATH, handler: handleApi }))
  ctx.effect(() => ctx.tools.register(createEssayTool()))
  ctx.effect(() => ctx.tools.register(createPracticeTool()))
  ctx.effect(() => ctx.systemPrompt.section({ name: 'essay-desk', order: 3500, text: systemPromptText }))
  // 每分钟检查一次是否到了推送时间（每天以任务文件存在与否去重）
  ctx.effect(() => ctx.timer.interval(checkPractice, PRACTICE_CHECK_INTERVAL))
}

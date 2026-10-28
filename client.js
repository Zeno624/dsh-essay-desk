/**
 * 随笔工坊（dsh-essay-desk）Client 半侧。
 *
 * 纯 JavaScript 的 Web GUI 插件模块：注册一个整页面板（main 槽，key 与侧栏 entry id 相同）
 * 和侧栏图标行（sidebar.panellist）。面板只通过同源 HTTP API `/essay-desk/api` 与 Host 通信，
 * 不 import 任何 Harness Client 包，不读写 Session，不产生模块级副作用。
 *
 * 契约见 CONTRACT.md §4（布局、交互、locale、主题 token）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-essay-desk',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback, useMemo } = React;

    const NS = 'essay-desk';
    const API = '/essay-desk/api';

    // ---------------------------------------------------------------------
    // locale（zh 为主语言；键必须一一对应）
    // ---------------------------------------------------------------------
    const zh = {
      nav: '随笔',
      title: '随笔',
      workshop: '随笔工坊',
      slogan: 'Hone Your Voice.',
      draftsCount: '{n} 篇未分类',
      topicsCount: '{n} 个主题',
      refresh: '刷新',
      newEssay: '＋ 新建随笔',
      loading: '加载中…',
      loadFailed: '加载随笔库失败。',
      requestFailed: '请求失败，请确认随笔服务已就绪。',
      saveFailed: '保存失败。',
      saveStaleHint: '这篇可能已被 DSH 归档；再次保存会另存为新草稿。',
      readFailed: '打开失败。',
      deleteFailed: '删除失败。',
      drafts: '未分类',
      topics: '主题',
      notesItem: '思想脉络',
      draftsEmpty: '还没有未分类随笔，点「＋ 新建随笔」开始写。',
      topicsEmpty: '还没有主题，归档后会自动出现。',
      hintClassify: '写完后在对话里说「帮我整理随笔」',
      untitled: '无题',
      chars: '{n} 字',
      saved: '已保存',
      savedAt: '已保存 {time}',
      unsaved: '未保存',
      saving: '保存中…',
      save: '保存',
      delete: '删除',
      confirmDelete: '把这篇文章移到已归档？',
      readonlyBy: '由 DSH 整理',
      emptyEditor: '选择一篇随笔，或直接新建',
      footerRoot: '存放位置：{root}',
      titleLabel: '随笔标题',
      bodyLabel: '正文',
      bodyPlaceholder: '开始写…',
      autosaveHint: '停止输入 1.2 秒后自动保存 · Ctrl/Cmd+S 立即保存',
      topicEmpty: '这个主题文件还是空的。',
      notesEmpty: '还没有思想脉络总结。在对话里说「总结一下我的思想变化」试试。',
      topicCount: '{n} 篇',
      // 写作练习
      practiceSection: '写作练习',
      practiceSettings: '练习设置',
      practiceSettingsTitle: '练习设置',
      practiceEnabled: '启用每日推送',
      practiceTime: '推送时间',
      practiceTimeHint: 'HH:MM，例如 09:00',
      practiceKeywords: '关键词',
      practiceKeywordsHint: '逗号或空格分隔，留空则按题目库轮换',
      practiceKeywordsPlaceholder: '旧照片, 末班车, 误会',
      practiceConfigFailed: '练习设置保存失败。',
      practiceConfigTimeInvalid: '推送时间格式应为 HH:MM。',
      practiceCancel: '取消',
      practiceStatusPending: '待写',
      practiceStatusWritten: '已写',
      practiceStatusSubmitted: '已交',
      practiceStatusScored: '已评',
      practiceToday: '今日',
      practicePointsShort: '积分 {n}',
      practicePointsDelta: '+{n}',
      practiceEmpty: '还没有练习任务，等 DSH 每日推送一道。',
      practiceTaskLoading: '练习任务加载中…',
      practiceTaskFailed: '练习任务打开失败。',
      practiceEmptyDraft: '先写一点内容再提交。',
      practiceWaitingReview: '已提交，等待 DSH 评分。',
      practiceReview: '评语',
      practiceDraftLabel: '我的演绎',
      practiceDraftPlaceholder: '在这里写你的演绎…',
      practiceSaveDraft: '保存草稿',
      practiceSubmit: '提交',
      practiceSubmitting: '提交中…',
      practiceConfirmSubmit: '提交后不能再修改，确认提交？',
      practiceSaveFailed: '保存草稿失败。',
      practiceSubmitFailed: '提交失败。',
      practicePointsEarned: '积分 +{n}',
      practiceBrief: '命题',
      practiceBeats: '剧本节拍',
      practiceDirection: '演绎方向',
      practiceConstraints: '约束',
      practiceCriteria: '反馈标准',
    };

    const en = {
      nav: 'Essays',
      title: 'Essays',
      workshop: 'Essay Desk',
      slogan: 'Hone Your Voice.',
      draftsCount: '{n} uncategorized',
      topicsCount: '{n} topics',
      refresh: 'Refresh',
      newEssay: '+ New essay',
      loading: 'Loading…',
      loadFailed: 'Failed to load the essay library.',
      requestFailed: 'Request failed. Check that the essay backend is running.',
      saveFailed: 'Save failed.',
      saveStaleHint: 'It may have been archived by DSH; saving again will create a new draft.',
      readFailed: 'Failed to open.',
      deleteFailed: 'Delete failed.',
      drafts: 'Uncategorized',
      topics: 'Topics',
      notesItem: 'Threads of thought',
      draftsEmpty: 'No uncategorized essays yet. Click “+ New essay” to start.',
      topicsEmpty: 'No topics yet. They appear after DSH archives your essays.',
      hintClassify: 'When you are done, say “organize my essays” in the chat.',
      untitled: 'Untitled',
      chars: '{n} chars',
      saved: 'Saved',
      savedAt: 'Saved {time}',
      unsaved: 'Unsaved',
      saving: 'Saving…',
      save: 'Save',
      delete: 'Delete',
      confirmDelete: 'Move this essay to the archive?',
      readonlyBy: 'Curated by DSH',
      emptyEditor: 'Select an essay, or create a new one',
      footerRoot: 'Storage: {root}',
      titleLabel: 'Essay title',
      bodyLabel: 'Body',
      bodyPlaceholder: 'Start writing…',
      autosaveHint: 'Autosaves after you stop typing · Ctrl/Cmd+S to save now',
      topicEmpty: 'This topic file is still empty.',
      notesEmpty: 'No summary yet. Say “summarize how my thinking has changed” in the chat.',
      topicCount: '{n} essays',
      // Writing practice
      practiceSection: 'Writing practice',
      practiceSettings: 'Practice settings',
      practiceSettingsTitle: 'Practice settings',
      practiceEnabled: 'Enable daily prompt',
      practiceTime: 'Push time',
      practiceTimeHint: 'HH:MM, e.g. 09:00',
      practiceKeywords: 'Keywords',
      practiceKeywordsHint: 'Comma or space separated; leave empty to rotate the prompt bank',
      practiceKeywordsPlaceholder: 'old photo, last train, misunderstanding',
      practiceConfigFailed: 'Failed to save practice settings.',
      practiceConfigTimeInvalid: 'Push time must be HH:MM.',
      practiceCancel: 'Cancel',
      practiceStatusPending: 'To write',
      practiceStatusWritten: 'Drafted',
      practiceStatusSubmitted: 'Submitted',
      practiceStatusScored: 'Scored',
      practiceToday: 'Today',
      practicePointsShort: 'Points {n}',
      practicePointsDelta: '+{n}',
      practiceEmpty: 'No practice tasks yet. DSH will push one every day.',
      practiceTaskLoading: 'Loading practice task…',
      practiceTaskFailed: 'Failed to open the practice task.',
      practiceEmptyDraft: 'Write something before submitting.',
      practiceWaitingReview: 'Submitted. Waiting for DSH to score it.',
      practiceReview: 'Review',
      practiceDraftLabel: 'My rendition',
      practiceDraftPlaceholder: 'Write your rendition here…',
      practiceSaveDraft: 'Save draft',
      practiceSubmit: 'Submit',
      practiceSubmitting: 'Submitting…',
      practiceConfirmSubmit: 'You cannot edit after submitting. Submit?',
      practiceSaveFailed: 'Failed to save draft.',
      practiceSubmitFailed: 'Submit failed.',
      practicePointsEarned: 'Points +{n}',
      practiceBrief: 'Brief',
      practiceBeats: 'Beats',
      practiceDirection: 'Directions',
      practiceConstraints: 'Constraints',
      practiceCriteria: 'Feedback criteria',
    };

    // ---------------------------------------------------------------------
    // 纯工具函数（模块级常量/纯函数，无副作用）
    // ---------------------------------------------------------------------
    const call = function (body) {
      return fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (response) {
        return response.json().then(
          function (data) { return data; },
          function () { throw new Error('HTTP ' + response.status); },
        );
      });
    };

    function fmt(template, values) {
      return String(template == null ? '' : template).replace(/\{(\w+)\}/g, function (match, key) {
        return values && values[key] != null ? String(values[key]) : match;
      });
    }

    function pad2(n) {
      return n < 10 ? '0' + n : String(n);
    }

    function monthDay(value) {
      if (!value) return '';
      const date = new Date(value);
      if (isNaN(date.getTime())) return '';
      return pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
    }

    function clock(value) {
      if (!value) return '';
      const date = new Date(value);
      if (isNaN(date.getTime())) return '';
      return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
    }

    // 行内最简 markdown：**粗体** 与 *斜体*。
    function renderInline(text, keyBase) {
      const source = text == null ? '' : String(text);
      const nodes = [];
      const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
      let last = 0;
      let match = null;
      let index = 0;
      while ((match = pattern.exec(source)) !== null) {
        if (match.index > last) nodes.push(source.slice(last, match.index));
        const token = match[0];
        if (token.slice(0, 2) === '**') {
          nodes.push(h('strong', {
            key: keyBase + '-strong-' + index,
            className: 'essay-desk-md-strong',
          }, token.slice(2, token.length - 2)));
        } else {
          nodes.push(h('em', {
            key: keyBase + '-em-' + index,
            className: 'essay-desk-md-em',
          }, token.slice(1, token.length - 1)));
        }
        last = match.index + token.length;
        index += 1;
      }
      if (last < source.length) nodes.push(source.slice(last));
      return nodes.length ? nodes : '';
    }

    // 块级最简 markdown：`#`/`##`/`###` 标题、`---` 分隔、`- ` 列表、空行分段。
    // skipTitle：主题文件/思想脉络文件的首行 `# 标题` 已在页头展示，避免重复。
    function renderMarkdown(source, skipTitle) {
      const lines = String(source == null ? '' : source).replace(/\r\n?/g, '\n').split('\n');
      let start = 0;
      if (skipTitle) {
        let probe = 0;
        while (probe < lines.length && lines[probe].trim() === '') probe += 1;
        if (probe < lines.length) {
          const head = /^#\s+(.+?)\s*#*$/.exec(lines[probe].trim());
          if (head && head[1].trim() === String(skipTitle).trim()) start = probe + 1;
        }
      }

      const blocks = [];
      let paragraph = [];
      function flushParagraph() {
        if (!paragraph.length) return;
        const key = 'p-' + blocks.length;
        blocks.push(h('p', { key: key, className: 'essay-desk-md-p' }, renderInline(paragraph.join(' '), key)));
        paragraph = [];
      }

      let i = start;
      while (i < lines.length) {
        const line = lines[i].trim();
        if (line === '') {
          flushParagraph();
          i += 1;
          continue;
        }
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
          flushParagraph();
          blocks.push(h('hr', { key: 'hr-' + blocks.length, className: 'essay-desk-md-hr' }));
          i += 1;
          continue;
        }
        const heading = /^(#{1,3})\s+(.+?)\s*#*$/.exec(line);
        if (heading) {
          flushParagraph();
          const level = heading[1].length;
          const key = 'h-' + blocks.length;
          blocks.push(h('h' + level, {
            key: key,
            className: 'essay-desk-md-h essay-desk-md-h' + level,
          }, renderInline(heading[2], key)));
          i += 1;
          continue;
        }
        if (/^[-*+]\s+/.test(line)) {
          flushParagraph();
          const items = [];
          while (i < lines.length) {
            const itemMatch = /^[-*+]\s+(.*)$/.exec(lines[i].trim());
            if (!itemMatch) break;
            items.push(h('li', {
              key: 'li-' + i,
              className: 'essay-desk-md-li',
            }, renderInline(itemMatch[1], 'li-' + i)));
            i += 1;
          }
          blocks.push(h('ul', { key: 'ul-' + blocks.length, className: 'essay-desk-md-ul' }, items));
          continue;
        }
        paragraph.push(line);
        i += 1;
      }
      flushParagraph();
      return blocks.length ? blocks : null;
    }

    // ---------------------------------------------------------------------
    // 写作练习：状态映射、分区字段、今日任务与日期工具（纯常量/纯函数）
    // ---------------------------------------------------------------------
    const PRACTICE_STATUS_LABELS = {
      pending: 'practiceStatusPending',
      written: 'practiceStatusWritten',
      submitted: 'practiceStatusSubmitted',
      scored: 'practiceStatusScored',
    };

    // Host 的练习任务契约使用中文分区键；展示标题仍走 locale。
    const PRACTICE_SECTIONS = [
      { key: '命题', label: 'practiceBrief' },
      { key: '剧本节拍', label: 'practiceBeats' },
      { key: '演绎方向', label: 'practiceDirection' },
      { key: '约束', label: 'practiceConstraints' },
      { key: '反馈标准', label: 'practiceCriteria' },
    ];

    function shortDate(value) {
      if (!value) return '';
      const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
      if (match) return match[2] + '-' + match[3];
      return monthDay(value);
    }

    // Host 的 practice.state 把 today 返回为 'YYYY-MM-DD'；同时兼容任务 id
    // 'YYYYMMDD' 与任务对象形态，最后再退回本地日期匹配任务。
    function getPracticeTodayId(practice) {
      if (!practice) return null;
      const tasks = Array.isArray(practice.tasks) ? practice.tasks : [];
      const today = practice.today;
      const candidates = [];
      if (typeof today === 'string' && today) {
        candidates.push(today);
        candidates.push(today.replace(/-/g, ''));
      } else if (today && typeof today === 'object' && typeof today.id === 'string') {
        candidates.push(today.id);
      }
      for (let ci = 0; ci < candidates.length; ci += 1) {
        const candidate = candidates[ci];
        for (let ti = 0; ti < tasks.length; ti += 1) {
          const task = tasks[ti];
          if (task && (task.id === candidate || task.date === today)) return task.id;
        }
      }
      const now = new Date();
      const stamp = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
      const numeric = stamp.replace(/-/g, '');
      for (let index = 0; index < tasks.length; index += 1) {
        const task = tasks[index];
        if (task && (task.id === numeric || task.date === stamp)) return task.id;
      }
      return null;
    }

    // 兼容 task.sections.{中文键} 与 task.{中文键} 两种返回形态。
    function getPracticeSections(task) {
      if (!task || typeof task !== 'object') return {};
      if (task.sections && typeof task.sections === 'object') return task.sections;
      const sections = {};
      for (let index = 0; index < PRACTICE_SECTIONS.length; index += 1) {
        const key = PRACTICE_SECTIONS[index].key;
        if (typeof task[key] === 'string') sections[key] = task[key];
      }
      return sections;
    }

    function stripFrontMatter(source) {
      return String(source == null ? '' : source).replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    }

    // ---------------------------------------------------------------------
    // 样式：只使用 --dsw-alias-* 主题 token，class 前缀 essay-desk-
    // ---------------------------------------------------------------------
    const CSS = [
      '.essay-desk-root{--ed-accent-soft:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);--ed-accent-line:color-mix(in srgb,var(--dsw-alias-brand-primary) 42%,transparent);display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:1.5;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent}',
      '.essay-desk-root *{box-sizing:border-box}',
      '.essay-desk-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 22px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;background:var(--dsw-alias-bg-base);background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-bg-layer-1) 60%,transparent),transparent)}',
      '.essay-desk-head-main{display:flex;align-items:baseline;gap:12px;min-width:0;flex-wrap:wrap}',
      '.essay-desk-title{display:flex;align-items:center;margin:0;font-size:18px;font-weight:650;line-height:26px;letter-spacing:-.01em;white-space:nowrap}',
      '.essay-desk-title::before{content:"";flex:none;width:9px;height:9px;border-radius:3px;background:var(--dsw-alias-brand-primary);margin-right:9px;transform:rotate(-10deg)}',
      '.essay-desk-sub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.essay-desk-slogan{flex:none;color:var(--dsw-alias-brand-primary);font-size:11px;font-style:italic;font-weight:500;letter-spacing:.07em;line-height:18px;opacity:.9;white-space:nowrap}',
      '.essay-desk-head-actions{display:flex;align-items:center;gap:8px;flex:none}',
      '.essay-desk-btn{font:inherit;font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:5px 12px;cursor:pointer;transition:background .16s ease,border-color .16s ease,color .16s ease,transform .16s ease}',
      '.essay-desk-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
      '.essay-desk-btn:active:not(:disabled){transform:translateY(1px)}',
      '.essay-desk-btn:focus-visible{outline:2px solid var(--ed-accent-line);outline-offset:1px}',
      '.essay-desk-btn:disabled{opacity:.45;cursor:default}',
      '.essay-desk-btn-primary{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1);background:var(--ed-accent-soft)}',
      '.essay-desk-btn-primary:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 24%,transparent);border-color:var(--dsw-alias-brand-primary)}',
      '.essay-desk-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-border-l1);background:transparent}',
      '.essay-desk-btn-danger:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);border-color:var(--dsw-alias-state-error-primary)}',
      '.essay-desk-error{display:flex;align-items:flex-start;gap:8px;margin:10px 22px 0;padding:8px 11px;border:1px solid var(--dsw-alias-border-l1);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);border-radius:10px;color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-1);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);font-size:12px;line-height:18px;flex:none;white-space:pre-wrap}',
      '.essay-desk-error::before{content:"!";flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin-top:1px;border:1px solid currentColor;border-radius:50%;font-size:10px;font-weight:700;line-height:1}',
      '.essay-desk-body{display:flex;flex:1;min-height:0}',
      '.essay-desk-side{width:272px;flex:none;border-right:1px solid var(--dsw-alias-border-l1);overflow-y:auto;padding:0 10px 26px;display:flex;flex-direction:column;gap:3px;background:var(--dsw-alias-bg-base);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 40%,var(--dsw-alias-bg-base))}',
      '.essay-desk-sec{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:7px;margin-top:6px;padding:13px 8px 7px;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;letter-spacing:.06em;line-height:16px;background:var(--dsw-alias-bg-base);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,var(--dsw-alias-bg-base));backdrop-filter:blur(6px)}',
      '.essay-desk-sec > span:first-of-type::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary);margin-right:7px;vertical-align:1px;opacity:.85}',
      '.essay-desk-sec-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:18px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:10px;font-weight:500;letter-spacing:0;line-height:1}',
      '.essay-desk-tip{margin:2px 6px 9px;padding:7px 10px;border:1px solid var(--ed-accent-line);border-radius:9px;background:var(--dsw-alias-bg-layer-1);background:var(--ed-accent-soft);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}',
      '.essay-desk-item{display:flex;flex-direction:column;gap:3px;width:100%;text-align:left;font:inherit;color:var(--dsw-alias-label-primary);background:transparent;border:1px solid transparent;border-radius:10px;padding:9px 11px;cursor:pointer;transition:background .16s ease,border-color .16s ease,transform .16s ease}',
      '.essay-desk-item:hover{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1);transform:translateY(-1px)}',
      '.essay-desk-item:focus-visible{outline:2px solid var(--ed-accent-line);outline-offset:1px}',
      '.essay-desk-item-on{background:var(--dsw-alias-bg-layer-2);background:var(--ed-accent-soft);border-color:var(--ed-accent-line);box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary)}',
      '.essay-desk-item-on:hover{transform:none;background:var(--dsw-alias-bg-layer-2);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 20%,transparent)}',
      '.essay-desk-item-row{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%}',
      '.essay-desk-item-title{font-size:13px;font-weight:500;line-height:19px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.essay-desk-item-meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px;letter-spacing:.01em}',
      '.essay-desk-chip{display:inline-flex;align-items:center;height:16px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1}',
      '.essay-desk-item-count{flex:none;display:inline-flex;align-items:center;height:17px;padding:0 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1}',
      '.essay-desk-empty-mini{margin:2px 6px 8px;padding:14px 12px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
      '.essay-desk-loading{display:flex;align-items:center;gap:9px;padding:16px 12px;color:var(--dsw-alias-label-tertiary);font-size:12px}',
      '.essay-desk-loading::before{content:"";width:13px;height:13px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:essay-desk-spin .8s linear infinite}',
      '@keyframes essay-desk-spin{to{transform:rotate(360deg)}}',
      '.essay-desk-main{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;padding:18px 26px 12px}',
      '.essay-desk-editor{display:flex;flex-direction:column;flex:1;min-height:0}',
      '.essay-desk-editor-head{display:flex;align-items:center;gap:14px;flex:none}',
      '.essay-desk-title-input{flex:1;min-width:0;font:inherit;font-size:20px;font-weight:650;letter-spacing:-.01em;line-height:30px;color:var(--dsw-alias-label-primary);background:transparent;border:none;border-bottom:1px solid transparent;outline:none;padding:2px 0;transition:border-color .16s ease}',
      '.essay-desk-title-input:focus{border-bottom-color:var(--dsw-alias-brand-primary)}',
      '.essay-desk-title-input::placeholder{color:var(--dsw-alias-label-tertiary);font-weight:400}',
      '.essay-desk-editor-actions{display:flex;align-items:center;gap:8px;flex:none}',
      '.essay-desk-meta{display:flex;align-items:center;gap:10px;padding:9px 0 13px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;flex:none;letter-spacing:.01em}',
      '.essay-desk-meta > span:first-child{display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:1}',
      '.essay-desk-status-unsaved{color:var(--dsw-alias-state-warn-primary)}',
      '.essay-desk-status-saved{color:var(--dsw-alias-state-success-primary)}',
      '.essay-desk-status-saving{color:var(--dsw-alias-label-secondary)}',
      '.essay-desk-textarea{flex:1;min-height:0;width:100%;resize:none;font:inherit;font-size:15.5px;line-height:1.95;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px 18px;outline:none;transition:border-color .16s ease,box-shadow .16s ease}',
      '.essay-desk-textarea:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px var(--ed-accent-soft)}',
      '.essay-desk-textarea::placeholder{color:var(--dsw-alias-label-tertiary)}',
      '.essay-desk-hint{flex:none;padding:10px 2px 0;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:16px}',
      '.essay-desk-placeholder{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--dsw-alias-label-tertiary);font-size:13px;text-align:center;padding:24px}',
      '.essay-desk-placeholder::before{content:"";width:46px;height:46px;border-radius:15px;border:1.5px dashed var(--dsw-alias-border-l2);background:var(--ed-accent-soft)}',
      '.essay-desk-read{display:flex;flex-direction:column;flex:1;min-height:0}',
      '.essay-desk-read-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:none;padding:2px 0 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.essay-desk-read-title{margin:0;font-size:17px;font-weight:650;line-height:26px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.essay-desk-read-title::before{content:"";display:inline-block;width:3px;height:15px;border-radius:2px;background:var(--dsw-alias-brand-primary);margin-right:10px;vertical-align:-1px}',
      '.essay-desk-badge{flex:none;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:3px 10px;background:var(--dsw-alias-bg-layer-1)}',
      '.essay-desk-read-body{flex:1;min-height:0;overflow-y:auto;width:100%;max-width:780px;margin:0 auto;padding:18px 4px 44px;font-size:14.5px;line-height:1.9;color:var(--dsw-alias-label-primary)}',
      '.essay-desk-md-h{margin:20px 0 9px;font-weight:650;line-height:1.5}',
      '.essay-desk-md-h1{font-size:22px;letter-spacing:-.01em}',
      '.essay-desk-md-h2{font-size:17px;padding-left:11px;border-left:3px solid var(--ed-accent-line)}',
      '.essay-desk-md-h3{font-size:14.5px;color:var(--dsw-alias-label-secondary)}',
      '.essay-desk-md-p{margin:0 0 12px}',
      '.essay-desk-md-ul{margin:0 0 12px;padding-left:22px}',
      '.essay-desk-md-li{margin:0 0 5px}',
      '.essay-desk-md-hr{border:none;height:1px;background:linear-gradient(90deg,var(--dsw-alias-border-l1),transparent);margin:24px 0}',
      '.essay-desk-md-strong{font-weight:650}',
      '.essay-desk-md-em{font-style:italic;color:var(--dsw-alias-label-secondary)}',
      '.essay-desk-foot{flex:none;border-top:1px solid var(--dsw-alias-border-l1);padding:8px 22px;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:var(--dsw-alias-bg-base);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 30%,var(--dsw-alias-bg-base))}',
      '.essay-desk-side::-webkit-scrollbar,.essay-desk-read-body::-webkit-scrollbar,.essay-desk-textarea::-webkit-scrollbar{width:10px;height:10px}',
      '.essay-desk-side::-webkit-scrollbar-thumb,.essay-desk-read-body::-webkit-scrollbar-thumb,.essay-desk-textarea::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:999px;border:3px solid transparent;background-clip:content-box}',
      '.essay-desk-side::-webkit-scrollbar-thumb:hover,.essay-desk-read-body::-webkit-scrollbar-thumb:hover,.essay-desk-textarea::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-label-tertiary);background-clip:content-box}',
      '.essay-desk-side::-webkit-scrollbar-track,.essay-desk-read-body::-webkit-scrollbar-track,.essay-desk-textarea::-webkit-scrollbar-track{background:transparent}',
      '@media (prefers-reduced-motion:reduce){.essay-desk-btn,.essay-desk-item,.essay-desk-textarea,.essay-desk-title-input{transition:none}.essay-desk-loading::before{animation-duration:2s}}',
      // 写作练习
      '.essay-desk-root{position:relative}',
      '.essay-desk-points-chip{display:inline-flex;align-items:center;height:24px;padding:0 10px;border-radius:999px;background:var(--ed-accent-soft);border:1px solid var(--ed-accent-line);color:var(--dsw-alias-brand-primary);font-size:11.5px;font-weight:650;letter-spacing:.01em;white-space:nowrap}',
      '.essay-desk-points-badge{display:inline-flex;align-items:center;height:19px;padding:0 8px;margin-left:auto;border-radius:999px;background:var(--ed-accent-soft);border:1px solid var(--ed-accent-line);color:var(--dsw-alias-brand-primary);font-size:10.5px;font-weight:650;letter-spacing:0;white-space:nowrap}',
      '.essay-desk-pchip{display:inline-flex;align-items:center;height:16px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1;white-space:nowrap}',
      '.essay-desk-pchip-written{color:var(--dsw-alias-brand-primary);background:var(--ed-accent-soft)}',
      '.essay-desk-pchip-submitted{color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.essay-desk-pchip-scored{color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.essay-desk-pchip-points{color:var(--dsw-alias-brand-primary);font-weight:650;background:var(--ed-accent-soft)}',
      '.essay-desk-practice{display:flex;flex-direction:column;flex:1;min-height:0}',
      '.essay-desk-practice-head{flex:none;padding:2px 0 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.essay-desk-practice-title-row{display:flex;align-items:center;justify-content:space-between;gap:12px}',
      '.essay-desk-practice-title{margin:0;font-size:18px;font-weight:650;line-height:26px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.essay-desk-practice-title::before{content:"";display:inline-block;width:3px;height:15px;border-radius:2px;background:var(--dsw-alias-brand-primary);margin-right:10px;vertical-align:-1px}',
      '.essay-desk-practice-meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:8px}',
      '.essay-desk-practice-brief{flex:0 1 46%;min-height:120px;width:100%;max-width:820px;margin:0 auto;overflow-y:auto;padding:14px 4px 16px}',
      '.essay-desk-pbrief-sec{margin:0 0 15px}',
      '.essay-desk-pbrief-title{margin:0 0 6px;font-size:12px;font-weight:650;letter-spacing:.04em;color:var(--dsw-alias-label-secondary)}',
      '.essay-desk-pbrief-body{font-size:13.5px;line-height:1.85;color:var(--dsw-alias-label-primary)}',
      '.essay-desk-pbrief-body .essay-desk-md-p:last-child{margin-bottom:0}',
      '.essay-desk-practice-editor{display:flex;flex-direction:column;flex:1;min-height:0;padding-top:11px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.essay-desk-practice-bar{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:9px;padding:0 1px 9px}',
      '.essay-desk-practice-label{font-size:12px;font-weight:650;color:var(--dsw-alias-label-secondary)}',
      '.essay-desk-practice-status{font-size:10.5px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      '.essay-desk-practice-actions{display:flex;align-items:center;gap:8px;margin-left:auto}',
      '.essay-desk-practice-textarea{flex:1;min-height:120px}',
      '.essay-desk-practice-textarea[readonly]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.essay-desk-practice-hint{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary)}',
      '.essay-desk-review{flex:none;margin-top:12px;padding:11px 13px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
      '.essay-desk-review-title{margin-bottom:6px;font-size:11.5px;font-weight:650;letter-spacing:.03em;color:var(--dsw-alias-label-secondary)}',
      '.essay-desk-review-body{font-size:13px;line-height:1.75;white-space:pre-wrap;color:var(--dsw-alias-label-primary)}',
      '.essay-desk-review-points{margin-top:8px;font-size:12px;font-weight:650;color:var(--dsw-alias-brand-primary)}',
      '.essay-desk-modal{position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:22px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 58%,transparent);backdrop-filter:blur(2px)}',
      '.essay-desk-modal-box{width:min(440px,100%);max-height:100%;overflow-y:auto;padding:18px 18px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 18px 48px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent)}',
      '.essay-desk-modal-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:15px;font-size:14.5px;font-weight:650;line-height:22px}',
      '.essay-desk-field{display:flex;flex-direction:column;gap:6px;margin-bottom:15px}',
      '.essay-desk-field-row{flex-direction:row;align-items:center;justify-content:space-between;gap:12px}',
      '.essay-desk-field-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
      '.essay-desk-field-hint{font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-tertiary)}',
      '.essay-desk-input{font:inherit;font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;outline:none;transition:border-color .16s ease}',
      '.essay-desk-input:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.essay-desk-input-time{width:132px}',
      '.essay-desk-textarea-settings{min-height:76px;resize:vertical;font-size:12.5px;line-height:1.6;padding:8px 10px}',
      '.essay-desk-switch{appearance:none;-webkit-appearance:none;position:relative;flex:none;width:36px;height:21px;margin:0;border:none;border-radius:999px;background:var(--dsw-alias-border-l2);cursor:pointer;transition:background .16s ease}',
      '.essay-desk-switch::after{content:"";position:absolute;top:2.5px;left:2.5px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .16s ease}',
      '.essay-desk-switch:checked{background:var(--dsw-alias-brand-primary)}',
      '.essay-desk-switch:checked::after{transform:translateX(15px)}',
      '.essay-desk-switch:focus-visible{outline:2px solid var(--ed-accent-line);outline-offset:2px}',
      '.essay-desk-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}',
      '.essay-desk-head-actions{flex-wrap:wrap;justify-content:flex-end}',
    ].join('\n');

    // ---------------------------------------------------------------------
    // 面板组件
    // ---------------------------------------------------------------------
    function EssayPanel(props) {
      const t = props.t;

      const [state, setState] = useState(null);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState('');
      const [selection, setSelection] = useState(null);
      const [editor, setEditor] = useState(null);
      const [readView, setReadView] = useState(null);
      const [editTick, setEditTick] = useState(0);
      // 写作练习
      const [practice, setPractice] = useState(null);
      const [practiceTaskLoading, setPracticeTaskLoading] = useState(false);
      const [practiceView, setPracticeView] = useState(null);
      const [settingsOpen, setSettingsOpen] = useState(false);
      const [settingsForm, setSettingsForm] = useState({ enabled: true, time: '09:00', keywords: '' });
      const [settingsSaving, setSettingsSaving] = useState(false);

      const titleRef = useRef(null);
      const focusTimerRef = useRef(0);
      const savingRef = useRef(false);
      const editVersionRef = useRef(0);
      const tokenRef = useRef(0);
      const activeTokenRef = useRef(0);
      const readSeqRef = useRef(0);
      const mountedRef = useRef(false);
      const latestEditorRef = useRef(null);
      const selectionRef = useRef(null);
      const practiceViewRef = useRef(null);
      const practiceSeqRef = useRef(0);
      const practiceSavingRef = useRef(false);
      const practiceEditVersionRef = useRef(0);
      const practiceAutoOpenedRef = useRef(false);

      // 把最新值镜像到 ref，供稳定的 useCallback / 定时器读取。
      latestEditorRef.current = editor;
      selectionRef.current = selection;
      practiceViewRef.current = practiceView;

      const readBlocks = useMemo(function () {
        return readView ? renderMarkdown(readView.text, readView.title) : null;
      }, [readView]);

      const focusTitle = useCallback(function () {
        clearTimeout(focusTimerRef.current);
        focusTimerRef.current = setTimeout(function () {
          const node = titleRef.current;
          if (node && typeof node.focus === 'function') node.focus();
        }, 0);
      }, []);

      const refresh = useCallback(async function (options) {
        const keepError = !!(options && options.keepError);
        if (!keepError) setError('');
        try {
          const data = await call({ op: 'state' });
          if (!mountedRef.current) return;
          if (!data || !data.ok) {
            setError((data && data.error) || t('loadFailed'));
            return;
          }
          const drafts = Array.isArray(data.drafts) ? data.drafts : [];
          const topics = Array.isArray(data.topics) ? data.topics : [];
          setState(Object.assign({}, data, { drafts: drafts, topics: topics }));
          const current = selectionRef.current;
          if (current && current.kind === 'draft' && !drafts.some(function (item) { return item.id === current.id; })) {
            // 选中的草稿已被外部归档/删除。还有未保存内容时保留编辑器，
            // 避免把用户刚写的内容清掉；只有已保存的空编辑器才直接清空。
            const currentEditor = latestEditorRef.current;
            const hasUnsaved = !!currentEditor
              && currentEditor.status !== 'saved'
              && (currentEditor.title.trim() !== '' || currentEditor.text.trim() !== '');
            if (!hasUnsaved && activeTokenRef.current !== 0) {
              activeTokenRef.current = 0;
              latestEditorRef.current = null;
              setEditor(null);
            }
            setSelection(null);
          }
        } catch (err) {
          if (mountedRef.current) setError(t('requestFailed'));
        } finally {
          if (mountedRef.current) setLoading(false);
        }
      }, [t]);

      const refreshPractice = useCallback(async function (options) {
        const keepError = !!(options && options.keepError);
        if (!keepError) setError('');
        try {
          const data = await call({ op: 'practice.state' });
          if (!mountedRef.current) return;
          if (!data || !data.ok) {
            setError((data && data.error) || t('loadFailed'));
            return;
          }
          setPractice({
            config: data.config && typeof data.config === 'object'
              ? data.config
              : { enabled: true, time: '09:00', keywords: '' },
            tasks: Array.isArray(data.tasks) ? data.tasks : [],
            points: data.points && typeof data.points === 'object' ? data.points : { total: 0, history: [] },
            today: data.today != null ? data.today : null,
          });
        } catch (err) {
          if (mountedRef.current) setError(t('requestFailed'));
        }
      }, [t]);

      const saveDraft = useCallback(async function () {
        const current = latestEditorRef.current;
        if (!current || savingRef.current) return;
        const title = current.title;
        const text = current.text;
        if (!current.id && !title.trim() && !text.trim()) return;

        const token = current.token;
        const version = editVersionRef.current;
        savingRef.current = true;
        setError('');
        setEditor(function (prev) {
          return prev && prev.token === token ? Object.assign({}, prev, { status: 'saving' }) : prev;
        });

        try {
          const body = { op: 'save', title: title, text: text };
          if (current.id) body.id = current.id;
          const data = await call(body);
          if (!mountedRef.current) return;
          if (!data || !data.ok) {
            const message = (data && data.error) || t('saveFailed');
            // Host 对不存在的 id 返回「草稿不存在」：说明这篇已被外部归档。
            // 保留编辑器内容，把 id 置空，下一次保存即另存为新草稿。
            const stale = !!(data && typeof data.error === 'string' && /不存在|not found|no such/i.test(data.error));
            setError(stale ? message + ' ' + t('saveStaleHint') : message);
            setEditor(function (prev) {
              if (!prev || prev.token !== token) return prev;
              return Object.assign({}, prev, { id: stale ? null : prev.id, status: 'dirty' });
            });
            refresh({ keepError: true });
            return;
          }

          const clean = editVersionRef.current === version && activeTokenRef.current === token;
          setEditor(function (prev) {
            if (!prev || prev.token !== token) return prev;
            return Object.assign({}, prev, {
              id: data.id != null ? data.id : prev.id,
              // Host 落盘时会 trim 标题；未在保存期间继续编辑时采用服务端规范化后的标题。
              title: clean && typeof data.title === 'string' ? data.title : prev.title,
              status: clean ? 'saved' : 'dirty',
              savedAt: clean ? Date.now() : prev.savedAt,
              updated: data.updated || prev.updated,
            });
          });
          if (data.id && activeTokenRef.current === token) {
            setSelection({ kind: 'draft', id: data.id });
          }
          if (!clean) setEditTick(function (n) { return n + 1; });
          refresh();
        } catch (err) {
          if (!mountedRef.current) return;
          setError(t('requestFailed'));
          setEditor(function (prev) {
            return prev && prev.token === token ? Object.assign({}, prev, { status: 'dirty' }) : prev;
          });
        } finally {
          savingRef.current = false;
        }
      }, [refresh, t]);

      const flushIfDirty = useCallback(function () {
        const current = latestEditorRef.current;
        if (current && current.status === 'dirty' && (current.title.trim() || current.text.trim())) {
          saveDraft();
        }
      }, [saveDraft]);

      // 切换草稿/主题失败时恢复原来的选中项与编辑态，避免把上一个编辑器锁在「保存中」。
      const restoreAfterFailedOpen = useCallback(function (previousSelection) {
        const current = latestEditorRef.current;
        if (current && current.token) {
          activeTokenRef.current = current.token;
          if (current.status === 'saving') {
            setEditor(function (prev) {
              return prev && prev.token === current.token
                ? Object.assign({}, prev, { status: 'dirty' })
                : prev;
            });
          }
        } else {
          activeTokenRef.current = 0;
        }
        setSelection(previousSelection || null);
      }, []);

      // ------------------------- 写作练习 -------------------------
      const onPracticeTextChange = useCallback(function (event) {
        const value = event.target.value;
        practiceEditVersionRef.current += 1;
        setPracticeView(function (prev) {
          return prev ? Object.assign({}, prev, { text: value, status: 'dirty' }) : prev;
        });
      }, []);

      const savePracticeDraft = useCallback(async function () {
        const view = practiceViewRef.current;
        if (!view || practiceSavingRef.current) return;
        const task = view.task || {};
        if (task.status === 'submitted' || task.status === 'scored') return;
        const text = view.text;
        if (!text.trim()) return;
        const id = view.id;
        const version = practiceEditVersionRef.current;
        practiceSavingRef.current = true;
        setError('');
        setPracticeView(function (prev) {
          return prev && prev.id === id ? Object.assign({}, prev, { status: 'saving' }) : prev;
        });
        try {
          const data = await call({ op: 'practice.save', id: id, text: text });
          if (!mountedRef.current) return;
          if (!data || !data.ok) {
            setError((data && data.error) || t('practiceSaveFailed'));
            setPracticeView(function (prev) {
              return prev && prev.id === id ? Object.assign({}, prev, { status: 'dirty' }) : prev;
            });
            return;
          }
          const clean = practiceEditVersionRef.current === version;
          setPracticeView(function (prev) {
            if (!prev || prev.id !== id) return prev;
            return Object.assign({}, prev, {
              status: clean ? 'saved' : 'dirty',
              savedAt: clean ? Date.now() : prev.savedAt,
              task: Object.assign({}, prev.task, { status: data.status || (prev.task && prev.task.status) || 'written' }),
            });
          });
          refreshPractice({ keepError: true });
        } catch (err) {
          if (!mountedRef.current) return;
          setError(t('requestFailed'));
          setPracticeView(function (prev) {
            return prev && prev.id === id ? Object.assign({}, prev, { status: 'dirty' }) : prev;
          });
        } finally {
          practiceSavingRef.current = false;
        }
      }, [refreshPractice, t]);

      const submitPractice = useCallback(async function () {
        const view = practiceViewRef.current;
        if (!view || practiceSavingRef.current) return;
        const task = view.task || {};
        if (task.status === 'submitted' || task.status === 'scored') return;
        if (!view.text.trim()) {
          setError(t('practiceEmptyDraft'));
          return;
        }
        if (!window.confirm(t('practiceConfirmSubmit'))) return;
        const id = view.id;
        const text = view.text;
        practiceSavingRef.current = true;
        setError('');
        setPracticeView(function (prev) {
          return prev && prev.id === id ? Object.assign({}, prev, { status: 'submitting' }) : prev;
        });
        try {
          // practice.submit 只接收 id，所以先保存当前正文，避免提交旧草稿。
          const saved = await call({ op: 'practice.save', id: id, text: text });
          if (!mountedRef.current) return;
          if (!saved || !saved.ok) {
            setError((saved && saved.error) || t('practiceSaveFailed'));
            setPracticeView(function (prev) {
              return prev && prev.id === id ? Object.assign({}, prev, { status: 'dirty' }) : prev;
            });
            return;
          }
          const submitted = await call({ op: 'practice.submit', id: id });
          if (!mountedRef.current) return;
          if (!submitted || !submitted.ok) {
            setError((submitted && submitted.error) || t('practiceSubmitFailed'));
            setPracticeView(function (prev) {
              return prev && prev.id === id ? Object.assign({}, prev, { status: 'dirty' }) : prev;
            });
            return;
          }
          practiceEditVersionRef.current += 1;
          setPracticeView(function (prev) {
            if (!prev || prev.id !== id) return prev;
            return Object.assign({}, prev, {
              status: 'saved',
              savedAt: Date.now(),
              task: Object.assign({}, prev.task, { status: submitted.status || 'submitted' }),
            });
          });
          refreshPractice();
        } catch (err) {
          if (!mountedRef.current) return;
          setError(t('requestFailed'));
          setPracticeView(function (prev) {
            return prev && prev.id === id ? Object.assign({}, prev, { status: 'dirty' }) : prev;
          });
        } finally {
          practiceSavingRef.current = false;
        }
      }, [refreshPractice, t]);

      const flushPracticeIfDirty = useCallback(function () {
        const view = practiceViewRef.current;
        if (view && view.status === 'dirty' && view.text.trim()) savePracticeDraft();
      }, [savePracticeDraft]);

      const openPractice = useCallback(async function (id, options) {
        const force = !!(options && options.force);
        const selected = selectionRef.current;
        const current = practiceViewRef.current;
        if (!force && selected && selected.kind === 'practice' && selected.id === id && current && current.id === id) {
          return;
        }
        const previousSelection = selected || null;
        flushIfDirty();
        flushPracticeIfDirty();
        // 让在途的随笔 read/save 失效，避免回写当前选中项。
        readSeqRef.current += 1;
        activeTokenRef.current = 0;
        const seq = practiceSeqRef.current + 1;
        practiceSeqRef.current = seq;
        practiceEditVersionRef.current = 0;
        setError('');
        setPracticeTaskLoading(true);
        setSelection({ kind: 'practice', id: id });
        try {
          const data = await call({ op: 'practice.read', id: id });
          if (!mountedRef.current || seq !== practiceSeqRef.current) return;
          if (!data || !data.ok || !data.task) {
            setError((data && data.error) || t('practiceTaskFailed'));
            setPracticeTaskLoading(false);
            setSelection(previousSelection);
            return;
          }
          setPracticeView({
            id: id,
            task: data.task,
            text: typeof data.task.draft === 'string' ? data.task.draft : '',
            status: 'loaded',
            savedAt: 0,
          });
          setPracticeTaskLoading(false);
        } catch (err) {
          if (!mountedRef.current || seq !== practiceSeqRef.current) return;
          setError(t('requestFailed'));
          setPracticeTaskLoading(false);
          setSelection(previousSelection);
        }
      }, [flushIfDirty, flushPracticeIfDirty, t]);

      const openSettings = useCallback(function () {
        const config = practice && practice.config ? practice.config : {};
        setSettingsForm({
          enabled: config.enabled !== false,
          time: typeof config.time === 'string' && config.time ? config.time : '09:00',
          keywords: typeof config.keywords === 'string' ? config.keywords : '',
        });
        setError('');
        setSettingsOpen(true);
      }, [practice]);

      const saveSettings = useCallback(async function () {
        if (settingsSaving) return;
        const time = String(settingsForm.time || '').trim();
        if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
          setError(t('practiceConfigTimeInvalid'));
          return;
        }
        setSettingsSaving(true);
        setError('');
        try {
          const data = await call({
            op: 'practice.config',
            enabled: !!settingsForm.enabled,
            time: time || '09:00',
            keywords: String(settingsForm.keywords || ''),
          });
          if (!mountedRef.current) return;
          if (!data || !data.ok) {
            setError((data && data.error) || t('practiceConfigFailed'));
            return;
          }
          if (data.config && typeof data.config === 'object') {
            setPractice(function (prev) {
              return prev ? Object.assign({}, prev, { config: data.config }) : prev;
            });
          }
          setSettingsOpen(false);
          refreshPractice();
        } catch (err) {
          if (mountedRef.current) setError(t('requestFailed'));
        } finally {
          if (mountedRef.current) setSettingsSaving(false);
        }
      }, [settingsForm, settingsSaving, refreshPractice, t]);

      const refreshAll = useCallback(function () {
        refresh();
        refreshPractice();
        const selected = selectionRef.current;
        if (selected && selected.kind === 'practice') {
          const view = practiceViewRef.current;
          if (!view || (view.status !== 'dirty' && view.status !== 'saving' && view.status !== 'submitting')) {
            openPractice(selected.id, { force: true });
          }
        } else if (!selected && !latestEditorRef.current) {
          // 没有选中项时，刷新后按默认规则重新选中今日任务。
          practiceAutoOpenedRef.current = false;
        }
      }, [refresh, refreshPractice, openPractice]);

      const newDraft = useCallback(function () {
        flushIfDirty();
        flushPracticeIfDirty();
        practiceSeqRef.current += 1;
        setPracticeTaskLoading(false);
        readSeqRef.current += 1;
        activeTokenRef.current = 0;
        tokenRef.current += 1;
        const token = tokenRef.current;
        editVersionRef.current = 0;
        setError('');
        setReadView(null);
        setSelection(null);
        setEditTick(0);
        setEditor({
          token: token,
          id: null,
          title: '',
          text: '',
          updated: null,
          status: 'saved',
          savedAt: 0,
        });
        activeTokenRef.current = token;
        focusTitle();
      }, [flushIfDirty, flushPracticeIfDirty, focusTitle]);

      const openDraft = useCallback(async function (item) {
        const selected = selectionRef.current;
        const current = latestEditorRef.current;
        if (selected && selected.kind === 'draft' && selected.id === item.id && current && current.id === item.id) {
          return;
        }
        const previousSelection = selected || null;
        flushIfDirty();
        flushPracticeIfDirty();
        practiceSeqRef.current += 1;
        setPracticeTaskLoading(false);
        const seq = readSeqRef.current + 1;
        readSeqRef.current = seq;
        activeTokenRef.current = 0;
        editVersionRef.current = 0;
        setError('');
        setEditTick(0);
        setSelection({ kind: 'draft', id: item.id });
        try {
          const data = await call({ op: 'read', target: 'draft', id: item.id });
          if (!mountedRef.current || seq !== readSeqRef.current) return;
          if (!data || !data.ok) {
            setError((data && data.error) || t('readFailed'));
            restoreAfterFailedOpen(previousSelection);
            return;
          }
          tokenRef.current += 1;
          const token = tokenRef.current;
          activeTokenRef.current = token;
          editVersionRef.current = 0;
          setReadView(null);
          setEditor({
            token: token,
            id: item.id,
            title: typeof data.title === 'string' ? data.title : '',
            text: typeof data.text === 'string' ? data.text : '',
            updated: data.updated || item.updated || null,
            status: 'saved',
            savedAt: 0,
          });
        } catch (err) {
          if (mountedRef.current && seq === readSeqRef.current) {
            setError(t('requestFailed'));
            restoreAfterFailedOpen(previousSelection);
          }
        }
      }, [flushIfDirty, flushPracticeIfDirty, restoreAfterFailedOpen, t]);

      const openTopic = useCallback(async function (topic) {
        const previousSelection = selectionRef.current || null;
        flushIfDirty();
        flushPracticeIfDirty();
        practiceSeqRef.current += 1;
        setPracticeTaskLoading(false);
        const seq = readSeqRef.current + 1;
        readSeqRef.current = seq;
        activeTokenRef.current = 0;
        editVersionRef.current = 0;
        setError('');
        setEditTick(0);
        setSelection({ kind: 'topic', name: topic.name });
        try {
          const data = await call({ op: 'read', target: 'topic', name: topic.name });
          if (!mountedRef.current || seq !== readSeqRef.current) return;
          if (!data || !data.ok) {
            setError((data && data.error) || t('readFailed'));
            restoreAfterFailedOpen(previousSelection);
            return;
          }
          activeTokenRef.current = 0;
          setEditor(null);
          setReadView({
            kind: 'topic',
            name: topic.name,
            title: typeof data.title === 'string' && data.title ? data.title : topic.name,
            text: typeof data.text === 'string' ? data.text : '',
            updated: data.updated || null,
          });
        } catch (err) {
          if (mountedRef.current && seq === readSeqRef.current) {
            setError(t('requestFailed'));
            restoreAfterFailedOpen(previousSelection);
          }
        }
      }, [flushIfDirty, flushPracticeIfDirty, restoreAfterFailedOpen, t]);

      const openNotes = useCallback(async function () {
        const previousSelection = selectionRef.current || null;
        flushIfDirty();
        flushPracticeIfDirty();
        practiceSeqRef.current += 1;
        setPracticeTaskLoading(false);
        const seq = readSeqRef.current + 1;
        readSeqRef.current = seq;
        activeTokenRef.current = 0;
        editVersionRef.current = 0;
        setError('');
        setEditTick(0);
        setSelection({ kind: 'notes' });
        try {
          const data = await call({ op: 'read', target: 'notes' });
          if (!mountedRef.current || seq !== readSeqRef.current) return;
          if (!data || !data.ok) {
            setError((data && data.error) || t('readFailed'));
            restoreAfterFailedOpen(previousSelection);
            return;
          }
          activeTokenRef.current = 0;
          setEditor(null);
          setReadView({
            kind: 'notes',
            title: typeof data.title === 'string' && data.title ? data.title : t('notesItem'),
            text: typeof data.text === 'string' ? data.text : '',
            updated: data.updated || null,
          });
        } catch (err) {
          if (mountedRef.current && seq === readSeqRef.current) {
            setError(t('requestFailed'));
            restoreAfterFailedOpen(previousSelection);
          }
        }
      }, [flushIfDirty, flushPracticeIfDirty, restoreAfterFailedOpen, t]);

      const removeDraft = useCallback(async function () {
        const current = latestEditorRef.current;
        if (!current || !current.id || current.status === 'saving') return;
        if (!window.confirm(t('confirmDelete'))) return;
        setError('');
        try {
          const data = await call({ op: 'delete', id: current.id });
          if (!mountedRef.current) return;
          if (!data || !data.ok) {
            setError((data && data.error) || t('deleteFailed'));
            return;
          }
          if (activeTokenRef.current === current.token) {
            activeTokenRef.current = 0;
            latestEditorRef.current = null;
            editVersionRef.current = 0;
            setEditTick(0);
            setEditor(null);
            setSelection(null);
          }
          refresh();
        } catch (err) {
          if (mountedRef.current) setError(t('requestFailed'));
        }
      }, [refresh, t]);

      const onTitleChange = useCallback(function (event) {
        const value = event.target.value;
        editVersionRef.current += 1;
        setEditTick(function (n) { return n + 1; });
        setEditor(function (prev) {
          return prev ? Object.assign({}, prev, { title: value, status: 'dirty' }) : prev;
        });
      }, []);

      const onTextChange = useCallback(function (event) {
        const value = event.target.value;
        editVersionRef.current += 1;
        setEditTick(function (n) { return n + 1; });
        setEditor(function (prev) {
          return prev ? Object.assign({}, prev, { text: value, status: 'dirty' }) : prev;
        });
      }, []);

      // 挂载时拉一次随笔 state 与练习 state；卸载时清理挂起 timer。
      useEffect(function () {
        mountedRef.current = true;
        refresh();
        refreshPractice();
        return function () {
          mountedRef.current = false;
          clearTimeout(focusTimerRef.current);
        };
      }, [refresh, refreshPractice]);

      // 默认选中今日练习任务（每次挂载一次）；手动刷新且无选中项时也按默认规则重选。
      useEffect(function () {
        if (practiceAutoOpenedRef.current || !practice) return;
        practiceAutoOpenedRef.current = true;
        if (selectionRef.current || latestEditorRef.current) return;
        const todayId = getPracticeTodayId(practice);
        if (todayId) openPractice(todayId);
      }, [practice, openPractice]);

      // 改动后 1.2s 自动保存（标题或正文非空、且仍处于未保存状态）。
      useEffect(function () {
        if (editTick === 0) return undefined;
        const timer = setTimeout(function () {
          const current = latestEditorRef.current;
          if (!current || current.status !== 'dirty') return;
          if (!current.title.trim() && !current.text.trim()) return;
          saveDraft();
        }, 1200);
        return function () {
          clearTimeout(timer);
        };
      }, [editTick, saveDraft]);

      // Ctrl/Cmd+S：练习任务视图保存草稿，随笔编辑器保存随笔。
      useEffect(function () {
        function onKeyDown(event) {
          if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
          if (event.key !== 's' && event.key !== 'S') return;
          const selected = selectionRef.current;
          if (selected && selected.kind === 'practice') {
            // 任务视图激活时，Ctrl/Cmd+S 只保存练习草稿，绝不动被隐藏的随笔编辑器。
            if (practiceViewRef.current) {
              event.preventDefault();
              savePracticeDraft();
            }
            return;
          }
          if (!latestEditorRef.current) return;
          event.preventDefault();
          saveDraft();
        }
        document.addEventListener('keydown', onKeyDown);
        return function () {
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [saveDraft, savePracticeDraft]);

      // 练习设置弹窗：Esc 关闭。
      useEffect(function () {
        if (!settingsOpen) return undefined;
        function onKeyDown(event) {
          if (event.key === 'Escape') setSettingsOpen(false);
        }
        document.addEventListener('keydown', onKeyDown);
        return function () {
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [settingsOpen]);

      // ------------------------- 渲染 -------------------------
      const root = state && typeof state.root === 'string' ? state.root : '';
      const drafts = state && Array.isArray(state.drafts) ? state.drafts : [];
      const topics = state && Array.isArray(state.topics) ? state.topics : [];
      const totals = state && state.totals ? state.totals : null;
      const draftsTotal = totals && typeof totals.drafts === 'number' ? totals.drafts : drafts.length;
      const topicsTotal = totals && typeof totals.topics === 'number' ? totals.topics : topics.length;

      const selectedDraftId = selection && selection.kind === 'draft' ? selection.id : null;
      const selectedTopicName = selection && selection.kind === 'topic' ? selection.name : null;
      const notesSelected = !!(selection && selection.kind === 'notes');

      // ------------------------- 写作练习派生数据 -------------------------
      const practiceTasks = practice && Array.isArray(practice.tasks) ? practice.tasks : [];
      const practiceTotalPoints = practice && practice.points && typeof practice.points.total === 'number'
        ? practice.points.total
        : 0;
      const practiceTodayTaskId = getPracticeTodayId(practice);
      const selectedPracticeId = selection && selection.kind === 'practice' ? selection.id : null;
      const sortedPracticeTasks = practiceTasks.slice().sort(function (left, right) {
        const leftToday = practiceTodayTaskId != null && left.id === practiceTodayTaskId;
        const rightToday = practiceTodayTaskId != null && right.id === practiceTodayTaskId;
        if (leftToday !== rightToday) return leftToday ? -1 : 1;
        return String(right.date || right.id || '').localeCompare(String(left.date || left.id || ''));
      });

      const practiceItems = sortedPracticeTasks.map(function (task) {
        const on = selectedPracticeId != null && selectedPracticeId === task.id;
        const statusLabel = PRACTICE_STATUS_LABELS[task.status] || null;
        const points = typeof task.points === 'number' ? task.points : Number(task.points) || 0;
        return h('button', {
          key: task.id,
          type: 'button',
          className: 'essay-desk-item' + (on ? ' essay-desk-item-on' : ''),
          title: task.title || t('untitled'),
          onClick: function () { openPractice(task.id); },
        },
        h('span', { className: 'essay-desk-item-row' },
          h('span', { className: 'essay-desk-item-title' }, task.title || t('untitled')),
          h('span', { className: 'essay-desk-pchip essay-desk-pchip-points' },
            fmt(t('practicePointsDelta'), { n: points }))),
        h('span', { className: 'essay-desk-item-meta' },
          task.date ? h('span', { className: 'essay-desk-chip' }, shortDate(task.date)) : null,
          practiceTodayTaskId != null && task.id === practiceTodayTaskId
            ? h('span', { className: 'essay-desk-chip' }, t('practiceToday'))
            : null,
          statusLabel ? h('span', { className: 'essay-desk-pchip essay-desk-pchip-' + task.status }, t(statusLabel)) : null,
          task.type ? h('span', { className: 'essay-desk-chip' }, task.type) : null));
      });

      // 练习任务视图：题目只读 + 我的演绎 + 保存/提交 + 评语积分。
      function buildPracticeView() {
        const view = practiceView;
        const task = view && view.task ? view.task : {};
        const locked = task.status === 'submitted' || task.status === 'scored';
        const sections = getPracticeSections(task);
        const sectionBlocks = [];
        for (let index = 0; index < PRACTICE_SECTIONS.length; index += 1) {
          const def = PRACTICE_SECTIONS[index];
          const raw = sections && typeof sections[def.key] === 'string' ? sections[def.key] : '';
          if (!raw.trim()) continue;
          sectionBlocks.push(h('section', { key: def.key, className: 'essay-desk-pbrief-sec' },
            h('h3', { className: 'essay-desk-pbrief-title' }, t(def.label)),
            h('div', { className: 'essay-desk-pbrief-body' },
              renderMarkdown(raw, null) || h('p', { className: 'essay-desk-md-p' }, raw))));
        }
        if (!sectionBlocks.length && typeof task.raw === 'string' && task.raw.trim()) {
          sectionBlocks.push(h('section', { key: 'raw', className: 'essay-desk-pbrief-sec' },
            h('div', { className: 'essay-desk-pbrief-body' }, renderMarkdown(stripFrontMatter(task.raw), null))));
        }

        const statusLabel = PRACTICE_STATUS_LABELS[task.status] || null;
        const chars = typeof view.text === 'string' ? view.text.length : 0;
        const points = typeof task.points === 'number' ? task.points : Number(task.points) || 0;
        const review = typeof task.review === 'string' ? task.review : '';
        const busy = view.status === 'saving' || view.status === 'submitting';
        let statusText = '';
        let statusModifier = 'saved';
        if (view.status === 'saving') {
          statusText = t('saving');
          statusModifier = 'saving';
        } else if (view.status === 'submitting') {
          statusText = t('practiceSubmitting');
          statusModifier = 'saving';
        } else if (view.status === 'dirty') {
          statusText = t('unsaved');
          statusModifier = 'unsaved';
        } else if (view.status === 'saved') {
          const timeText = clock(view.savedAt);
          statusText = timeText ? fmt(t('savedAt'), { time: timeText }) : t('saved');
        } else if (!locked && view.text) {
          statusText = t('saved');
        }

        return h('div', { className: 'essay-desk-practice' },
          h('div', { className: 'essay-desk-practice-head' },
            h('div', { className: 'essay-desk-practice-title-row' },
              h('h2', { className: 'essay-desk-practice-title' }, task.title || t('practiceSection')),
              statusLabel ? h('span', { className: 'essay-desk-pchip essay-desk-pchip-' + task.status }, t(statusLabel)) : null),
            h('div', { className: 'essay-desk-practice-meta' },
              task.date ? h('span', { className: 'essay-desk-chip' }, task.date) : null,
              task.type ? h('span', { className: 'essay-desk-chip' }, task.type) : null,
              task.motif ? h('span', { className: 'essay-desk-chip' }, task.motif) : null,
              practiceTodayTaskId != null && task.id === practiceTodayTaskId
                ? h('span', { className: 'essay-desk-chip' }, t('practiceToday'))
                : null)),
          h('div', { className: 'essay-desk-practice-brief' },
            sectionBlocks.length
              ? sectionBlocks
              : h('div', { className: 'essay-desk-practice-hint' }, t('practiceTaskFailed'))),
          h('div', { className: 'essay-desk-practice-editor' },
            h('div', { className: 'essay-desk-practice-bar' },
              h('span', { className: 'essay-desk-practice-label' }, t('practiceDraftLabel')),
              h('span', { className: 'essay-desk-practice-status' }, fmt(t('chars'), { n: chars })),
              statusText
                ? h('span', { className: 'essay-desk-practice-status essay-desk-status-' + statusModifier }, statusText)
                : null,
              locked ? null : h('div', { className: 'essay-desk-practice-actions' },
                h('button', {
                  type: 'button',
                  className: 'essay-desk-btn',
                  disabled: busy || !view.text.trim(),
                  onClick: function () { savePracticeDraft(); },
                }, t('practiceSaveDraft')),
                h('button', {
                  type: 'button',
                  className: 'essay-desk-btn essay-desk-btn-primary',
                  disabled: busy || !view.text.trim(),
                  onClick: function () { submitPractice(); },
                }, view.status === 'submitting' ? t('practiceSubmitting') : t('practiceSubmit')))),
            h('textarea', {
              className: 'essay-desk-textarea essay-desk-practice-textarea',
              value: view.text,
              readOnly: locked,
              placeholder: locked ? '' : t('practiceDraftPlaceholder'),
              'aria-label': t('practiceDraftLabel'),
              spellCheck: false,
              onChange: onPracticeTextChange,
            }),
            locked ? h('div', { className: 'essay-desk-review' },
              h('div', { className: 'essay-desk-review-title' }, t('practiceReview')),
              review
                ? h('div', { className: 'essay-desk-review-body' }, review)
                : h('div', { className: 'essay-desk-practice-hint' }, t('practiceWaitingReview')),
              points > 0
                ? h('div', { className: 'essay-desk-review-points' }, fmt(t('practicePointsEarned'), { n: points }))
                : null) : null));
      }

      // 练习设置弹窗：关键词 / 推送时间 / 启用开关。
      function buildSettingsModal() {
        const patchForm = function (patch) {
          setSettingsForm(Object.assign({}, settingsForm, patch));
        };
        return h('div', {
          className: 'essay-desk-modal',
          role: 'presentation',
          onMouseDown: function (event) {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          },
        },
        h('div', {
          className: 'essay-desk-modal-box',
          role: 'dialog',
          'aria-modal': true,
          'aria-label': t('practiceSettingsTitle'),
        },
        h('div', { className: 'essay-desk-modal-title' }, t('practiceSettingsTitle')),
        h('div', { className: 'essay-desk-field essay-desk-field-row' },
          h('span', { className: 'essay-desk-field-label' }, t('practiceEnabled')),
          h('input', {
            type: 'checkbox',
            className: 'essay-desk-switch',
            checked: !!settingsForm.enabled,
            'aria-label': t('practiceEnabled'),
            onChange: function (event) { patchForm({ enabled: event.target.checked }); },
          })),
        h('div', { className: 'essay-desk-field' },
          h('span', { className: 'essay-desk-field-label' }, t('practiceTime')),
          h('input', {
            type: 'time',
            className: 'essay-desk-input essay-desk-input-time',
            value: settingsForm.time,
            step: 60,
            onChange: function (event) { patchForm({ time: event.target.value }); },
          }),
          h('span', { className: 'essay-desk-field-hint' }, t('practiceTimeHint'))),
        h('div', { className: 'essay-desk-field' },
          h('span', { className: 'essay-desk-field-label' }, t('practiceKeywords')),
          h('textarea', {
            className: 'essay-desk-input essay-desk-textarea-settings',
            value: settingsForm.keywords,
            placeholder: t('practiceKeywordsPlaceholder'),
            'aria-label': t('practiceKeywords'),
            spellCheck: false,
            onChange: function (event) { patchForm({ keywords: event.target.value }); },
          }),
          h('span', { className: 'essay-desk-field-hint' }, t('practiceKeywordsHint'))),
        h('div', { className: 'essay-desk-modal-actions' },
          h('button', {
            type: 'button',
            className: 'essay-desk-btn',
            disabled: settingsSaving,
            onClick: function () { setSettingsOpen(false); },
          }, t('practiceCancel')),
          h('button', {
            type: 'button',
            className: 'essay-desk-btn essay-desk-btn-primary',
            disabled: settingsSaving,
            onClick: function () { saveSettings(); },
          }, settingsSaving ? t('saving') : t('save')))));
      }

      const draftItems = drafts.map(function (draft) {
        const on = selectedDraftId != null && selectedDraftId === draft.id;
        const day = monthDay(draft.updated);
        return h('button', {
          key: draft.id,
          type: 'button',
          className: 'essay-desk-item' + (on ? ' essay-desk-item-on' : ''),
          title: draft.title || t('untitled'),
          onClick: function () { openDraft(draft); },
        },
        h('span', { className: 'essay-desk-item-title' }, draft.title || t('untitled')),
        h('span', { className: 'essay-desk-item-meta' },
          day ? h('span', { className: 'essay-desk-chip' }, day) : null,
          h('span', { className: 'essay-desk-chip' }, fmt(t('chars'), { n: draft.chars }))));
      });

      const topicItems = topics.map(function (topic) {
        const on = selectedTopicName != null && selectedTopicName === topic.name;
        return h('button', {
          key: topic.name,
          type: 'button',
          className: 'essay-desk-item' + (on ? ' essay-desk-item-on' : ''),
          title: topic.name,
          onClick: function () { openTopic(topic); },
        },
        h('span', { className: 'essay-desk-item-row' },
          h('span', { className: 'essay-desk-item-title' }, topic.name),
          h('span', { className: 'essay-desk-item-count' }, fmt(t('topicCount'), { n: topic.count }))));
      });

      let mainContent = null;
      if (selectedPracticeId != null) {
        if (practiceView && practiceView.id === selectedPracticeId) {
          mainContent = buildPracticeView();
        } else if (practiceTaskLoading) {
          mainContent = h('div', { className: 'essay-desk-placeholder' }, t('practiceTaskLoading'));
        } else {
          mainContent = h('div', { className: 'essay-desk-placeholder' }, t('practiceTaskFailed'));
        }
      } else if (editor) {
        let statusText;
        if (editor.status === 'saving') {
          statusText = t('saving');
        } else if (editor.status === 'dirty') {
          statusText = t('unsaved');
        } else if (!editor.id) {
          statusText = t('unsaved');
        } else {
          const timeText = clock(editor.savedAt || editor.updated);
          statusText = timeText ? fmt(t('savedAt'), { time: timeText }) : t('saved');
        }
        const chars = editor.text.length;
        const saveDisabled = editor.status === 'saving' || (!editor.id && !editor.title.trim() && !editor.text.trim());
        mainContent = h('div', { className: 'essay-desk-editor' },
          h('div', { className: 'essay-desk-editor-head' },
            h('input', {
              ref: titleRef,
              className: 'essay-desk-title-input',
              type: 'text',
              value: editor.title,
              placeholder: t('untitled'),
              'aria-label': t('titleLabel'),
              spellCheck: false,
              onChange: onTitleChange,
            }),
            h('div', { className: 'essay-desk-editor-actions' },
              h('button', {
                type: 'button',
                className: 'essay-desk-btn essay-desk-btn-primary',
                disabled: saveDisabled,
                onClick: function () { saveDraft(); },
              }, t('save')),
              h('button', {
                type: 'button',
                className: 'essay-desk-btn essay-desk-btn-danger',
                disabled: !editor.id || editor.status === 'saving',
                onClick: function () { removeDraft(); },
              }, t('delete')))),
          h('div', { className: 'essay-desk-meta' },
            h('span', null, fmt(t('chars'), { n: chars })),
            h('span', null, '·'),
            h('span', { className: 'essay-desk-status-' + (editor.status === 'dirty' ? 'unsaved' : editor.status) }, statusText)),
          h('textarea', {
            className: 'essay-desk-textarea',
            value: editor.text,
            placeholder: t('bodyPlaceholder'),
            'aria-label': t('bodyLabel'),
            spellCheck: false,
            onChange: onTextChange,
          }),
          h('div', { className: 'essay-desk-hint' }, t('autosaveHint')));
      } else if (readView) {
        mainContent = h('div', { className: 'essay-desk-read' },
          h('div', { className: 'essay-desk-read-head' },
            h('h2', { className: 'essay-desk-read-title' }, readView.title || t('notesItem')),
            h('span', { className: 'essay-desk-badge' }, t('readonlyBy'))),
          h('div', { className: 'essay-desk-read-body' },
            readBlocks || h('div', { className: 'essay-desk-empty-mini' },
              readView.kind === 'notes' ? t('notesEmpty') : t('topicEmpty'))));
      } else {
        mainContent = h('div', { className: 'essay-desk-placeholder' }, t('emptyEditor'));
      }

      const summary = [
        t('workshop'),
        fmt(t('draftsCount'), { n: draftsTotal }),
        fmt(t('topicsCount'), { n: topicsTotal }),
      ].join(' · ');

      return h('div', { className: 'essay-desk-root' },
        h('style', null, CSS),
        h('header', { className: 'essay-desk-head' },
          h('div', { className: 'essay-desk-head-main' },
            h('h1', { className: 'essay-desk-title' }, t('title')),
            h('span', { className: 'essay-desk-slogan' }, t('slogan')),
            h('span', { className: 'essay-desk-sub' }, summary)),
          h('div', { className: 'essay-desk-head-actions' },
            h('span', {
              className: 'essay-desk-points-chip',
              title: t('practiceSection'),
            }, fmt(t('practicePointsShort'), { n: practiceTotalPoints })),
            h('button', {
              type: 'button',
              className: 'essay-desk-btn',
              title: t('practiceSettings'),
              onClick: function () { openSettings(); },
            }, t('practiceSettings')),
            h('button', {
              type: 'button',
              className: 'essay-desk-btn',
              title: t('refresh'),
              onClick: function () { refreshAll(); },
            }, t('refresh')),
            h('button', {
              type: 'button',
              className: 'essay-desk-btn essay-desk-btn-primary',
              onClick: function () { newDraft(); },
            }, t('newEssay')))),
        error ? h('div', { className: 'essay-desk-error', role: 'alert' }, error) : null,
        h('div', { className: 'essay-desk-body' },
          h('aside', { className: 'essay-desk-side' },
            h('div', { className: 'essay-desk-sec' },
              h('span', null, t('practiceSection')),
              h('span', { className: 'essay-desk-points-badge' },
                fmt(t('practicePointsShort'), { n: practiceTotalPoints }))),
            practice
              ? (practiceItems.length
                ? practiceItems
                : h('div', { className: 'essay-desk-empty-mini' }, t('practiceEmpty')))
              : (loading ? h('div', { className: 'essay-desk-loading' }, t('loading')) : null),
            h('div', { className: 'essay-desk-sec' },
              h('span', null, t('drafts')),
              h('span', { className: 'essay-desk-sec-count' }, '(' + draftsTotal + ')')),
            h('div', { className: 'essay-desk-tip' }, t('hintClassify')),
            loading && !state ? h('div', { className: 'essay-desk-loading' }, t('loading')) : null,
            !loading && !drafts.length ? h('div', { className: 'essay-desk-empty-mini' }, t('draftsEmpty')) : null,
            draftItems,
            h('div', { className: 'essay-desk-sec' },
              h('span', null, t('topics')),
              h('span', { className: 'essay-desk-sec-count' }, '(' + topicsTotal + ')')),
            !topics.length ? h('div', { className: 'essay-desk-empty-mini' }, t('topicsEmpty')) : null,
            topicItems,
            h('button', {
              type: 'button',
              className: 'essay-desk-item' + (notesSelected ? ' essay-desk-item-on' : ''),
              onClick: function () { openNotes(); },
            },
            h('span', { className: 'essay-desk-item-row' },
              h('span', { className: 'essay-desk-item-title' }, t('notesItem'))))),
          h('div', { className: 'essay-desk-main' }, mainContent)),
        h('footer', { className: 'essay-desk-foot', title: root },
          fmt(t('footerRoot'), { root: root || '—' })),
        settingsOpen ? buildSettingsModal() : null);
    }

    // ---------------------------------------------------------------------
    // 侧栏图标（24×24 viewBox，随 size 缩放，stroke=currentColor）
    // ---------------------------------------------------------------------
    function EssayIcon(props) {
      const size = props && props.size != null ? props.size : 16;
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: 'false',
      },
      h('path', { d: 'M5 3.5h9.2L19 8.3v12.2H5z' }),
      h('path', { d: 'M14 3.5V8h5' }),
      h('path', { d: 'M8 12h8' }),
      h('path', { d: 'M8 15.5h5.5' }));
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(function () {
          return ctx.locale.register(NS, { zh: zh, en: en });
        }, 'dsh-essay-desk: dictionaries');

        const t = ctx.locale.bind(NS);

        ctx.slots.inject('main', function () {
          return ctx.slots.register({
            name: 'main',
            key: 'essay-desk',
            locale: NS,
            inject: function () { return { t: t }; },
          }, function () {
            return h(EssayPanel, { t: t });
          });
        });

        ctx.slots.inject('sidebar.panellist', function () {
          return ctx.slots.register({
            name: 'sidebar.panellist',
            id: 'essay-desk',
            order: 2,
            label: function () { return t('nav'); },
            locale: NS,
          }, function (owner) {
            const props = owner || {};
            return h(EssayIcon, { size: props.size != null ? props.size : 16 });
          });
        });
      },
    };
  },
});

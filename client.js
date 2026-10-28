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
    };

    const en = {
      nav: 'Essays',
      title: 'Essays',
      workshop: 'Essay Desk',
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

      // 把最新值镜像到 ref，供稳定的 useCallback / 定时器读取。
      latestEditorRef.current = editor;
      selectionRef.current = selection;

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

      const newDraft = useCallback(function () {
        flushIfDirty();
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
      }, [flushIfDirty, focusTitle]);

      const openDraft = useCallback(async function (item) {
        const selected = selectionRef.current;
        const current = latestEditorRef.current;
        if (selected && selected.kind === 'draft' && selected.id === item.id && current && current.id === item.id) {
          return;
        }
        const previousSelection = selected || null;
        flushIfDirty();
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
      }, [flushIfDirty, restoreAfterFailedOpen, t]);

      const openTopic = useCallback(async function (topic) {
        const previousSelection = selectionRef.current || null;
        flushIfDirty();
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
      }, [flushIfDirty, restoreAfterFailedOpen, t]);

      const openNotes = useCallback(async function () {
        const previousSelection = selectionRef.current || null;
        flushIfDirty();
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
      }, [flushIfDirty, restoreAfterFailedOpen, t]);

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

      // 挂载时拉一次 state；卸载时清理挂起 timer。
      useEffect(function () {
        mountedRef.current = true;
        refresh();
        return function () {
          mountedRef.current = false;
          clearTimeout(focusTimerRef.current);
        };
      }, [refresh]);

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

      // Ctrl/Cmd+S 保存。
      useEffect(function () {
        function onKeyDown(event) {
          if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
          if (event.key !== 's' && event.key !== 'S') return;
          if (!latestEditorRef.current) return;
          event.preventDefault();
          saveDraft();
        }
        document.addEventListener('keydown', onKeyDown);
        return function () {
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [saveDraft]);

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
      if (editor) {
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
            h('span', { className: 'essay-desk-sub' }, summary)),
          h('div', { className: 'essay-desk-head-actions' },
            h('button', {
              type: 'button',
              className: 'essay-desk-btn',
              title: t('refresh'),
              onClick: function () { refresh(); },
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
          fmt(t('footerRoot'), { root: root || '—' })));
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

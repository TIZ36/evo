/**
 * evo-memory native Web panel (DSH client-plugin half).
 *
 * Plain-JS ModuleLoader bundle. Surfaces:
 *   - Settings → Memory page (settings.section): full explorer — scope tree,
 *     kind tabs, search, list, and per-memory detail.
 *   - Composer "evo" chip (conversation.input.left): self-upgrade mark with the
 *     evo wordmark; spins while processing and toggles the corner card.
 *   - Corner card (shell.overlay): a compact Codex-style panel pinned to the
 *     top-right of the conversation area — scope chips + memory list + detail.
 *   - Ambient process line (conversation.composer.dock) while reflecting.
 *
 * Data comes from the host API at /evo-memory/*.
 */
window.__ModuleLoader__.load({
  id: 'evo-memory',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    var IconClose = primitives.IconCloseOutline16
    var useState = React.useState
    var useEffect = React.useEffect
    var useCallback = React.useCallback

    var API = '/evo-memory'
    var KINDS = ['fact', 'preference', 'constraint', 'procedure', 'skill']

    function h(type, props) {
      var children = Array.prototype.slice.call(arguments, 2)
      return React.createElement.apply(React, [type, props].concat(children))
    }

    function api(path, options) {
      return fetch(API + path, options).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' on ' + path)
        return res.json()
      })
    }

    function fmtTime(ts) {
      if (!ts) return ''
      return new Date(ts).toLocaleString()
    }

    function shortId(value, max) {
      var text = String(value || '')
      return text.length > max ? text.slice(0, max) + '…' : text
    }

    var KIND_COLORS = {
      fact: '#4a9eff',
      preference: '#9d7bff',
      constraint: '#ff8f4a',
      procedure: '#3fbf8f',
      skill: '#ff5c8a',
    }

    function kindBadge(kind) {
      var color = KIND_COLORS[kind] || '#8a8a8a'
      return h('span', {
        className: 'evo-kind',
        style: { color: color, background: 'color-mix(in srgb, ' + color + ' 12%, transparent)' },
      }, kind)
    }

    // ── shared store: chip ↔ card ↔ dock ──────────────────────────────────
    var evoStore = { cardOpen: false, busy: false, listeners: [] }
    function setEvoStore(part) {
      var changed = false
      for (var key in part) {
        if (evoStore[key] !== part[key]) { evoStore[key] = part[key]; changed = true }
      }
      if (changed) evoStore.listeners.forEach(function (fn) { fn() })
    }
    function subscribeEvoStore(fn) {
      evoStore.listeners.push(fn)
      return function () {
        evoStore.listeners = evoStore.listeners.filter(function (other) { return other !== fn })
      }
    }

    // ── styles ────────────────────────────────────────────────────────────
    function ensureEvoStyle() {
      if (document.getElementById('evo-memory-composer-css')) return
      var tag = document.createElement('style')
      tag.id = 'evo-memory-composer-css'
      tag.dataset.plugin = 'evo-memory'
      tag.textContent =
        '@keyframes evo-pulse { 0%, 100% { opacity: 0.3 } 50% { opacity: 1 } }' +
        '@keyframes evo-spin { to { transform: rotate(360deg) } }' +
        '@keyframes evo-card-in { from { opacity: 0; transform: translateX(10px) scale(0.98) } to { opacity: 1; transform: none } }' +
        // chip
        '.evo-chip{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 8px;' +
        'border:1px solid var(--dsw-alias-border-l2,#d8d8d8);background:transparent;border-radius:7px;cursor:pointer;' +
        'color:var(--dsw-alias-label-secondary,#555);font:inherit;font-size:12px;font-weight:500;' +
        'transition:background .15s var(--ds-ease-in-out,ease-out),border-color .15s var(--ds-ease-in-out,ease-out),' +
        'color .15s var(--ds-ease-in-out,ease-out),transform .1s ease-out;}' +
        '.evo-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}' +
        '.evo-chip:active{transform:scale(.96)}' +
        '.evo-chip:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:2px}' +
        '.evo-chip[data-active=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));border-color:var(--dsw-alias-border-l1,#c9c9c9)}' +
        '.evo-chip[data-busy=true]{color:var(--dsw-alias-state-business-primary,#4a9eff);' +
        'border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 45%,transparent)}' +
        '.evo-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;' +
        'border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a8a);border-radius:6px;cursor:pointer;' +
        'transition:background .15s var(--ds-ease-in-out,ease-out),color .15s var(--ds-ease-in-out,ease-out)}' +
        '.evo-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#262626)}' +
        '.evo-iconbtn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:1px}' +
        '.evo-spin{animation:evo-spin 1.15s linear infinite}' +
        '.evo-spark{animation:evo-pulse 1.15s ease-in-out infinite}' +
        // corner card
        '.evo-card{animation:evo-card-in .18s var(--ds-ease-in-out,ease-out);' +
        'position:fixed;top:72px;right:24px;z-index:91;width:min(360px,calc(100vw - 32px));max-height:min(70vh,620px);overflow:auto;' +
        'border:1px solid var(--dsw-alias-border-l2,#d8d8d8);background:var(--dsw-alias-bg-overlay,#ffffff);' +
        'border-radius:12px;box-shadow:var(--dsw-shadow-lv1,0 12px 40px rgba(0,0,0,0.18));' +
        'padding:12px 14px;color:var(--dsw-alias-label-primary,#262626);font-family:inherit}' +
        '.evo-card-head{display:flex;align-items:center;gap:7px;margin:0 0 10px}' +
        '.evo-card-title{font-size:12px;font-weight:600;letter-spacing:.2px}' +
        '.evo-card-status{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}' +
        '.evo-card-spacer{flex:1}' +
        '.evo-chips{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px}' +
        '.evo-chip-mini{height:24px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2,#d8d8d8);background:transparent;' +
        'color:var(--dsw-alias-label-secondary,#555);border-radius:999px;font:inherit;font-size:11px;cursor:pointer;' +
        'transition:background .15s var(--ds-ease-in-out,ease-out),color .15s var(--ds-ease-in-out,ease-out),border-color .15s var(--ds-ease-in-out,ease-out)}' +
        '.evo-chip-mini:hover{color:var(--dsw-alias-label-primary,#262626)}' +
        '.evo-chip-mini:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:1px}' +
        '.evo-chip-mini[data-active=true]{background:var(--dsw-alias-bg-layer-1,#fff);border-color:var(--dsw-alias-border-l1,#c9c9c9);' +
        'color:var(--dsw-alias-state-business-primary,#4a9eff);font-weight:500}' +
        '.evo-card-hint{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a);border-top:1px solid var(--dsw-alias-border-l1,#e4e4e4);' +
        'padding-top:8px;margin-top:8px}' +
        '.evo-turninfo{display:flex;align-items:center;gap:7px;width:100%;padding:5px 0;border:none;background:transparent;' +
        'color:var(--dsw-alias-label-tertiary,#8a8a8a);font:inherit;font-size:11px;text-align:left;cursor:pointer;' +
        'transition:color .15s var(--ds-ease-in-out,ease-out)}' +
        '.evo-turninfo:hover{color:var(--dsw-alias-label-primary,#262626)}' +
        '.evo-turninfo:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:2px;border-radius:4px}' +
        '.evo-turninfo-label{font-weight:600;color:var(--dsw-alias-label-secondary,#555)}' +
        // rows / detail (shared by card + settings explorer)
        '.evo-list{margin:0}' +
        '.evo-row{display:flex;align-items:center;gap:8px;width:100%;border:none;border-bottom:1px solid var(--dsw-alias-border-l1,#e4e4e4);' +
        'background:transparent;color:var(--dsw-alias-label-primary,#262626);padding:6px 4px;font:inherit;text-align:left;cursor:pointer;' +
        'transition:background .15s var(--ds-ease-in-out,ease-out)}' +
        '.evo-row:last-child{border-bottom:none}' +
        '.evo-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}' +
        '.evo-row:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:-2px}' +
        '.evo-row-title{font-size:13px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}' +
        '.evo-row-time{margin-left:auto;flex:none;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:11px;font-variant-numeric:tabular-nums}' +
        '.evo-kind{flex:none;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600;line-height:16px;letter-spacing:.2px}' +
        '.evo-empty{color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:12px;padding:8px 2px}' +
        '.evo-err{color:var(--dsw-alias-state-error-primary,#e5484d);font-size:12px;margin:0 0 8px}' +
        '.evo-detail{padding:2px 0}' +
        '.evo-back{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 10px;border:none;background:transparent;' +
        'color:var(--dsw-alias-label-tertiary,#8a8a8a);border-radius:6px;font:inherit;font-size:12px;cursor:pointer;margin:0 0 8px;' +
        'transition:background .15s var(--ds-ease-in-out,ease-out),color .15s var(--ds-ease-in-out,ease-out)}' +
        '.evo-back:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#262626)}' +
        '.evo-back:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:1px}' +
        '.evo-dtitle{margin:0 0 8px;font-size:14px;font-weight:600;line-height:20px;overflow-wrap:anywhere}' +
        '.evo-dmeta{display:grid;grid-template-columns:max-content 1fr;gap:3px 12px;margin:0 0 12px;font-size:12px;line-height:18px}' +
        '.evo-dmeta dt{color:var(--dsw-alias-label-tertiary,#8a8a8a)}' +
        '.evo-dmeta dd{margin:0;color:var(--dsw-alias-label-secondary,#555);overflow-wrap:anywhere}' +
        '.evo-dcontent{margin:0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary,#262626);white-space:pre-wrap;overflow-wrap:anywhere}' +
        '.evo-tags{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 0}' +
        '.evo-tag{font-size:11px;color:var(--dsw-alias-label-secondary,#555);border:1px solid var(--dsw-alias-border-l2,#d8d8d8);' +
        'border-radius:5px;padding:0 6px;line-height:18px}' +
        // settings explorer
        '.evo-page{width:100%;max-width:760px;color:var(--dsw-alias-label-primary,#262626);font-family:inherit}' +
        '.evo-head{display:flex;align-items:baseline;gap:10px;margin:0 0 14px}' +
        '.evo-title{margin:0;font-size:15px;font-weight:600;letter-spacing:.1px}' +
        '.evo-meta{min-width:0;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.evo-actions{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none}' +
        '.evo-btn{height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,#d8d8d8);background:transparent;' +
        'color:var(--dsw-alias-label-secondary,#555);border-radius:7px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;' +
        'transition:background .15s var(--ds-ease-in-out,ease-out),border-color .15s var(--ds-ease-in-out,ease-out),color .15s var(--ds-ease-in-out,ease-out)}' +
        '.evo-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}' +
        '.evo-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:1px}' +
        '.evo-btn[data-accent=true]{color:var(--dsw-alias-state-business-primary,#4a9eff);' +
        'border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 45%,transparent)}' +
        '.evo-btn[disabled]{opacity:.45;cursor:default}' +
        '.evo-input{height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,#d8d8d8);background:var(--dsw-alias-bg-layer-1,#fff);' +
        'color:var(--dsw-alias-label-primary,#262626);border-radius:7px;font:inherit;font-size:12px;outline:none;min-width:150px}' +
        '.evo-input:focus-visible{border-color:var(--dsw-alias-state-business-primary,#4a9eff);' +
        'box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 18%,transparent)}' +
        '.evo-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px}' +
        '.evo-tabs{display:flex;gap:6px;flex-wrap:wrap;align-items:center}' +
        '.evo-tab{height:26px;padding:0 10px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a8a);' +
        'border-radius:999px;font:inherit;font-size:12px;cursor:pointer;' +
        'transition:background .15s var(--ds-ease-in-out,ease-out),color .15s var(--ds-ease-in-out,ease-out),border-color .15s var(--ds-ease-in-out,ease-out)}' +
        '.evo-tab:hover{color:var(--dsw-alias-label-primary,#262626)}' +
        '.evo-tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:1px}' +
        '.evo-tab[data-active=true]{background:var(--dsw-alias-bg-layer-1,#fff);border-color:var(--dsw-alias-border-l1,#c9c9c9);' +
        'color:var(--dsw-alias-label-primary,#262626);font-weight:500}' +
        '.evo-scopes{display:flex;flex-direction:column;gap:1px;margin:0 0 14px}' +
        '.evo-scope{display:flex;align-items:center;gap:6px;width:100%;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#555);' +
        'border-radius:6px;padding:3px 8px;font:inherit;font-size:12px;cursor:pointer;text-align:left;' +
        'transition:background .15s var(--ds-ease-in-out,ease-out),color .15s var(--ds-ease-in-out,ease-out)}' +
        '.evo-scope:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}' +
        '.evo-scope:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:-2px}' +
        '.evo-scope[data-active=true]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 10%,transparent);' +
        'color:var(--dsw-alias-state-business-primary,#4a9eff);font-weight:500}' +
        '.evo-scope .evo-count{margin-left:auto;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:11px;font-variant-numeric:tabular-nums}' +
        '.evo-scope[data-active=true] .evo-count{color:var(--dsw-alias-state-business-primary,#4a9eff)}' +
        '.evo-scope-chevron{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border:none;' +
        'background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a8a);border-radius:4px;padding:0;cursor:pointer;flex:none;' +
        'transition:transform .15s var(--ds-ease-in-out,ease-out)}' +
        '.evo-scope-chevron[data-open=true]{transform:rotate(90deg)}' +
        '.evo-scope-chevron:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:-1px}' +
        '.evo-sec{margin:16px 0 8px;font-size:11px;font-weight:600;letter-spacing:.3px;color:var(--dsw-alias-label-secondary,#555)}' +
        '.evo-activity{display:flex;gap:8px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary,#555);' +
        'padding:2px 0;align-items:baseline}' +
        '.evo-activity-dot{flex:none;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#8a8a8a);align-self:center}' +
        '@media (prefers-reduced-motion:reduce){' +
        '.evo-spin,.evo-spark,.evo-pulse{animation:none}.evo-card{animation:none}}'
      document.head.appendChild(tag)
    }

    // ── evo mark (self-upgrade loop) ──────────────────────────────────────
    function EvoMark(props) {
      var busy = props.busy === true
      var size = props.size || 15
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
        className: busy ? 'evo-spin' : '',
      },
        h('path', { d: 'M 10.2 3.29 A 5.2 5.2 0 1 1 5.8 3.29', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
        h('path', { d: 'M 9.88 3.97 L 11.38 3.84 L 10.52 2.61 Z', fill: 'currentColor' }),
        busy ? h('path', { className: 'evo-spark', d: 'M 8 6 L 8.5 7.5 L 10 8 L 8.5 8.5 L 8 10 L 7.5 8.5 L 6 8 L 7.5 7.5 Z', fill: 'currentColor' }) : null)
    }

    function evoDot(busy) {
      return h('span', {
        className: busy ? 'evo-spark' : '',
        style: {
          width: 6, height: 6, borderRadius: '50%', flex: 'none', display: 'inline-block',
          background: busy ? 'var(--dsw-alias-state-business-primary, #4a9eff)' : 'var(--dsw-alias-label-tertiary, #8a8a8a)',
        },
      })
    }

    // ── scope helpers ─────────────────────────────────────────────────────
    function scopeLabel(scope) {
      switch (scope.type) {
        case 'global': return 'global'
        case 'project': {
          var id = String(scope.id || '')
          var base = id.split('/').filter(Boolean).pop() || id
          return 'cwd · ' + base
        }
        case 'session': return 'session · ' + shortId(scope.id, 12)
        case 'user': return 'user · ' + shortId(scope.id, 16)
        case 'conversation': return 'conversation · ' + shortId(scope.id, 12)
        default: return String(scope.type)
      }
    }

    function flattenScopes(nodes) {
      var out = []
      nodes.forEach(function (node) {
        out.push(node)
        ;(node.children || []).forEach(function (child) { out.push(child) })
      })
      return out
    }

    function isRootOrCwd(item) {
      return item.scope && (item.scope.type === 'global' || item.scope.type === 'project')
    }

    function sumScopeCount(nodes) {
      var total = 0
      nodes.forEach(function (node) {
        total += node.count
        total += sumScopeCount(node.children || [])
      })
      return total
    }

    // ── list row + detail ─────────────────────────────────────────────────
    function MemoryRow(props) {
      var item = props.item
      return h('button', {
        className: 'evo-row', onClick: function () { props.onSelect(item) }, title: item.title,
      },
        kindBadge(item.kind),
        h('span', { className: 'evo-row-title' }, item.title),
        h('span', { className: 'evo-row-time' }, fmtTime(item.updatedAt)))
    }

    function MemoryDetail(props) {
      var item = props.item
      var source = item.source || {}
      var scopeText = item.scope ? scopeLabel(item.scope) : '—'
      if (item.scope && item.scope.type !== 'global' && item.scope.parent) {
        scopeText = scopeLabel(item.scope.parent) + ' / ' + scopeText
      }
      return h('div', { className: 'evo-detail' },
        h('button', { className: 'evo-back', onClick: props.onBack }, '← Back'),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
          kindBadge(item.kind),
          h('span', { className: 'evo-meta' }, '#' + String(item.id).slice(0, 8))),
        h('h3', { className: 'evo-dtitle' }, item.title),
        h('dl', { className: 'evo-dmeta' },
          h('dt', null, 'scope'), h('dd', null, scopeText),
          h('dt', null, 'updated'), h('dd', null, fmtTime(item.updatedAt)),
          h('dt', null, 'created'), h('dd', null, fmtTime(item.createdAt)),
          h('dt', null, 'usage'), h('dd', null, String(item.usageCount ?? 0)),
          source.path ? h('dt', null, 'source') : null,
          source.path ? h('dd', null, source.path) : null,
          source.sessionId ? h('dt', null, 'session') : null,
          source.sessionId ? h('dd', null, source.sessionId + (source.turn !== undefined ? ' · turn ' + source.turn : '')) : null,
          source.runtime ? h('dt', null, 'runtime') : null,
          source.runtime ? h('dd', null, source.runtime) : null),
        h('p', { className: 'evo-dcontent' }, item.content),
        item.tags && item.tags.length
          ? h('div', { className: 'evo-tags' }, item.tags.map(function (tag) { return h('span', { key: tag, className: 'evo-tag' }, tag) }))
          : null)
    }

    function eventLabel(event) {
      var payload = event.payload || {}
      switch (event.type) {
        case 'memory.created': return 'created · ' + payload.item.title
        case 'memory.updated': return 'updated · ' + payload.item.title
        case 'memory.deleted': return 'deleted · ' + payload.id
        case 'memory.reflected': {
          var d = payload.delta || {}
          return 'reflected turn ' + payload.turn.turn + ' · +' + (d.created || []).length +
            (d.updated && d.updated.length ? ' ~' + d.updated.length : '') +
            (d.deleted && d.deleted.length ? ' −' + d.deleted.length : '')
        }
        case 'memory.consolidated': return 'consolidated · ' + payload.result.before + ' → ' + payload.result.after
        default: return String(event.type)
      }
    }

    // ── settings page: full explorer ──────────────────────────────────────
    function EvoExplorer(props) {
      var state = useState({
        status: null, roots: [], scopeKey: 'all', selectedScope: null,
        expanded: new Set(), items: [], detail: null, kind: 'all', text: '',
        events: [], error: '', loading: true,
      })
      var s = state[0]
      var set = state[1]
      var patch = function (part) { set(function (prev) { return Object.assign({}, prev, part) }) }

      var loadScopes = useCallback(function () {
        return api('/scopes').then(function (json) {
          var roots = json.roots || []
          var expanded = new Set()
          var collect = function (list) { list.forEach(function (node) { expanded.add(node.key); collect(node.children || []) }) }
          collect(roots)
          patch({ roots: roots, expanded: expanded })
        })
      }, [])

      var loadAll = useCallback(function () {
        patch({ loading: true, error: '' })
        Promise.all([api('/status'), api('/events?limit=6'), api('/memories?limit=300'), loadScopes()])
          .then(function (results) {
            setEvoStore({ busy: !!(results[0] && results[0].busy) })
            patch({ status: results[0], events: results[1].events, items: results[2].items, loading: false })
          })
          .catch(function (err) { patch({ error: String(err.message || err), loading: false }) })
      }, [loadScopes])

      useEffect(function () {
        ensureEvoStyle()
        loadAll()
      }, [loadAll])

      var selectScope = function (node) {
        var key = node ? node.key : 'all'
        patch({ scopeKey: key, selectedScope: node ? node.scope : null, detail: null, loading: true, error: '' })
        var path = key === 'all' ? '/memories?limit=300' : '/memories?scopeKey=' + encodeURIComponent(key) + '&limit=300'
        api(path).then(function (json) {
          patch({ items: json.items, loading: false })
        }).catch(function (err) { patch({ error: String(err.message || err), loading: false }) })
      }

      var toggleScope = function (key) {
        var next = new Set(s.expanded)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        patch({ expanded: next })
      }

      var runConsolidate = function () {
        var scope = s.selectedScope || { type: 'global' }
        var body = scope.type === 'global' ? { scope: scope } : { scope: { type: scope.type, id: scope.id } }
        patch({ loading: true, error: '' })
        api('/consolidate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          .then(function () { loadAll() })
          .catch(function (err) { patch({ error: String(err.message || err), loading: false }) })
      }

      var runImport = function () {
        if (!s.selectedScope || s.selectedScope.type !== 'project') return
        patch({ loading: true, error: '' })
        api('/import-workspace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd: s.selectedScope.id, force: true }) })
          .then(function () { loadAll() })
          .catch(function (err) { patch({ error: String(err.message || err), loading: false }) })
      }

      var filtered = s.items.filter(function (item) {
        if (s.kind !== 'all' && item.kind !== s.kind) return false
        if (s.text && (item.title + ' ' + item.content).toLowerCase().indexOf(s.text.toLowerCase()) < 0) return false
        return true
      })

      return h('div', { className: 'evo-page' },
        h('div', { className: 'evo-head' },
          h('span', { style: { display: 'inline-flex', color: s.status && s.status.busy ? 'var(--dsw-alias-state-business-primary, #4a9eff)' : 'var(--dsw-alias-label-tertiary, #8a8a8a)' } },
            h(EvoMark, { size: 16, busy: !!(s.status && s.status.busy) })),
          h('h2', { className: 'evo-title' }, 'Memory'),
          h('span', { className: 'evo-meta' }, s.status ? s.status.databasePath : ''),
          h('div', { className: 'evo-actions' },
            h('button', {
              className: 'evo-btn', disabled: !s.selectedScope || s.selectedScope.type !== 'project',
              title: s.selectedScope && s.selectedScope.type === 'project' ? 'Re-import ' + s.selectedScope.id : 'Select a project scope to re-import',
              onClick: runImport,
            }, 'Re-import'),
            h('button', { className: 'evo-btn', 'data-accent': 'true', onClick: runConsolidate, disabled: s.loading }, 'Consolidate'),
            h('button', { className: 'evo-btn', onClick: loadAll }, 'Refresh'))),
        s.error ? h('div', { className: 'evo-err' }, s.error) : null,
        h('div', { className: 'evo-sec' }, 'Scopes'),
        h('div', { className: 'evo-scopes' },
          h('div', { style: { display: 'flex', alignItems: 'center' } },
            h('span', { style: { width: 16, flex: 'none' } }),
            h('button', {
              className: 'evo-scope', 'data-active': s.scopeKey === 'all' ? 'true' : 'false',
              onClick: function () { selectScope(null) },
            },
              h('span', null, 'all'),
              h('span', { className: 'evo-count' }, String(sumScopeCount(s.roots))))),
          s.roots.map(function (node) {
            return h(ScopeNode, {
              key: node.key, node: node, depth: 0, selected: s.scopeKey === node.key,
              open: s.expanded.has(node.key), expanded: s.expanded,
              onToggle: toggleScope, onSelect: selectScope,
            })
          })),
        s.detail
          ? h(MemoryDetail, { item: s.detail, onBack: function () { patch({ detail: null }) } })
          : h('div', null,
            h('div', { className: 'evo-toolbar' },
              h('div', { className: 'evo-tabs' },
                ['all'].concat(KINDS).map(function (kind) {
                  return h('button', {
                    key: kind, className: 'evo-tab', 'data-active': s.kind === kind ? 'true' : 'false',
                    onClick: function () { patch({ kind: kind }) },
                  }, kind)
                })),
              h('input', {
                className: 'evo-input', placeholder: 'search memories', value: s.text,
                onChange: function (event) { patch({ text: event.target.value }) },
              })),
            s.loading ? h('div', { className: 'evo-empty' }, 'loading…')
              : filtered.length
                ? h('div', { className: 'evo-list' }, filtered.slice(0, 200).map(function (item) {
                  return h(MemoryRow, { key: item.id, item: item, onSelect: function (selected) { patch({ detail: selected }) } })
                }))
                : h('div', { className: 'evo-empty' }, 'No memories in this scope yet.')),
        h('details', { style: { marginTop: 8 } },
          h('summary', { className: 'evo-sec', style: { cursor: 'pointer', margin: '16px 0 8px' } }, 'Recent activity'),
          s.events && s.events.length
            ? s.events.map(function (event, index) {
              return h('div', { key: index, className: 'evo-activity' },
                h('span', { className: 'evo-activity-dot' }),
                h('span', null, eventLabel(event) + ' · ' + fmtTime(event.createdAt)))
            })
            : h('div', { className: 'evo-empty' }, 'No activity yet.')))
    }

    function ScopeNode(props) {
      var node = props.node
      var depth = props.depth
      var selected = props.selected
      var open = props.open
      var hasChildren = (node.children && node.children.length) > 0
      return h('div', null,
        h('div', { style: { display: 'flex', alignItems: 'center', paddingLeft: depth * 14 } },
          hasChildren
            ? h('button', {
              className: 'evo-scope-chevron', 'data-open': open ? 'true' : 'false',
              onClick: function (event) { event.stopPropagation(); props.onToggle(node.key) },
              'aria-label': 'toggle scope',
            }, h('span', null, '›'))
            : h('span', { style: { width: 16, flex: 'none' } }),
          h('button', {
            className: 'evo-scope', 'data-active': selected ? 'true' : 'false',
            onClick: function () { props.onSelect(node) },
            title: node.scope && node.scope.id ? String(node.scope.id) : '',
          },
            h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, scopeLabel(node.scope)),
            h('span', { className: 'evo-count' }, String(node.count)))),
        open && hasChildren
          ? node.children.map(function (child) {
            return h(ScopeNode, {
              key: child.key, node: child, depth: depth + 1,
              selected: selected === child.key, open: props.expanded.has(child.key),
              expanded: props.expanded, onToggle: props.onToggle, onSelect: props.onSelect,
            })
          })
          : null)
    }

    // ── corner card (Codex-style, top-right of the conversation area) ─────
    function EvoCard() {
      var state = useState({ open: evoStore.cardOpen, busy: evoStore.busy, roots: [], scopeKey: 'all', items: [], detail: null, error: '', loading: false })
      var s = state[0]
      var set = state[1]
      var patch = function (part) { set(function (prev) { return Object.assign({}, prev, part) }) }

      var load = useCallback(function () {
        patch({ loading: true, error: '' })
        Promise.all([api('/scopes'), api('/memories?limit=100')]).then(function (results) {
          var items = (results[1].items || []).filter(isRootOrCwd)
          patch({ roots: results[0].roots || [], items: items, loading: false })
        }).catch(function (err) { patch({ error: String(err.message || err), loading: false }) })
      }, [])

      useEffect(function () {
        ensureEvoStyle()
        var unsubscribe = subscribeEvoStore(function () {
          patch({ open: evoStore.cardOpen, busy: evoStore.busy })
          if (evoStore.cardOpen) load()
        })
        var onKey = function (event) { if (event.key === 'Escape') setEvoStore({ cardOpen: false }) }
        document.addEventListener('keydown', onKey)
        if (evoStore.cardOpen) load()
        return function () { unsubscribe(); document.removeEventListener('keydown', onKey) }
      }, [load])

      var selectScope = function (node) {
        var key = node ? node.key : 'all'
        patch({ scopeKey: key, detail: null, loading: true, error: '' })
        var path = key === 'all' ? '/memories?limit=100' : '/memories?scopeKey=' + encodeURIComponent(key) + '&limit=100'
        api(path).then(function (json) {
          patch({ items: key === 'all' ? (json.items || []).filter(isRootOrCwd) : json.items, loading: false })
        }).catch(function (err) { patch({ error: String(err.message || err), loading: false }) })
      }

      if (!s.open) return null

      var chips = [{ key: 'all', scope: null }].concat(
        flattenScopes(s.roots).filter(function (node) {
          return node.scope && (node.scope.type === 'global' || node.scope.type === 'project')
        }).map(function (node) { return { key: node.key, scope: node } }))

      return h('div', { className: 'evo-card', role: 'dialog', 'aria-label': 'evo-memory' },
          h('div', { className: 'evo-card-head' },
            h('span', { style: { display: 'inline-flex', color: s.busy ? 'var(--dsw-alias-state-business-primary, #4a9eff)' : 'var(--dsw-alias-label-tertiary, #8a8a8a)' } },
              h(EvoMark, { size: 14, busy: s.busy })),
            h('span', { className: 'evo-card-title' }, 'evo memory'),
            h('span', { className: 'evo-card-status' }, evoDot(s.busy), s.busy ? 'reflecting…' : 'idle'),
            h('span', { className: 'evo-card-spacer' }),
            h('button', { className: 'evo-iconbtn', onClick: function () { setEvoStore({ cardOpen: false }) }, 'aria-label': 'Collapse evo memory' }, h(IconClose, { size: 13 }))),
          s.error ? h('div', { className: 'evo-err' }, s.error) : null,
          h('div', { className: 'evo-chips' },
            chips.map(function (chip) {
              var label = chip.scope ? scopeLabel(chip.scope) : 'all'
              return h('button', {
                key: chip.key, className: 'evo-chip-mini', 'data-active': s.scopeKey === chip.key ? 'true' : 'false',
                onClick: function () { selectScope(chip.scope) },
                title: chip.scope && chip.scope.id ? String(chip.scope.id) : '',
              }, label)
            })),
          s.detail
            ? h(MemoryDetail, { item: s.detail, onBack: function () { patch({ detail: null }) } })
            : s.loading
              ? h('div', { className: 'evo-empty' }, 'loading…')
              : s.items.length
                ? h('div', { className: 'evo-list' }, s.items.slice(0, 50).map(function (item) {
                  return h(MemoryRow, { key: item.id, item: item, onSelect: function (selected) { patch({ detail: selected }) } })
                }))
                : h('div', { className: 'evo-empty' }, 'No memories in this scope yet.'),
          h('div', { className: 'evo-card-hint' }, 'Root + cwd memory · Full view in Settings → Memory'))
    }

    // ── composer chip + dock ──────────────────────────────────────────────
    function EvoChip(props) {
      var state = useState({ busy: evoStore.busy, open: evoStore.cardOpen })
      var s = state[0]
      var set = state[1]
      useEffect(function () {
        ensureEvoStyle()
        var unsubscribe = subscribeEvoStore(function () {
          set({ busy: evoStore.busy, open: evoStore.cardOpen })
        })
        var alive = true
        var timer = null
        var poll = function () {
          fetch(API + '/status').then(function (res) { return res.ok ? res.json() : null }).then(function (json) {
            if (!alive) return
            var next = !!(json && json.busy)
            setEvoStore({ busy: next })
            set({ busy: next, open: evoStore.cardOpen })
            timer = setTimeout(poll, 2000)
          }).catch(function () {
            if (!alive) return
            setEvoStore({ busy: false })
            set({ busy: false, open: evoStore.cardOpen })
            timer = setTimeout(poll, 4000)
          })
        }
        timer = setTimeout(poll, 300)
        return function () { alive = false; if (timer !== null) clearTimeout(timer); unsubscribe() }
      }, [])
      return h('button', {
        className: 'evo-chip',
        'data-busy': s.busy ? 'true' : 'false',
        'data-active': s.open ? 'true' : 'false',
        onClick: function () { setEvoStore({ cardOpen: !evoStore.cardOpen }) },
        title: s.busy ? 'evo-memory: processing' : 'evo-memory',
        'aria-label': 'evo-memory',
        'aria-expanded': s.open ? 'true' : 'false',
      },
        h(EvoMark, { size: 15, busy: s.busy }),
        h('span', null, 'evo'),
        h('span', { style: { opacity: 0.62 } }, 'memory'))
    }

    function EvoDock(props) {
      var state = useState(evoStore.busy)
      var busy = state[0]
      var setBusy = state[1]
      useEffect(function () {
        ensureEvoStyle()
        var unsubscribe = subscribeEvoStore(function () { setBusy(evoStore.busy) })
        return unsubscribe
      }, [])
      return h('button', {
        className: 'evo-turninfo',
        onClick: function () { setEvoStore({ cardOpen: !evoStore.cardOpen }) },
        'aria-label': 'Show turninfo and evo memory',
        'aria-expanded': evoStore.cardOpen ? 'true' : 'false',
      },
        h(EvoMark, { size: 12, busy: busy }),
        h('span', { className: 'evo-turninfo-label' }, 'turninfo'),
        h('span', null, busy ? 'evo is updating memory…' : 'evo will use root + cwd memory'))
    }

    // ── slots ─────────────────────────────────────────────────────────────
    function apply(ctx) {
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          { name: 'settings.section', id: 'evo-memory', order: 25, label: function () { return 'Memory' } },
          function () { return h(EvoExplorer, null) })
      })
      ctx.slots.inject('conversation.input.left', function () {
        return ctx.slots.register(
          { name: 'conversation.input.left', id: 'evo-memory', order: 0, label: function () { return 'evo' } },
          EvoChip)
      })
      ctx.slots.inject('conversation.composer.dock', function () {
        return ctx.slots.register(
          { name: 'conversation.composer.dock', id: 'evo-memory', order: 10, label: function () { return 'evo-memory' } },
          EvoDock)
      })
      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register(
          { name: 'shell.overlay', id: 'evo-memory', order: 0, label: function () { return 'evo-memory' } },
          EvoCard)
      })
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})

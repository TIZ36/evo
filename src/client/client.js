/**
 * evo-memory native Web panel (DSH client-plugin half).
 *
 * Plain-JS ModuleLoader bundle. Three surfaces, no overlay:
 *   - Settings → Memory page (settings.section): the ONE place memory is
 *     browsed — scope tree, kind filter, search, list, per-memory detail.
 *   - Composer "evo" chip (conversation.input.left): the hourglass mark plus
 *     wordmark. Status indicator and entry point; clicking opens the Settings
 *     page rather than expanding a second list UI.
 *   - Composer dock line (conversation.composer.dock): present only while evo
 *     is actually reflecting. Idle costs zero vertical space.
 *
 * Brand: the hourglass is the only brand asset. Its coral sand is the only
 * non-host colour in the plugin; everything else rides DSH design tokens.
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
    var Tooltip = primitives.Tooltip
    var useState = React.useState
    var useEffect = React.useEffect
    var useCallback = React.useCallback

    var API = '/evo-memory'
    var KINDS = ['fact', 'preference', 'constraint', 'procedure', 'skill']
    /** Must match the settings.section label below — DOM navigation matches on it. */
    var SECTION_LABEL = 'Memory'

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

    /**
     * Kinds are typographic, not chromatic. A five-colour badge palette turned
     * every list into a tag wall and competed with the one accent that should
     * mean something (evo is working). Weight and letterspacing separate them.
     */
    function kindBadge(kind) {
      return h('span', { className: 'evo-kind' }, kind)
    }

    // ── shared store: chip ↔ dock ─────────────────────────────────────────
    var evoStore = { busy: false, reachable: true, counts: null, listeners: [] }
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

    // ── opening Settings → Memory ─────────────────────────────────────────
    /**
     * DSH exposes no navigation service to client plugins: `openSection(id)` is
     * handed only to `settings.onboarding` registrants (and only while a blank
     * session is onboarding), and the settings panel's open/active state lives
     * in local React state inside the shell. So we drive the DOM instead: click
     * the settings trigger, then the nav row whose text is our section label.
     *
     * Matching is by ARIA role and visible text, never by the shell's hashed CSS
     * module class names, so a DSH restyle does not silently break this. If the
     * shell ever changes shape anyway, every step fails closed and the chip just
     * does nothing — the tooltip still reports status.
     */
    function findSettingsPanel() {
      return document.querySelector('[role="dialog"][aria-modal="true"]')
    }

    function clickSectionRow(panel) {
      var nodes = panel.querySelectorAll('*')
      var deepest = null
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i]
        if ((node.textContent || '').trim() !== SECTION_LABEL) continue
        // Prefer the innermost match: the click bubbles up to the nav row handler.
        if (!deepest || deepest.contains(node)) deepest = node
      }
      if (!deepest) return false
      deepest.click()
      return true
    }

    function openMemorySettings() {
      if (!findSettingsPanel()) {
        var triggers = document.querySelectorAll('button[aria-haspopup="dialog"]')
        if (!triggers.length) return false
        triggers[0].click()
      }
      // The panel mounts asynchronously; poll a few frames, then give up quietly.
      var attempts = 0
      var step = function () {
        var panel = findSettingsPanel()
        if (panel && clickSectionRow(panel)) return
        if (++attempts < 12) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
      return true
    }

    // ── styles ────────────────────────────────────────────────────────────
    function ensureEvoStyle() {
      if (document.getElementById('evo-memory-composer-css')) return
      var tag = document.createElement('style')
      tag.id = 'evo-memory-composer-css'
      tag.dataset.plugin = 'evo-memory'
      tag.textContent =
        // hourglass mark — the only brand asset, and the only non-host colour
        '.evo-glass{display:inline-flex;flex:none;--evo-accent:#ff5c5c}' +
        '@supports (color:oklch(0.68 0.19 21)){.evo-glass{--evo-accent:oklch(0.68 0.19 21)}}' +
        '.evo-glass svg{display:block;transform-origin:50% 50%}' +
        // idle: the sand has run out — only the settled grain in the lower bulb
        '.evo-sand-top{opacity:0;transition:opacity .24s var(--ds-ease-in-out,ease-out)}' +
        '.evo-sand-fall{stroke-dasharray:1.6 8;stroke-dashoffset:-2.5;' +
        'transition:stroke-dashoffset .24s var(--ds-ease-in-out,ease-out)}' +
        // reflecting: full stream, and the glass turns over once every 2.4s
        '.evo-glass[data-busy=true] .evo-sand-top{opacity:1}' +
        '.evo-glass[data-busy=true] .evo-sand-fall{stroke-dasharray:none;stroke-dashoffset:0}' +
        '.evo-glass[data-busy=true] svg{animation:evo-turn 4.8s cubic-bezier(.62,0,.2,1) infinite}' +
        // two 180° turns per cycle, so the loop closes on 360° with no snap-back
        '@keyframes evo-turn{0%,40%{transform:rotate(0deg)}50%,90%{transform:rotate(180deg)}' +
        '100%{transform:rotate(360deg)}}' +
        '@keyframes evo-fade-in{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}' +
        // composer chip: borderless at rest, so idle evo costs nothing visually
        '.evo-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;' +
        'border:none;background:transparent;border-radius:7px;cursor:pointer;' +
        'color:var(--dsw-alias-label-secondary,#555);font:inherit;font-size:12px;font-weight:500;' +
        'transition:background .15s var(--ds-ease-in-out,ease-out),' +
        'color .15s var(--ds-ease-in-out,ease-out),transform .1s ease-out}' +
        '.evo-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));' +
        'color:var(--dsw-alias-label-primary,#262626)}' +
        '.evo-chip:active{transform:scale(.96)}' +
        '.evo-chip:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:2px}' +
        '.evo-chip[data-state=error]{color:var(--dsw-alias-state-error-primary,#e5484d)}' +
        '.evo-chip-sub{opacity:.55}' +
        // composer dock: mounted only while reflecting
        '.evo-dock{display:flex;align-items:center;gap:7px;padding:4px 0;font-size:11px;line-height:18px;' +
        'color:var(--dsw-alias-label-tertiary,#8a8a8a);animation:evo-fade-in .24s var(--ds-ease-in-out,ease-out)}' +
        // rows / detail (settings explorer)
        '.evo-list{margin:0}' +
        '.evo-row{display:flex;align-items:center;gap:8px;width:100%;border:none;border-bottom:1px solid var(--dsw-alias-border-l1,#e4e4e4);' +
        'background:transparent;color:var(--dsw-alias-label-primary,#262626);padding:6px 4px;font:inherit;text-align:left;cursor:pointer;' +
        'transition:background .15s var(--ds-ease-in-out,ease-out)}' +
        '.evo-row:last-child{border-bottom:none}' +
        '.evo-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}' +
        '.evo-row:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:-2px}' +
        '.evo-row-title{font-size:13px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}' +
        '.evo-row-time{margin-left:auto;flex:none;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:11px;font-variant-numeric:tabular-nums}' +
        '.evo-kind{flex:none;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600;line-height:16px;' +
        'letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#8a8a8a);' +
        'background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}' +
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
        '.evo-head{display:flex;align-items:center;gap:9px;margin:0 0 18px}' +
        '.evo-head>.evo-glass{color:var(--dsw-alias-label-secondary,#555)}' +
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
        // Reduced motion keeps the state legible without the turn: busy still
        // shows the full sand stream, it just stops flipping.
        '@media (prefers-reduced-motion:reduce){' +
        '.evo-glass[data-busy=true] svg{animation:none}.evo-dock{animation:none}}'
      document.head.appendChild(tag)
    }

    // ── evo mark: the hourglass ───────────────────────────────────────────
    /**
     * Capped bars, pinched bowls, coral sand. Time settling into sediment is
     * what this plugin does, so the glyph says it directly.
     *
     *   idle       the sand has run out; one settled grain in the lower bulb
     *   busy       full stream, and the glass turns over every 2.4s
     *
     * The frame is `currentColor` so it inherits host text colour in both
     * themes; only the sand carries the evo accent.
     */
    function EvoMark(props) {
      var busy = props.busy === true
      var size = props.size || 15
      var frame = { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }
      return h('span', { className: 'evo-glass', 'data-busy': busy ? 'true' : 'false' },
        h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('path', Object.assign({ d: 'M4.1 2.7 H11.9' }, frame)),
          h('path', Object.assign({ d: 'M4.1 13.3 H11.9' }, frame)),
          h('path', Object.assign({ d: 'M5.5 2.7 C5.5 5.9 8 6.9 8 8 C8 9.1 5.5 10.1 5.5 13.3' }, frame)),
          h('path', Object.assign({ d: 'M10.5 2.7 C10.5 5.9 8 6.9 8 8 C8 9.1 10.5 10.1 10.5 13.3' }, frame)),
          h('path', {
            className: 'evo-sand-top', d: 'M8.75 5.15 C8.25 5.7 8.05 6.3 8.05 6.85',
            stroke: 'var(--evo-accent)', strokeWidth: 1.7, strokeLinecap: 'round',
          }),
          h('path', {
            className: 'evo-sand-fall', d: 'M8 6.8 V10.9',
            stroke: 'var(--evo-accent)', strokeWidth: 1.2, strokeLinecap: 'round',
          })))
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

    /**
     * "root 12 · cwd 43" — what evo will actually pull into the next turn.
     * Lives in the chip tooltip rather than a permanent line of chrome.
     */
    function contextSummary(roots) {
      var counts = { global: 0, project: 0 }
      var walk = function (nodes) {
        nodes.forEach(function (node) {
          if (node.scope && counts[node.scope.type] !== undefined) counts[node.scope.type] += node.count
          walk(node.children || [])
        })
      }
      walk(roots || [])
      return 'root ' + counts.global + ' · cwd ' + counts.project
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
          h(EvoMark, { size: 17, busy: !!(s.status && s.status.busy) }),
          h('h2', { className: 'evo-title' }, SECTION_LABEL),
          h('span', { className: 'evo-meta' }, s.status ? s.status.databasePath : ''),
          h('div', { className: 'evo-actions' },
            h('button', {
              className: 'evo-btn', disabled: !s.selectedScope || s.selectedScope.type !== 'project',
              title: s.selectedScope && s.selectedScope.type === 'project' ? 'Re-import ' + s.selectedScope.id : 'Select a project scope to re-import',
              onClick: runImport,
            }, 'Re-import'),
            h('button', { className: 'evo-btn', 'data-accent': 'true', onClick: runConsolidate, disabled: s.loading }, 'Consolidate'),
            h('button', { className: 'evo-btn', onClick: loadAll }, 'Refresh'))),
        s.error ? h('div', { className: 'evo-err', role: 'alert' }, 'Memory service unreachable — ' + s.error) : null,
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
                className: 'evo-input', placeholder: 'Search memories', 'aria-label': 'Search memories', value: s.text,
                onChange: function (event) { patch({ text: event.target.value }) },
              })),
            s.loading ? h('div', { className: 'evo-empty' }, 'Loading…')
              : filtered.length
                ? h('div', { className: 'evo-list' }, filtered.slice(0, 200).map(function (item) {
                  return h(MemoryRow, { key: item.id, item: item, onSelect: function (selected) { patch({ detail: selected }) } })
                }))
                : h('div', { className: 'evo-empty' },
                  s.text || s.kind !== 'all'
                    ? 'Nothing matches that filter.'
                    : 'evo writes memory after each completed turn. Finish one and it will appear here.')),
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

    // ── status polling (one poller, shared by chip and dock) ──────────────
    /**
     * Idle costs almost nothing, so poll lazily; while evo is reflecting the
     * user is watching the mark, so tighten up. A failed /status is surfaced,
     * not swallowed — silently looking healthy while the service is down is
     * the one thing that would break trust in the mark.
     */
    var POLL_IDLE_MS = 8000
    var POLL_BUSY_MS = 1500
    var pollers = 0
    var pollTimer = null

    function pollStatus() {
      fetch(API + '/status').then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status)
        return res.json()
      }).then(function (json) {
        var busy = !!(json && json.busy)
        setEvoStore({ busy: busy, reachable: true })
        schedulePoll(busy ? POLL_BUSY_MS : POLL_IDLE_MS)
      }).catch(function () {
        setEvoStore({ busy: false, reachable: false })
        schedulePoll(POLL_IDLE_MS)
      })
    }

    function schedulePoll(delay) {
      if (pollTimer !== null) clearTimeout(pollTimer)
      pollTimer = pollers > 0 ? setTimeout(pollStatus, delay) : null
    }

    function useEvoStatus() {
      var state = useState({ busy: evoStore.busy, reachable: evoStore.reachable, counts: evoStore.counts })
      var set = state[1]
      useEffect(function () {
        ensureEvoStyle()
        var unsubscribe = subscribeEvoStore(function () {
          set({ busy: evoStore.busy, reachable: evoStore.reachable, counts: evoStore.counts })
        })
        pollers += 1
        if (pollers === 1) schedulePoll(300)
        return function () {
          pollers -= 1
          if (pollers === 0 && pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null }
          unsubscribe()
        }
      }, [])
      return state[0]
    }

    // ── composer chip + dock ──────────────────────────────────────────────
    /**
     * Status indicator first, entry point second. It does not expand anything:
     * memory is browsed in exactly one place, Settings → Memory.
     */
    function EvoChip() {
      var s = useEvoStatus()

      // Context counts are only needed for the tooltip, so fetch them lazily.
      useEffect(function () {
        if (evoStore.counts) return
        api('/scopes').then(function (json) {
          setEvoStore({ counts: contextSummary(json.roots) })
        }).catch(function () { /* tooltip simply stays generic */ })
      }, [])

      var label = !s.reachable
        ? 'Memory service unreachable'
        : s.busy
          ? 'Distilling this turn into memory…'
          : (s.counts ? s.counts + ' memories in context' : 'Memory in context')

      var button = h('button', {
        className: 'evo-chip',
        'data-state': !s.reachable ? 'error' : s.busy ? 'busy' : 'idle',
        onClick: openMemorySettings,
        'aria-label': 'evo memory — ' + label,
      },
        h(EvoMark, { size: 15, busy: s.busy }),
        h('span', null, 'evo'),
        h('span', { className: 'evo-chip-sub' }, 'memory'))

      return Tooltip ? h(Tooltip, { label: label, side: 'top' }, button) : button
    }

    /** Ambient line under the composer. Mounted only while reflecting. */
    function EvoDock() {
      var s = useEvoStatus()
      if (!s.busy) return null
      return h('div', { className: 'evo-dock', role: 'status' },
        h(EvoMark, { size: 12, busy: true }),
        h('span', null, 'Distilling this turn into memory…'))
    }

    // ── slots ─────────────────────────────────────────────────────────────
    function apply(ctx) {
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          { name: 'settings.section', id: 'evo-memory', order: 25, label: function () { return SECTION_LABEL } },
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
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})

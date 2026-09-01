/**
 * evo native Web panel (DSH client-plugin half).
 *
 * Three surfaces, no overlay:
 *   - Settings → Memory (settings.section): the ONE place memory is browsed.
 *     Two modes, because "reads like a lab notebook" and "holds thousands of
 *     rows" cannot be the same view:
 *       Journal  (default)  a dated stream. Every memory is a *paragraph* —
 *                           kind, title, a 3-line excerpt of the body, and a
 *                           provenance line. Answers "what did evo just learn".
 *       Library  (implicit) entered the moment you search, pick a kind, or
 *                           pick a scope. Dense rows + scope tree. Answers
 *                           "what did I record before".
 *   - Composer "evo" chip (conversation.input.left): status indicator and
 *     entry point. After a reflect lands it briefly shows `+N` — the cheapest
 *     possible answer to "what did evo just remember".
 *   - Composer dock line (conversation.composer.dock): only while reflecting.
 *
 * Brand: the capsule is the only brand asset, its coral fill the only
 * non-host colour. Everything else rides DSH design tokens — no own font,
 * no own palette. The notebook character comes from typographic structure
 * (measure, leading, a hairline timeline), not from a typeface.
 *
 * Data comes from the host API at /evo/*.
 */
window.__ModuleLoader__.load({
  id: 'evo',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    var Tooltip = primitives.Tooltip
    var useState = React.useState
    var useEffect = React.useEffect
    var useCallback = React.useCallback
    var useRef = React.useRef

    var API = '/evo'
    var KINDS = ['fact', 'preference', 'constraint', 'procedure']
    /** Must match the settings.section label below — DOM navigation matches on it. */
    var SECTION_LABEL = 'Memory'
    /** Server-side filtering exists; offset does not. Until it does, this is the ceiling. */
    var PAGE_LIMIT = 300
    var SEARCH_DEBOUNCE_MS = 220
    var RECEIPT_MS = 2600
    /** Panel modes: memories or skills catalog. */
    var MODE_MEMORIES = 'memories'
    var MODE_SKILLS = 'skills'

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

    /** Fetch that returns null on 404 — for optional routes like /skills and /backlog. */
    function apiOptional(path, options) {
      return fetch(API + path, options).then(function (res) {
        if (res.status === 404) return null
        if (!res.ok) throw new Error('HTTP ' + res.status + ' on ' + path)
        return res.json()
      })
    }

    function shortId(value, max) {
      var text = String(value || '')
      return text.length > max ? text.slice(0, max) + '…' : text
    }

    // ── time ──────────────────────────────────────────────────────────────
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    function pad2(n) { return (n < 10 ? '0' : '') + n }
    /** Local midnight of the day `ts` falls in — the key the Journal groups on. */
    function dayStart(ts) {
      var d = new Date(ts)
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    }
    function clockOf(ts) {
      var d = new Date(ts)
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
    }
    function dayLabel(dayTs) {
      var today = dayStart(Date.now())
      if (dayTs === today) return 'Today'
      if (dayTs === today - 86400000) return 'Yesterday'
      var d = new Date(dayTs)
      var label = MONTHS[d.getMonth()] + ' ' + d.getDate()
      return d.getFullYear() === new Date().getFullYear() ? label : label + ', ' + d.getFullYear()
    }
    function fullStamp(ts) {
      if (!ts) return '—'
      var d = new Date(ts)
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + clockOf(ts)
    }
    /** Coarse and honest: this is a "how stale is this" cue, not a precise duration. */
    function relativeTime(ts) {
      if (!ts) return ''
      var delta = Date.now() - ts
      if (delta < 60000) return 'just now'
      if (delta < 3600000) return Math.floor(delta / 60000) + 'm ago'
      if (delta < 86400000) return Math.floor(delta / 3600000) + 'h ago'
      return Math.floor(delta / 86400000) + 'd ago'
    }

    // ── scope ─────────────────────────────────────────────────────────────
    function scopeLabel(scope) {
      if (!scope) return '—'
      switch (scope.type) {
        case 'global': return 'root'
        case 'project': {
          var id = String(scope.id || '')
          var base = id.split('/').filter(Boolean).pop() || id
          return 'cwd · ' + base
        }
        case 'session': return 'session ' + shortId(scope.id, 10)
        case 'user': return 'user · ' + shortId(scope.id, 16)
        case 'conversation': return 'conversation ' + shortId(scope.id, 10)
        default: return String(scope.type)
      }
    }

    /**
     * "root 12 · cwd 43" — the scope-chain candidate count. Deliberately NOT
     * called the recall set: the API has no endpoint for what a turn actually
     * pulls in, and claiming precision we do not have is the one thing that
     * would make this number worse than useless.
     */
    function contextCounts(roots) {
      var counts = { global: 0, project: 0, total: 0 }
      var walk = function (nodes) {
        nodes.forEach(function (node) {
          if (node.scope && counts[node.scope.type] !== undefined) counts[node.scope.type] += node.count
          counts.total += node.count
          walk(node.children || [])
        })
      }
      walk(roots || [])
      return counts
    }

    function sumScopeCount(nodes) {
      var total = 0
      nodes.forEach(function (node) {
        total += node.count
        total += sumScopeCount(node.children || [])
      })
      return total
    }

    /** Flatten the scope tree into render rows so the list stays a plain map. */
    function flattenScopes(nodes, expanded, depth, out) {
      nodes.forEach(function (node) {
        var hasChildren = !!(node.children && node.children.length)
        out.push({ node: node, depth: depth, hasChildren: hasChildren, open: expanded.has(node.key) })
        if (hasChildren && expanded.has(node.key)) flattenScopes(node.children, expanded, depth + 1, out)
      })
      return out
    }

    // ── provenance ────────────────────────────────────────────────────────
    /**
     * Where a memory came from, as a phrase rather than a metadata table.
     * This is the evidence the whole panel exists to show; burying it in a
     * <dl> was the old version's core mistake.
     */
    function originPhrase(item) {
      var source = item.source || {}
      if (source.path) return 'imported from ' + source.path
      if (source.sessionId) {
        var text = 'session ' + shortId(source.sessionId, 10)
        if (source.turn !== undefined) text += ' · turn ' + source.turn
        return text
      }
      return source.runtime ? 'via ' + source.runtime : 'origin unknown'
    }

    function recallPhrase(item) {
      var n = item.usageCount || 0
      return n === 1 ? 'recalled once' : 'recalled ' + n + '×'
    }

    // ── shared store: chip ↔ dock ↔ explorer ──────────────────────────────
    var evoStore = { busy: false, reachable: true, counts: null, receipt: 0 }
    var listeners = []
    function setEvoStore(part) {
      var changed = false
      for (var key in part) {
        if (evoStore[key] !== part[key]) { evoStore[key] = part[key]; changed = true }
      }
      if (changed) listeners.forEach(function (fn) { fn() })
    }
    function subscribeEvoStore(fn) {
      listeners.push(fn)
      return function () { listeners = listeners.filter(function (other) { return other !== fn }) }
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
    /**
     * One injected stylesheet. Everything derives from `--dsw-alias-*` so the
     * plugin follows host theming; the fallbacks only matter if DSH renames a
     * token. DSH ships no radius token, so radii are hard px on purpose.
     */
    function ensureEvoStyle() {
      if (document.getElementById('evo-panel-css')) return
      var tag = document.createElement('style')
      tag.id = 'evo-panel-css'
      tag.dataset.plugin = 'evo'
      tag.textContent = [
        // ── brand mark ────────────────────────────────────────────────────
        '.evo-glass{display:inline-flex;flex:none;line-height:0;--evo-accent:#ff5c5c}',
        '@supports (color:oklch(0.68 0.19 21)){.evo-glass{--evo-accent:oklch(0.68 0.19 21)}}',
        '.evo-glass svg{display:block}',
        // idle: the capsule is full — everything already distilled and stored.
        // The fill is scaled rather than resized: CSS geometry properties on
        // <rect> do not apply reliably, transforms do.
        '.evo-core{fill:currentColor;transform-box:fill-box;transform-origin:left center;' +
          'transition:transform .28s var(--ds-ease-in-out,ease-out),fill .28s var(--ds-ease-in-out,ease-out)}',
        '.evo-glass[data-busy=true] .evo-core{fill:var(--evo-accent);' +
          'animation:evo-fill 2.4s cubic-bezier(.62,0,.2,1) infinite}',
        '@keyframes evo-fill{0%,100%{transform:scaleX(.34)}50%{transform:scaleX(1)}}',
        '@keyframes evo-fade-in{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}',
        '@keyframes evo-entry-in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}',
        '@keyframes evo-receipt-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}',
        '@keyframes evo-skel{0%,100%{opacity:.55}50%{opacity:1}}',

        // ── page shell ────────────────────────────────────────────────────
        '.evo-page{--evo-accent:#ff5c5c;width:100%;max-width:860px;' +
          'color:var(--dsw-alias-label-primary,#262626);font-family:inherit}',
        '@supports (color:oklch(0.68 0.19 21)){.evo-page{--evo-accent:oklch(0.68 0.19 21)}}',

        // ── header ────────────────────────────────────────────────────────
        '.evo-head{display:flex;align-items:center;gap:10px;margin:0 0 24px}',
        '.evo-head>.evo-glass{color:var(--dsw-alias-label-secondary,#555)}',
        '.evo-title{margin:0;font-size:17px;line-height:24px;font-weight:600;letter-spacing:.1px;flex:none}',
        '.evo-dbpath{min-width:0;flex:0 1 auto;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:11px;' +
          'line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}',
        '.evo-actions{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none}',

        '.evo-btn{height:28px;padding:0 11px;border:1px solid var(--dsw-alias-border-l2,#d8d8d8);background:transparent;' +
          'color:var(--dsw-alias-label-secondary,#555);border-radius:7px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;' +
          'transition:background .15s var(--ds-ease-in-out,ease-out),border-color .15s var(--ds-ease-in-out,ease-out),color .15s var(--ds-ease-in-out,ease-out)}',
        '.evo-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#262626)}',
        '.evo-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:1px}',
        '.evo-btn.evo-ghost{border-color:transparent}',
        '.evo-btn[data-accent=true]{color:var(--dsw-alias-state-business-primary,#4a9eff);' +
          'border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 42%,transparent)}',
        '.evo-btn[disabled]{opacity:.42;cursor:default}',

        // ── in-context band ───────────────────────────────────────────────
        '.evo-ctx{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding:9px 12px;' +
          'background:var(--dsw-alias-bg-layer-0,#fafafa);border:1px solid var(--dsw-alias-border-l1,#e4e4e4);' +
          'border-radius:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#555);margin:0 0 24px}',
        '.evo-ctx[data-open=true]{border-radius:8px 8px 0 0;margin-bottom:0}',
        '.evo-ctx .n{color:var(--dsw-alias-label-primary,#262626);font-weight:600;font-variant-numeric:tabular-nums}',
        '.evo-ctx .split{color:var(--dsw-alias-label-tertiary,#8a8a8a);font-variant-numeric:tabular-nums}',
        '.evo-ctx .approx{color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:11px}',
        '.evo-ctx-more{margin-left:auto;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a8a);' +
          'font:inherit;font-size:11px;cursor:pointer;padding:1px 3px;border-radius:4px}',
        '.evo-ctx-more:hover{color:var(--dsw-alias-label-primary,#262626)}',
        '.evo-ctx-more:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:1px}',
        '.evo-ctx-list{margin:0 0 24px;padding:10px 12px 11px;border:1px solid var(--dsw-alias-border-l1,#e4e4e4);' +
          'border-top:none;border-radius:0 0 8px 8px;background:var(--dsw-alias-bg-layer-0,#fafafa)}',
        '.evo-ctx-row{display:flex;gap:9px;align-items:baseline;font-size:12px;line-height:20px;' +
          'color:var(--dsw-alias-label-secondary,#555)}',
        '.evo-ctx-row .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
        '.evo-ctx-row .sc{margin-left:auto;flex:none;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:11px}',

        // ── toolbar ───────────────────────────────────────────────────────
        '.evo-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 16px}',
        '.evo-input{height:28px;padding:0 11px;border:1px solid var(--dsw-alias-border-l2,#d8d8d8);' +
          'background:var(--dsw-alias-bg-layer-0,#fff);color:var(--dsw-alias-label-primary,#262626);' +
          'border-radius:7px;font:inherit;font-size:12px;outline:none;min-width:200px}',
        '.evo-input::placeholder{color:var(--dsw-alias-label-tertiary,#8a8a8a)}',
        '.evo-input:focus-visible{border-color:var(--dsw-alias-state-business-primary,#4a9eff);' +
          'box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 18%,transparent)}',
        '.evo-kinds{display:flex;gap:5px;flex-wrap:wrap;align-items:center}',
        '.evo-tab{height:26px;padding:0 11px;border:1px solid transparent;background:transparent;' +
          'color:var(--dsw-alias-label-tertiary,#8a8a8a);border-radius:999px;font:inherit;font-size:12px;cursor:pointer;' +
          'transition:background .15s var(--ds-ease-in-out,ease-out),color .15s var(--ds-ease-in-out,ease-out),border-color .15s var(--ds-ease-in-out,ease-out)}',
        '.evo-tab:hover{color:var(--dsw-alias-label-primary,#262626)}',
        '.evo-tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:1px}',
        '.evo-tab[data-active=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));' +
          'border-color:var(--dsw-alias-border-l1,#e4e4e4);color:var(--dsw-alias-label-primary,#262626);font-weight:500}',

        // ── kind badge: typographic, never chromatic ───────────────────────
        // A five-colour palette turned every list into a tag wall and competed
        // with the one accent that should mean something (evo is working).
        '.evo-kind{flex:none;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600;line-height:16px;' +
          'letter-spacing:.07em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#8a8a8a);' +
          'background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}',

        // ── Journal ───────────────────────────────────────────────────────
        '.evo-day{margin:0 0 32px}',
        '.evo-day-head{display:flex;align-items:baseline;gap:9px;margin:0 0 12px}',
        '.evo-day-head .d{font-size:11px;font-weight:600;line-height:16px;color:var(--dsw-alias-label-secondary,#555)}',
        '.evo-day-head .c{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-variant-numeric:tabular-nums}',
        '.evo-day-head .rule{flex:1;height:1px;background:var(--dsw-alias-border-l1,#e4e4e4)}',
        // Timeline: a hairline plus node dots. Explicitly not a coloured side
        // stripe — that pattern reads as template, never as intent.
        '.evo-stream{position:relative;padding-left:22px}',
        '.evo-stream::before{content:"";position:absolute;left:4px;top:8px;bottom:8px;width:1px;' +
          'background:var(--dsw-alias-border-l2,#d8d8d8)}',
        '.evo-entry{position:relative;display:block;width:100%;border:none;background:transparent;color:inherit;' +
          'font:inherit;text-align:left;padding:10px;margin:0 0 2px -10px;border-radius:8px;cursor:pointer;' +
          'transition:background .15s var(--ds-ease-in-out,ease-out)}',
        '.evo-entry:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
        '.evo-entry:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:-2px}',
        '.evo-entry::before{content:"";position:absolute;left:-13px;top:19px;width:5px;height:5px;border-radius:50%;' +
          'background:var(--dsw-alias-label-tertiary,#8a8a8a)}',
        // fresh = landed this session (solid coral); pending = in flight (ring).
        '.evo-entry[data-fresh=true]::before{background:var(--evo-accent)}',
        '.evo-entry[data-fresh=true]{animation:evo-entry-in .5s var(--ds-ease-in-out,ease-out)}',
        '.evo-entry.evo-pending{cursor:default}',
        '.evo-entry.evo-pending::before{background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 0 0 1.5px var(--evo-accent)}',
        '.evo-entry-top{display:flex;align-items:center;gap:8px;margin:0 0 5px}',
        '.evo-entry-title{font-size:13.5px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary,#262626);' +
          'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
        // The excerpt is the whole point of the redesign: the list must be
        // readable without a click.
        '.evo-entry-body{margin:0 0 7px;max-width:68ch;font-size:13.5px;line-height:1.65;' +
          'color:var(--dsw-alias-label-secondary,#555);display:-webkit-box;-webkit-line-clamp:3;' +
          '-webkit-box-orient:vertical;overflow:hidden}',
        '.evo-entry-meta{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;font-size:11px;line-height:16px;' +
          'color:var(--dsw-alias-label-tertiary,#8a8a8a);font-variant-numeric:tabular-nums}',
        '.evo-entry-meta .dot{opacity:.45}',
        '.evo-entry-meta .evo-entry-scope{color:var(--dsw-alias-label-secondary,#555)}',
        '.evo-pending-text{font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}',

        // ── Library ───────────────────────────────────────────────────────
        '.evo-lib{display:grid;grid-template-columns:216px minmax(0,1fr);gap:24px;align-items:start}',
        '@media (max-width:720px){.evo-lib{grid-template-columns:minmax(0,1fr)}}',
        '.evo-sec{font-size:11px;font-weight:600;line-height:16px;color:var(--dsw-alias-label-secondary,#555);margin:0 0 8px}',
        '.evo-scopes{display:flex;flex-direction:column;gap:1px}',
        '.evo-scope-row{display:flex;align-items:center}',
        '.evo-scope-chevron{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;' +
          'border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a8a);border-radius:4px;padding:0;cursor:pointer;' +
          'font-size:10px;transition:transform .15s var(--ds-ease-in-out,ease-out)}',
        '.evo-scope-chevron[data-open=true]{transform:rotate(90deg)}',
        '.evo-scope-chevron:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:-1px}',
        '.evo-scope{display:flex;align-items:center;gap:6px;min-width:0;flex:1;border:none;background:transparent;' +
          'color:var(--dsw-alias-label-secondary,#555);border-radius:6px;padding:4px 8px;font:inherit;font-size:12px;' +
          'line-height:18px;cursor:pointer;text-align:left;' +
          'transition:background .15s var(--ds-ease-in-out,ease-out),color .15s var(--ds-ease-in-out,ease-out)}',
        '.evo-scope:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
        '.evo-scope:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:-2px}',
        '.evo-scope .nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.evo-scope .c{margin-left:auto;flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a);' +
          'font-variant-numeric:tabular-nums}',
        '.evo-scope[data-active=true]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 12%,transparent);' +
          'color:var(--dsw-alias-state-business-primary,#4a9eff);font-weight:500}',
        '.evo-scope[data-active=true] .c{color:var(--dsw-alias-state-business-primary,#4a9eff)}',

        '.evo-filters{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 16px}',
        '.evo-chipf{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 5px 0 10px;' +
          'border:1px solid var(--dsw-alias-border-l2,#d8d8d8);border-radius:999px;font-size:11px;' +
          'color:var(--dsw-alias-label-secondary,#555);background:transparent}',
        '.evo-chipf b{font-weight:600;color:var(--dsw-alias-label-primary,#262626)}',
        '.evo-chipf button{border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a8a);' +
          'cursor:pointer;font:inherit;font-size:13px;line-height:1;padding:2px 4px;border-radius:50%}',
        '.evo-chipf button:hover{color:var(--dsw-alias-label-primary,#262626)}',
        '.evo-back-journal{margin-left:auto;border:none;background:transparent;font:inherit;font-size:12px;' +
          'color:var(--dsw-alias-state-business-primary,#4a9eff);cursor:pointer;padding:2px 4px;border-radius:5px}',
        '.evo-back-journal:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:1px}',

        '.evo-rows{display:flex;flex-direction:column}',
        '.evo-row{display:block;width:100%;border:none;background:transparent;color:inherit;font:inherit;text-align:left;' +
          'cursor:pointer;padding:8px 10px;margin:0 -10px;border-radius:7px;' +
          'border-bottom:1px solid var(--dsw-alias-border-l1,#e4e4e4);' +
          'transition:background .15s var(--ds-ease-in-out,ease-out)}',
        '.evo-row:last-child{border-bottom:none}',
        '.evo-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
        '.evo-row:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:-2px}',
        '.evo-row-top{display:flex;align-items:center;gap:8px}',
        '.evo-row-title{font-size:13px;line-height:20px;font-weight:500;min-width:0;' +
          'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.evo-row-time{margin-left:auto;flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a);' +
          'font-variant-numeric:tabular-nums}',
        '.evo-row-body{margin:2px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a8a8a);' +
          'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:72ch}',
        '.evo-mark{background:color-mix(in srgb,var(--evo-accent) 24%,transparent);border-radius:2px;padding:0 1px}',
        '.evo-pager{display:flex;align-items:center;gap:10px;margin:16px 0 0;font-size:11px;' +
          'color:var(--dsw-alias-label-tertiary,#8a8a8a);font-variant-numeric:tabular-nums}',

        // ── detail ────────────────────────────────────────────────────────
        '.evo-detail{max-width:68ch}',
        '.evo-back{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px 0 8px;border:none;' +
          'background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a8a);border-radius:6px;font:inherit;font-size:12px;' +
          'cursor:pointer;margin:0 0 16px;' +
          'transition:background .15s var(--ds-ease-in-out,ease-out),color .15s var(--ds-ease-in-out,ease-out)}',
        '.evo-back:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#262626)}',
        '.evo-back:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:1px}',
        '.evo-dtitle{margin:6px 0 10px;font-size:21px;line-height:30px;font-weight:600;letter-spacing:-.2px;overflow-wrap:anywhere}',
        '.evo-trace{margin:0 0 24px;padding:0 0 16px;border-bottom:1px solid var(--dsw-alias-border-l1,#e4e4e4);' +
          'font-size:12px;line-height:19px;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-variant-numeric:tabular-nums}',
        '.evo-trace b{font-weight:500;color:var(--dsw-alias-label-secondary,#555)}',
        '.evo-dcontent{margin:0;font-size:14px;line-height:1.75;color:var(--dsw-alias-label-primary,#262626);' +
          'white-space:pre-wrap;overflow-wrap:anywhere}',
        '.evo-tags{display:flex;gap:6px;flex-wrap:wrap;margin:16px 0 0}',
        '.evo-tag{font-size:11px;line-height:18px;padding:0 7px;border-radius:5px;color:var(--dsw-alias-label-secondary,#555);' +
          'border:1px solid var(--dsw-alias-border-l2,#d8d8d8)}',
        '.evo-raw{margin:24px 0 0;font-size:12px}',
        '.evo-raw summary{cursor:pointer;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:11px;font-weight:600;' +
          'list-style:none;padding:4px 0}',
        '.evo-raw summary::-webkit-details-marker{display:none}',
        '.evo-raw summary::before{content:"\\203A";display:inline-block;width:11px;' +
          'transition:transform .15s var(--ds-ease-in-out,ease-out)}',
        '.evo-raw[open] summary::before{transform:rotate(90deg)}',
        '.evo-raw dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:3px 14px;margin:6px 0 0;' +
          'font-size:12px;line-height:19px}',
        '.evo-raw dt{color:var(--dsw-alias-label-tertiary,#8a8a8a)}',
        '.evo-raw dd{margin:0;color:var(--dsw-alias-label-secondary,#555);overflow-wrap:anywhere;font-variant-numeric:tabular-nums}',
        '.evo-copyid{margin:16px 0 0;height:26px;padding:0 10px;border-radius:6px;' +
          'border:1px solid var(--dsw-alias-border-l2,#d8d8d8);background:transparent;' +
          'color:var(--dsw-alias-label-tertiary,#8a8a8a);font:inherit;font-size:11px;cursor:pointer}',
        '.evo-copyid:hover{color:var(--dsw-alias-label-primary,#262626)}',

        // ── empty / error / loading ───────────────────────────────────────
        '.evo-empty{max-width:44ch;padding:48px 0}',
        '.evo-empty>.evo-glass{color:var(--dsw-alias-border-l2,#d8d8d8);margin:0 0 16px}',
        '.evo-empty h3{margin:0 0 8px;font-size:13.5px;line-height:20px;font-weight:600}',
        '.evo-empty p{margin:0;font-size:13px;line-height:1.65;color:var(--dsw-alias-label-tertiary,#8a8a8a)}',
        '.evo-empty .evo-btn{margin-top:16px}',
        '.evo-alert{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;padding:10px 12px;margin:0 0 16px;' +
          'border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 40%,var(--dsw-alias-border-l1,#e4e4e4));' +
          'border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 7%,transparent);' +
          'font-size:12px;line-height:19px;color:var(--dsw-alias-state-error-primary,#e5484d)}',
        '.evo-alert code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;' +
          'color:var(--dsw-alias-label-secondary,#555)}',
        '.evo-skel{position:relative;padding-left:22px}',
        '.evo-skel::before{content:"";position:absolute;left:4px;top:8px;bottom:8px;width:1px;' +
          'background:var(--dsw-alias-border-l2,#d8d8d8)}',
        '.evo-sk{margin:0 0 22px}',
        '.evo-sk i{display:block;height:9px;border-radius:4px;margin:0 0 7px;' +
          'background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));' +
          'animation:evo-skel 1.4s var(--ds-ease-in-out,ease-out) infinite}',

        // ── mode toggle: two sections of one notebook, not two apps ─────
        '.evo-modes{display:inline-flex;gap:0;padding:2px;margin:0 0 16px;' +
          'background:var(--dsw-alias-bg-layer-0,#fafafa);border:1px solid var(--dsw-alias-border-l1,#e4e4e4);border-radius:7px}',
        '.evo-mode{height:26px;padding:0 14px;border:none;background:transparent;' +
          'color:var(--dsw-alias-label-tertiary,#8a8a8a);border-radius:5px;font:inherit;font-size:12px;font-weight:500;cursor:pointer;' +
          'transition:background .15s var(--ds-ease-in-out,ease-out),color .15s var(--ds-ease-in-out,ease-out)}',
        '.evo-mode:hover{color:var(--dsw-alias-label-primary,#262626)}',
        '.evo-mode:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:1px}',
        '.evo-mode[data-active=true]{background:var(--dsw-alias-bg-layer-1,#fff);' +
          'box-shadow:0 1px 2px rgba(0,0,0,.06);color:var(--dsw-alias-label-primary,#262626)}',

        // ── skills list: same notebook structure as Journal ─────────────
        // Timeline with hairline + dots, passages not rows, typographic badges.
        '.evo-skill-stream{position:relative;padding-left:22px}',
        '.evo-skill-stream::before{content:"";position:absolute;left:4px;top:8px;bottom:8px;width:1px;' +
          'background:var(--dsw-alias-border-l2,#d8d8d8)}',
        '.evo-skill{position:relative;display:block;width:100%;border:none;background:transparent;color:inherit;' +
          'font:inherit;text-align:left;padding:10px;margin:0 0 2px -10px;border-radius:8px;cursor:pointer;' +
          'transition:background .15s var(--ds-ease-in-out,ease-out)}',
        '.evo-skill:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
        '.evo-skill:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:-2px}',
        '.evo-skill::before{content:"";position:absolute;left:-13px;top:19px;width:5px;height:5px;border-radius:50%;' +
          'background:var(--dsw-alias-label-tertiary,#8a8a8a)}',
        '.evo-skill-top{display:flex;align-items:center;gap:8px;margin:0 0 5px}',
        '.evo-skill-name{font-size:13.5px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary,#262626);' +
          'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.evo-skill-trigger{margin:0 0 7px;max-width:68ch;font-size:13.5px;line-height:1.65;' +
          'color:var(--dsw-alias-label-secondary,#555);display:-webkit-box;-webkit-line-clamp:2;' +
          '-webkit-box-orient:vertical;overflow:hidden}',
        '.evo-skill-meta{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;font-size:11px;line-height:16px;' +
          'color:var(--dsw-alias-label-tertiary,#8a8a8a);font-variant-numeric:tabular-nums}',
        '.evo-skill-meta .evo-skill-scope{color:var(--dsw-alias-label-secondary,#555)}',
        '.evo-skill-meta .path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;' +
          'color:var(--dsw-alias-label-tertiary,#8a8a8a);opacity:.8}',
        '.evo-skill-meta .dot{opacity:.45}',

        // ── backlog chip ────────────────────────────────────────────────
        '.evo-backlog{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:5px;' +
          'font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a);' +
          'background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}',
        '.evo-backlog .n{font-weight:600;color:var(--dsw-alias-label-secondary,#555);font-variant-numeric:tabular-nums}',

        // ── composer chip + dock ──────────────────────────────────────────
        '.evo-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;border:none;' +
          'background:transparent;border-radius:7px;cursor:pointer;color:var(--dsw-alias-label-secondary,#555);' +
          'font:inherit;font-size:12px;font-weight:500;' +
          'transition:background .15s var(--ds-ease-in-out,ease-out),color .15s var(--ds-ease-in-out,ease-out),transform .1s ease-out}',
        '.evo-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#262626)}',
        '.evo-chip:active{transform:scale(.96)}',
        '.evo-chip:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:2px}',
        '.evo-chip[data-state=error]{color:var(--dsw-alias-state-error-primary,#e5484d)}',
        '.evo-chip-sub{opacity:.55}',
        '.evo-chip-receipt{color:var(--evo-accent,#ff5c5c);font-weight:600;font-variant-numeric:tabular-nums;' +
          'animation:evo-receipt-in .4s var(--ds-ease-in-out,ease-out)}',
        '.evo-dock{display:flex;align-items:center;gap:7px;padding:4px 0;font-size:11px;line-height:18px;' +
          'color:var(--dsw-alias-label-tertiary,#8a8a8a);animation:evo-fade-in .24s var(--ds-ease-in-out,ease-out)}',

        // Reduced motion keeps state legible without the movement: busy still
        // shows the coral fill, it just stops sweeping.
        '@media (prefers-reduced-motion:reduce){',
        '.evo-glass[data-busy=true] .evo-core{animation:none;transform:scaleX(.6)}',
        '.evo-dock,.evo-entry[data-fresh=true],.evo-chip-receipt,.evo-sk i{animation:none}}',
      ].join('')
      document.head.appendChild(tag)
    }

    // ── evo mark: the capsule ─────────────────────────────────────────────
    /**
     * A capsule with a fill inside it. What this plugin does is hold things,
     * so the glyph is a container and how full it is.
     *
     *   idle       full fill in host text colour — everything is stored
     *   busy       the fill draws back in coral and refills every 2.4s
     *   hollow     no fill at all — used by the empty state
     *
     * The shell is `currentColor` so it inherits host text colour in both
     * themes; only the fill carries the evo accent, and only while busy.
     */
    function EvoMark(props) {
      var busy = props.busy === true
      var size = props.size || 15
      return h('span', { className: 'evo-glass', 'data-busy': busy ? 'true' : 'false' },
        h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('rect', {
            x: 1, y: 5.25, width: 14, height: 5.5, rx: 2.75,
            stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round',
          }),
          props.hollow ? null : h('rect', { className: 'evo-core', x: 2.6, y: 6.9, width: 10.8, height: 2.2, rx: 1.1 })))
    }

    function kindBadge(kind) {
      return h('span', { className: 'evo-kind' }, kind)
    }

    /** Split a string on a query so matches can be wrapped, without regex escaping. */
    function highlight(text, query) {
      var body = String(text || '')
      if (!query) return body
      var needle = query.toLowerCase()
      var hay = body.toLowerCase()
      var parts = []
      var from = 0
      var at = hay.indexOf(needle)
      var key = 0
      while (at >= 0 && needle.length) {
        if (at > from) parts.push(body.slice(from, at))
        parts.push(h('span', { key: 'm' + key++, className: 'evo-mark' }, body.slice(at, at + needle.length)))
        from = at + needle.length
        at = hay.indexOf(needle, from)
      }
      if (!parts.length) return body
      if (from < body.length) parts.push(body.slice(from))
      return parts
    }

    // ── Journal ───────────────────────────────────────────────────────────
    function JournalEntry(props) {
      var item = props.item
      return h('button', {
        className: 'evo-entry',
        'data-fresh': props.fresh ? 'true' : 'false',
        onClick: function () { props.onSelect(item) },
      },
        h('div', { className: 'evo-entry-top' },
          kindBadge(item.kind),
          h('span', { className: 'evo-entry-title' }, item.title)),
        h('p', { className: 'evo-entry-body' }, item.content),
        h('div', { className: 'evo-entry-meta' },
          h('span', { className: 'evo-entry-scope' }, scopeLabel(item.scope)),
          h('span', { className: 'dot' }, '·'),
          h('span', null, originPhrase(item)),
          h('span', { className: 'dot' }, '·'),
          h('span', null, recallPhrase(item)),
          h('span', { className: 'dot' }, '·'),
          h('span', null, clockOf(item.updatedAt))))
    }

    /** Group by local day, newest first, so the stream reads like a log. */
    function groupByDay(items) {
      var order = []
      var buckets = {}
      items.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt }).forEach(function (item) {
        var day = dayStart(item.updatedAt)
        if (!buckets[day]) { buckets[day] = []; order.push(day) }
        buckets[day].push(item)
      })
      return order.map(function (day) { return { day: day, items: buckets[day] } })
    }

    function Journal(props) {
      var groups = groupByDay(props.items)
      return h('div', null, groups.map(function (group) {
        return h('div', { key: group.day, className: 'evo-day' },
          h('div', { className: 'evo-day-head' },
            h('span', { className: 'd' }, dayLabel(group.day)),
            h('span', { className: 'c' }, group.items.length === 1 ? '1 memory' : group.items.length + ' memories'),
            h('span', { className: 'rule' })),
          h('div', { className: 'evo-stream' },
            props.busy && group.day === groups[0].day
              ? h('div', { className: 'evo-entry evo-pending' },
                h('div', { className: 'evo-entry-top' },
                  h(EvoMark, { size: 13, busy: true }),
                  h('span', { className: 'evo-pending-text' }, 'Distilling this turn into memory…')))
              : null,
            group.items.map(function (item) {
              return h(JournalEntry, {
                key: item.id, item: item, fresh: props.freshIds.has(item.id), onSelect: props.onSelect,
              })
            })))
      }))
    }

    // ── Library ───────────────────────────────────────────────────────────
    function LibraryRow(props) {
      var item = props.item
      return h('button', { className: 'evo-row', onClick: function () { props.onSelect(item) }, title: item.title },
        h('div', { className: 'evo-row-top' },
          kindBadge(item.kind),
          h('span', { className: 'evo-row-title' }, highlight(item.title, props.query)),
          h('span', { className: 'evo-row-time' }, fullStamp(item.updatedAt).slice(0, 10))),
        h('p', { className: 'evo-row-body' }, highlight(item.content, props.query)))
    }

    // ── Skills ─────────────────────────────────────────────────────────
    /**
     * Skill entry in the catalog. Same notebook structure as Journal: a passage
     * with name, trigger excerpt, and provenance metadata. Source/status badges
     * are typographic (uppercase, letter-spaced, neutral) — not emoji or chromatic.
     */
    function SkillRow(props) {
      var skill = props.skill
      return h('button', {
        className: 'evo-skill',
        onClick: function () { props.onSelect && props.onSelect(skill) },
        title: skill.trigger,
      },
        h('div', { className: 'evo-skill-top' },
          h('span', { className: 'evo-kind' }, skill.source || 'evo'),
          h('span', { className: 'evo-skill-name' }, skill.name)),
        h('p', { className: 'evo-skill-trigger' }, skill.trigger),
        h('div', { className: 'evo-skill-meta' },
          h('span', { className: 'evo-skill-scope' }, scopeLabel(skill.scope)),
          h('span', { className: 'dot' }, '·'),
          h('span', null, skill.usageCount === 1 ? '1 use' : (skill.usageCount || 0) + ' uses'),
          skill.path ? h('span', { className: 'dot' }, '·') : null,
          skill.path ? h('span', { className: 'path' }, skill.path) : null))
    }

    function SkillsList(props) {
      var skills = props.skills || []
      if (!skills.length) {
        return h('div', { className: 'evo-empty' },
          h(EvoMark, { size: 26, hollow: true }),
          h('h3', null, 'No skills in this scope'),
          h('p', null, 'Skills come from two sources: SKILL.md files on disk that evo discovers, and ' +
            'reusable procedures that evo distils when it spots a repeatable workflow. Once present, ' +
            'they apply automatically when their trigger matches.'))
      }
      return h('div', { className: 'evo-skill-stream' },
        skills.map(function (skill) {
          return h(SkillRow, { key: skill.name, skill: skill, onSelect: props.onSelect })
        }),
        h('div', { className: 'evo-pager' },
          h('span', null, skills.length === 1 ? '1 skill' : skills.length + ' skills')))
    }

    function ScopeTree(props) {
      var rows = flattenScopes(props.roots, props.expanded, 0, [])
      return h('div', null,
        h('div', { className: 'evo-sec' }, 'Scope'),
        h('div', { className: 'evo-scopes' },
          h('div', { className: 'evo-scope-row' },
            h('span', { style: { width: 16, flex: 'none' } }),
            h('button', {
              className: 'evo-scope', 'data-active': props.scopeKey === 'all' ? 'true' : 'false',
              onClick: function () { props.onSelect(null) },
            },
              h('span', { className: 'nm' }, 'all'),
              h('span', { className: 'c' }, String(props.total)))),
          rows.map(function (row) {
            return h('div', { key: row.node.key, className: 'evo-scope-row', style: { paddingLeft: row.depth * 14 } },
              row.hasChildren
                ? h('button', {
                  className: 'evo-scope-chevron', 'data-open': row.open ? 'true' : 'false',
                  'aria-label': (row.open ? 'Collapse ' : 'Expand ') + scopeLabel(row.node.scope),
                  onClick: function (event) { event.stopPropagation(); props.onToggle(row.node.key) },
                }, '›')
                : h('span', { style: { width: 16, flex: 'none' } }),
              h('button', {
                className: 'evo-scope', 'data-active': props.scopeKey === row.node.key ? 'true' : 'false',
                title: row.node.scope && row.node.scope.id ? String(row.node.scope.id) : '',
                onClick: function () { props.onSelect(row.node) },
              },
                h('span', { className: 'nm' }, scopeLabel(row.node.scope)),
                h('span', { className: 'c' }, String(row.node.count))))
          })))
    }

    // ── detail ────────────────────────────────────────────────────────────
    function MemoryDetail(props) {
      var item = props.item
      var source = item.source || {}
      var copyState = useState('Copy id')
      var copyLabel = copyState[0]
      var setCopyLabel = copyState[1]

      var copyId = function () {
        var done = function () {
          setCopyLabel('Copied')
          setTimeout(function () { setCopyLabel('Copy id') }, 1600)
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(String(item.id)).then(done, function () { setCopyLabel('Copy failed') })
        } else {
          setCopyLabel('Copy unavailable')
        }
      }

      return h('div', { className: 'evo-detail' },
        h('button', { className: 'evo-back', onClick: props.onBack }, '← Back'),
        kindBadge(item.kind),
        h('h3', { className: 'evo-dtitle' }, item.title),
        // Provenance first: this is the evidence, not an afterthought.
        h('p', { className: 'evo-trace' },
          h('b', null, fullStamp(item.createdAt)), ' · ', originPhrase(item),
          ' · ', h('b', null, recallPhrase(item)),
          item.updatedAt && item.updatedAt !== item.createdAt
            ? [' · updated ', h('b', { key: 'u' }, relativeTime(item.updatedAt))]
            : null,
          h('br'),
          'scope ', h('b', null, scopeLabel(item.scope)),
          item.confidence !== undefined ? [' · confidence ', h('b', { key: 'c' }, String(item.confidence))] : null),
        h('p', { className: 'evo-dcontent' }, item.content),
        item.tags && item.tags.length
          ? h('div', { className: 'evo-tags' }, item.tags.map(function (tag) {
            return h('span', { key: tag, className: 'evo-tag' }, tag)
          }))
          : null,
        h('details', { className: 'evo-raw' },
          h('summary', null, 'Raw fields'),
          h('dl', null,
            h('dt', null, 'id'), h('dd', null, String(item.id)),
            h('dt', null, 'runtime'), h('dd', null, source.runtime || '—'),
            source.path ? h('dt', null, 'path') : null,
            source.path ? h('dd', null, source.path) : null,
            h('dt', null, 'created'), h('dd', null, fullStamp(item.createdAt)),
            h('dt', null, 'updated'), h('dd', null, fullStamp(item.updatedAt))),
          // The API is read-only, so the only way to act on a wrong memory is
          // out-of-band. Handing over the id costs nothing and removes the
          // "I can see it but I cannot touch it" dead end.
          h('button', { className: 'evo-copyid', onClick: copyId }, copyLabel)))
    }

    // ── in-context band ───────────────────────────────────────────────────
    function ContextBand(props) {
      var openState = useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      var counts = props.counts
      if (!counts) return null
      var preview = props.items.slice(0, 6)

      return h('div', null,
        h('div', { className: 'evo-ctx', 'data-open': open ? 'true' : 'false' },
          h('span', null, h('span', { className: 'n' }, String(counts.total)), ' heading into the next turn'),
          h('span', { className: 'split' }, 'root ' + counts.global + ' · cwd ' + counts.project),
          // Say what this number is. The API cannot tell us the real recall
          // set, and implying otherwise would be worse than saying nothing.
          h('span', { className: 'approx' }, 'scope-chain candidates, not the exact recall set'),
          h('button', {
            className: 'evo-ctx-more', 'aria-expanded': open ? 'true' : 'false',
            onClick: function () { setOpen(!open) },
          }, open ? 'Hide ‹' : 'Show ›')),
        open
          ? h('div', { className: 'evo-ctx-list' },
            preview.map(function (item) {
              return h('div', { key: item.id, className: 'evo-ctx-row' },
                kindBadge(item.kind),
                h('span', { className: 't' }, item.title),
                h('span', { className: 'sc' }, scopeLabel(item.scope)))
            }),
            props.items.length > preview.length
              ? h('div', { className: 'evo-ctx-row' },
                h('span', { className: 't', style: { fontSize: 11, opacity: .7 } },
                  '…and ' + (props.items.length - preview.length) + ' more'))
              : null)
          : null)
    }

    // ── settings page ─────────────────────────────────────────────────────
    function EvoExplorer() {
      var state = useState({
        status: null, roots: [], scopeKey: 'all', selectedScope: null, expanded: new Set(),
        items: [], detail: null, kind: 'all', text: '', query: '',
        error: '', loading: true, busy: false, freshIds: new Set(),
        mode: MODE_MEMORIES, skills: [], skillsLoading: false, skillsError: '',
        backlog: null, skillsAvailable: true,
      })
      var s = state[0]
      var set = state[1]
      var patch = useCallback(function (part) {
        set(function (prev) { return Object.assign({}, prev, part) })
      }, [])

      var searchTimer = useRef(null)
      var seenIds = useRef(null)

      // Library is not a place you navigate to; it is what the panel becomes
      // once you are looking for something.
      var searching = s.mode === MODE_MEMORIES && !!(s.query || s.kind !== 'all' || s.scopeKey !== 'all')

      var fetchMemories = useCallback(function (opts) {
        var params = ['limit=' + PAGE_LIMIT]
        if (opts.scopeKey && opts.scopeKey !== 'all') params.push('scopeKey=' + encodeURIComponent(opts.scopeKey))
        if (opts.kind && opts.kind !== 'all') params.push('kind=' + encodeURIComponent(opts.kind))
        if (opts.query) params.push('text=' + encodeURIComponent(opts.query))
        return api('/memories?' + params.join('&'))
      }, [])

      var loadScopes = useCallback(function () {
        return api('/scopes').then(function (json) {
          var roots = json.roots || []
          var expanded = new Set()
          var collect = function (list) {
            list.forEach(function (node) { expanded.add(node.key); collect(node.children || []) })
          }
          collect(roots)
          setEvoStore({ counts: contextCounts(roots) })
          return { roots: roots, expanded: expanded }
        })
      }, [])

      var fetchSkills = useCallback(function (opts) {
        opts = opts || {}
        var params = ['limit=' + PAGE_LIMIT, 'includeDormant=true']
        if (opts.scopeKey && opts.scopeKey !== 'all') params.push('scopeKey=' + encodeURIComponent(opts.scopeKey))
        if (opts.query) params.push('text=' + encodeURIComponent(opts.query))
        if (opts.cwd) params.push('cwd=' + encodeURIComponent(opts.cwd))
        return apiOptional('/skills?' + params.join('&'))
      }, [])

      var fetchBacklog = useCallback(function (scope) {
        if (!scope || scope.type === 'global') {
          return apiOptional('/backlog?scopeType=global')
        }
        var params = ['scopeType=' + encodeURIComponent(scope.type)]
        if (scope.id) params.push('scopeId=' + encodeURIComponent(scope.id))
        return apiOptional('/backlog?' + params.join('&'))
      }, [])

      var loadSkills = useCallback(function () {
        patch({ skillsLoading: true, skillsError: '' })
        var cwd = s.selectedScope && s.selectedScope.type === 'project' ? s.selectedScope.id : null
        fetchSkills({ scopeKey: s.scopeKey, query: s.query, cwd: cwd }).then(function (json) {
          if (json === null) {
            patch({ skillsAvailable: false, skills: [], skillsLoading: false })
            return
          }
          patch({ skills: json.skills || [], skillsLoading: false, skillsAvailable: true })
        }).catch(function (err) {
          patch({ skillsError: String(err.message || err), skillsLoading: false })
        })
      }, [patch, fetchSkills, s.scopeKey, s.query, s.selectedScope])

      var loadAll = useCallback(function () {
        patch({ loading: true, error: '' })
        Promise.all([
          api('/status'),
          fetchMemories({ scopeKey: s.scopeKey, kind: s.kind, query: s.query }),
          loadScopes(),
          fetchBacklog(s.selectedScope),
        ]).then(function (results) {
          var items = results[1].items || []
          // Anything unseen since this panel mounted gets the fresh marker once.
          if (!seenIds.current) {
            seenIds.current = new Set(items.map(function (item) { return item.id }))
          }
          var fresh = new Set()
          items.forEach(function (item) { if (!seenIds.current.has(item.id)) fresh.add(item.id) })
          fresh.forEach(function (id) { seenIds.current.add(id) })

          setEvoStore({ busy: !!(results[0] && results[0].busy), reachable: true })
          patch({
            status: results[0], items: items, roots: results[2].roots, expanded: results[2].expanded,
            busy: !!(results[0] && results[0].busy), loading: false, freshIds: fresh,
            backlog: results[3],
          })
        }).catch(function (err) {
          setEvoStore({ reachable: false })
          patch({ error: String(err.message || err), loading: false })
        })
      }, [patch, fetchMemories, loadScopes, fetchBacklog, s.scopeKey, s.kind, s.query, s.selectedScope])

      useEffect(function () {
        ensureEvoStyle()
        loadAll()
        // loadAll is re-created whenever a filter changes, which is exactly
        // when the list needs to be refetched.
      }, [loadAll])

      // Load skills when switching to skills mode or when filters change.
      useEffect(function () {
        if (s.mode === MODE_SKILLS) loadSkills()
      }, [s.mode, loadSkills])

      // Mirror the shared busy flag so the pending entry appears without the
      // explorer running a second poller.
      useEffect(function () {
        return subscribeEvoStore(function () { patch({ busy: evoStore.busy }) })
      }, [patch])

      var onSearchChange = function (event) {
        var value = event.target.value
        patch({ text: value })
        if (searchTimer.current) clearTimeout(searchTimer.current)
        searchTimer.current = setTimeout(function () { patch({ query: value, detail: null }) }, SEARCH_DEBOUNCE_MS)
      }

      var selectScope = function (node) {
        patch({ scopeKey: node ? node.key : 'all', selectedScope: node ? node.scope : null, detail: null })
      }

      var toggleScope = function (key) {
        var next = new Set(s.expanded)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        patch({ expanded: next })
      }

      var clearFilters = function () {
        if (searchTimer.current) clearTimeout(searchTimer.current)
        patch({ text: '', query: '', kind: 'all', scopeKey: 'all', selectedScope: null, detail: null })
      }

      var runConsolidate = function () {
        var scope = s.selectedScope || { type: 'global' }
        var body = scope.type === 'global' ? { scope: { type: 'global' } } : { scope: { type: scope.type, id: scope.id } }
        patch({ loading: true, error: '' })
        api('/consolidate', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        }).then(loadAll).catch(function (err) {
          patch({ error: String(err.message || err), loading: false })
        })
      }

      var runImport = function () {
        if (!s.selectedScope || s.selectedScope.type !== 'project') return
        patch({ loading: true, error: '' })
        api('/import-workspace', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cwd: s.selectedScope.id, force: true }),
        }).then(loadAll).catch(function (err) {
          patch({ error: String(err.message || err), loading: false })
        })
      }

      var backlogChip = s.backlog && s.backlog.replaySize > 0
        ? h('span', { className: 'evo-backlog', title: 'Batches queued for next consolidation' },
            h('span', { className: 'n' }, String(s.backlog.replaySize)),
            ' in backlog')
        : null

      var head = h('div', { className: 'evo-head' },
        h(EvoMark, { size: 17, busy: s.busy }),
        h('h2', { className: 'evo-title' }, SECTION_LABEL),
        h('span', { className: 'evo-dbpath' }, s.status ? s.status.databasePath : ''),
        backlogChip,
        h('div', { className: 'evo-actions' },
          h('button', { className: 'evo-btn evo-ghost', onClick: function () { s.mode === MODE_SKILLS ? loadSkills() : loadAll() } }, 'Refresh'),
          h('button', {
            className: 'evo-btn', disabled: !s.selectedScope || s.selectedScope.type !== 'project',
            title: s.selectedScope && s.selectedScope.type === 'project'
              ? 'Re-import ' + s.selectedScope.id
              : 'Select a project scope to re-import',
            onClick: runImport,
          }, 'Re-import'),
          h('button', {
            className: 'evo-btn', 'data-accent': 'true', onClick: runConsolidate, disabled: s.loading,
          }, 'Consolidate')))

      var modeToggle = h('div', { className: 'evo-modes' },
        h('button', {
          className: 'evo-mode', 'data-active': s.mode === MODE_MEMORIES ? 'true' : 'false',
          onClick: function () { patch({ mode: MODE_MEMORIES }) },
        }, 'Memories'),
        h('button', {
          className: 'evo-mode', 'data-active': s.mode === MODE_SKILLS ? 'true' : 'false',
          onClick: function () { patch({ mode: MODE_SKILLS }) },
        }, 'Skills'))

      var toolbar = s.mode === MODE_MEMORIES
        ? h('div', { className: 'evo-tools' },
            h('input', {
              className: 'evo-input', placeholder: 'Search memories', 'aria-label': 'Search memories',
              value: s.text, onChange: onSearchChange,
            }),
            h('div', { className: 'evo-kinds' },
              ['all'].concat(KINDS).map(function (kind) {
                return h('button', {
                  key: kind, className: 'evo-tab', 'data-active': s.kind === kind ? 'true' : 'false',
                  onClick: function () { patch({ kind: kind, detail: null }) },
                }, kind)
              })))
        : h('div', { className: 'evo-tools' },
            h('input', {
              className: 'evo-input', placeholder: 'Search skills', 'aria-label': 'Search skills',
              value: s.text, onChange: onSearchChange,
            }))

      // ── hard states first ───────────────────────────────────────────────
      if (s.error) {
        return h('div', { className: 'evo-page' }, head,
          h('div', { className: 'evo-alert', role: 'alert' },
            h('span', null, 'Memory service unreachable'),
            h('code', null, s.error)),
          h('div', { className: 'evo-empty' },
            h('h3', null, 'The memory store cannot be read right now'),
            h('p', null, 'evo is neither writing new memories nor injecting old ones while this lasts. ' +
              'Nothing has been forgotten — the service is simply not answering.'),
            h('button', { className: 'evo-btn', onClick: loadAll }, 'Retry')))
      }

      if (s.detail) {
        return h('div', { className: 'evo-page' }, head,
          h(MemoryDetail, { item: s.detail, onBack: function () { patch({ detail: null }) } }))
      }

      if (s.loading) {
        return h('div', { className: 'evo-page' }, head,
          h('div', { className: 'evo-skel' },
            [0, 1, 2].map(function (row) {
              return h('div', { key: row, className: 'evo-sk' },
                h('i', { style: { width: '38%' } }),
                h('i', { style: { width: '88%' } }),
                h('i', { style: { width: '62%' } }),
                h('i', { style: { width: '26%', height: 7 } }))
            })))
      }

      // ── Skills ─────────────────────────────────────────────────────────
      if (s.mode === MODE_SKILLS) {
        if (!s.skillsAvailable) {
          return h('div', { className: 'evo-page' }, head, modeToggle,
            h('div', { className: 'evo-empty' },
              h(EvoMark, { size: 26, hollow: true }),
              h('h3', null, 'Skills endpoint not available'),
              h('p', null, 'The /evo/skills API route is not present on this server. ' +
                'Skills require a newer version of the evo service.')))
        }
        if (s.skillsLoading) {
          return h('div', { className: 'evo-page' }, head, modeToggle,
            h('div', { className: 'evo-skel' },
              [0, 1, 2].map(function (row) {
                return h('div', { key: row, className: 'evo-sk' },
                  h('i', { style: { width: '38%' } }),
                  h('i', { style: { width: '88%' } }),
                  h('i', { style: { width: '26%', height: 7 } }))
              })))
        }
        if (s.skillsError) {
          return h('div', { className: 'evo-page' }, head, modeToggle,
            h('div', { className: 'evo-alert', role: 'alert' },
              h('span', null, 'Failed to load skills'),
              h('code', null, s.skillsError)),
            h('button', { className: 'evo-btn', onClick: loadSkills }, 'Retry'))
        }
        return h('div', { className: 'evo-page' }, head, modeToggle, toolbar,
          h(SkillsList, { skills: s.skills }))
      }

      // ── Library ─────────────────────────────────────────────────────────
      if (searching) {
        var filterChips = []
        if (s.query) {
          filterChips.push(h('span', { key: 'q', className: 'evo-chipf' },
            '“', h('b', null, s.query), '”',
            h('button', {
              'aria-label': 'Clear search',
              onClick: function () {
                if (searchTimer.current) clearTimeout(searchTimer.current)
                patch({ text: '', query: '' })
              },
            }, '×')))
        }
        if (s.kind !== 'all') {
          filterChips.push(h('span', { key: 'k', className: 'evo-chipf' },
            'kind ', h('b', null, s.kind),
            h('button', { 'aria-label': 'Clear kind', onClick: function () { patch({ kind: 'all' }) } }, '×')))
        }
        if (s.scopeKey !== 'all') {
          filterChips.push(h('span', { key: 's', className: 'evo-chipf' },
            'scope ', h('b', null, scopeLabel(s.selectedScope)),
            h('button', {
              'aria-label': 'Clear scope',
              onClick: function () { patch({ scopeKey: 'all', selectedScope: null }) },
            }, '×')))
        }

        return h('div', { className: 'evo-page' }, head, modeToggle,
          h('div', { className: 'evo-lib' },
            h(ScopeTree, {
              roots: s.roots, expanded: s.expanded, scopeKey: s.scopeKey,
              total: sumScopeCount(s.roots), onSelect: selectScope, onToggle: toggleScope,
            }),
            h('div', null,
              toolbar,
              h('div', { className: 'evo-filters' },
                filterChips,
                h('button', { className: 'evo-back-journal', onClick: clearFilters }, '← Back to Journal')),
              s.items.length
                ? h('div', null,
                  h('div', { className: 'evo-rows' }, s.items.map(function (item) {
                    return h(LibraryRow, {
                      key: item.id, item: item, query: s.query,
                      onSelect: function (selected) { patch({ detail: selected }) },
                    })
                  })),
                  h('div', { className: 'evo-pager' },
                    h('span', null, s.items.length >= PAGE_LIMIT
                      ? 'Showing the first ' + PAGE_LIMIT + ' matches — narrow the filters to see the rest'
                      : s.items.length + (s.items.length === 1 ? ' match' : ' matches'))))
                : h('div', { className: 'evo-empty' },
                  h('h3', null, 'No memory matches'),
                  h('p', null, 'Nothing satisfies every filter at once. Dropping one of them usually helps.'),
                  h('button', { className: 'evo-btn', onClick: clearFilters }, 'Clear all filters')))))
      }

      // ── Journal ─────────────────────────────────────────────────────────
      if (!s.items.length) {
        return h('div', { className: 'evo-page' }, head, modeToggle,
          h('div', { className: 'evo-empty' },
            h(EvoMark, { size: 26, hollow: true }),
            h('h3', null, 'No memories yet'),
            h('p', null, 'evo distils facts, preferences, constraints and reusable procedures from every ' +
              'completed turn. Finish one and they appear here in order, each carrying the session and ' +
              'turn it came from.'),
            s.selectedScope && s.selectedScope.type === 'project'
              ? h('button', { className: 'evo-btn', onClick: runImport }, 'Import existing workspace memory')
              : null))
      }

      return h('div', { className: 'evo-page' }, head, modeToggle,
        h(ContextBand, { counts: evoStore.counts, items: s.items }),
        toolbar,
        h(Journal, {
          items: s.items, busy: s.busy, freshIds: s.freshIds,
          onSelect: function (item) { patch({ detail: item }) },
        }),
        h('div', { className: 'evo-pager' },
          h('span', null, s.items.length >= PAGE_LIMIT
            ? 'Showing the ' + PAGE_LIMIT + ' most recent — search to reach older memories'
            : s.items.length + (s.items.length === 1 ? ' memory' : ' memories'))))
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

    /**
     * On the busy→idle edge, ask what the reflect actually produced so the chip
     * can report `+N`. Failure is silent: a missing receipt is a missing nicety,
     * not a status claim.
     */
    function fetchReceipt() {
      api('/events?limit=4').then(function (json) {
        var events = (json && json.events) || []
        for (var i = 0; i < events.length; i++) {
          if (events[i].type !== 'memory.reflected') continue
          var delta = (events[i].payload && events[i].payload.delta) || {}
          var created = (delta.created || []).length
          if (created > 0) {
            setEvoStore({ receipt: created })
            setTimeout(function () { setEvoStore({ receipt: 0 }) }, RECEIPT_MS)
          }
          return
        }
      }).catch(function () { /* no receipt, no claim */ })
    }

    function pollStatus() {
      fetch(API + '/status').then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status)
        return res.json()
      }).then(function (json) {
        var busy = !!(json && json.busy)
        var wasBusy = evoStore.busy
        setEvoStore({ busy: busy, reachable: true })
        if (wasBusy && !busy) fetchReceipt()
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
      var state = useState({
        busy: evoStore.busy, reachable: evoStore.reachable, counts: evoStore.counts, receipt: evoStore.receipt,
      })
      var set = state[1]
      useEffect(function () {
        ensureEvoStyle()
        var unsubscribe = subscribeEvoStore(function () {
          set({
            busy: evoStore.busy, reachable: evoStore.reachable,
            counts: evoStore.counts, receipt: evoStore.receipt,
          })
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
          setEvoStore({ counts: contextCounts(json.roots) })
        }).catch(function () { /* tooltip simply stays generic */ })
      }, [])

      var summary = s.counts ? 'root ' + s.counts.global + ' · cwd ' + s.counts.project + ' in context' : 'Memory in context'
      var label = !s.reachable
        ? 'Memory service unreachable'
        : s.receipt
          ? s.receipt + (s.receipt === 1 ? ' memory' : ' memories') + ' written this turn'
          : s.busy
            ? 'Distilling this turn into memory…'
            : summary

      var button = h('button', {
        className: 'evo-chip',
        'data-state': !s.reachable ? 'error' : s.busy ? 'busy' : 'idle',
        onClick: openMemorySettings,
        'aria-label': 'evo memory — ' + label,
      },
        h(EvoMark, { size: 15, busy: s.busy }),
        h('span', null, 'evo'),
        !s.reachable
          ? h('span', { className: 'evo-chip-sub' }, 'unreachable')
          : s.receipt
            ? h('span', { className: 'evo-chip-receipt' }, '+' + s.receipt)
            : h('span', { className: 'evo-chip-sub' }, 'memory'))

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
          { name: 'settings.section', id: 'evo', order: 25, label: function () { return SECTION_LABEL } },
          function () { return h(EvoExplorer, null) })
      })
      ctx.slots.inject('conversation.input.left', function () {
        return ctx.slots.register(
          { name: 'conversation.input.left', id: 'evo', order: 0, label: function () { return 'evo' } },
          EvoChip)
      })
      ctx.slots.inject('conversation.composer.dock', function () {
        return ctx.slots.register(
          { name: 'conversation.composer.dock', id: 'evo', order: 10, label: function () { return 'evo' } },
          EvoDock)
      })
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})

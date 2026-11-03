/* Foreman homepage: the record, the session timelines and the before-and-after chart.
   Reads data.json written by build.py. Everything in it is anonymous. */
(function () {
  'use strict';

  const TYPES = ['builder', 'responder', 'clerk', 'scout', 'investigator'];
  const CREW = {
    builder: 'Build or fix something whose cause is known, and open a PR',
    investigator: 'Find the cause of a bug or a flaky test, and write the fix brief',
    clerk: 'Merges, conflicts, renumbering, full test runs',
    scout: 'Answer one factual question from the web, docs or code',
    responder: 'Handle one round of a review bot’s findings on a PR',
  };
  // Effort set in each worker's profile (agents/foreman-*.md).
  const EFFORT = { builder: 'medium', investigator: 'high', clerk: 'medium', scout: 'medium', responder: 'high' };
  const $ = (id) => document.getElementById(id);
  const color = (k) => (k === 'lead' ? 'var(--ink-2)' : `var(--t-${TYPES.includes(k) ? k : 'other'})`);
  const fTime = d3.timeFormat('%a %-d %b, %H:%M');
  const fDay = d3.timeFormat('%a %-d %b');
  const fClock = d3.timeFormat('%H:%M');
  const fInt = (n) => Math.round(n).toLocaleString('en-US');
  const fK = (k) => (k >= 1000 ? (k / 1000).toFixed(2).replace(/0$/, '') + 'M' : Math.round(k) + 'k');
  const fPct = (v, d = 0) => (100 * v).toFixed(d) + '%';
  const median = (xs) => d3.median(xs) || 0;
  function fMin(m) {
    if (m < 60) return Math.round(m) + ' min';
    const h = Math.floor(m / 60);
    const r = Math.round(m - h * 60);
    return r ? `${h} h ${r} min` : `${h} h`;
  }

  let data;
  let cur = 0;
  let hideQuiet = true;

  // ---------- DOM helpers ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function legend(id, items) {
    const box = typeof id === 'string' ? $(id) : id;
    box.replaceChildren();
    for (const it of items) {
      const s = el('span');
      const i = el('i', it.kind || '');
      if (it.color) i.style.background = it.color;
      s.append(i, document.createTextNode(it.label));
      box.append(s);
    }
  }

  // ---------- tooltip ----------
  const tip = $('tip');
  function showTip(ev, title, rows) {
    tip.replaceChildren();
    if (title) tip.append(el('div', 'tt', title));
    for (const r of rows) {
      const row = el('div', 'row');
      row.append(el('b', null, r[0]), el('span', null, r[1]));
      tip.append(row);
    }
    tip.hidden = false;
    const pad = 14;
    let x = ev.clientX + pad;
    let y = ev.clientY + pad;
    if (x + tip.offsetWidth > innerWidth - 8) x = ev.clientX - tip.offsetWidth - pad;
    if (y + tip.offsetHeight > innerHeight - 8) y = ev.clientY - tip.offsetHeight - pad;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(8, y) + 'px';
  }
  const hideTip = () => { tip.hidden = true; };

  // ---------- headline numbers ----------
  function renderStats() {
    const f = data.score.foreman;
    $('version').textContent = data.version || '';
    const stats = [
      [fInt(f.workers), 'workers sent, each with one task'],
      [fInt(f.prsOpened), `pull requests opened, ${f.prsMerged} merged so far`],
      [fInt(f.rounds), `review-bot rounds answered, on ${f.prsReviewed} pull requests`],
      [fPct(f.cacheHit, 1), 'of all input tokens read from the cache'],
    ];
    $('stats').replaceChildren(...stats.map(([big, text]) => {
      const d = el('div', 'stat');
      d.append(el('b', null, big), el('span', null, text));
      return d;
    }));
    const sub = [
      [String(f.sessions), `sessions in ${f.repos} repositories`],
      [fInt(f.calls), 'model calls'],
      [(f.tokens / 1e9).toFixed(1) + 'B', 'tokens processed'],
      ['$' + (f.usd / f.workers).toFixed(2), 'per worker task at API prices, lead included'],
    ];
    $('substats').replaceChildren(...sub.map(([b, t]) => {
      const s = el('span');
      s.append(el('b', null, b), document.createTextNode(' ' + t));
      return s;
    }));
  }

  // ---------- the record ----------
  function renderRecord() {
    const f = data.score.foreman;
    const b = data.score.baseline;
    const sr = data.score.sameRepo;
    const perK = (o) => (o.usd / o.lines) * 1000;
    const less = (before, after) => Math.round(100 * (1 - after / before)) + '% less';
    // What Foreman does better, each against the sessions before it.
    const wins = [
      {
        name: 'Cheaper per change',
        why: `In the same repository (${sr.project}), merged work cost less per line changed, even though most PRs now also went through rounds of a review bot.`,
        before: ['$' + perK(sr.baseline).toFixed(2), `per 1,000 lines merged, ${sr.baseline.merged} PRs`],
        after: ['$' + perK(sr.foreman).toFixed(2), `per 1,000 lines merged, ${sr.foreman.merged} PRs`],
        change: less(perK(sr.baseline), perK(sr.foreman)),
      },
      {
        name: 'The cache stays warm',
        why: 'Workers keep a one-hour cache, so a long test run no longer ends in a full rewrite of the context at many times the price of a read.',
        before: [fPct(b.missShare, 1), `of the cost was rewrites, ${b.missN} of them`],
        after: [fPct(f.missShare, 1), `of the cost was rewrites, ${f.missN} of them`],
        change: less(b.missShare, f.missShare),
      },
      {
        name: 'Workers start small',
        why: 'Each profile lists only the tools that worker needs. Whatever an agent starts with, it re-reads on every call.',
        before: [fK(b.startMedian / 1000), 'median context on the first call'],
        after: [fK(f.startMedian / 1000), 'median context on the first call'],
        change: (b.startMedian / f.startMedian).toFixed(1) + '\u00d7 smaller',
      },
      {
        name: 'Workers stay small',
        why: 'One task per worker, and follow-up work goes to a fresh one instead of the one that has grown.',
        before: [fK(b.peakMedian / 1000), `median peak context, ${fPct(b.under200k)} under 200k`],
        after: [fK(f.peakMedian / 1000), `median peak context, ${fPct(f.under200k)} under 200k`],
        change: less(b.peakMedian, f.peakMedian),
      },
    ];
    $('record-lede').textContent = `Each row compares ${f.sessions} sessions and ${fInt(f.workers)} workers under Foreman with ${b.sessions} earlier sessions and ${b.workers} general-purpose agents without it. The sessions ran in Claude Code, where Foreman started.`;
    const card = $('card');
    card.replaceChildren();
    const head = el('div', 'rule head');
    head.append(el('div', null, 'Where it wins'), el('div', null, 'Before'), el('div', null, 'With Foreman'), el('div', null, 'Change'));
    card.append(head);
    for (const r of wins) {
      const row = el('div', 'rule');
      const what = el('div', 'what');
      what.append(el('h3', null, r.name), el('p', 'why', r.why));
      const cell = (v, cls, tag) => {
        const c = el('div', 'val ' + cls);
        c.append(el('span', 'tag', tag), el('b', null, v[0]), el('span', null, v[1]));
        return c;
      };
      row.append(what, cell(r.before, 'before', 'Before'), cell(r.after, 'after', 'With Foreman'), el('div', 'verdict held', r.change));
      card.append(row);
    }

    // Worker mix: one bar, one segment per kind.
    const kinds = [...TYPES, 'other'].filter((k) => f.byType[k]).sort((p, q) => f.byType[q] - f.byType[p]);
    const mix = $('mix');
    mix.replaceChildren(...kinds.map((k) => {
      const i = el('i');
      i.style.flex = f.byType[k] + ' 0 0';
      i.style.background = color(k);
      i.title = `${k}: ${f.byType[k]}`;
      return i;
    }));
    mix.setAttribute('aria-label', 'Workers by kind: ' + kinds.map((k) => `${f.byType[k]} ${k}`).join(', '));
    legend('mix-legend', kinds.map((k) => ({ label: `${k === 'other' ? 'not a Foreman worker' : k} ${f.byType[k]}`, color: color(k) })));
    $('mix-note').textContent = `More than half were responders: one worker per round of review-bot findings, ${(f.rounds / f.prsReviewed).toFixed(1)} rounds per reviewed pull request on average.`;
  }

  // ---------- timeline ----------
  function packRows(items, gapSec) {
    const ends = [];
    return items.map((it) => {
      let r = ends.findIndex((e) => e + gapSec <= it.first);
      if (r < 0) { r = ends.length; ends.push(0); }
      ends[r] = it.last;
      return r;
    });
  }

  function renderTabs() {
    // One row per project, its sessions in order.
    const box = $('tl-tabs');
    const projects = [...new Set(data.sessions.map((s) => s.project))].sort();
    box.replaceChildren(...projects.map((name) => {
      const row = el('div', 'tab-group');
      const tabs = el('div', 'tabs');
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', name + ' sessions');
      data.sessions.forEach((s, i) => {
        if (s.project !== name) return;
        const b = el('button', null, s.label);
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(i === cur));
        b.onclick = () => { cur = i; renderTabs(); renderTimeline(); };
        tabs.append(b);
      });
      row.append(el('span', 'kicker', name), tabs);
      return row;
    }));
  }

  function renderTimeline() {
    const s = data.sessions[cur];
    const box = $('tl-chart');
    box.replaceChildren();
    const W = Math.max(760, box.parentElement.clientWidth);
    const m = { t: 58, r: 12, b: 28, l: 62 };
    const youH = 18;
    const prRowH = 13;
    const leadH = 84;
    const rowH = 34;
    const gapY = 10;
    const span = s.end - s.start;
    const at = (dt) => new Date((s.start + dt) * 1000);

    const byAgent = s.agents.map(() => []);
    for (const c of s.calls) byAgent[c[0]].push(c);
    const lead = s.agents[0];
    const subs = s.agents.slice(1);
    const place = packRows(subs, 600);
    const rows = d3.max(place) + 1;
    // A PR's bar runs while this session worked on it: from its opening, or the first worker on it,
    // to its merge, or the last worker on it.
    const prs = s.prs.map((p) => {
      const mine = subs.filter((a) => a.pr === p.n);
      const from = p.opened >= 0 ? p.opened : d3.min(mine, (a) => a.first);
      const to = p.merged != null && p.merged <= span ? p.merged : d3.max(mine, (a) => a.last);
      // The stretches when at least one worker was on it; between them the PR only waits.
      const busy = [];
      for (const a of [...mine].sort((u, v) => u.first - v.first)) {
        const last = busy[busy.length - 1];
        if (last && a.first <= last[1] + 600) last[1] = Math.max(last[1], a.last);
        else busy.push([a.first, a.last]);
      }
      return { n: p.n, kind: p.kind, lines: p.lines, rounds: p.rounds, merged: p.merged, opened: p.opened, workers: mine.length,
        busy, work: d3.sum(mine, (a) => a.work),
        first: from, last: Math.max(to, from + 60) };
    }).sort((p, q) => p.first - q.first);
    const prPlace = packRows(prs, 900);
    // Clicking a PR bar focuses it: workers on other PRs and the other bars fade.
    let focusPr = null;
    const faded = 0.12;
    const prAt = (my, t) => {
      const r = Math.floor((my - yPr) / (prRowH + 3));
      return prs.find((q, k) => prPlace[k] === r && t >= q.first - 300 && t <= q.last + 300);
    };
    const prRows = (d3.max(prPlace) || 0) + 1;

    // Accumulated cost: the session's API price spread over its calls by their weighted tokens.
    const yCost = m.t;
    const usdPerUnit = s.usd / Math.max(1, d3.sum(s.calls, (c) => c[4]));
    let run = 0;
    const spent = s.calls.map((c) => [c[1], (run += c[4] * usdPerUnit)]);
    const costMax = run || 1;
    const costH = Math.max(56, 14 + 14 * Math.ceil(costMax / 100));  // 14px for every $100
    const spentAt = (t) => { const i = d3.bisector((d) => d[0]).right(spent, t) - 1; return i < 0 ? 0 : spent[i][1]; };
    const yYou = yCost + costH + gapY;
    const yPr = yYou + youH + gapY;
    const prH = prRows * (prRowH + 3);
    const yLead = yPr + prH + gapY;
    const yAg = yLead + leadH + gapY + 4;
    const H = yAg + rows * (rowH + 4) + m.b;

    // Silent breaks: 30 minutes or more with no model call from the lead or any worker.
    const quiet = [];
    for (let k = 1; k < s.calls.length; k++) {
      const a = s.calls[k - 1][1];
      const b = s.calls[k][1];
      if (b - a >= 1800) quiet.push([a, b]);
    }
    // The time scale. With quiet hours hidden it is piecewise: busy time zooms, and each break
    // stays a band 8 pixels wide at any zoom.
    const base = d3.scaleTime().domain([at(-1200), at(span + 1800)]).range([m.l, W - m.r]);
    const band = 8;
    const k0 = (W - m.l - m.r - band * quiet.length) / (span + 3000 - d3.sum(quiet, ([a, b]) => b - a));
    function makeScale(T) {
      if (!hideQuiet || !quiet.length) return T.rescaleX(base);
      const dom = [at(-1200)];
      const rng = [T.applyX(m.l)];
      let busy = 0;
      let prev = -1200;
      quiet.forEach(([a, b], i) => {
        busy += a - prev;
        const v = T.applyX(m.l + busy * k0);
        dom.push(at(a), at(b));
        rng.push(v + band * i, v + band * (i + 1));
        prev = b;
      });
      busy += span + 1800 - prev;
      dom.push(at(span + 1800));
      rng.push(T.applyX(m.l + busy * k0) + band * quiet.length);
      return d3.scaleTime().domain(dom).range(rng);
    }
    let x = makeScale(d3.zoomIdentity);
    const yCtx = (k, top, h, max) => top + h - (h * Math.min(k, max)) / max;

    const present = TYPES.filter((k) => s.byType[k]);
    // Legend in three lines: the agents, a sample PR, and the symbols.
    const lg = $('tl-legend');
    const agentsRow = el('div', 'legend');
    legend(agentsRow, [
      { label: 'lead', color: color('lead') },
      ...present.map((k) => ({ label: k, color: color(k) })),
      ...(s.byType.other ? [{ label: 'not a Foreman worker', color: color('other') }] : []),
    ]);
    // A sample PR with annotation leaders from each part to what it means.
    const prRow = el('div', 'legend pr-sample');
    const ns = 'http://www.w3.org/2000/svg';
    const sample = document.createElementNS(ns, 'svg');
    sample.setAttribute('width', '330');
    sample.setAttribute('height', '68');
    sample.setAttribute('role', 'img');
    sample.setAttribute('aria-label', 'A pull request: a bar while workers are on it, a thin line while it waits, a dot when it merges');
    const leader = (x1, y1, x2, y2) => `<path d="M${x1},${y1}V${y2}H${x2}" style="fill: none; stroke: var(--muted); stroke-width: 1"></path>`;
    const note = (x, y, text, anchor) => `<text class="note-lbl" x="${x}" y="${y}" text-anchor="${anchor}">${text}</text>`;
    sample.innerHTML = '<line x1="10" x2="220" y1="35" y2="35" style="stroke: var(--hat-deep); stroke-width: 1.5"></line>'
      + '<rect x="10" y="29" width="56" height="12" rx="2" style="fill: var(--hat)"></rect>'
      + '<rect x="150" y="29" width="30" height="12" rx="2" style="fill: var(--hat)"></rect>'
      + '<circle cx="220" cy="35" r="4" style="fill: var(--hat-deep); stroke: var(--surface); stroke-width: 1.5"></circle>'
      + '<text class="note-lbl" x="232" y="39">PR 7</text>'
      // Bars: workers on it, bracketed above.
      + leader(38, 29, 38, 17) + leader(165, 29, 165, 17) + '<path d="M38,17H165" style="fill: none; stroke: var(--muted); stroke-width: 1"></path>'
      + note(101, 11, 'workers on it', 'middle')
      // Thin line: open and waiting, below.
      + leader(108, 36, 108, 52) + note(108, 64, 'open, waiting', 'middle')
      // Dot: merged, below right.
      + leader(220, 39, 248, 55) + note(252, 59, 'merged', 'start');
    prRow.append(sample);
    const symRow = el('div', 'legend');
    legend(symRow, [
      { label: 'your message', color: 'var(--ink-2)', kind: 'line' },
      { label: 'lead compacted', kind: 'tri' },
      { label: 'cache rewrite', color: 'var(--missed)', kind: 'dot' },
      { label: 'quiet: no agent working for 30 min or more', color: 'var(--quiet)' },
    ]);
    // Each line in its own frame, with a caption.
    const framed = (caption, row, area) => {
      const box = el('div', 'legend-group ' + area);
      box.append(el('div', 'legend-cap', caption), row);
      return box;
    };
    lg.replaceChildren(framed('Agents', agentsRow, 'lg-agents'), framed('Marks', symRow, 'lg-marks'), framed('Pull requests', prRow, 'lg-pr'));

    const svg = d3.select(box).append('svg').attr('width', W).attr('height', H).attr('role', 'img')
      .attr('aria-label', `Timeline of ${s.label}: the lead, ${subs.length} workers, ${prs.length} pull requests and your messages`);
    svg.append('clipPath').attr('id', 'tl-clip').append('rect').attr('x', m.l).attr('y', 0).attr('width', W - m.l - m.r).attr('height', H);
    const gMain = svg.append('g').attr('clip-path', 'url(#tl-clip)');
    const gTop = svg.append('g');
    const gBot = svg.append('g');
    [['Cost', yCost + 12], ['You', yYou + 12], ['PRs', yPr + 11], ['Lead', yLead + 14], ['Workers', yAg + 14]].forEach(([t, y]) => {
      svg.append('text').attr('class', 'lbl-ink').attr('x', 2).attr('y', y).text(t);
    });
    const hair = (y) => svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y).style('stroke', 'var(--hair)');
    hair(yLead + leadH);
    for (let r = 0; r < rows; r++) hair(yAg + r * (rowH + 4) + rowH);

    // Ticks evenly spaced on screen, skipping any that fall inside a hidden break.
    function ticks() {
      const n = Math.max(3, Math.floor(W / 100));
      if (!hideQuiet) return x.ticks(n);
      const [d0, d1] = [x.invert(m.l), x.invert(W - m.r)];
      const visible = (d3.timeHour.count(d0, d1) || 1);
      const every = [1, 2, 3, 6, 12, 24].find((h) => visible / h <= n * 2.2) || 48;
      const all = d3.timeHour.every(every).range(d0, d1);
      const out = [];
      for (const d of all) {
        const t = d.getTime() / 1000 - s.start;
        if (quiet.some(([a, b]) => t > a && t < b)) continue;
        if (out.length && x(d) - x(out[out.length - 1]) < 70) continue;
        out.push(d);
      }
      return out;
    }
    function axis(g, y, bare) {
      const fmt = (d) => (d.getHours() === 0 && d.getMinutes() === 0 ? fDay(d) : fClock(d));
      g.attr('class', 'axis').attr('transform', `translate(0,${y})`)
        .call(d3.axisBottom(x).tickValues(ticks()).tickFormat(fmt).tickSizeOuter(0));
      g.selectAll('.tick text').filter((d) => d.getHours() === 0 && d.getMinutes() === 0).attr('class', 'lbl-ink');
      if (bare) g.selectAll('.domain, .tick line').remove();
    }

    function drawAgent(a, i, top, h, max, label) {
      const calls = byAgent[i];
      const c0 = color(a.k);
      const g = gMain.append('g').style('opacity', focusPr != null && i > 0 && a.pr !== focusPr ? faded : 1);
      // A gap of more than 30 minutes splits the block: the agent was idle.
      const segs = [];
      for (const c of calls) {
        const last = segs[segs.length - 1];
        if (last && c[1] - last[last.length - 1][1] <= 1800) last.push(c);
        else segs.push([c]);
      }
      const area = d3.area().x((c) => x(at(c[1]))).y0(top + h).y1((c) => yCtx(c[2], top, h, max));
      const line = d3.line().x((c) => x(at(c[1]))).y((c) => yCtx(c[2], top, h, max));
      for (const seg of segs) {
        if (seg.length === 1) {
          const y = yCtx(seg[0][2], top, h, max);
          g.append('rect').attr('x', x(at(seg[0][1])) - 1).attr('width', 2).attr('y', y).attr('height', top + h - y).style('fill', c0);
        } else {
          g.append('path').attr('d', area(seg)).style('fill', c0).style('fill-opacity', 0.24);
          g.append('path').attr('d', line(seg)).style('fill', 'none').style('stroke', c0).style('stroke-width', 1.5);
        }
      }
      g.selectAll('circle').data(calls.filter((c) => c[3])).join('circle')
        .attr('cx', (c) => x(at(c[1]))).attr('cy', (c) => yCtx(c[2], top, h, max)).attr('r', 3)
        .style('fill', 'var(--missed)').style('stroke', 'var(--surface)').style('stroke-width', 1.5);
      if (label) {
        const xa = x(at(a.first));
        const xb = x(at(a.last));
        if (xb - xa > a.label.length * 6.4 + 8) g.append('text').attr('class', 'agent-lbl').attr('x', xa + 3).attr('y', top + 10).text(a.label);
      }
    }


    function draw() {
      gMain.selectAll('*').remove();
      // A dimension line over the chart: one duration, matching what the axis shows. With quiet
      // hours hidden the line measures the time agents were working; otherwise the whole session.
      {
        const y = 14;
        const xa = x(at(0));
        const xb = x(at(span));
        const quietSec = d3.sum(quiet, ([a, b]) => b - a);
        const label = hideQuiet && quiet.length
          ? `${fMin((span - quietSec) / 60)} with agents working`
          : `${fMin(span / 60)} from first call to last`;
        const g = svg.select('g.measure').empty() ? svg.append('g').attr('class', 'measure') : svg.select('g.measure');
        g.selectAll('*').remove();
        g.attr('clip-path', 'url(#tl-clip)');
        const line = (x1, y1, x2, y2) => g.append('line').attr('x1', x1).attr('x2', x2).attr('y1', y1).attr('y2', y2)
          .style('stroke', 'var(--ink-2)').style('stroke-width', 1);
        line(xa, y - 6, xa, y + 6);
        line(xb, y - 6, xb, y + 6);
        line(xa, y, xb, y);
        g.append('path').attr('d', `M${xa},${y}l7,-3.5v7z M${xb},${y}l-7,-3.5v7z`).style('fill', 'var(--ink-2)');
        // Keep the label in the visible part of the line.
        const lo = Math.max(xa, m.l);
        const hi = Math.min(xb, W - m.r);
        if (hi - lo > 40) {
          const t = g.append('text').attr('class', 'lbl-ink').attr('x', (lo + hi) / 2).attr('y', y + 4).attr('text-anchor', 'middle').text(label);
          const w = t.node().getComputedTextLength();
          g.insert('rect', 'text').attr('x', (lo + hi) / 2 - w / 2 - 6).attr('y', y - 8).attr('width', w + 12).attr('height', 16)
            .style('fill', 'var(--surface)');
        }
      }
      quiet.forEach(([a, b]) => {
        const xa = x(at(a));
        const xb = x(at(b));
        gMain.append('rect').attr('x', xa).attr('y', yCost - 4).attr('width', xb - xa).attr('height', H - m.b - yCost + 4)
          .style('fill', 'var(--quiet)');
        const lbl = 'quiet ' + fMin((b - a) / 60);
        if (xb - xa > lbl.length * 6.4 + 8) {
          gMain.append('text').attr('class', 'lbl').attr('x', (xa + xb) / 2).attr('y', yAg - 6).attr('text-anchor', 'middle').text(lbl);
        }
      });
      axis(gTop, m.t - 22, true);
      axis(gBot, H - m.b + 4, false);
      const yUsd = (v) => yCost + costH - (costH - 14) * (v / costMax);
      // A hairline at every $100.
      for (let v = 100; v <= costMax; v += 100) {
        gMain.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', yUsd(v)).attr('y2', yUsd(v))
          .style('stroke', 'var(--hair)').style('stroke-dasharray', '2 3');
        gMain.append('text').attr('class', 'lbl').attr('x', m.l + 3).attr('y', yUsd(v) - 2).style('font-size', '9.5px').text('$' + v);
      }
      const step = [[-1200, 0], ...spent, [span + 1800, costMax]];
      gMain.append('path').attr('d', d3.area().curve(d3.curveStepAfter).x((d) => x(at(d[0]))).y0(yCost + costH).y1((d) => yUsd(d[1]))(step))
        .style('fill', 'var(--hat)').style('fill-opacity', 0.25);
      gMain.append('path').attr('d', d3.line().curve(d3.curveStepAfter).x((d) => x(at(d[0]))).y((d) => yUsd(d[1]))(step))
        .style('fill', 'none').style('stroke', 'var(--hat-deep)').style('stroke-width', 1.5);
      gMain.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', yCost + costH).attr('y2', yCost + costH).style('stroke', 'var(--hair)');
      // Label the running total at the right edge of what is in view.
      const tEnd = Math.min(span, x.invert(W - m.r).getTime() / 1000 - s.start);
      const vEnd = spentAt(tEnd);
      gMain.append('text').attr('class', 'lbl-ink').attr('x', Math.min(x(at(tEnd)), W - m.r) - 4).attr('y', yUsd(vEnd) - 4)
        .attr('text-anchor', 'end').text('$' + fInt(vEnd) + (s.usdEstimated ? ' est.' : ''));
      gMain.selectAll('rect.user').data(s.users).join('rect').attr('class', 'user')
        .attr('x', (t) => x(at(t)) - 1).attr('width', 2).attr('y', yYou + 2).attr('height', youH - 5).attr('rx', 1).style('fill', 'var(--ink-2)');
      prs.forEach((p, k) => {
        const y = yPr + prPlace[k] * (prRowH + 3);
        const xa = x(at(p.first));
        const xb = x(at(p.last));
        const pg = gMain.append('g').style('opacity', focusPr != null && p.n !== focusPr ? faded : 1);
        // A thin line while the PR is open, a bar while workers are on it, a dot when it merges.
        pg.append('line').attr('x1', xa).attr('x2', xb).attr('y1', y + prRowH / 2).attr('y2', y + prRowH / 2)
          .style('stroke', 'var(--hat-deep)').style('stroke-width', 1.5);
        p.busy.forEach(([a, b]) => {
          pg.append('rect').attr('x', x(at(a))).attr('y', y + 1).attr('width', Math.max(3, x(at(b)) - x(at(a)))).attr('height', prRowH - 2)
            .attr('rx', 2).style('fill', 'var(--hat)');
        });
        if (p.merged != null && p.merged <= span) {
          pg.append('circle').attr('cx', x(at(p.merged))).attr('cy', y + prRowH / 2).attr('r', 4)
            .style('fill', 'var(--hat-deep)').style('stroke', 'var(--surface)').style('stroke-width', 1.5);
        }
        // The label sits just after the PR's end, only where the row is free until the next PR.
        const lbl = 'PR ' + p.n;
        const next = prs.find((q, j) => j > k && prPlace[j] === prPlace[k]);
        const room = (next ? x(at(next.first)) : W - m.r) - (xb + 8);
        const need = lbl.length * 6.4 + 6;
        // Otherwise just before its start, if the row is free back to the previous PR.
        const prev = prs.slice(0, k).reverse().find((q, j) => prPlace[k - 1 - j] === prPlace[k]);
        const before = xa - 8 - (prev ? x(at(prev.last)) + 52 : m.l);  // leave room for the previous PR's own label
        if (room > need) {
          pg.append('text').attr('class', 'lbl').attr('x', xb + 8).attr('y', y + 10).text(lbl);
        } else if (before > need) {
          pg.append('text').attr('class', 'lbl').attr('x', xa - 6).attr('y', y + 10).attr('text-anchor', 'end').text(lbl);
        }
      });
      drawAgent(lead, 0, yLead, leadH, 1000, false);
      gMain.append('text').attr('class', 'agent-lbl').attr('x', m.l + 4).attr('y', yLead + 11)
        .text(`lead · ${lead.calls} calls · peak ${fK(lead.peak)}`);
      s.compacts.forEach(([t]) => {
        const cx = x(at(t));
        gMain.append('path').attr('d', `M${cx - 5},${yLead + 16}h10l-5,7z`).style('fill', 'var(--ink)');
      });
      subs.forEach((a, k) => drawAgent(a, k + 1, yAg + place[k] * (rowH + 4), rowH, 600, true));
    }
    draw();

    function agentTip(ev, a, i, t) {
      const calls = byAgent[i];
      const c = calls[Math.min(calls.length - 1, Math.max(0, d3.bisector((d) => d[1]).center(calls, t)))];
      const total = d3.sum(s.agents, (d) => d.units);
      const rows = [
        [fK(c[2]), `context at ${fClock(at(c[1]))}`],
        [fK(a.peak), `peak, from ${fK(a.start)} on the first call`],
        [String(a.calls), `calls over ${fMin(a.work)} of work`],
        [fPct(a.units / total, a.units / total < 0.1 ? 1 : 0), 'of this session’s cost'],
      ];
      if (a.pr) rows.push(['PR ' + a.pr, a.round ? `review round ${a.round}` : a.opened ? 'opened by this worker' : 'worked on']);
      if (a.misses) rows.push([String(a.misses), 'cache rewrites']);
      showTip(ev, a.label, rows);
    }

    const overlay = svg.append('rect').attr('x', m.l).attr('y', yCost - 4).attr('width', W - m.l - m.r).attr('height', H - m.b - yCost + 4)
      .style('fill', 'transparent').style('cursor', 'crosshair');
    const focusNote = $('tl-focus') || $('tl-reset').insertAdjacentElement('afterend', el('span', 'note'));
    focusNote.id = 'tl-focus';
    focusNote.textContent = '';
    overlay.on('click', (ev) => {
      const [mx, my] = d3.pointer(ev);
      const t = x.invert(mx).getTime() / 1000 - s.start;
      const p = my >= yPr && my < yPr + prH ? prAt(my, t) : null;
      focusPr = p && p.n !== focusPr ? p.n : null;
      const p2 = prs.find((q) => q.n === focusPr);
      focusNote.textContent = p2 ? `Showing PR ${p2.n}: ${p2.workers} workers. Click it again, or anywhere else, to show all.` : '';
      draw();
    });
    overlay.on('pointermove', (ev) => {
      const [mx, my] = d3.pointer(ev);
      const t = x.invert(mx).getTime() / 1000 - s.start;
      if (my < yCost + costH) {
        if (t >= 0 && t <= span) return showTip(ev, 'Accumulated cost', [['$' + fInt(spentAt(t)), `at API prices by ${fTime(at(t))}`], ['$' + fInt(costMax), 'for the whole session']]);
      } else if (my < yYou + youH) {
        const u = d3.least(s.users, (d) => Math.abs(x(at(d)) - mx));
        if (u != null && Math.abs(x(at(u)) - mx) < 8) return showTip(ev, 'Your message', [[fTime(at(u)), '']]);
      } else if (my >= yPr && my < yPr + prH) {
        const p = prAt(my, t);
        if (p) {
          return showTip(ev, `PR ${p.n} · ${p.kind}`, [
            [p.opened < 0 ? 'earlier' : fTime(at(p.opened)), 'opened'],
            [p.merged == null ? 'open' : fTime(at(p.merged)), p.merged == null ? 'not merged' : 'merged'],
            [fInt(p.lines), 'lines changed'],
            [String(p.rounds), 'review rounds in this session'],
            [String(p.workers), `workers on it, ${fMin(p.work)} of work in all`],
          ]);
        }
      } else if (my >= yLead && my <= yLead + leadH) {
        return agentTip(ev, lead, 0, t);
      } else if (my >= yAg) {
        const r = Math.floor((my - yAg) / (rowH + 4));
        const k = subs.findIndex((a, j) => place[j] === r && t >= a.first - 300 && t <= a.last + 300);
        if (k >= 0) return agentTip(ev, subs[k], k + 1, t);
      }
      const q = quiet.find(([a, b]) => t >= a && t <= b);
      if (q) return showTip(ev, 'Quiet', [[fMin((q[1] - q[0]) / 60), `no agent working, ${fClock(at(q[0]))} to ${fClock(at(q[1]))}`]]);
      hideTip();
    }).on('pointerleave', hideTip);

    const zoom = d3.zoom().scaleExtent([1, 120])
      .translateExtent([[m.l, 0], [W - m.r, H]]).extent([[m.l, 0], [W - m.r, H]])
      .filter((ev) => (ev.type === 'wheel' ? ev.ctrlKey || ev.metaKey : !ev.button))
      .on('zoom', (ev) => { x = makeScale(ev.transform); hideTip(); draw(); });
    overlay.call(zoom);
    $('tl-quiet').checked = hideQuiet;
    $('tl-quiet').onchange = (ev) => { hideQuiet = ev.target.checked; renderTimeline(); };
    $('tl-reset').onclick = () => overlay.transition().duration(300).call(zoom.transform, d3.zoomIdentity);

    // What this session shows.
    const total = d3.sum(s.agents, (a) => a.units);
    const busiest = d3.max(d3.range(0, span, 900), (t) => subs.filter((a) => byAgent[s.agents.indexOf(a)].some((c) => c[1] >= t && c[1] < t + 900)).length);
    const fb = $('tl-findings');
    const finding = (big, text) => {
      const d = el('div', 'finding');
      d.append(el('b', null, big), document.createTextNode(text));
      return d;
    };
    fb.replaceChildren(
      finding(String(subs.length), `workers in ${Math.round(span / 3600)} hours, at most ${busiest} in the same 15 minutes. ${s.prsOpened} pull requests opened, ${s.rounds} review rounds answered.`),
      finding(fK(median(subs.map((a) => a.peak))), `median peak context of a worker, after ${median(subs.map((a) => a.calls))} calls. The largest reached ${fK(d3.max(subs, (a) => a.peak))}.`),
      finding(fPct(lead.units / total), `of the cost went to the lead: ${lead.calls} calls, compacted ${s.compacts.length} times, peak ${fK(lead.peak)}.`),
      finding('$' + fInt(s.usd), `at API prices${s.usdEstimated ? ', estimated from the tokens' : ', as Claude Code recorded it'}. That is $${(s.usd / subs.length).toFixed(2)} per worker task with the lead included.`),
    );
  }

  // ---------- before and after ----------
  function renderPeaks() {
    const f = data.score.foreman;
    const b = data.score.baseline;
    $('peak-lede').textContent = `Each dot is one agent, placed at the largest context it reached. An agent re-reads its whole context on every call, so the further right a dot sits, the more each of its steps cost. Without Foreman the median agent peaked at ${fK(b.peakMedian / 1000)}. With it, the median worker peaks at ${fK(f.peakMedian / 1000)}.`;
    legend('peak-legend', [
      { label: `before: ${b.workers} general-purpose agents`, color: 'var(--before)', kind: 'dot' },
      { label: `Foreman: ${f.workers} workers`, color: 'var(--hat-deep)', kind: 'dot' },
      { label: 'median', color: 'var(--ink)', kind: 'line' },
    ]);
    const box = $('peak-chart');
    box.replaceChildren();
    const W = box.clientWidth;
    const m = { t: 8, r: 16, b: 34, l: 16 };
    const band = 86;
    const H = m.t + band * 2 + 18 + m.b;
    const x = d3.scaleLinear().domain([0, 1000]).range([m.l, W - m.r]);
    const svg = d3.select(box).append('svg').attr('width', W).attr('height', H).attr('role', 'img')
      .attr('aria-label', 'Peak context of every agent, before Foreman and with it');
    const gx = svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).ticks(W < 560 ? 5 : 10).tickFormat((d) => (d ? fK(d) : '0')).tickSizeOuter(0));
    gx.append('text').attr('class', 'lbl').attr('x', W - m.r).attr('y', 30).attr('text-anchor', 'end').text('peak context, tokens');
    const x200 = x(200);
    svg.append('line').attr('x1', x200).attr('x2', x200).attr('y1', m.t).attr('y2', H - m.b).style('stroke', 'var(--axis)').style('stroke-dasharray', '3 3');
    svg.append('text').attr('class', 'lbl').attr('x', x200 + 5).attr('y', m.t + 9).text('200k');
    const jitter = (i) => ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
    [[b, 'var(--before)', 'Before', 0], [f, 'var(--hat-deep)', 'Foreman', 1]].forEach(([g, c, name, row]) => {
      const top = m.t + 18 + row * (band + 4);
      const mid = top + band / 2 - 4;
      svg.append('text').attr('class', 'lbl-ink').attr('x', W - m.r).attr('y', top + 6).attr('text-anchor', 'end')
        .text(`${name}: median ${fK(g.peakMedian / 1000)}, largest ${fK(g.peakMax / 1000)}`);
      svg.append('g').selectAll('circle').data(g.peaks).join('circle')
        .attr('cx', (d) => x(Math.min(d, 1000))).attr('cy', (d, i) => mid + (jitter(i + row * 997) - 0.5) * (band - 26))
        .attr('r', 3).style('fill', c).style('fill-opacity', 0.55)
        .on('pointermove', (ev, d) => showTip(ev, name === 'Before' ? 'A general-purpose agent' : 'A Foreman worker', [[fK(d), 'peak context']]))
        .on('pointerleave', hideTip);
      const xm = x(g.peakMedian / 1000);
      svg.append('line').attr('x1', xm).attr('x2', xm).attr('y1', top + 10).attr('y2', top + band - 14).style('stroke', 'var(--ink)').style('stroke-width', 2);
    });
  }

  // ---------- the crew ----------
  // Per worker type: how many, their models and their median peak. A build without
  // sessions (the public one) carries these precomputed in data.crew.
  function crewStats() {
    if (data.crew) return data.crew;
    const all = data.sessions.flatMap((s) => s.agents.slice(1));
    return Object.fromEntries(Object.keys(CREW).map((k) => {
      const mine = all.filter((a) => a.k === k);
      return [k, {
        n: mine.length,
        peak: median(mine.map((a) => a.peak)),
        models: d3.rollups(mine, (v) => v.length, (a) => a.model).sort((p, q) => q[1] - p[1]),
      }];
    }));
  }

  function renderCrew() {
    const stats = crewStats();
    $('crew-body').replaceChildren(...Object.keys(CREW).map((k) => {
      const st = stats[k];
      const tr = el('tr');
      const name = el('span', 'name');
      const sw = el('i');
      sw.style.background = color(k);
      name.append(sw, document.createTextNode(k));
      const td = el('td');
      td.append(name);
      // The model the workers actually ran on in these sessions, and the profile's effort.
      const models = st.models;
      const mt = el('td', 'meta');
      mt.append(el('div', null, `${models[0][0]} \u00b7 ${EFFORT[k]}`));
      if (models.length > 1) {
        const rest = models.slice(1).map(([name, n]) => `${name} on ${n}`).join(', ');
        mt.append(el('div', 'sub', `${rest} of ${st.n}`));
      }
      tr.append(td, el('td', null, CREW[k]), mt, el('td', 'num', String(st.n)), el('td', 'num', fK(st.peak)));
      return tr;
    }));
  }

  function renderMethod() {
    const f = data.score.foreman;
    const items = [
      `Every number comes from Claude Code, where these sessions ran: its own transcripts of ${f.sessions} lead sessions and their ${fInt(f.workers)} sub-agents, read by a script in this repository (site/build.py). Data as of ${data.generated}.`,
      'Projects, pull requests and tasks are anonymous. Pull requests are renumbered from 1 in the order they were opened and keep only their kind, their times and their size. No message text, command or task description is published.',
      'The timelines are drawn in 5-minute steps, not single calls: for each agent and step, its largest context, its cache rewrites and its cost. Your messages and the lead’s compactions are placed in the step they fell in.',
      'The cache hit rate is cache-read tokens over all input tokens (read, written and uncached). A cache rewrite is a call, after the first, that wrote more than half of a context over 20k tokens again. The lead’s first call after a compaction is not counted.',
      `Cost shares weight tokens by price relative to a fresh input token: cache read ×${data.weights.cr}, 5-minute cache write ×${data.weights.cw5}, 1-hour cache write ×${data.weights.cw1h}, output ×${data.weights.out}.`,
      'Dollar figures are API prices, not what a subscription costs. One session’s figure is the total Claude Code recorded. The other transcript undercounts sub-agent output, so its figure is estimated from the tokens and the text each call wrote.',
      'The “before” sessions ran in one of the two repositories, with general-purpose agents and no written rules. The tasks differ, so read the comparison as a direction, not a controlled test.',
    ];
    $('method').replaceChildren(...items.map((t) => el('li', null, t)));
  }

  function wireCopy() {
    document.querySelectorAll('.copy').forEach((b) => {
      b.onclick = async () => {
        const text = b.closest('.snippet').querySelector('pre').textContent;
        try {
          await navigator.clipboard.writeText(text);
          b.textContent = 'Copied';
        } catch (err) {
          b.textContent = 'Select and copy';
        }
        setTimeout(() => { b.textContent = 'Copy'; }, 1600);
      };
    });
  }

  let resizeTimer;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if ($('sessions')) renderTimeline(); renderPeaks(); }, 150);
  }

  fetch('data.json').then((r) => {
    if (!r.ok) throw new Error('data.json: HTTP ' + r.status);
    return r.json();
  }).then((d) => {
    data = d;
    // The public build leaves the sessions out; drop their section and its link.
    const hasSessions = !!(data.sessions && data.sessions.length);
    if (!hasSessions) {
      $('sessions').remove();
      document.querySelector('a[href="#sessions"]')?.remove();
    }
    renderStats();
    renderRecord();
    if (hasSessions) {
      cur = d3.maxIndex(data.sessions, (s) => s.agents.length);
      renderTabs();
      renderTimeline();
    }
    renderPeaks();
    renderCrew();
    renderMethod();
    wireCopy();
    addEventListener('resize', onResize);
  }).catch((err) => {
    const box = el('div', 'error', 'Could not load the data: ' + err.message + '. Run python3 site/build.py, then serve this folder over HTTP.');
    $('stats').replaceWith(box);
  });
})();

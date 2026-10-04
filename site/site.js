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

  // ---------- DOM helpers ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function legend(id, items) {
    const box = $(id);
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
      [String(f.sessions), 'sessions in two repositories'],
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
    const grade = (v, held, mostly, lower = true) => {
      const ok = (lim) => (lower ? v <= lim : v >= lim);
      return ok(held) ? 'held' : ok(mostly) ? 'mostly' : 'missed';
    };
    const rules = [
      {
        name: 'Workers start small',
        why: 'A worker’s profile lists only the tools it needs. Whatever it starts with, it re-reads on every call.',
        before: [fK(b.startMedian / 1000), 'median context on the first call'],
        after: [fK(f.startMedian / 1000), 'median context on the first call'],
        grade: grade(f.startMedian, 20000, 30000),
      },
      {
        name: 'Workers stay small',
        why: 'One task per worker, and follow-up work goes to a fresh one. The largest worker still reached ' + fK(f.peakMax / 1000) + '.',
        before: [fPct(b.under200k), `finished under 200k, median peak ${fK(b.peakMedian / 1000)}`],
        after: [fPct(f.under200k), `finished under 200k, median peak ${fK(f.peakMedian / 1000)}`],
        grade: grade(f.under200k, 0.98, 0.85, false),
      },
      {
        name: 'The cache survives a wait',
        why: 'With a one-hour cache, a long test run no longer ends in a full rewrite of the context at many times the price of a read.',
        before: [fPct(b.missShare, 1), `of the cost was rewrites, ${b.missN} of them`],
        after: [fPct(f.missShare, 1), `of the cost was rewrites, ${f.missN} of them`],
        grade: grade(f.missShare, 0.005, 0.05),
      },
      {
        name: 'The lead stays under 200k',
        why: 'The lead should compact at 200k. It didn’t: it was compacted ' + f.leadCompactions + ' times, by hand, and peaked at ' + fK(f.leadPeak / 1000) + '. Automatic compaction is the next fix.',
        before: [fK(b.leadAvgCtx / 1000), `average lead context, ${fPct(b.leadShare)} of the cost`],
        after: [fK(f.leadAvgCtx / 1000), `average lead context, ${fPct(f.leadShare)} of the cost`],
        grade: grade(f.leadAvgCtx, 200000, 250000),
      },
    ];
    const words = { held: 'Held', mostly: 'Mostly held', missed: 'Missed' };
    const count = (g) => rules.filter((r) => r.grade === g).length;
    $('record-lede').textContent = `Foreman is a set of rules, so here is each rule against what the transcripts show: ${f.sessions} sessions and ${fInt(f.workers)} workers under Foreman, next to ${b.sessions} earlier sessions and ${b.workers} general-purpose agents without it. ${count('held')} held, ${count('mostly')} mostly held, ${count('missed')} missed. All of it measured on the original Claude Code edition.`;
    const card = $('card');
    card.replaceChildren();
    const head = el('div', 'rule head');
    head.append(el('div', null, 'Rule'), el('div', null, 'Before'), el('div', null, 'With Foreman'), el('div', null, 'Verdict'));
    card.append(head);
    for (const r of rules) {
      const row = el('div', 'rule');
      const what = el('div', 'what');
      what.append(el('h3', null, r.name), el('p', 'why', r.why));
      const cell = (v, cls, tag) => {
        const c = el('div', 'val ' + cls);
        c.append(el('span', 'tag', tag), el('b', null, v[0]), el('span', null, v[1]));
        return c;
      };
      row.append(what, cell(r.before, 'before', 'Before'), cell(r.after, 'after', 'With Foreman'), el('div', 'verdict ' + r.grade, words[r.grade]));
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
    const box = $('tl-tabs');
    box.replaceChildren(...data.sessions.map((s, i) => {
      const b = el('button', null, `${s.label} · ${s.project}`);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(i === cur));
      b.onclick = () => { cur = i; renderTabs(); renderTimeline(); };
      return b;
    }));
  }

  function renderTimeline() {
    const s = data.sessions[cur];
    const box = $('tl-chart');
    box.replaceChildren();
    const W = Math.max(760, box.parentElement.clientWidth);
    const m = { t: 30, r: 12, b: 28, l: 62 };
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
      return { n: p.n, kind: p.kind, lines: p.lines, rounds: p.rounds, merged: p.merged, opened: p.opened, workers: mine.length,
        first: from, last: Math.max(to, from + 60) };
    }).sort((p, q) => p.first - q.first);
    const prPlace = packRows(prs, 900);
    const prRows = (d3.max(prPlace) || 0) + 1;

    const yYou = m.t;
    const yPr = yYou + youH + gapY;
    const prH = prRows * (prRowH + 3);
    const yLead = yPr + prH + gapY;
    const yAg = yLead + leadH + gapY + 4;
    const H = yAg + rows * (rowH + 4) + m.b;

    const x0 = d3.scaleTime().domain([at(-1200), at(span + 1800)]).range([m.l, W - m.r]);
    let x = x0;
    const yCtx = (k, top, h, max) => top + h - (h * Math.min(k, max)) / max;

    const present = TYPES.filter((k) => s.byType[k]);
    legend('tl-legend', [
      { label: 'lead', color: color('lead') },
      ...present.map((k) => ({ label: k, color: color(k) })),
      ...(s.byType.other ? [{ label: 'not a Foreman worker', color: color('other') }] : []),
      { label: 'PR being worked on, filled once merged', color: 'var(--hat)' },
      { label: 'your message', color: 'var(--ink-2)', kind: 'line' },
      { label: 'lead compacted', kind: 'tri' },
      { label: 'cache rewrite', color: 'var(--missed)', kind: 'dot' },
    ]);

    const svg = d3.select(box).append('svg').attr('width', W).attr('height', H).attr('role', 'img')
      .attr('aria-label', `Timeline of ${s.label}: the lead, ${subs.length} workers, ${prs.length} pull requests and your messages`);
    svg.append('clipPath').attr('id', 'tl-clip').append('rect').attr('x', m.l).attr('y', 0).attr('width', W - m.l - m.r).attr('height', H);
    const gMain = svg.append('g').attr('clip-path', 'url(#tl-clip)');
    const gTop = svg.append('g');
    const gBot = svg.append('g');
    [['You', yYou + 12], ['PRs', yPr + 11], ['Lead', yLead + 14], ['Workers', yAg + 14]].forEach(([t, y]) => {
      svg.append('text').attr('class', 'lbl-ink').attr('x', 2).attr('y', y).text(t);
    });
    const hair = (y) => svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y).style('stroke', 'var(--hair)');
    hair(yLead + leadH);
    for (let r = 0; r < rows; r++) hair(yAg + r * (rowH + 4) + rowH);

    function axis(g, y, bare) {
      const fmt = (d) => (d.getHours() === 0 && d.getMinutes() === 0 ? fDay(d) : fClock(d));
      g.attr('class', 'axis').attr('transform', `translate(0,${y})`)
        .call(d3.axisBottom(x).ticks(Math.max(3, Math.floor(W / 100))).tickFormat(fmt).tickSizeOuter(0));
      g.selectAll('.tick text').filter((d) => d.getHours() === 0 && d.getMinutes() === 0).attr('class', 'lbl-ink');
      if (bare) g.selectAll('.domain, .tick line').remove();
    }

    function drawAgent(a, i, top, h, max, label) {
      const calls = byAgent[i];
      const c0 = color(a.k);
      const g = gMain.append('g');
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
      axis(gTop, m.t - 22, true);
      axis(gBot, H - m.b + 4, false);
      gMain.selectAll('rect.user').data(s.users).join('rect').attr('class', 'user')
        .attr('x', (t) => x(at(t)) - 1).attr('width', 2).attr('y', yYou + 2).attr('height', youH - 5).attr('rx', 1).style('fill', 'var(--ink-2)');
      prs.forEach((p, k) => {
        const y = yPr + prPlace[k] * (prRowH + 3);
        const xa = x(at(p.first));
        const xb = x(at(p.last));
        gMain.append('rect').attr('x', xa).attr('y', y).attr('width', Math.max(3, xb - xa)).attr('height', prRowH).attr('rx', 3)
          .style('fill', 'var(--hat)').style('fill-opacity', p.merged == null ? 0 : 0.45).style('stroke', 'var(--hat-deep)').style('stroke-width', 1);
        const lbl = 'PR ' + p.n;
        if (xb - xa > lbl.length * 6.4 + 6) gMain.append('text').attr('class', 'agent-lbl').attr('x', Math.max(xa, m.l) + 3).attr('y', y + 10).text(lbl);
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

    const overlay = svg.append('rect').attr('x', m.l).attr('y', yYou - 4).attr('width', W - m.l - m.r).attr('height', H - m.b - yYou + 4)
      .style('fill', 'transparent').style('cursor', 'crosshair');
    overlay.on('pointermove', (ev) => {
      const [mx, my] = d3.pointer(ev);
      const t = x.invert(mx).getTime() / 1000 - s.start;
      if (my < yYou + youH) {
        const u = d3.least(s.users, (d) => Math.abs(x(at(d)) - mx));
        if (u != null && Math.abs(x(at(u)) - mx) < 8) return showTip(ev, 'Your message', [[fTime(at(u)), '']]);
      } else if (my >= yPr && my < yPr + prH) {
        const r = Math.floor((my - yPr) / (prRowH + 3));
        const p = prs.find((q, k) => prPlace[k] === r && t >= q.first - 300 && t <= q.last + 300);
        if (p) {
          return showTip(ev, `PR ${p.n} · ${p.kind}`, [
            [p.opened < 0 ? 'earlier' : fTime(at(p.opened)), 'opened'],
            [p.merged == null ? 'open' : fTime(at(p.merged)), p.merged == null ? 'not merged' : 'merged'],
            [fInt(p.lines), 'lines changed'],
            [String(p.rounds), 'review rounds in this session'],
            [String(p.workers), 'workers on it'],
          ]);
        }
      } else if (my >= yLead && my <= yLead + leadH) {
        return agentTip(ev, lead, 0, t);
      } else if (my >= yAg) {
        const r = Math.floor((my - yAg) / (rowH + 4));
        const k = subs.findIndex((a, j) => place[j] === r && t >= a.first - 300 && t <= a.last + 300);
        if (k >= 0) return agentTip(ev, subs[k], k + 1, t);
      }
      hideTip();
    }).on('pointerleave', hideTip);

    const zoom = d3.zoom().scaleExtent([1, 120])
      .translateExtent([[m.l, 0], [W - m.r, H]]).extent([[m.l, 0], [W - m.r, H]])
      .filter((ev) => (ev.type === 'wheel' ? ev.ctrlKey || ev.metaKey : !ev.button))
      .on('zoom', (ev) => { x = ev.transform.rescaleX(x0); hideTip(); draw(); });
    overlay.call(zoom);
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
  function renderCrew() {
    const all = data.sessions.flatMap((s) => s.agents.slice(1));
    $('crew-body').replaceChildren(...Object.keys(CREW).map((k) => {
      const mine = all.filter((a) => a.k === k);
      const tr = el('tr');
      const name = el('span', 'name');
      const sw = el('i');
      sw.style.background = color(k);
      name.append(sw, document.createTextNode(k));
      const td = el('td');
      td.append(name);
      tr.append(td, el('td', null, CREW[k]), el('td', 'num', String(mine.length)), el('td', 'num', fK(median(mine.map((a) => a.peak)))));
      return tr;
    }));
  }

  function renderMethod() {
    const f = data.score.foreman;
    const items = [
      `Every number was measured on the original Claude Code edition of Foreman, from its own transcripts of ${f.sessions} lead sessions and their ${fInt(f.workers)} sub-agents, read by a script in this repository (site/build.py). Data as of ${data.generated}.`,
      'Projects, pull requests and tasks are anonymous. Pull requests are renumbered from 1 in the order they were opened and keep only their kind, their times and their size. No message text, command or task description is published.',
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
    resizeTimer = setTimeout(() => { renderTimeline(); renderPeaks(); }, 150);
  }

  fetch('data.json').then((r) => {
    if (!r.ok) throw new Error('data.json: HTTP ' + r.status);
    return r.json();
  }).then((d) => {
    data = d;
    cur = data.sessions.length - 1;
    renderStats();
    renderRecord();
    renderTabs();
    renderTimeline();
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

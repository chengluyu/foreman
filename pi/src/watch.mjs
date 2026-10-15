import { command } from './storage.mjs';

export function validateTarget(t) {
  if (!t || !/^[\w.-]+\/[\w.-]+$/.test(t.repo) || !Number.isSafeInteger(t.pr) || t.pr < 1 ||
      !/^[a-f0-9]{40,64}$/i.test(t.headSha) || !/^\d+$/.test(t.requestId)) {
    throw new Error('Target needs owner/repo, positive PR number, full head SHA, and numeric review-comment ID.');
  }
}
export function githubAPI(cwd) {
  return async (endpoint, paged = false) => {
    const args = ['api', endpoint];
    if (paged) args.push('--paginate', '--slurp');
    const value = JSON.parse(await command('gh', args, cwd, 15000));
    return paged ? value.flat() : value;
  };
}
const defaultBots = ['chatgpt-codex-connector[bot]', 'codex[bot]'];
export async function checkReview(target, api, bots = defaultBots) {
  validateTarget(target);
  const base = `repos/${target.repo}`;
  const pr = await api(`${base}/pulls/${target.pr}`);
  if (pr.head.sha !== target.headSha) return { state: 'head_changed', headSha: pr.head.sha };
  if (pr.state === 'closed') return { state: 'closed', merged: !!pr.merged };
  const trigger = await api(`${base}/issues/comments/${target.requestId}`);
  if (!trigger.issue_url?.endsWith(`/issues/${target.pr}`) || !/@codex\s+review\b/i.test(trigger.body || '')) {
    throw new Error('Comment is not a Codex review request on this PR.');
  }
  const isBot = user => bots.includes(user?.login);
  const since = Date.parse(trigger.created_at);
  if (!Number.isFinite(since)) throw new Error('Review request has no valid timestamp.');
  const reviews = await api(`${base}/pulls/${target.pr}/reviews`, true);
  const relevant = reviews.filter(r => isBot(r.user) && r.commit_id === target.headSha &&
    Date.parse(r.submitted_at) > since && r.state !== 'DISMISSED');
  relevant.sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at));
  let result = { state: 'pending' };
  if (relevant.length) {
    const review = relevant[0];
    const comments = await api(`${base}/pulls/${target.pr}/reviews/${review.id}/comments`, true);
    if (comments.length || review.state === 'CHANGES_REQUESTED' || /\bP[0-3]\b/.test(review.body || '')) {
      result = { state: 'findings', reviewId: review.id, url: review.html_url, count: comments.length };
    } else if (review.state === 'APPROVED' || /didn.t find any (major )?issues|no (major )?issues found/i.test(review.body || '')) {
      result = { state: 'passed', reviewId: review.id, url: review.html_url };
    }
  }
  // A reaction carries no commit SHA. Only accept one when the request itself
  // explicitly identifies the watched head, and recheck the head after fetching.
  if (result.state === 'pending' && trigger.body.includes(`<!-- foreman-head: ${target.headSha} -->`)) {
    const reactions = await api(`${base}/issues/comments/${target.requestId}/reactions`, true);
    const pass = reactions.find(r => isBot(r.user) && r.content === '+1' && Date.parse(r.created_at) >= since);
    if (pass) result = { state: 'passed', reactionId: pass.id, requestId: target.requestId };
  }
  const latest = await api(`${base}/pulls/${target.pr}`);
  if (latest.head.sha !== target.headSha) return { state: 'head_changed', headSha: latest.head.sha };
  return result;
}

// No model calls, no per-watch subprocess, and no automatic review posting.
export async function tickWatches(watches, { now = Date.now(), check, emit, save }) {
  for (const watch of Object.values(watches)) {
    if (watch.state !== 'pending') continue;
    if (now >= watch.deadline) {
      watch.state = 'timeout'; save(); emit(watch); continue;
    }
    if (now < watch.nextCheck) continue;
    try {
      const result = await check(watch.target);
      if (watch.state !== 'pending') continue; // Deadline/cancel can win during I/O.
      Object.assign(watch, result, { lastCheck: now, errors: 0 });
      delete watch.error;
    } catch (error) {
      if (watch.state !== 'pending') continue;
      watch.errors = (watch.errors || 0) + 1;
      watch.error = String(error.message).slice(0, 500);
      if (watch.errors >= 3) watch.state = 'unavailable';
    }
    if (Date.now() >= watch.deadline && watch.state === 'pending') watch.state = 'timeout';
    watch.nextCheck = now + Math.min(60000 * 2 ** (watch.errors || 0), 240000);
    save();
    if (watch.state !== 'pending') emit(watch);
  }
}

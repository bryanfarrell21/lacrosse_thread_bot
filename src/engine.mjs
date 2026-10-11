// Platform-independent policy and Markdown rendering. No Reddit writes.
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
export const defaults = Object.freeze({
  timezone: 'America/New_York', leadMinutes: 30, pollMaxAgeDays: 10,
  finalConfirmMinutes: 2, maxPostgameAgeHours: 24, enabled: true,
  rankCutoff: 20, indexPublishHour: 8,
});
function stamp(value) {
  const n = Date.parse(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid timestamp: ${value}`);
  return n;
}
export function validateGame(g) {
  if (!g?.id || g.sport !== 'lacrosse-men' || g.division !== 'd1')
    throw new Error('Expected a stable ID and men’s D1 game');
  if (!g.away?.id || !g.home?.id || !g.away.name || !g.home.name)
    throw new Error('Both teams need canonical IDs and names');
  if (!['scheduled','live','final','postponed','canceled'].includes(g.status))
    throw new Error('Unrecognized game status');
  stamp(g.observedAt);
  if (g.startTime != null) stamp(g.startTime);
  if (g.status === 'final' && (!Number.isInteger(g.away.score) ||
    !Number.isInteger(g.home.score) || g.away.score < 0 || g.home.score < 0 ||
    g.away.score === g.home.score)) throw new Error('Invalid final score');
  return g;
}
export function ranksAt(poll, now, config = defaults) {
  if (!poll?.publishedAt) return {};
  const age = now - stamp(poll.publishedAt);
  if (age < 0 || age > config.pollMaxAgeDays * DAY) return {};
  const result = {};
  for (const [id, rank] of Object.entries(poll.ranks ?? {}))
    if (Number.isInteger(rank) && rank >= 1 && rank <= config.rankCutoff) result[id] = rank;
  return result;
}
export function requestGame(g, state, now, config = defaults) {
  validateGame(g);
  if (!config.enabled) throw new Error('Thread requests are paused');
  if (['postponed','canceled','final'].includes(g.status))
    throw new Error('Game is unavailable for a game-thread request');
  if (!g.startTime) throw new Error('Start time needs moderator confirmation');
  if (stamp(g.startTime) > now + 7 * DAY) throw new Error('Request within seven days of faceoff');
  return {...state, requested: true}; // Calling twice is harmless.
}
export function planGame(g, previous = {}, poll, now, overrides = {}) {
  const config = {...defaults, ...overrides};
  validateGame(g);
  const state = {...previous};
  const actions = [];
  if (!config.enabled) return {state, actions};
  const observed = stamp(g.observedAt);
  // Ignore stale snapshots and out-of-order observations.
  if (observed > now || now - observed > 10 * MINUTE ||
      (state.lastObservation && observed < state.lastObservation)) return {state, actions};
  state.lastObservation = observed;
  const ranks = ranksAt(poll, now, config);
  const automatic = ranks[g.away.id] != null && ranks[g.home.id] != null;
  const eligible = state.requested || automatic;
  if (['scheduled','live'].includes(g.status) && eligible && !state.gamePostId &&
      g.startTime && (g.status === 'live' || now >= stamp(g.startTime) - config.leadMinutes * MINUTE)) {
    actions.push({kind:'game', key:`${g.id}:game`, title:gameTitle(g,ranks,config), body:gameBody(g,ranks,config)});
  }
  // Only follow games with a published game thread; do not backfill every final.
  if (g.status === 'final' && state.gamePostId && !state.postgamePostId) {
    const signature = `${g.away.score}:${g.home.score}:${g.overtime ?? 0}`;
    if (state.finalSignature !== signature) {
      state.finalSignature = signature;
      state.finalFirstSeen = observed;
    } else if (observed - state.finalFirstSeen >= config.finalConfirmMinutes * MINUTE &&
        now - state.finalFirstSeen <= config.maxPostgameAgeHours * 60 * MINUTE) {
      const frozen = state.threadRanks ?? ranks;
      actions.push({kind:'postgame', key:`${g.id}:postgame`, title:postgameTitle(g,frozen),
        body:postgameBody(g,frozen,state.gamePostId)});
    }
  } else if (g.status !== 'final') {
    delete state.finalSignature; delete state.finalFirstSeen;
  }
  return {state, actions};
}
export function recordPost(state, kind, postId, poll, now, config = defaults) {
  if (!postId) throw new Error('Cannot mark an unsuccessful post as published');
  if (kind === 'game') return {...state, gamePostId:postId, threadRanks:ranksAt(poll,now,config)};
  if (kind === 'postgame') return {...state, postgamePostId:postId};
  throw new Error('Unknown post kind');
}
const clean = s => String(s).replace(/[\r\n|\[\]*_`]/g,' ').trim();
const team = (t,r) => `${r[t.id] ? `#${r[t.id]} ` : ''}${clean(t.name)}`;
function link(url,label) {
  try { const u = new URL(url); return u.protocol === 'https:' ? `[${label}](${u.href.replace(/[()]/g,encodeURIComponent)})` : ''; }
  catch { return ''; }
}
function time(g,c) {
  return g.startTime ? new Intl.DateTimeFormat('en-US', {timeZone:c.timezone,month:'short',day:'numeric',
    hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(stamp(g.startTime)) : 'TBD';
}
export function gameTitle(g,r={},c=defaults) {
  return `[Game Thread] ${team(g.away,r)} ${g.neutralSite ? 'vs.' : 'at'} ${team(g.home,r)} (${time(g,c)})`;
}
export function gameBody(g,r={},c=defaults) {
  const links = [link(g.broadcastUrl,'Watch'),link(g.liveStatsUrl,'Live stats'),link(g.boxScoreUrl,'Box score')].filter(Boolean);
  return `## ${team(g.away,r)} ${g.neutralSite?'vs.':'at'} ${team(g.home,r)}\n\n`+
    `**Faceoff:** ${time(g,c)}\n\n**Venue:** ${clean(g.venue ?? 'TBD')}\n\n`+
    `| Team | Record |\n|---|---|\n| ${team(g.away,r)} | ${clean(g.away.record??'—')} |\n| ${team(g.home,r)} | ${clean(g.home.record??'—')} |\n\n`+
    (links.length ? links.join(' · ')+'\n\n' : '')+
    `Automated men’s Division I game thread.\n\n<!-- lax-game:${clean(g.id)} -->`;
}
export function postgameTitle(g,r={}) {
  const [winner,loser] = g.away.score > g.home.score ? [g.away,g.home] : [g.home,g.away];
  const ot = g.overtime ? ` (${g.overtime > 1 ? g.overtime : ''}OT)` : '';
  return `[Post Game Thread] ${team(winner,r)} defeats ${team(loser,r)}, ${winner.score}–${loser.score}${ot}`;
}
export function postgameBody(g,r={},gamePostId) {
  return `| Team | Final |\n|---|---|\n| ${team(g.away,r)} | ${g.away.score} |\n| ${team(g.home,r)} | ${g.home.score} |\n\n`+
    `[Game thread](https://www.reddit.com/comments/${gamePostId.replace(/^t3_/,'')}/)\n\n`+
    (link(g.boxScoreUrl,'Box score') || '')+`\n\n<!-- lax-game:${clean(g.id)} -->`;
}
function localDate(n,timezone) {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(n);
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function weeklyWindow(now,timezone=defaults.timezone) {
  // Calendar arithmetic, not 168-hour windows: safe across daylight-saving changes.
  const today=localDate(now,timezone);
  const date=new Date(`${today}T12:00:00Z`);
  const dayOfWeek=date.getUTCDay();
  date.setUTCDate(date.getUTCDate()-((dayOfWeek+1)%7));
  const saturday=date.toISOString().slice(0,10);
  date.setUTCDate(date.getUTCDate()+6);
  return {saturday,friday:date.toISOString().slice(0,10),isSaturday:dayOfWeek===6};
}
export function planWeeklyIndex(games,states,poll,now,indexState={},overrides={}) {
  const c={...defaults,...overrides}; const w=weeklyWindow(now,c.timezone);
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:c.timezone,hour:'numeric',hourCycle:'h23'}).format(now));
  if(!c.enabled || !w.isSaturday || hour<c.indexPublishHour || indexState[w.saturday]) return null;
  return {kind:'index',key:`index:${w.saturday}`,title:`Men’s D1 Lacrosse Weekly Game Index — ${w.saturday} through ${w.friday}`,
    body:weeklyIndex(games,states,poll,now,c)};
}
export function weeklyIndex(games,states,poll,now,overrides={}) {
  const c={...defaults,...overrides}; const r=ranksAt(poll,now,c);
  const w=weeklyWindow(now,c.timezone);
  const rows=games.filter(g=>g.startTime && localDate(stamp(g.startTime),c.timezone)>=w.saturday && localDate(stamp(g.startTime),c.timezone)<=w.friday)
    .sort((a,b)=>stamp(a.startTime)-stamp(b.startTime)).map(g=>{
      validateGame(g); const s=states[g.id]??{};
      const mode=['canceled','postponed'].includes(g.status) ? g.status :
        s.gamePostId ? `[Thread](https://www.reddit.com/comments/${s.gamePostId.replace(/^t3_/,'')}/)` :
        s.requested ? 'Requested' : r[g.away.id]&&r[g.home.id] ? 'Automatic' : `Request: !thread ${clean(g.id)}`;
      return `| ${time(g,c)} | ${team(g.away,r)} ${g.neutralSite?'vs.':'at'} ${team(g.home,r)} | ${mode} |`;
    });
  return `# Men’s D1 Lacrosse — ${w.saturday} through ${w.friday}\n\nBoth teams in the IL Top ${c.rankCutoff}: automatic threads. Other games: comment the request shown below in this index.\n\n`+
    `| Faceoff | Matchup | Thread |\n|---|---|---|\n${rows.join('\n') || '| — | No games listed | — |'}\n\n`+
    `Rankings: ${clean(poll?.source??'Not configured')}. Requests open seven days before faceoff.\n`;
}
export function parseRequest(body) {
  return /^!thread\s+([a-zA-Z0-9_-]{1,80})\s*$/.exec(body.trim())?.[1] ?? null;
}

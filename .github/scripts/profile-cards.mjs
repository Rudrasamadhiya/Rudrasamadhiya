// Builds the "activity" cards for the profile README straight from the GitHub API,
// so the README doesn't depend on a third-party stats server staying online.
// Writes stats-{dark,light}.svg and langs-{dark,light}.svg into the given directory.
// usage: GITHUB_TOKEN=... node profile-cards.mjs <user> <outdir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [user = 'Rudrasamadhiya', out = 'dist'] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error('GITHUB_TOKEN is required');

const query = `query($login: String!) {
  user(login: $login) {
    followers { totalCount }
    pullRequests(states: MERGED) { totalCount }
    contributionsCollection { totalCommitContributions restrictedContributionsCount totalPullRequestReviewContributions }
    repositories(ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, first: 100, orderBy: { field: PUSHED_AT, direction: DESC }) {
      totalCount
      nodes { stargazerCount languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } } }
    }
  }
}`;

const res = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-cards' },
  body: JSON.stringify({ query, variables: { login: user } }),
});
const { data, errors } = await res.json();
if (errors) throw new Error(JSON.stringify(errors));
const u = data.user;

const c = u.contributionsCollection;
const stats = [
  ['Commits · last 12 months', c.totalCommitContributions + c.restrictedContributionsCount],
  ['Merged pull requests', u.pullRequests.totalCount],
  ['Public repositories', u.repositories.totalCount],
  ['Stars earned', u.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0)],
  ['Followers', u.followers.totalCount],
];

// Markup and build files aren't "languages I code in", and one huge repo shouldn't
// drown out the rest, so each repo's bytes are square-rooted before summing.
const SKIP = new Set(['HTML', 'CSS', 'SCSS', 'Batchfile', 'Shell', 'PowerShell', 'Dockerfile', 'Makefile', 'Procfile', 'Jupyter Notebook']);
const sizes = new Map();
for (const r of u.repositories.nodes) {
  for (const { size, node } of r.languages.edges) {
    if (SKIP.has(node.name)) continue;
    const cur = sizes.get(node.name) || { size: 0, color: node.color || '#8B949E' };
    cur.size += Math.sqrt(size);
    sizes.set(node.name, cur);
  }
}
const total = [...sizes.values()].reduce((s, l) => s + l.size, 0) || 1;
const langs = [...sizes.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 8)
  .map(([name, l]) => ({ name, color: l.color, pct: (l.size / total) * 100 }));

// same palette as the hand-made SVGs in assets/
const THEMES = {
  dark: { bg: '#0F1319', border: '#252B36', title: '#E6EDF3', accent: '#5B9DFF', text: '#8B949E', num: '#E6EDF3', track: '#1B212B' },
  light: { bg: '#FFFFFF', border: '#D8DEE4', title: '#1F2328', accent: '#1F6FEB', text: '#59636E', num: '#1F2328', track: '#EEF1F4' },
};
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,'JetBrains Mono',Menlo,Consolas,monospace";
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const W = 440, H = 200;

function frame(t, label, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none">
<style>.r{animation:in .6s ease backwards}@keyframes in{from{opacity:0}}</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="${t.bg}" stroke="${t.border}"/>
<text x="24" y="38" font-family="${MONO}" font-size="12" font-weight="700" fill="${t.accent}" letter-spacing="1">${label}</text>
${body}
</svg>
`;
}

function statsCard(t) {
  const rows = stats.map(([k, v], i) => {
    const y = 72 + i * 25;
    return `<g class="r" style="animation-delay:${i * 0.12}s">
<text x="24" y="${y}" font-family="${SANS}" font-size="14" fill="${t.text}">${esc(k)}</text>
<text x="${W - 24}" y="${y}" font-family="${MONO}" font-size="15" font-weight="700" fill="${t.num}" text-anchor="end">${v.toLocaleString('en-US')}</text>
</g>`;
  }).join('\n');
  return frame(t, 'GITHUB · STATS', rows);
}

function langsCard(t) {
  const barW = W - 48;
  let x = 24;
  const segs = langs.map((l) => {
    const w = Math.max((l.pct / 100) * barW, 2);
    const s = `<rect x="${x.toFixed(1)}" y="54" width="${w.toFixed(1)}" height="8" fill="${l.color}"/>`;
    x += w;
    return s;
  }).join('');
  const legend = langs.map((l, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const lx = 24 + col * (barW / 2), ly = 94 + row * 26;
    return `<g class="r" style="animation-delay:${i * 0.08}s">
<circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${l.color}"/>
<text x="${lx + 18}" y="${ly}" font-family="${SANS}" font-size="14" fill="${t.title}">${esc(l.name)}</text>
<text x="${lx + barW / 2 - 16}" y="${ly}" font-family="${MONO}" font-size="12" fill="${t.text}" text-anchor="end">${l.pct.toFixed(1)}%</text>
</g>`;
  }).join('\n');
  return frame(t, 'MOST USED LANGUAGES',
    `<clipPath id="bar"><rect x="24" y="54" width="${barW}" height="8" rx="4"/></clipPath>
<rect x="24" y="54" width="${barW}" height="8" rx="4" fill="${t.track}"/>
<g clip-path="url(#bar)">${segs}</g>
${legend}`);
}

mkdirSync(out, { recursive: true });
for (const [mode, t] of Object.entries(THEMES)) {
  writeFileSync(join(out, `stats-${mode}.svg`), statsCard(t));
  writeFileSync(join(out, `langs-${mode}.svg`), langsCard(t));
}
console.log('stats:', Object.fromEntries(stats), '\nlangs:', langs.map((l) => `${l.name} ${l.pct.toFixed(1)}%`).join(', '));

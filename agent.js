// ============================================================
//  JAKE'S DAILY NEWS DIGEST AGENT
//  Newspaper Edition — Light, Big, Tabbed, Collapsible
// ============================================================

require('dotenv').config();

const RSSParser = require('rss-parser');
const fs = require('fs');
const path = require('path');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const parser = new RSSParser({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsAgent/1.0)' }
});

const SOURCES = {
  'AI & Technology': [
    { name: 'TechCrunch',         url: 'https://techcrunch.com/feed/' },
    { name: 'The Verge',          url: 'https://www.theverge.com/rss/index.xml' },
    { name: 'Ars Technica',       url: 'https://feeds.arstechnica.com/arstechnica/technology-lab' },
    { name: 'Wired',              url: 'https://www.wired.com/feed/rss' },
    { name: 'MIT Tech Review',    url: 'https://www.technologyreview.com/feed/' },
    { name: 'VentureBeat AI',     url: 'https://venturebeat.com/category/ai/feed/' },
  ],
  'Energy': [
    { name: 'Utility Dive',       url: 'https://www.utilitydive.com/feeds/news/' },
    { name: 'Canary Media',       url: 'https://www.canarymedia.com/rss' },
    { name: 'Heatmap News',       url: 'https://heatmap.news/rss' },
    { name: 'E&E News',           url: 'https://www.eenews.net/rss/news' },
    { name: 'PV Magazine',        url: 'https://www.pv-magazine-usa.com/feed/' },
  ],
  'Venture Capital': [
    { name: 'TechCrunch VC',      url: 'https://techcrunch.com/category/venture/feed/' },
    { name: 'Fortune Term Sheet', url: 'https://fortune.com/feed/fortune-feeds/?id=3230629' },
    { name: 'VentureBeat',        url: 'https://venturebeat.com/feed/' },
    { name: 'Crunchbase News',    url: 'https://news.crunchbase.com/feed/' },
  ],
  'Healthcare & Healthcare VC': [
    { name: 'Healthcare Dive',    url: 'https://www.healthcaredive.com/feeds/news/' },
    { name: 'STAT News',          url: 'https://www.statnews.com/feed/' },
    { name: 'Fierce Healthcare',  url: 'https://www.fiercehealthcare.com/rss/xml' },
    { name: 'Fierce Biotech',     url: 'https://www.fiercebiotech.com/rss/xml' },
    { name: 'MedCity News',       url: 'https://medcitynews.com/feed/' },
  ],
  'Politics': [
    { name: 'Politico',           url: 'https://www.politico.com/rss/politicopicks.xml' },
    { name: 'The Hill',           url: 'https://thehill.com/rss/syndicator/19109' },
    { name: 'Axios',              url: 'https://api.axios.com/feed/' },
    { name: 'NPR Politics',       url: 'https://feeds.npr.org/1014/rss.xml' },
    { name: 'RealClearPolitics',  url: 'https://www.realclearpolitics.com/xml/politics.xml' },
  ],
  'Sports — NBA': [
    { name: 'ESPN NBA',           url: 'https://www.espn.com/espn/rss/nba/news' },
    { name: 'NBA.com',            url: 'https://www.nba.com/rss/nba_rss.xml' },
  ],
  'Sports — NCAA Football': [
    { name: 'ESPN College FB',    url: 'https://www.espn.com/espn/rss/ncf/news' },
    { name: '247Sports',          url: 'https://247sports.com/Season/2025-Football/RSS/' },
  ],
  'Sports — Tennis': [
    { name: 'ESPN Tennis',        url: 'https://www.espn.com/espn/rss/tennis/news' },
    { name: 'Tennis.com',         url: 'https://www.tennis.com/rss/news/' },
  ],
  'World News': [
    { name: 'BBC World',          url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { name: 'AP News',            url: 'https://feeds.apnews.com/rss/apf-topnews' },
    { name: 'Al Jazeera',         url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { name: 'NPR World',          url: 'https://feeds.npr.org/1004/rss.xml' },
    { name: 'Foreign Policy',     url: 'https://foreignpolicy.com/feed/' },
  ],
};

const MAX_ITEMS_PER_SOURCE = 5;
const OUTPUT_FILE = path.join(__dirname, 'dashboard.html');

function safeString(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'object') {
    if (val._) return String(val._);
    if (val['#text']) return String(val['#text']);
    try { return JSON.stringify(val); } catch (e) { return ''; }
  }
  return String(val);
}

// Generate URL-safe ID from a category name
function slugify(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─── STEP 1: FETCH RSS ──────────────────────────────────────
async function fetchCategory(categoryName, sources) {
  console.log(`  📡 Fetching: ${categoryName}`);
  const allItems = [];
  for (const source of sources) {
    try {
      const feed = await parser.parseURL(source.url);
      const items = (feed.items || []).slice(0, MAX_ITEMS_PER_SOURCE).map(item => ({
        source: source.name,
        title: safeString(item.title),
        link: safeString(item.link),
        summary: safeString(item.contentSnippet || item.content),
        date: safeString(item.pubDate || item.isoDate),
      }));
      allItems.push(...items);
      console.log(`    ✅ ${source.name}: ${items.length} items`);
    } catch (err) {
      console.log(`    ⚠️  ${source.name}: skipped (${err.message.slice(0, 60)})`);
    }
  }
  return allItems;
}

// ─── STEP 2: SUMMARIZE WITH CLAUDE ──────────────────────────
async function summarizeWithClaude(categoryName, items) {
  if (items.length === 0) {
    return { bullets: [], topStory: null };
  }

  const headlineList = items.map((item, i) => {
    return '[' + (i + 1) + '] SOURCE: ' + safeString(item.source) +
           '\nTITLE: ' + safeString(item.title) +
           '\nURL: ' + safeString(item.link) +
           '\nPREVIEW: ' + safeString(item.summary).slice(0, 250);
  }).join('\n\n');

  const prompt = `You are a hard-hitting news editor writing a deep morning briefing for a sophisticated professional who wants real intelligence, not headlines.

Here are today's articles from the "${categoryName}" category:

${headlineList}

Write 5-7 detailed bullet points. Each bullet MUST follow these rules:

CONTENT RULES:
- Length: 4-5 substantive sentences per bullet
- Lead with the most newsworthy fact
- Include ALL specific details: dollar amounts, percentages, company names, people, dates, locations
- Provide CONTEXT: why this happened, what led to it, who is affected
- Include IMPLICATIONS: what changes, what to watch next
- Reference the article index number in "sourceIndex"

FORMAT:
- Start each bullet with a fitting emoji like 🔥 ⚡ 💡 📈 🚀 ⚠️ 💰 🏥 🌍 🏆 🔋 🤖 📊 🎾 🏈 🏀 💊 ⚖️ 🛢️ 📉
- Bloomberg or Axios quality — professional, dense, informative

GOOD EXAMPLE:
"🤖 Google quietly rolled out Gemini 2.0 across all Workspace apps this week, giving 3 billion users AI-assisted drafting, summarization, and search with zero opt-in required. The deployment makes it the largest AI rollout in history by user count, dwarfing OpenAI's 200M ChatGPT weekly users. The move came just days after Microsoft announced similar Copilot defaults, signaling a new phase where AI is no longer optional in productivity software. Watch for enterprise pushback on data privacy as both companies now train on user behavior by default."

Also pick the SINGLE most important story and write a 4-5 sentence Top Story summary.

Respond ONLY in this exact JSON format — no markdown, no code blocks:
{
  "bullets": [
    {"text": "🔥 Detailed bullet 1...", "sourceIndex": 1},
    {"text": "📈 Detailed bullet 2...", "sourceIndex": 3}
  ],
  "topStory": {
    "headline": "Specific, newsy headline",
    "summary": "4-5 sentence deep summary with context and stakes.",
    "sourceIndex": 1
  }
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const clean = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    const bullets = (parsed.bullets || []).map(b => {
      const item = items[(b.sourceIndex || 1) - 1] || items[0];
      return {
        text: safeString(b.text),
        link: item ? safeString(item.link) : '',
        source: item ? safeString(item.source) : '',
      };
    });

    let topStory = null;
    if (parsed.topStory) {
      const item = items[(parsed.topStory.sourceIndex || 1) - 1] || items[0];
      topStory = {
        headline: safeString(parsed.topStory.headline),
        summary: safeString(parsed.topStory.summary),
        link: item ? safeString(item.link) : '',
        source: item ? safeString(item.source) : '',
      };
    }

    return { bullets, topStory };

  } catch (err) {
    console.log(`    ⚠️  Claude error for ${categoryName}: ${err.message}`);
    return {
      bullets: items.slice(0, 5).map(i => ({
        text: '📰 ' + safeString(i.title),
        link: safeString(i.link),
        source: safeString(i.source),
      })),
      topStory: null,
    };
  }
}

// ─── STEP 3: BUILD HTML DASHBOARD ───────────────────────────
function buildHTML(results, generatedAt) {
  const categoryIcons = {
    'AI & Technology': '⚡',
    'Energy': '🔋',
    'Venture Capital': '💰',
    'Healthcare & Healthcare VC': '🏥',
    'Politics': '🏛️',
    'Sports — NBA': '🏀',
    'Sports — NCAA Football': '🏈',
    'Sports — Tennis': '🎾',
    'World News': '🌍',
  };

  const date = new Date(generatedAt).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const time = new Date(generatedAt).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit'
  });
  const totalItems = results.reduce((a, r) => a + r.itemCount, 0);
  const totalSources = Object.values(SOURCES).reduce((a, s) => a + s.length, 0);

  // Build tabs nav
  const tabsHTML = ['<button class="tab active" data-target="all">All Categories</button>']
    .concat(results.map(({ category }) => {
      const icon = categoryIcons[category] || '📰';
      return `<button class="tab" data-target="${slugify(category)}">${icon} ${category}</button>`;
    })).join('');

  // Build TOC
  const tocHTML = results.map(({ category, itemCount }) => {
    const icon = categoryIcons[category] || '📰';
    return `<a class="toc-item" href="#${slugify(category)}">
      <span class="toc-icon">${icon}</span>
      <span class="toc-name">${category}</span>
      <span class="toc-count">${itemCount}</span>
    </a>`;
  }).join('');

  // Build category sections
  const categorySections = results.map(({ category, summary, itemCount }) => {
    const icon = categoryIcons[category] || '📰';
    const slug = slugify(category);

    const topStoryHTML = summary.topStory ? `
      <div class="top-story">
        <div class="top-story-label">★ TOP STORY</div>
        <div class="top-story-headline">${summary.topStory.headline}</div>
        <div class="top-story-text">${summary.topStory.summary}</div>
        <div class="top-story-footer">
          <span class="top-story-source">— ${summary.topStory.source}</span>
          ${summary.topStory.link ? `<a href="${summary.topStory.link}" target="_blank" class="read-more">Read full article →</a>` : ''}
        </div>
      </div>` : '';

    const bulletsHTML = (summary.bullets || []).map((b, i) => `
      <article class="bullet">
        <div class="bullet-marker">${String(i + 1).padStart(2, '0')}</div>
        <div class="bullet-content">
          <div class="bullet-text">${b.text}</div>
          <div class="bullet-footer">
            <span class="bullet-source">${b.source}</span>
            ${b.link ? `<a href="${b.link}" target="_blank" class="read-more">Read more →</a>` : ''}
          </div>
        </div>
      </article>
    `).join('');

    return `
    <section class="category" id="${slug}" data-category="${slug}">
      <header class="category-header" onclick="toggleCategory('${slug}')">
        <div class="category-icon">${icon}</div>
        <div class="category-title-wrap">
          <div class="category-eyebrow">Section · ${itemCount} sources</div>
          <h2 class="category-title">${category}</h2>
        </div>
        <div class="category-toggle">▼</div>
      </header>
      <div class="category-body">
        ${topStoryHTML}
        <div class="bullets">${bulletsHTML}</div>
      </div>
    </section>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Jake's Daily Brief — ${date}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Source+Serif+Pro:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --paper: #faf7f0;
    --ink: #1a1a1a;
    --ink-2: #2d2d2d;
    --ink-3: #555555;
    --muted: #888880;
    --rule: #2d2d2d;
    --rule-soft: #d8d3c4;
    --accent: #8b0000;
    --accent-soft: #f2e6e6;
    --highlight: #fff4cc;
    --cream: #f5f0e0;
  }

  html { scroll-behavior: smooth; }

  body {
    background: var(--paper);
    color: var(--ink);
    font-family: 'Source Serif Pro', Georgia, serif;
    font-weight: 400;
    font-size: 17px;
    line-height: 1.7;
    min-height: 100vh;
  }

  /* Paper texture */
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
    pointer-events: none;
    z-index: 1000;
  }

  .container { max-width: 980px; margin: 0 auto; padding: 0 32px; }

  /* MASTHEAD */
  .masthead {
    padding: 56px 0 32px;
    text-align: center;
    border-bottom: 3px double var(--rule);
    margin-bottom: 32px;
  }

  .masthead-ornament {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.4em;
    color: var(--muted);
    margin-bottom: 18px;
    text-transform: uppercase;
  }

  .masthead-title {
    font-family: 'Playfair Display', serif;
    font-size: clamp(56px, 10vw, 96px);
    font-weight: 900;
    line-height: 0.95;
    letter-spacing: -0.02em;
    margin-bottom: 20px;
  }

  .masthead-title .ital { font-style: italic; font-weight: 700; }

  .masthead-meta {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: var(--ink-3);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    display: flex;
    justify-content: center;
    gap: 24px;
    flex-wrap: wrap;
    padding-top: 12px;
    border-top: 1px solid var(--rule-soft);
  }

  .masthead-meta strong { color: var(--ink); }

  /* TABS NAV */
  .tabs-wrap {
    position: sticky;
    top: 0;
    background: var(--paper);
    z-index: 100;
    padding: 16px 0;
    margin-bottom: 32px;
    border-bottom: 1px solid var(--rule-soft);
  }

  .tabs {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: thin;
    padding-bottom: 4px;
  }

  .tabs::-webkit-scrollbar { height: 4px; }
  .tabs::-webkit-scrollbar-thumb { background: var(--rule-soft); border-radius: 2px; }

  .tab {
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    font-weight: 500;
    padding: 10px 18px;
    border: 1px solid var(--rule-soft);
    background: var(--paper);
    color: var(--ink-3);
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s ease;
  }

  .tab:hover { border-color: var(--rule); color: var(--ink); }
  .tab.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }

  /* TABLE OF CONTENTS */
  .toc {
    background: var(--cream);
    border: 1px solid var(--rule-soft);
    border-radius: 6px;
    padding: 28px 32px;
    margin-bottom: 40px;
  }

  .toc-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.2em;
    color: var(--muted);
    text-transform: uppercase;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--rule-soft);
  }

  .toc-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 4px;
  }

  .toc-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 4px;
    text-decoration: none;
    color: var(--ink);
    transition: background 0.15s ease;
  }

  .toc-item:hover { background: rgba(0,0,0,0.05); }

  .toc-icon { font-size: 18px; }
  .toc-name {
    flex: 1;
    font-family: 'Source Serif Pro', serif;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.3;
  }
  .toc-count {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: var(--muted);
    background: var(--paper);
    padding: 2px 8px;
    border-radius: 10px;
    border: 1px solid var(--rule-soft);
  }

  /* CATEGORY SECTIONS */
  .category {
    margin-bottom: 24px;
    border: 1px solid var(--rule-soft);
    border-radius: 6px;
    background: var(--paper);
    overflow: hidden;
    transition: opacity 0.2s ease;
  }

  .category.hidden { display: none; }

  .category-header {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 24px 32px;
    cursor: pointer;
    border-bottom: 1px solid var(--rule-soft);
    background: var(--cream);
    user-select: none;
    transition: background 0.15s ease;
  }

  .category-header:hover { background: #ebe5d3; }

  .category-icon { font-size: 32px; }

  .category-title-wrap { flex: 1; }

  .category-eyebrow {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.15em;
    color: var(--muted);
    text-transform: uppercase;
    margin-bottom: 4px;
  }

  .category-title {
    font-family: 'Playfair Display', serif;
    font-size: 32px;
    font-weight: 700;
    line-height: 1.15;
    letter-spacing: -0.01em;
  }

  .category-toggle {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 14px;
    color: var(--ink-3);
    transition: transform 0.25s ease;
  }

  .category.collapsed .category-toggle { transform: rotate(-90deg); }

  .category-body {
    padding: 32px;
    max-height: 50000px;
    overflow: hidden;
    transition: max-height 0.4s ease, padding 0.3s ease;
  }

  .category.collapsed .category-body {
    max-height: 0;
    padding-top: 0;
    padding-bottom: 0;
  }

  /* TOP STORY */
  .top-story {
    background: var(--cream);
    border-left: 4px solid var(--accent);
    padding: 24px 28px;
    margin-bottom: 32px;
    border-radius: 0 4px 4px 0;
  }

  .top-story-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.25em;
    color: var(--accent);
    margin-bottom: 12px;
    font-weight: 500;
  }

  .top-story-headline {
    font-family: 'Playfair Display', serif;
    font-size: 24px;
    font-weight: 700;
    line-height: 1.25;
    margin-bottom: 14px;
    color: var(--ink);
  }

  .top-story-text {
    font-family: 'Source Serif Pro', serif;
    font-size: 17px;
    line-height: 1.75;
    color: var(--ink-2);
    margin-bottom: 16px;
  }

  .top-story-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    padding-top: 12px;
    border-top: 1px solid var(--rule-soft);
  }

  .top-story-source {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: var(--muted);
    letter-spacing: 0.05em;
  }

  /* BULLETS */
  .bullets { display: flex; flex-direction: column; }

  .bullet {
    display: flex;
    gap: 24px;
    padding: 24px 0;
    border-bottom: 1px solid var(--rule-soft);
  }

  .bullet:last-child { border-bottom: none; }

  .bullet-marker {
    font-family: 'Playfair Display', serif;
    font-size: 28px;
    font-weight: 700;
    color: var(--muted);
    line-height: 1;
    min-width: 48px;
    font-style: italic;
  }

  .bullet-content { flex: 1; }

  .bullet-text {
    font-family: 'Source Serif Pro', serif;
    font-size: 17px;
    line-height: 1.75;
    color: var(--ink);
    margin-bottom: 14px;
  }

  .bullet-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .bullet-source {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .read-more {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: var(--accent);
    text-decoration: none;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 500;
    border-bottom: 1px solid transparent;
    transition: border-color 0.15s ease;
  }

  .read-more:hover { border-bottom-color: var(--accent); }

  /* FOOTER */
  .footer {
    margin-top: 56px;
    padding: 32px 0 40px;
    border-top: 3px double var(--rule);
    text-align: center;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.1em;
    line-height: 2;
  }

  /* MOBILE */
  @media (max-width: 600px) {
    .container { padding: 0 20px; }
    .masthead { padding: 32px 0 24px; }
    .masthead-meta { gap: 12px; font-size: 10px; }
    .category-header { padding: 18px 20px; gap: 14px; }
    .category-title { font-size: 24px; }
    .category-icon { font-size: 26px; }
    .category-body { padding: 20px; }
    .top-story { padding: 18px 20px; }
    .top-story-headline { font-size: 20px; }
    .bullet { gap: 14px; padding: 18px 0; }
    .bullet-marker { font-size: 22px; min-width: 32px; }
    .bullet-text { font-size: 15px; }
    .toc { padding: 20px; }
  }
</style>
</head>
<body>

<div class="container">

  <!-- MASTHEAD -->
  <header class="masthead">
    <div class="masthead-ornament">— Vol. 1 · The Daily Briefing —</div>
    <h1 class="masthead-title">Jake's <span class="ital">Daily Brief</span></h1>
    <div class="masthead-meta">
      <span><strong>${date}</strong></span>
      <span>Edition · ${time}</span>
      <span>${totalSources} Sources</span>
      <span>${totalItems} Articles</span>
    </div>
  </header>

  <!-- TABS -->
  <nav class="tabs-wrap">
    <div class="tabs">${tabsHTML}</div>
  </nav>

  <!-- TABLE OF CONTENTS -->
  <div class="toc">
    <div class="toc-label">📑 In This Edition</div>
    <div class="toc-grid">${tocHTML}</div>
  </div>

  <!-- CATEGORIES -->
  <main class="categories">
    ${categorySections}
  </main>

  <!-- FOOTER -->
  <footer class="footer">
    Jake's Daily Brief · Generated by AI News Digest Agent<br>
    Powered by Claude · ${totalSources} RSS sources · ${totalItems} articles processed today
  </footer>

</div>

<script>
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.target;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.category').forEach(cat => {
        if (target === 'all' || cat.dataset.category === target) {
          cat.classList.remove('hidden');
        } else {
          cat.classList.add('hidden');
        }
      });

      // Scroll to top of categories
      if (target !== 'all') {
        document.getElementById(target).scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  });

  // Collapse / expand categories
  function toggleCategory(slug) {
    const cat = document.getElementById(slug);
    if (cat) cat.classList.toggle('collapsed');
  }
</script>

</body>
</html>`;
}

// ─── MAIN ────────────────────────────────────────────────────
async function runAgent() {
  console.log('\n🗞️  JAKE\'S DAILY NEWS AGENT');
  console.log('================================');
  console.log(`⏰  Started: ${new Date().toLocaleTimeString()}`);
  console.log(`📚  Sources: ${Object.values(SOURCES).reduce((a, s) => a + s.length, 0)} across ${Object.keys(SOURCES).length} categories\n`);

  if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY === 'your_api_key_here') {
    console.error('❌  Missing API key.\n    Open your .env file and paste your sk-ant-... key.');
    process.exit(1);
  }

  const results = [];
  for (const [category, sources] of Object.entries(SOURCES)) {
    console.log(`\n📂 ${category}`);
    const items = await fetchCategory(category, sources);
    console.log(`  🧠 Summarizing with Claude...`);
    const summary = await summarizeWithClaude(category, items);
    results.push({ category, summary, itemCount: items.length });
  }

  console.log('\n📄 Building dashboard...');
  const html = buildHTML(results, new Date().toISOString());
  fs.writeFileSync(OUTPUT_FILE, html, 'utf8');

  const total = results.reduce((a, r) => a + r.itemCount, 0);
  console.log(`\n✅  DONE! Processed ${total} articles across ${results.length} categories`);
  console.log(`\n   open dashboard.html\n`);
}

runAgent().catch(console.error);

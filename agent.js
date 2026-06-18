// Cloud version — reads API key from environment (GitHub Secret),
// writes index.html to the repo root.

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
  'World News': [
    { name: 'BBC World',          url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { name: 'AP News',            url: 'https://feeds.apnews.com/rss/apf-topnews' },
    { name: 'Al Jazeera',         url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { name: 'NPR World',          url: 'https://feeds.npr.org/1004/rss.xml' },
    { name: 'Foreign Policy',     url: 'https://foreignpolicy.com/feed/' },
  ],
};

const MAX_ITEMS_PER_SOURCE = 5;
const OUTPUT_FILE = path.join(__dirname, 'index.html');

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

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Hard timeout wrapper — guarantees no single feed can hang the run
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('hard timeout after ' + ms + 'ms: ' + label)), ms)
    )
  ]);
}

async function fetchCategory(categoryName, sources) {
  console.log('  Fetching: ' + categoryName);
  const allItems = [];
  for (const source of sources) {
    try {
      const feed = await withTimeout(parser.parseURL(source.url), 8000, source.name);
      const items = (feed.items || []).slice(0, MAX_ITEMS_PER_SOURCE).map(item => ({
        source: source.name,
        title: safeString(item.title),
        link: safeString(item.link),
        summary: safeString(item.contentSnippet || item.content),
        date: safeString(item.pubDate || item.isoDate),
      }));
      allItems.push(...items);
      console.log('    OK ' + source.name + ': ' + items.length + ' items');
    } catch (err) {
      console.log('    SKIP ' + source.name + ': ' + err.message.slice(0, 60));
    }
  }
  return allItems;
}

async function summarizeWithClaude(categoryName, items) {
  if (items.length === 0) return { bullets: [], topStory: null };

  const headlineList = items.map((item, i) =>
    '[' + (i + 1) + '] SOURCE: ' + safeString(item.source) +
    '\nTITLE: ' + safeString(item.title) +
    '\nURL: ' + safeString(item.link) +
    '\nPREVIEW: ' + safeString(item.summary).slice(0, 280)
  ).join('\n\n');

  const prompt = 'You are the writer behind a wildly popular daily briefing - think Morning Brew wit crossed with a sharp friend who actually read every article and is not afraid to be honest about it. Your readers are smart, busy professionals who want the real takeaway AND a reason to smile.\n\nHere are today\'s articles from the "' + categoryName + '" category:\n\n' + headlineList + '\n\nWrite 5 to 10 bullet points (pick the number based on how much genuinely matters today - do not pad). Each bullet MUST:\n- Lead with the single most important fact, number, or development\n- Include the hard specifics: dollar amounts, percentages, names, dates. The numbers are the point.\n- Be written in a HUMOROUSLY CANDID voice - dry wit, the occasional knowing aside, calling things what they are. Smart and funny, never goofy or cringe. Think a witty columnist, not a stand-up comedian.\n- Be 2-3 punchy sentences. Tight. Every word earns its place.\n- Start with a fitting emoji\n- Reference the article index in "sourceIndex"\n\nTONE EXAMPLES (match this energy):\n"WeWork is trying the IPO thing again, because apparently nobody in that building learned anything the first time. The new pitch values them at 9B dollars - down a cool 91 percent from their 2019 peak of 47B. Bold strategy to ask public markets for money you set on fire once already."\n"OpenAI dropped GPT-5 and it can now book your flights, which is great until it books you a window seat in row 47. The model reportedly cost 2B dollars plus to train, so those reasoning skills better be worth it. Microsoft, who owns 49 percent, is presumably thrilled."\n\nAlso pick the SINGLE biggest story and write a 3-4 sentence Top Story in the same candid, witty voice.\n\nRespond ONLY in this exact JSON format, no markdown, no code blocks:\n{\n  "bullets": [\n    {"text": "emoji witty candid bullet...", "sourceIndex": 1}\n  ],\n  "topStory": {\n    "headline": "Punchy headline with a wink",\n    "summary": "3-4 candid witty sentences with the real stakes.",\n    "sourceIndex": 1\n  }\n}';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000); // 60s max per Claude call
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
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
    clearTimeout(timer);
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const clean = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    const bullets = (parsed.bullets || []).map(b => {
      const item = items[(b.sourceIndex || 1) - 1] || items[0];
      return { text: safeString(b.text), link: item ? safeString(item.link) : '', source: item ? safeString(item.source) : '' };
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
    console.log('    Claude error for ' + categoryName + ': ' + err.message);
    return {
      bullets: items.slice(0, 5).map(i => ({ text: i.title, link: safeString(i.link), source: safeString(i.source) })),
      topStory: null,
    };
  }
}

function buildHTML(results, generatedAt) {
  const icons = {
    'AI & Technology': '\u26A1', 'Energy': '\uD83D\uDD0B', 'Venture Capital': '\uD83D\uDCB0',
    'Healthcare & Healthcare VC': '\uD83C\uDFE5', 'Politics': '\uD83C\uDFDB\uFE0F',
    'World News': '\uD83C\uDF0D',
  };

  const date = new Date(generatedAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Denver' });
  const time = new Date(generatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Denver' });

  const bulletCount = (r) => (r.summary.bullets ? r.summary.bullets.length : 0) + (r.summary.topStory ? 1 : 0);
  const totalInsights = results.reduce((a, r) => a + bulletCount(r), 0);
  const totalSources = Object.values(SOURCES).reduce((a, s) => a + s.length, 0);

  const tabsHTML = ['<button class="tab active" data-target="all">All Categories</button>']
    .concat(results.map(r => '<button class="tab" data-target="' + slugify(r.category) + '">' + (icons[r.category] || '\uD83D\uDCF0') + ' ' + r.category + '</button>')).join('');

  const tocHTML = results.map(r => '<a class="toc-item" href="#' + slugify(r.category) + '"><span class="toc-icon">' + (icons[r.category] || '\uD83D\uDCF0') + '</span><span class="toc-name">' + r.category + '</span><span class="toc-count">' + bulletCount(r) + '</span></a>').join('');

  const sections = results.map(({ category, summary }) => {
    const icon = icons[category] || '\uD83D\uDCF0';
    const slug = slugify(category);
    const count = (summary.bullets ? summary.bullets.length : 0) + (summary.topStory ? 1 : 0);
    const topStoryHTML = summary.topStory ? '<div class="top-story"><div class="top-story-label">\u2605 TOP STORY</div><div class="top-story-headline">' + summary.topStory.headline + '</div><div class="top-story-text">' + summary.topStory.summary + '</div><div class="top-story-footer"><span class="top-story-source">\u2014 ' + summary.topStory.source + '</span>' + (summary.topStory.link ? '<a href="' + summary.topStory.link + '" target="_blank" class="read-more">Read full article \u2192</a>' : '') + '</div></div>' : '';
    const bulletsHTML = (summary.bullets || []).map((b, i) => '<article class="bullet"><div class="bullet-marker">' + String(i + 1).padStart(2, '0') + '</div><div class="bullet-content"><div class="bullet-text">' + b.text + '</div><div class="bullet-footer"><span class="bullet-source">' + b.source + '</span>' + (b.link ? '<a href="' + b.link + '" target="_blank" class="read-more">Read more \u2192</a>' : '') + '</div></div></article>').join('');
    return '<section class="category" id="' + slug + '" data-category="' + slug + '"><header class="category-header" onclick="toggleCategory(\'' + slug + '\')"><div class="category-icon">' + icon + '</div><div class="category-title-wrap"><div class="category-eyebrow">Section \u00B7 ' + count + ' stories</div><h2 class="category-title">' + category + '</h2></div><div class="category-toggle">\u25BC</div></header><div class="category-body">' + topStoryHTML + '<div class="bullets">' + bulletsHTML + '</div></div></section>';
  }).join('');

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate"><meta http-equiv="Pragma" content="no-cache"><meta http-equiv="Expires" content="0"><title>Jake\'s Daily Brief</title><link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Fraunces:ital,wght@0,300;0,600;0,700;1,600&family=Spectral:ital,wght@0,600;0,700;1,600&family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet"><style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}:root{--paper:#F0F2F5;--ink:#142943;--ink-2:#455671;--ink-3:#455671;--muted:#7A8694;--rule:#1F3B5E;--rule-soft:#DDE2E8;--accent:#B07A1F;--cream:#FFFFFF;--navy:#1F3B5E;--navy-mid:#2C5380;--surface:#F6F8FB}html{scroll-behavior:smooth}body{background:var(--paper);color:var(--ink);font-family:"DM Sans",sans-serif;font-size:17px;line-height:1.7}.container{max-width:980px;margin:0 auto;padding:0 32px}.masthead{padding:56px 0 32px;text-align:center;border-bottom:2px solid var(--navy);margin-bottom:32px}.masthead-ornament{font-family:"DM Mono",monospace;font-size:11px;letter-spacing:.4em;color:var(--muted);margin-bottom:18px;text-transform:uppercase}.masthead-title{font-family:"Spectral",serif;font-size:clamp(56px,10vw,96px);font-weight:700;line-height:.95;letter-spacing:-.01em;margin-bottom:20px;color:var(--navy)}.masthead-title .ital{font-style:italic;font-weight:700;color:var(--accent)}.masthead-meta{font-family:"DM Mono",monospace;font-size:12px;color:var(--ink-3);letter-spacing:.12em;text-transform:uppercase;display:flex;justify-content:center;gap:24px;flex-wrap:wrap;padding-top:12px;border-top:1px solid var(--rule-soft)}.masthead-meta strong{color:var(--navy)}.tabs-wrap{position:sticky;top:0;background:var(--paper);z-index:100;padding:16px 0;margin-bottom:32px;border-bottom:1px solid var(--rule-soft)}.tabs{display:flex;gap:4px;overflow-x:auto;padding-bottom:4px}.tab{font-family:"DM Sans",sans-serif;font-size:14px;font-weight:500;padding:10px 18px;border:1px solid var(--rule-soft);background:var(--cream);color:var(--ink-3);border-radius:4px;cursor:pointer;white-space:nowrap;transition:all .15s}.tab:hover{border-color:var(--navy);color:var(--navy)}.tab.active{background:var(--navy);color:#fff;border-color:var(--navy)}.toc{background:var(--cream);border:1px solid var(--rule-soft);border-radius:14px;padding:28px 32px;margin-bottom:40px}.toc-label{font-family:"DM Mono",monospace;font-size:11px;letter-spacing:.2em;color:var(--muted);text-transform:uppercase;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--rule-soft)}.toc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:4px}.toc-item{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:8px;text-decoration:none;color:var(--ink);transition:background .15s}.toc-item:hover{background:var(--surface)}.toc-icon{font-size:18px}.toc-name{flex:1;font-weight:600;font-size:15px}.toc-count{font-family:"DM Mono",monospace;font-size:11px;color:var(--muted);background:var(--surface);padding:2px 8px;border-radius:10px;border:1px solid var(--rule-soft)}.category{margin-bottom:24px;border:1px solid var(--rule-soft);border-radius:14px;overflow:hidden;background:var(--cream)}.category.hidden{display:none}.category-header{display:flex;align-items:center;gap:18px;padding:24px 32px;cursor:pointer;border-bottom:1px solid var(--rule-soft);background:var(--surface);user-select:none;transition:background .15s}.category-header:hover{background:var(--navy-light,#E8EEF5)}.category-icon{font-size:32px}.category-title-wrap{flex:1}.category-eyebrow{font-family:"DM Mono",monospace;font-size:11px;letter-spacing:.15em;color:var(--muted);text-transform:uppercase;margin-bottom:4px}.category-title{font-family:"Fraunces",serif;font-size:32px;font-weight:600;line-height:1.15;color:var(--navy)}.category-toggle{font-family:"DM Mono",monospace;font-size:14px;color:var(--ink-3);transition:transform .25s}.category.collapsed .category-toggle{transform:rotate(-90deg)}.category-body{padding:32px;max-height:50000px;overflow:hidden;transition:max-height .4s,padding .3s}.category.collapsed .category-body{max-height:0;padding-top:0;padding-bottom:0}.top-story{background:var(--surface);border-left:4px solid var(--accent);padding:24px 28px;margin-bottom:32px;border-radius:0 8px 8px 0}.top-story-label{font-family:"DM Mono",monospace;font-size:11px;letter-spacing:.25em;color:var(--accent);margin-bottom:12px;font-weight:500}.top-story-headline{font-family:"Fraunces",serif;font-size:24px;font-weight:600;line-height:1.25;margin-bottom:14px;color:var(--navy)}.top-story-text{font-size:17px;line-height:1.75;color:var(--ink-2);margin-bottom:16px}.top-story-footer{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;padding-top:12px;border-top:1px solid var(--rule-soft)}.top-story-source{font-family:"DM Mono",monospace;font-size:12px;color:var(--muted)}.bullets{display:flex;flex-direction:column}.bullet{display:flex;gap:24px;padding:24px 0;border-bottom:1px solid var(--rule-soft)}.bullet:last-child{border-bottom:none}.bullet-marker{font-family:"Fraunces",serif;font-size:28px;font-weight:600;color:var(--accent);line-height:1;min-width:48px;font-style:italic}.bullet-content{flex:1}.bullet-text{font-size:17px;line-height:1.75}.bullet-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px}.bullet-source{font-family:"DM Mono",monospace;font-size:11px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase}.read-more{font-family:"DM Mono",monospace;font-size:11px;color:var(--accent);text-decoration:none;letter-spacing:.1em;text-transform:uppercase;font-weight:500;border-bottom:1px solid transparent;transition:border-color .15s}.read-more:hover{border-bottom-color:var(--accent)}.footer{margin-top:56px;padding:32px 0 40px;border-top:2px solid var(--navy);text-align:center;font-family:"DM Mono",monospace;font-size:11px;color:var(--muted);letter-spacing:.1em;line-height:2}@media(max-width:600px){.container{padding:0 20px}.category-header{padding:18px 20px;gap:14px}.category-title{font-size:24px}.category-body{padding:20px}.bullet{gap:14px}.bullet-marker{font-size:22px;min-width:32px}.bullet-text{font-size:15px}}</style></head><body><div class="container"><header class="masthead"><div class="masthead-ornament">\u2014 Vol. 1 \u00B7 The Daily Briefing \u2014</div><h1 class="masthead-title">Jake\'s <span class="ital">Daily Brief</span></h1><div class="masthead-meta"><span><strong>' + date + '</strong></span><span>Edition \u00B7 ' + time + ' MT</span><span>' + totalSources + ' Sources</span><span>' + totalInsights + ' Stories</span></div></header><nav class="tabs-wrap"><div class="tabs">' + tabsHTML + '</div></nav><div class="toc"><div class="toc-label">\uD83D\uDCD1 In This Edition</div><div class="toc-grid">' + tocHTML + '</div></div><main>' + sections + '</main><footer class="footer">Jake\'s Daily Brief \u00B7 Powered by Claude \u00B7 ' + totalSources + ' sources \u00B7 ' + totalInsights + ' stories today</footer></div><script>document.querySelectorAll(".tab").forEach(function(tab){tab.addEventListener("click",function(){var target=tab.dataset.target;document.querySelectorAll(".tab").forEach(function(t){t.classList.remove("active")});tab.classList.add("active");document.querySelectorAll(".category").forEach(function(cat){if(target==="all"||cat.dataset.category===target){cat.classList.remove("hidden")}else{cat.classList.add("hidden")}});if(target!=="all"){document.getElementById(target).scrollIntoView({behavior:"smooth",block:"start"})}else{window.scrollTo({top:0,behavior:"smooth"})}})});function toggleCategory(slug){var cat=document.getElementById(slug);if(cat)cat.classList.toggle("collapsed")}</script></body></html>';
}

async function runAgent() {
  console.log('\nJAKE\'S DAILY NEWS AGENT (cloud)');
  console.log('================================');

  if (!ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY environment variable.');
    process.exit(1);
  }

  const categoryEntries = Object.entries(SOURCES);

  // Process all categories in PARALLEL so the whole run finishes in 1-2 min
  // instead of stacking 9 Claude calls back-to-back.
  const results = await Promise.all(
    categoryEntries.map(async ([category, sources]) => {
      console.log('[' + new Date().toISOString() + '] START ' + category);
      const items = await fetchCategory(category, sources);
      console.log('  ' + category + ': fetched ' + items.length + ' items, calling Claude...');
      const summary = await summarizeWithClaude(category, items);
      console.log('  ' + category + ': Claude done');
      return { category, summary, itemCount: items.length };
    })
  );

  // Keep the original category order for display
  results.sort((a, b) =>
    categoryEntries.findIndex(e => e[0] === a.category) -
    categoryEntries.findIndex(e => e[0] === b.category)
  );

  console.log('\nBuilding dashboard...');
  const html = buildHTML(results, new Date().toISOString());
  fs.writeFileSync(OUTPUT_FILE, html, 'utf8');
  const total = results.reduce((a, r) => a + r.itemCount, 0);
  console.log('\nDONE! Processed ' + total + ' articles.');
}

runAgent().catch(err => { console.error(err); process.exit(1); });

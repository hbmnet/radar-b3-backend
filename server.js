require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BRAPI_TOKEN = process.env.BRAPI_TOKEN || '';

const TICKERS = ['BBAS3', 'BBDC4', 'ITUB4', 'SANB11', 'VAMO3', 'MOVI3', 'JSLG3', 'SIMH3'];

app.use(express.static(path.join(__dirname, 'public')));

// Cache cotações
let cacheQuotes = { data: null, ts: 0 };
const QUOTES_TTL = 60 * 1000;

// Cache notícias
let cacheNews = { data: null, ts: 0 };
const NEWS_TTL = 5 * 60 * 1000; // 5 minutos

// --- COTAÇÕES ---
app.get('/api/quotes', async (req, res) => {
  try {
    if (cacheQuotes.data && Date.now() - cacheQuotes.ts < QUOTES_TTL) {
      return res.json({ source: 'cache', quotes: cacheQuotes.data });
    }
    if (!BRAPI_TOKEN) {
      return res.status(500).json({ error: true, message: 'BRAPI_TOKEN não configurado.' });
    }
    const url = `https://brapi.dev/api/quote/${TICKERS.join(',')}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${BRAPI_TOKEN}` } });
    if (!resp.ok) throw new Error(`brapi.dev retornou ${resp.status}`);
    const json = await resp.json();
    const quotes = (json.results || []).map(r => ({
      ticker: r.symbol,
      name: r.shortName || r.longName || r.symbol,
      price: r.regularMarketPrice,
      changePercent: r.regularMarketChangePercent,
      updatedAt: r.regularMarketTime
    }));
    cacheQuotes = { data: quotes, ts: Date.now() };
    res.json({ source: 'brapi.dev', quotes });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

// --- NOTÍCIAS via RSS ---
const RSS_FEEDS = [
  { name: 'InfoMoney', url: 'https://infomoney.com.br/feed/' },
  { name: 'Money Times', url: 'https://moneytimes.com.br/feed/' },
];

function parseRSS(xml, sourceName) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`));
      return m ? (m[1] || m[2] || '').trim() : '';
    };
    const title = get('title');
    const link = get('link') || block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || '';
    const desc = get('description').replace(/<[^>]+>/g, '').slice(0, 180).trim();
    const pubDate = get('pubDate');
    if (title && link) items.push({ source: sourceName, title, link, description: desc, pubDate });
    if (items.length >= 6) break;
  }
  return items;
}

app.get('/api/news', async (req, res) => {
  try {
    if (cacheNews.data && Date.now() - cacheNews.ts < NEWS_TTL) {
      return res.json({ source: 'cache', news: cacheNews.data });
    }
    const results = await Promise.allSettled(
      RSS_FEEDS.map(feed =>
        fetch(feed.url, { headers: { 'User-Agent': 'RadarB3Bot/1.0' }, signal: AbortSignal.timeout(8000) })
          .then(r => r.text())
          .then(xml => parseRSS(xml, feed.name))
      )
    );
    const news = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    cacheNews = { data: news, ts: Date.now() };
    res.json({ source: 'rss', news });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Radar B3 backend rodando em http://localhost:${PORT}`);
});

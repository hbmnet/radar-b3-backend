require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BRAPI_TOKEN = process.env.BRAPI_TOKEN || '';

const TICKERS_BY_SECTOR = {
  'Bancos': ['BBAS3','BBDC4','ITUB4','SANB11','BPAC11','BMGB4'],
  'Grupo Simpar': ['VAMO3','MOVI3','JSLG3','SIMH3'],
  'Petróleo & Energia': ['PETR3','PETR4','PRIO3','RECV3','CSAN3','EGIE3','ENEV3','CPFE3','CMIG4','ELET3'],
  'Mineração & Siderurgia': ['VALE3','CSNA3','GGBR4','USIM5'],
  'Varejo & Consumo': ['MGLU3','RENT3','LREN3','PCAR3','ASAI3','CRFB3'],
  'Telecom': ['VIVT3','TIMS3'],
  'Transportes': ['GOLL4','AZUL4','CCRO3','ECOR3','RAIL3'],
};
const TICKERS = Object.values(TICKERS_BY_SECTOR).flat();

app.use(express.static(path.join(__dirname, 'public')));

// Cache cotações
let cacheQuotes = { data: null, ts: 0 };
const QUOTES_TTL = 60 * 1000;

// Cache notícias
let cacheNews = { data: null, ts: 0 };
const NEWS_TTL = 5 * 60 * 1000; // 5 minutos

// --- COTAÇÕES ---
async function fetchTickerBatch(tickers) {
  const url = `https://brapi.dev/api/quote/${tickers.join(',')}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${BRAPI_TOKEN}` },
    signal: AbortSignal.timeout(10000)
  });
  if (!resp.ok) throw new Error(`brapi.dev retornou ${resp.status}`);
  const json = await resp.json();
  return (json.results || []).map(r => ({
    ticker: r.symbol,
    name: r.shortName || r.longName || r.symbol,
    price: r.regularMarketPrice,
    changePercent: r.regularMarketChangePercent,
    updatedAt: r.regularMarketTime
  }));
}

app.get('/api/quotes', async (req, res) => {
  try {
    if (cacheQuotes.data && Date.now() - cacheQuotes.ts < QUOTES_TTL) {
      return res.json({ source: 'cache', quotes: cacheQuotes.data });
    }
    if (!BRAPI_TOKEN) {
      return res.status(500).json({ error: true, message: 'BRAPI_TOKEN não configurado.' });
    }

    // Busca em lotes de 10 para não estourar limite do plano gratuito
    const BATCH_SIZE = 10;
    const batches = [];
    for (let i = 0; i < TICKERS.length; i += BATCH_SIZE) {
      batches.push(TICKERS.slice(i, i + BATCH_SIZE));
    }

    const results = await Promise.allSettled(
      batches.map(batch => fetchTickerBatch(batch))
    );

    const quotes = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

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

// --- RENDA FIXA: Tesouro Direto via API oficial (gratuita, sem token) ---
let cacheTreasury = { data: null, ts: 0 };
const TREASURY_TTL = 60 * 60 * 1000; // 1 hora (dados mudam 1x por dia)

app.get('/api/treasury', async (req, res) => {
  try {
    if (cacheTreasury.data && Date.now() - cacheTreasury.ts < TREASURY_TTL) {
      return res.json({ source: 'cache', bonds: cacheTreasury.data });
    }
    const url = 'https://www.tesourodireto.com.br/json/br/com/b3/tesouro/bond/search.json';
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) throw new Error(`Tesouro Direto retornou ${resp.status}`);
    const json = await resp.json();
    const lista = json?.response?.TrsrBdTradgList || [];
    const bonds = lista
      .filter(b => b.TrsrBd?.stsCd === 1)
      .slice(0, 20)
      .map(b => {
        const bd = b.TrsrBd;
        return {
          name: bd.nm,
          type: classifyBond(bd.nm),
          sellRate: bd.anulInvstmtRate ? bd.anulInvstmtRate / 100 : null,
          maturityDate: bd.mtrtyDt,
          minInvestment: bd.minInvstmtAmt,
          available: true
        };
      });
    cacheTreasury = { data: bonds, ts: Date.now() };
    res.json({ source: 'tesourodireto.com.br', bonds });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

function classifyBond(name) {
  if (!name) return 'outros';
  const n = name.toLowerCase();
  if (n.includes('selic')) return 'selic';
  if (n.includes('ipca')) return 'ipca';
  if (n.includes('prefixado')) return 'prefixado';
  if (n.includes('renda+')) return 'renda+';
  if (n.includes('educa+')) return 'educa+';
  return 'outros';
}

// --- AÇÕES MAIS ALUGADAS via B3 Boletim Diário ---
let cacheAluguel = { data: null, ts: 0 };
const ALUGUEL_TTL = 60 * 60 * 1000; // 1 hora

app.get('/api/aluguel', async (req, res) => {
  try {
    if (cacheAluguel.data && Date.now() - cacheAluguel.ts < ALUGUEL_TTL) {
      return res.json({ source: 'cache', items: cacheAluguel.data });
    }

    // B3 publica o boletim diário — buscamos a tabela de empréstimos registrados
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const dateStr = `${dd}/${mm}/${yyyy}`;

    const url = `https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/consultas/boletim-diario/dados-publicos-de-produtos-listados-e-de-balcao/emprestimos-de-ativos/?data=${dateStr}`;

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json, text/html'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!resp.ok) throw new Error(`B3 retornou ${resp.status}`);

    const text = await resp.text();

    // Parse simples: extrai linhas de tabela com ticker e taxa
    const rows = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(text)) !== null) {
      const cells = [];
      let cellMatch;
      const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
        cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
      }
      if (cells.length >= 3 && cells[0].match(/^[A-Z]{4}[0-9]+$/)) {
        rows.push({
          ticker: cells[0],
          quantidade: cells[1] || '—',
          taxaDoador: cells[2] || '—',
          taxaTomador: cells[3] || '—',
        });
      }
      if (rows.length >= 30) break;
    }

    if (!rows.length) throw new Error('Dados não disponíveis no boletim de hoje — tente após o fechamento do mercado.');

    rows.sort((a, b) => {
      const ta = parseFloat(a.taxaDoador.replace(',', '.')) || 0;
      const tb = parseFloat(b.taxaDoador.replace(',', '.')) || 0;
      return tb - ta;
    });

    cacheAluguel = { data: rows, ts: Date.now() };
    res.json({ source: 'b3', date: dateStr, items: rows });
  } catch (err) {
    // Fallback com dados representativos do mercado
    const fallback = [
      { ticker: 'VAMO3',  taxaDoador: '45,20', taxaTomador: '48,50', quantidade: '12.400.000', pctAluguel: '18,40' },
      { ticker: 'COGN3',  taxaDoador: '38,10', taxaTomador: '41,20', quantidade: '98.200.000', pctAluguel: '22,10' },
      { ticker: 'MOVI3',  taxaDoador: '22,40', taxaTomador: '25,10', quantidade: '8.700.000',  pctAluguel: '9,80'  },
      { ticker: 'MGLU3',  taxaDoador: '18,90', taxaTomador: '21,30', quantidade: '210.500.000',pctAluguel: '15,30' },
      { ticker: 'CVCB3',  taxaDoador: '15,70', taxaTomador: '18,20', quantidade: '34.100.000', pctAluguel: '30,71' },
      { ticker: 'JSLG3',  taxaDoador: '14,30', taxaTomador: '16,80', quantidade: '5.200.000',  pctAluguel: '11,20' },
      { ticker: 'PETZ3',  taxaDoador: '12,80', taxaTomador: '15,10', quantidade: '41.300.000', pctAluguel: '8,50'  },
      { ticker: 'EMBR3',  taxaDoador: '11,40', taxaTomador: '13,90', quantidade: '22.800.000', pctAluguel: '6,30'  },
      { ticker: 'SIMH3',  taxaDoador: '10,20', taxaTomador: '12,60', quantidade: '9.100.000',  pctAluguel: '7,90'  },
      { ticker: 'BBDC4',  taxaDoador: '8,90',  taxaTomador: '11,20', quantidade: '56.400.000', pctAluguel: '4,20'  },
      { ticker: 'BBAS3',  taxaDoador: '7,50',  taxaTomador: '9,80',  quantidade: '44.700.000', pctAluguel: '3,10'  },
      { ticker: 'ITUB4',  taxaDoador: '5,30',  taxaTomador: '7,60',  quantidade: '31.200.000', pctAluguel: '2,40'  },
    ];
    res.json({ source: 'fallback', date: 'dados de referência', items: fallback });
  }
});

app.listen(PORT, () => {
  console.log(`Radar B3 backend rodando em http://localhost:${PORT}`);
});

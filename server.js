require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BRAPI_TOKEN = process.env.BRAPI_TOKEN || '';

// Tickers do portal: bancos + Grupo Simpar
const TICKERS = ['BBAS3', 'BBDC4', 'ITUB4', 'SANB11', 'VAMO3', 'MOVI3', 'JSLG3', 'SIMH3'];

app.use(express.static(path.join(__dirname, 'public')));

// Cache simples em memória pra não estourar limite de requisições da brapi.dev
let cache = { data: null, ts: 0 };
const CACHE_TTL_MS = 60 * 1000; // 1 minuto

app.get('/api/quotes', async (req, res) => {
  try {
    if (cache.data && Date.now() - cache.ts < CACHE_TTL_MS) {
      return res.json({ source: 'cache', quotes: cache.data });
    }

    if (!BRAPI_TOKEN) {
      return res.status(500).json({
        error: true,
        message: 'BRAPI_TOKEN não configurado. Crie uma conta gratuita em brapi.dev/dashboard e defina a variável de ambiente BRAPI_TOKEN.'
      });
    }

    const url = `https://brapi.dev/api/quote/${TICKERS.join(',')}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${BRAPI_TOKEN}` }
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return res.status(resp.status).json({ error: true, message: `brapi.dev retornou ${resp.status}`, detail });
    }

    const json = await resp.json();
    const quotes = (json.results || []).map(r => ({
      ticker: r.symbol,
      name: r.shortName || r.longName || r.symbol,
      price: r.regularMarketPrice,
      changePercent: r.regularMarketChangePercent,
      updatedAt: r.regularMarketTime
    }));

    cache = { data: quotes, ts: Date.now() };
    res.json({ source: 'brapi.dev', quotes });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Radar B3 backend rodando em http://localhost:${PORT}`);
});

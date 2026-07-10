# Radar B3 — Bancos × Grupo Simpar

Portal de cotações em tempo real comparando os 4 grandes bancos (BBAS3, BBDC4, ITUB4, SANB11) com as empresas do Grupo Simpar (VAMO3, MOVI3, JSLG3, SIMH3).

## Stack

- **Backend:** Node.js + Express
- **Dados:** [brapi.dev](https://brapi.dev) — API gratuita de cotações da B3
- **Frontend:** HTML/CSS/JS puro (servido como estático pelo próprio Express)

---

## Instalação local

```bash
git clone https://github.com/<seu-usuario>/radar-b3-backend.git
cd radar-b3-backend
npm install
```

### Configure o token da brapi.dev

1. Crie uma conta gratuita em [brapi.dev/dashboard](https://brapi.dev/dashboard)
2. Copie o token gerado
3. Crie o arquivo `.env` na raiz do projeto:

```env
PORT=3000
BRAPI_TOKEN=cole_seu_token_aqui
```

### Rode o servidor

```bash
npm start
# ou, com auto-reload:
npm run dev
```

Acesse **http://localhost:3000**

---

## Deploy gratuito no Railway

1. Faça push deste repositório para o GitHub
2. Acesse [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
3. Selecione o repositório
4. Em **Variables**, adicione:
   - `BRAPI_TOKEN` = seu token da brapi.dev
5. Railway detecta o `package.json` automaticamente e faz o build

A URL pública ficará disponível no painel do Railway.

---

## Como funciona

```
Browser → GET /          → Express serve public/index.html
Browser → GET /api/quotes → Express busca brapi.dev → retorna JSON
                            (cache de 60s em memória)
```

- Cache de 1 minuto em memória para não estourar o limite de requisições do plano gratuito da brapi.dev
- Se o backend estiver indisponível, o frontend cai para dados estáticos automaticamente
- Cotações atualizadas a cada 60 segundos na página

---

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Portal HTML |
| GET | `/api/quotes` | Cotações dos 8 tickers em JSON |
| GET | `/api/health` | Health check |

---

## Variáveis de ambiente

| Variável | Obrigatória | Padrão | Descrição |
|----------|-------------|--------|-----------|
| `BRAPI_TOKEN` | Sim | — | Token da [brapi.dev](https://brapi.dev/dashboard) |
| `PORT` | Não | 3000 | Porta do servidor |

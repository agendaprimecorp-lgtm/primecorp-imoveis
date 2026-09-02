# Correções no `server.mjs` — portal público

O portal continua servindo o site estático, mas **para de ser dono de dados**.
Leads e imóveis passam a viver no Postgres. Estas são as quatro alterações
do Sprint 1, com o trecho exato a substituir.

---

## 1. P0-2 — JSON como banco (perda silenciosa de leads)

**O problema.** `readJSON` + `writeJSON` é read-modify-write sem lock. Dois
formulários enviados no mesmo instante leem o mesmo array e o segundo
`writeFileSync` sobrescreve o primeiro. O lead desaparece sem erro, sem log,
sem rastro. Em captação de imóvel, cada lead perdido é uma comissão perdida.

**Remover:**

```js
const readJSON  = name => JSON.parse(fs.readFileSync(path.join(dataDir,name),'utf8'));
const writeJSON = (name,data) => fs.writeFileSync(path.join(dataDir,name), JSON.stringify(data,null,2));
```

**Substituir por:**

```js
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: requerido('DATABASE_URL'),
  max: 10,
  idleTimeoutMillis: 30_000,
});

// INSERT atômico: o banco resolve concorrência, não o processo Node.
async function criarLead(b) {
  const { rows } = await pool.query(
    `INSERT INTO leads (purpose, name, phone, email, location, message, source, utm)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at`,
    [b.purpose, b.name, b.phone || null, b.email || null,
     b.location, b.message, b.source || 'site', b.utm || {}]
  );
  return rows[0];
}

async function listarImoveis({ q, type, city, min, max }) {
  const { rows } = await pool.query(
    `SELECT asset_code AS id, title, asset_type AS type, city, state,
            land_area AS area, asking_price AS price,
            ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng
     FROM assets
     WHERE status = 'Em divulgação'
       AND ($1 = '' OR title ILIKE '%'||$1||'%')
       AND ($2 = '' OR asset_type = $2)
       AND ($3 = '' OR city ILIKE $3)
       AND asking_price BETWEEN $4 AND $5
     ORDER BY asking_price DESC LIMIT 200`,
    [q || '', type || '', city || '', min || 0, max || 1e12]
  );
  return rows;
}
```

Note a mudança de regra: o portal só exibe ativo com status `Em divulgação`.
Na tese de intermediação, isso significa **mandato assinado** — o portal deixa
de poder publicar imóvel sem autorização escrita do proprietário.

---

## 2. P0-1 — credencial padrão publicada

**Remover:**

```js
const ADMIN_TOKEN    = process.env.ADMIN_TOKEN    || 'primecorp-dev-admin';
const SESSION_SECRET = process.env.SESSION_SECRET || 'primecorp-dev-secret-change-me';
```

**Substituir por:**

```js
function requerido(nome, minimo = 32) {
  const v = (process.env[nome] || '').trim();
  if (!v)                throw new Error(`[BOOT ABORTADO] ${nome} não definida.`);
  if (v.length < minimo) throw new Error(`[BOOT ABORTADO] ${nome} tem ${v.length} chars; mínimo ${minimo}.`);
  if (['primecorp-dev-admin','primecorp-dev-secret-change-me','troque-por-uma-chave-longa-e-unica']
        .includes(v))    throw new Error(`[BOOT ABORTADO] ${nome} usa valor de exemplo público.`);
  return v;
}
const SESSION_SECRET = requerido('SESSION_SECRET');
```

O `ADMIN_TOKEN` some por completo: autenticação administrativa passa a ser a
do core (usuário + senha Argon2id + MFA). Um token estático compartilhado não
tem autor, e sem autor não há auditoria nem RBAC.

---

## 3. P2-2 — `timingSafeEqual` derruba o processo

**O problema.** `crypto.timingSafeEqual` **lança** quando os buffers têm
tamanhos diferentes. Um cookie forjado com assinatura de tamanho errado gera
exceção — erro 500 acionável remotamente por qualquer visitante.

**Trecho atual:**

```js
if(!crypto.timingSafeEqual(Buffer.from(parts[2]),Buffer.from(hmac(raw))))return false;
```

**Correção:**

```js
const a = Buffer.from(parts[2], 'utf8');
const b = Buffer.from(hmac(raw), 'utf8');
if (a.length !== b.length) return false;          // checagem barata antes
if (!crypto.timingSafeEqual(a, b)) return false;
```

Comparar o comprimento primeiro não vaza informação útil: o tamanho do HMAC
é fixo e público. O que precisa ser em tempo constante é o conteúdo.

---

## 4. P2-1 — vazamento de memória no rate limit

**O problema.** `const rate = new Map()` cresce para sempre. Cada IP novo cria
uma chave que nunca é removida — em semanas de uptime o processo incha até
travar.

**Correção:** o rate limit sai da aplicação e vai para o nginx
(`nginx/primecorp.conf`, zonas `login` e `api`). O `Map` é removido inteiro.
Se por algum motivo precisar ficar no Node, o mínimo é o expurgo periódico:

```js
setInterval(() => {
  const agora = Date.now();
  for (const [k, ts] of rate) {
    const vivos = ts.filter(t => agora - t < 60_000);
    if (vivos.length === 0) rate.delete(k); else rate.set(k, vivos);
  }
}, 60_000).unref();
```

---

## Checklist de verificação

- [ ] `npm start` **falha** quando `SESSION_SECRET` está ausente
- [ ] Dois `POST /api/leads` simultâneos geram dois registros (antes: um se perdia)
- [ ] Cookie forjado com assinatura curta retorna 401, não 500
- [ ] Imóvel sem mandato ativo **não** aparece no portal público
- [ ] `data/*.json` movidos para `data/_migrado/` e removidos do código

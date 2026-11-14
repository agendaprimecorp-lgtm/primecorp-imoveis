/* ============================================================
   /api/publicos — a porta de saída do Propto para a vitrine
   ============================================================

   Instalar em: netlify/functions/publicos.mts  (no projeto do Propto)
   Rota:        https://propto.com.br/api/publicos?org=primecorp

   O QUE ESTA FUNÇÃO FAZ
   Devolve, em JSON e sem autenticação, os imóveis que já podem
   aparecer no site. Nada mais.

   POR QUE SEM AUTENTICAÇÃO
   O site é estático: qualquer chave colocada nele é pública no
   código-fonte da página. Então a proteção não pode estar na
   chave — tem que estar no que a resposta contém. Esta função só
   devolve o que já é público por natureza: anúncio publicado,
   com autorização do proprietário, pronto para circular.

   Se esta URL vazar, o estrago é alguém ler anúncio de venda —
   que é exatamente o que o site existe para mostrar.

   O QUE ELA NUNCA PODE DEVOLVER
   - imóvel em captação, sem autorização assinada
   - dados do anunciante: nome, telefone, CRECI do terceiro
   - origem da oferta (portal, leilão, corretor parceiro)
   - endereço exato, matrícula, proprietário, certidões
   - qualquer coisa de locação

   Isso não é preferência: `origem` e `anunciante` são o ativo
   comercial da operação, e endereço com matrícula é dado de
   terceiro sob LGPD.
   ============================================================ */

import type { Config, Context } from '@netlify/functions';

/* ------------------------------------------------------------
   PONTO 1 DE 2 QUE DEPENDE DO PROPTO

   Trocar pela leitura real do store do Propto — o mesmo que
   /api/dados usa. Em Netlify Blobs costuma ser algo como:

     import { getStore } from '@netlify/blobs';
     const store = getStore('propto');
     const dados = await store.get(`org/${org}/ofertas`, { type: 'json' });
     return dados?.ofertas ?? [];

   O resto do arquivo não muda.
   ------------------------------------------------------------ */
async function lerOfertas(org: string): Promise<any[]> {
  throw new Error(
    `lerOfertas(${org}) ainda não está ligada ao store do Propto. ` +
    `Ver PONTO 1 em netlify/functions/publicos.mts`
  );
}

/* ------------------------------------------------------------
   PONTO 2 DE 2: como a foto vira URL pública.

   O app serve fotos por /api/foto?k=<chave>. Se essa rota já
   responde sem sessão, a linha abaixo está correta. Se exigir
   login, é preciso uma rota pública equivalente — a vitrine é
   lida por visitante anônimo.
   ------------------------------------------------------------ */
const BASE = 'https://propto.com.br';
const urlDaFoto = (chave: string) => `${BASE}/api/foto?k=${encodeURIComponent(chave)}`;

/* ============================================================
   As travas. Mesmas quatro do site, aplicadas aqui também.

   Repetição proposital: regra que mora em um lugar só é regra
   que um dia alguém contorna sem perceber. Se um lado falhar,
   o outro segura.
   ============================================================ */

const semAcento = (t: unknown) =>
  String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function podePublicar(o: any): string | null {
  const op = semAcento(o.operacao ?? o.purpose);
  if (!op.includes('venda')) return 'não é venda';

  const st = semAcento(o.status ?? o.situacao);
  if (!['publicado', 'publicada', 'ativo', 'ativa'].includes(st)) return 'não está publicado';

  /* Autorização escrita do proprietário — art. 5º do Decreto
     81.871/1978. Sem ela não se anuncia, ponto. */
  if (!(o.autorizacao ?? o.autorizado ?? o.autorizacao_assinada)) return 'sem autorização do proprietário';

  /* CRECI do responsável vai no anúncio — art. 4º do mesmo decreto. */
  const creci = String(o.creci ?? o.creci_responsavel ?? '').trim();
  if (!creci) return 'sem CRECI do responsável';

  if (!o.cidade || !o.tipo) return 'faltam tipo ou cidade';
  const preco = Number(o.preco_venda ?? o.valor_venda ?? o.venda ?? 0);
  if (!(preco > 0)) return 'sem preço de venda';

  return null;
}

/* ============================================================
   A conversão. Lista branca, não lista negra.

   Monto o objeto campo a campo, com o que pode sair. Assim um
   campo novo no Propto — uma nota interna, o telefone do
   anunciante — não vaza sozinho para a vitrine no dia em que
   alguém o criar.
   ============================================================ */

const num = (v: unknown) => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

function paraVitrine(o: any) {
  const fotos: string[] = (Array.isArray(o.fotos) ? o.fotos : [])
    .map((f: any) => (typeof f === 'string' ? f : f?.chave ?? f?.k ?? f?.path))
    .filter(Boolean)
    .slice(0, 12)
    .map(urlDaFoto);

  return {
    ref:   String(o.ref ?? o.codigo ?? '').trim(),
    tipo:  String(o.tipo ?? '').trim(),
    operacao: 'venda',
    status:   'publicado',

    titulo:    o.titulo ?? null,
    descricao: o.descricao ?? null,
    destaques: Array.isArray(o.diferenciais) ? o.diferenciais.slice(0, 8) : [],

    /* Localização sem endereço: cidade, UF e o eixo de acesso.
       Endereço exato é da ficha interna, não da vitrine. */
    cidade: o.cidade,
    uf:     String(o.uf ?? '').toUpperCase().slice(0, 2),
    regiao: o.regiao ?? o.bairro ?? o.eixo ?? null,

    preco: num(o.preco_venda ?? o.valor_venda ?? o.venda),

    area_terreno:    num(o.area_terreno),
    area_construida: num(o.area_construida),
    area_fabril:     num(o.area_fabril),
    frente:          num(o.frente),
    pedireito:       num(o.pedireito ?? o.pe_direito),
    docas:           num(o.docas),
    energia_kva:     num(o.energia_kva ?? o.energia),
    zoneamento:      o.zoneamento ?? null,
    quartos:         num(o.quartos),
    vagas:           num(o.vagas),
    agua:            Boolean(o.agua ?? o.recurso_hidrico),
    benfeitorias:    Boolean(o.benfeitorias),
    elevador:        Boolean(o.elevador),

    /* O corretor responsável pelo anúncio. Não confundir com o
       anunciante terceiro, que nunca sai daqui. */
    corretor: o.corretor ?? o.responsavel ?? null,
    creci:    String(o.creci ?? o.creci_responsavel ?? '').trim(),

    fotos,
    publicado_em: o.publicado_em ?? o.atualizado_em ?? null
  };
}

/* ============================================================ */

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const org = url.searchParams.get('org') ?? 'primecorp';

  const cabecalhos: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    /* A vitrine roda em outro domínio: sem isso o navegador recusa.
       Restrinja aos domínios do site — curinga aqui é desnecessário. */
    'Access-Control-Allow-Origin': 'https://www.primecorpimoveis.com.br',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    /* 5 minutos de cache: o visitante vê a publicação quase na hora
       e o Propto não é consultado a cada visita. */
    'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=3600'
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cabecalhos });
  if (req.method !== 'GET') return new Response('{}', { status: 405, headers: cabecalhos });

  try {
    const ofertas = await lerOfertas(org);

    const imoveis: any[] = [];
    const recusadas: Array<{ ref: string; motivo: string }> = [];

    for (const o of ofertas) {
      const motivo = podePublicar(o);
      if (motivo) recusadas.push({ ref: String(o.ref ?? o.codigo ?? '?'), motivo });
      else imoveis.push(paraVitrine(o));
    }

    /* Mais recente primeiro. A vitrine reordena como quiser; isto é
       só um padrão sensato para quem consumir o JSON direto. */
    imoveis.sort((a, b) => String(b.publicado_em ?? '').localeCompare(String(a.publicado_em ?? '')));

    return new Response(JSON.stringify({
      org,
      gerado_em: new Date().toISOString(),
      total: imoveis.length,
      imoveis,
      /* Contagem, não detalhe: por que uma oferta não saiu é
         informação interna e fica no painel do Propto. */
      nao_publicados: recusadas.length
    }), { status: 200, headers: cabecalhos });

  } catch (erro) {
    /* Falha aqui não pode derrubar a vitrine: o site cai na última
       carteira recebida e segue. Devolvemos lista vazia com o aviso,
       sem detalhar o erro para quem está de fora. */
    console.error('[publicos] falha ao montar a vitrine:', erro);
    return new Response(JSON.stringify({
      org, gerado_em: new Date().toISOString(), total: 0, imoveis: [], erro: true
    }), { status: 200, headers: cabecalhos });
  }
};

export const config: Config = { path: '/api/publicos' };

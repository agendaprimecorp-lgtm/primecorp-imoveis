/* ============================================================
   PROPTO → VITRINE
   A ponte entre o aplicativo de campo e o site.
   ============================================================

   O corretor capta o imóvel no celular, publica no Propto, e o
   imóvel aparece aqui. Ninguém edita arquivo, ninguém senta no
   computador para copiar dados.

   COMO FUNCIONA
   O site busca `ENDPOINT` a cada carregamento. Se responder,
   a vitrine é o que o Propto publicou. Se não responder — rede
   fora, manutenção, endpoint ainda não instalado — a vitrine cai
   na lista local de assets/carteira.js e o site continua de pé.

   Isso significa que este arquivo já funciona hoje, antes do
   endpoint existir: ele tenta, falha em silêncio e usa a lista
   local. No dia em que o endpoint subir, é trocar a URL abaixo.

   PARA LIGAR
   1. Instale a função do endpoint no Propto (ver docs/PROPTO.md)
   2. Troque ENDPOINT pela URL real
   3. Pronto — o site passa a se alimentar sozinho

   ============================================================ */

/* Object.assign e não atribuição direta: assim dá para configurar o
   endpoint antes deste arquivo carregar — por um script do build, por
   uma variável de ambiente do Netlify ou pelo painel. Sem isso, a
   única forma de mudar a URL seria editar este arquivo à mão. */
window.PROPTO = Object.assign({

  /* URL do endpoint público do Propto. Vazio = usa só a lista local.
     Quando o endpoint estiver no ar:
     ENDPOINT: "https://propto.com.br/api/publicos?org=primecorp" */
  ENDPOINT: "https://propto.com.br/vitrine/imoveis",

  /* Segundos antes de desistir da busca. Acima disso o visitante
     está esperando uma tela em branco, e a lista local é melhor
     que isso. */
  TIMEOUT: 6,

  /* Guardar a última resposta boa no navegador do visitante.
     Se o Propto cair, quem já visitou continua vendo a carteira
     em vez do estado vazio. */
  CACHE: true,
  CACHE_HORAS: 12
}, window.PROPTO || {});

(function () {
  "use strict";

  const CHAVE = "primecorp:carteira:v1";
  const semAcento = t => (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

  /* ----------------------------------------------------------
     AS TRAVAS

     Estas quatro regras decidem o que pode aparecer no site. Não
     são preferência de layout: são o que separa um anúncio
     regular de uma exposição sob o CRECI dos sócios.

     Elas vivem aqui, no site, e não só no Propto, de propósito.
     Regra que mora em um lugar só é regra que um dia alguém
     contorna sem perceber.
     ---------------------------------------------------------- */

  const MOTIVOS = {
    operacao:  "não é venda",
    publicado: "não está publicado",
    creci:     "sem CRECI do corretor responsável",
    essencial: "faltam dados essenciais (tipo, cidade ou preço)"
  };

  function recusar(o) {
    /* 1. Somente venda. O site não opera locação, está escrito no
          rodapé, e uma oferta de locação publicada aqui desmente a
          própria página. */
    const op = semAcento(o.operacao || o.purpose || "");
    if (!op.includes("venda")) return MOTIVOS.operacao;

    /* 2. Só anúncio publicado de verdade. "Em captação" é trabalho
          em andamento: ainda não há autorização assinada, e o art. 5º
          do Decreto 81.871/1978 não admite anunciar sem ela. */
    const st = semAcento(o.status || "");
    if (st && !["publicado", "publicada", "ativo", "ativa"].includes(st)) return MOTIVOS.publicado;

    /* 3. CRECI do responsável em todo anúncio (art. 4º do mesmo
          decreto). Sem isso o anúncio é irregular, por mais bonito
          que esteja. */
    if (!o.creci || !String(o.creci).trim()) return MOTIVOS.creci;

    /* 4. O mínimo para o anúncio dizer alguma coisa. Ficha vazia no
          ar é pior que vitrine vazia. */
    if (!o.tipo || !o.cidade || !(o.preco > 0)) return MOTIVOS.essencial;

    return null;
  }

  /* ----------------------------------------------------------
     NORMALIZAÇÃO

     O Propto tem vocabulário próprio — 23 tipologias, áreas
     separadas por fabril/construída/terreno, estrutura industrial.
     A vitrine tem o dela. Esta é a tradução, e é o único lugar
     que precisa mudar se um dos dois lados mudar.
     ---------------------------------------------------------- */

  /* Tipologia do Propto → slug de assets/carteira.js */
  const TIPOS = {
    "galpao": "galpao", "galpão": "galpao",
    "galpao em condominio": "galpao", "galpão em condomínio": "galpao",
    "barracao": "galpao", "barracão": "galpao",
    "centro de distribuicao": "centro-distribuicao",
    "area industrial": "area-industrial", "área industrial": "area-industrial",
    "area comercial": "area-comercial", "área comercial": "area-comercial",
    "terreno": "terreno-urbano",
    "lote em condominio": "terreno-urbano", "lote em condomínio": "terreno-urbano",
    "area / terreno": "terreno-urbano", "área / terreno": "terreno-urbano",
    "fazenda": "fazenda", "sitio": "chacara-sitio", "sítio": "chacara-sitio",
    "chacara": "chacara-sitio", "chácara": "chacara-sitio",
    "haras": "fazenda",
    "predio comercial": "predio-comercial", "prédio comercial": "predio-comercial",
    "sala comercial": "sala-comercial",
    "loja": "loja-ponto", "ponto comercial": "loja-ponto",
    "imovel comercial": "predio-comercial", "imóvel comercial": "predio-comercial",
    "casa": "casa", "casa em condominio": "casa-condominio", "casa em condomínio": "casa-condominio",
    "sobrado": "casa", "apartamento": "apartamento", "cobertura": "cobertura",
    "kitnet / studio": "apartamento"
  };

  /* Qual ilustração usar quando o imóvel ainda não tem foto. */
  const ARTE = {
    "area-industrial": "industrial", "galpao": "galpao", "centro-distribuicao": "galpao",
    "terreno-urbano": "terreno", "area-comercial": "terreno",
    "gleba-rural": "rural", "fazenda": "rural", "chacara-sitio": "rural",
    "predio-comercial": "predio", "sala-comercial": "predio", "loja-ponto": "predio",
    "hotel-pousada": "predio", "posto-combustivel": "terreno",
    "casa": "residencial", "casa-condominio": "residencial",
    "apartamento": "predio", "cobertura": "predio"
  };

  const num = v => {
    if (v === null || v === undefined || v === "") return undefined;
    const n = Number(String(v).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3})/g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  function tipoDe(o) {
    const bruto = semAcento(o.tipo || "");
    return TIPOS[bruto] || TIPOS[o.tipo] || "area-comercial";
  }

  /* As três linhas da fichinha do cartão. Mostramos o que o imóvel
     tem, não um gabarito fixo com "não informado" repetido. */
  function fichinha(o, tipo) {
    const l = [];
    const m2 = v => Math.round(v).toLocaleString("pt-BR") + " m²";
    if (o.area_terreno)    l.push(["Terreno", m2(o.area_terreno)]);
    if (o.area_construida) l.push(["Construído", m2(o.area_construida)]);
    if (o.area_fabril)     l.push(["Área fabril", m2(o.area_fabril)]);
    if (o.pedireito)       l.push(["Pé-direito", o.pedireito + " m"]);
    if (o.docas)           l.push(["Docas", String(o.docas)]);
    if (o.energia_kva)     l.push(["Energia", o.energia_kva + " kVA"]);
    if (o.zoneamento)      l.push(["Zoneamento", o.zoneamento]);
    if (o.frente)          l.push(["Frente", o.frente + " m"]);

    const area = o.area_terreno || o.area_construida || o.area_fabril;
    if (area && o.preco) l.push(["Valor por m²", "R$ " + Math.round(o.preco / area).toLocaleString("pt-BR")]);
    return l.slice(0, 3);
  }

  function converter(o) {
    const tipo = tipoDe(o);
    const area = num(o.area_terreno) || num(o.area_construida) || num(o.area_fabril) || 0;
    const uf = (o.uf || "").toUpperCase().slice(0, 2);
    const onde = [o.cidade + (uf ? "/" + uf : ""), o.regiao || o.bairro].filter(Boolean).join(" · ");

    const imovel = {
      ref: o.ref || o.codigo,
      tipo,
      titulo: o.titulo || `${o.tipo} em ${o.cidade}`,
      cidade: o.cidade, uf,
      onde,
      preco: num(o.preco),
      area,
      creci: o.creci,
      corretor: o.corretor || null,
      arte: ARTE[tipo] || "terreno",
      descricao: o.descricao || null,
      fotos: Array.isArray(o.fotos) ? o.fotos.filter(f => typeof f === "string" && /^https?:\/\//.test(f)) : [],
      origem: "propto"
    };

    /* Atributos que alimentam os filtros da vitrine. Só entram se
       vierem preenchidos: campo ausente é diferente de campo zero,
       e filtro que exige campo inexistente esconde o imóvel. */
    const mapa = {
      area_construida: "construida", pedireito: "pedireito", docas: "docas",
      frente: "frente", quartos: "quartos", vagas: "vagas"
    };
    for (const [de, para] of Object.entries(mapa)) {
      const v = num(o[de]);
      if (v !== undefined) imovel[para] = v;
    }
    if (o.zoneamento) imovel.zoneamento = semAcento(o.zoneamento).includes("indust") ? "industrial"
                                        : semAcento(o.zoneamento).includes("comerc") ? "comercial" : "misto";
    if (o.energia_kva) imovel.energia = num(o.energia_kva) >= 300 ? "alta" : "media";

    /* Os campos de sim/não — piscina, churrasqueira, elevador, água,
       AVCB — vêm do próprio carteira.js, não de uma lista escrita aqui.
       Assim, acrescentar uma característica lá passa a funcionar na
       integração sem ninguém lembrar de mexer neste arquivo. */
    const CAMPOS = window.CAMPOS || {};
    for (const [campo, def] of Object.entries(CAMPOS)) {
      /* Dois formatos contam como sim/não: caixa de marcar (tipo "sim")
         e seletor cuja única opção é "sim" — é o caso de recurso hídrico
         e benfeitorias, que ficam entre os principais da tipologia rural. */
      const booleano = def.tipo === "sim" ||
        (def.opcoes && def.opcoes.filter(o => o[0]).every(o => o[0] === "sim"));
      if (!booleano) continue;
      if (o[campo] === true || semAcento(o[campo]) === "sim") imovel[campo] = "sim";
    }

    imovel.dados = fichinha(
      {...o, area_terreno: num(o.area_terreno), area_construida: num(o.area_construida),
             area_fabril: num(o.area_fabril), preco: imovel.preco}, tipo);
    if (!imovel.dados.length) imovel.dados = [["Área", area ? area.toLocaleString("pt-BR") + " m²" : "a confirmar"]];

    return imovel;
  }

  /* ---------------------------------------------------------- */

  function guardar(lista) {
    if (!window.PROPTO.CACHE) return;
    try {
      localStorage.setItem(CHAVE, JSON.stringify({ em: Date.now(), lista }));
    } catch (_) { /* navegador anônimo ou armazenamento cheio: segue sem cache */ }
  }

  function recuperar() {
    if (!window.PROPTO.CACHE) return null;
    try {
      const bruto = localStorage.getItem(CHAVE);
      if (!bruto) return null;
      const { em, lista } = JSON.parse(bruto);
      if (Date.now() - em > window.PROPTO.CACHE_HORAS * 3600e3) return null;
      return Array.isArray(lista) && lista.length ? lista : null;
    } catch (_) { return null; }
  }

  async function buscar() {
    const url = window.PROPTO.ENDPOINT;
    if (!url) return { lista: null, motivo: "endpoint não configurado" };

    const corta = new AbortController();
    const relogio = setTimeout(() => corta.abort(), window.PROPTO.TIMEOUT * 1000);
    try {
      const r = await fetch(url, { signal: corta.signal, headers: { Accept: "application/json" } });
      if (!r.ok) return { lista: null, motivo: "HTTP " + r.status };
      const corpo = await r.json();
      const bruta = Array.isArray(corpo) ? corpo : (corpo.imoveis || corpo.dados || corpo.ofertas || []);
      if (!Array.isArray(bruta)) return { lista: null, motivo: "formato inesperado" };

      const aceitos = [], recusados = [];
      for (const o of bruta) {
        const motivo = recusar(o);
        if (motivo) recusados.push({ ref: o.ref || o.codigo || "?", motivo });
        else aceitos.push(converter(o));
      }
      /* Recusa é informação de operação, não erro: o corretor precisa
         saber por que o imóvel dele não apareceu. */
      if (recusados.length) console.info("[Propto] não publicados na vitrine:", recusados);
      return { lista: aceitos, recusados, motivo: null };
    } catch (e) {
      return { lista: null, motivo: e.name === "AbortError" ? "tempo esgotado" : "rede indisponível" };
    } finally {
      clearTimeout(relogio);
    }
  }

  /* ----------------------------------------------------------
     A carteira que o site usa.

     Ordem de preferência: Propto ao vivo → cache recente →
     lista local de carteira.js. Nenhum caminho deixa o site sem
     resposta, e o visitante nunca vê erro de integração.
     ---------------------------------------------------------- */
  window.PROPTO.carregar = async function carregar() {
    const local = Array.isArray(window.IMOVEIS) ? window.IMOVEIS : [];

    const { lista, motivo } = await buscar();
    if (lista) {
      guardar(lista);
      window.IMOVEIS = lista;
      return { fonte: "propto", total: lista.length };
    }

    const doCache = recuperar();
    if (doCache) {
      window.IMOVEIS = doCache;
      console.info("[Propto] usando a última carteira recebida —", motivo);
      return { fonte: "cache", total: doCache.length, motivo };
    }

    console.info("[Propto] usando a carteira local —", motivo);
    return { fonte: "local", total: local.length, motivo };
  };
})();

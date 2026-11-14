/* ============================================================
   CARTEIRA E TAXONOMIA — PrimeCorp Imóveis
   ============================================================

   Este é o único arquivo que precisa ser editado para cadastrar,
   alterar ou retirar um imóvel do site. Não mexa no index.html.

   REGRA QUE NÃO DEVE SER QUEBRADA
   Só entra aqui imóvel com AUTORIZAÇÃO ESCRITA do proprietário
   vigente (art. 5º do Decreto 81.871/1978). O site publica o
   número do CRECI junto de cada imóvel — o anúncio é uma peça
   assinada por vocês.

   Os três registros que vêm de fábrica são DEMONSTRATIVOS.
   Troque-os pela carteira real antes de colocar o site no ar.
   Para subir sem vitrine, deixe window.IMOVEIS = [] : a seção se
   adapta sozinha e passa a captar mandato de busca.
   ============================================================ */

/* ---------- 1. TIPOLOGIAS ----------
   `campos` declara quais filtros fazem sentido em cada tipologia.
   É isso que faz a barra de filtros se adaptar: galpão filtra por
   pé-direito e docas, gleba por recurso hídrico. Não inclua campo
   residencial em tipologia industrial — era esse o defeito que
   zerava a vitrine na versão anterior.
   Os nomes abaixo são os que aparecem no dropdown do site. */
window.TIPOS = [
  /* ---------- Residencial ---------- */
  {slug:"apartamento",        nome:"Apartamento",               grupo:"Residencial",            campos:["construida","quartos","suites","banheiros","vagas"]},
  {slug:"studio",             nome:"Studio",                    grupo:"Residencial",            campos:["construida","banheiros","vagas"]},
  {slug:"kitnet",             nome:"Kitnet",                    grupo:"Residencial",            campos:["construida","banheiros","vagas"]},
  {slug:"casa",               nome:"Casa",                      grupo:"Residencial",            campos:["construida","quartos","suites","banheiros","vagas"]},
  {slug:"casa-condominio",    nome:"Casa de condomínio",        grupo:"Residencial",            campos:["construida","quartos","suites","banheiros","vagas"]},
  {slug:"casa-vila",          nome:"Casa de vila",              grupo:"Residencial",            campos:["construida","quartos","banheiros","vagas"]},
  {slug:"cobertura",          nome:"Cobertura",                 grupo:"Residencial",            campos:["construida","quartos","suites","banheiros","vagas"]},
  {slug:"flat",               nome:"Flat",                      grupo:"Residencial",            campos:["construida","quartos","banheiros","vagas"]},
  {slug:"loft",               nome:"Loft",                      grupo:"Residencial",            campos:["construida","quartos","banheiros","vagas"]},
  {slug:"sobrado",            nome:"Sobrado",                   grupo:"Residencial",            campos:["construida","quartos","suites","banheiros","vagas"]},

  /* ---------- Industrial e logístico ---------- */
  {slug:"galpao",             nome:"Galpão / depósito / armazém",grupo:"Industrial e logístico",campos:["construida","pedireito","docas","energia","piso"]},
  {slug:"centro-distribuicao",nome:"Centro de distribuição",    grupo:"Industrial e logístico", campos:["construida","pedireito","docas","energia"]},
  {slug:"barracao",           nome:"Barracão",                  grupo:"Industrial e logístico", campos:["construida","pedireito","energia"]},
  {slug:"area-industrial",    nome:"Área industrial",           grupo:"Industrial e logístico", campos:["zoneamento","energia","frente"]},

  /* ---------- Comercial ---------- */
  {slug:"loja-ponto",         nome:"Loja / salão / ponto comercial",grupo:"Comercial",          campos:["construida","frente","banheiros"]},
  {slug:"sala-comercial",     nome:"Conjunto comercial / sala", grupo:"Comercial",              campos:["construida","vagas","banheiros","elevador"]},
  {slug:"casa-comercial",     nome:"Casa comercial",            grupo:"Comercial",              campos:["construida","vagas","banheiros"]},
  {slug:"hotel-pousada",      nome:"Hotel / motel / pousada",   grupo:"Comercial",              campos:["construida","quartos","vagas"]},
  {slug:"andar-corporativo",  nome:"Andar / laje corporativa",  grupo:"Comercial",              campos:["construida","vagas","elevador"]},
  {slug:"predio-comercial",   nome:"Prédio inteiro",            grupo:"Comercial",              campos:["construida","vagas","elevador"]},
  {slug:"posto-combustivel",  nome:"Posto de combustível",      grupo:"Comercial",              campos:["frente","construida"]},
  {slug:"garagem",            nome:"Garagem",                   grupo:"Comercial",              campos:["construida"]},

  /* ---------- Terrenos e glebas ---------- */
  {slug:"terreno-urbano",     nome:"Terreno / lote / condomínio",grupo:"Terrenos e glebas",     campos:["zoneamento","frente","portaria24h"]},
  {slug:"terreno-comercial",  nome:"Terrenos / lotes comerciais",grupo:"Terrenos e glebas",     campos:["zoneamento","frente"]},
  {slug:"area-comercial",     nome:"Área comercial",            grupo:"Terrenos e glebas",      campos:["zoneamento","frente"]},

  /* ---------- Rural ---------- */
  {slug:"fazenda",            nome:"Fazenda",                   grupo:"Rural",                  campos:["agua","benfeitorias","construida"]},
  {slug:"sitio",              nome:"Sítio",                     grupo:"Rural",                  campos:["agua","benfeitorias","construida"]},
  {slug:"chacara",            nome:"Chácara",                   grupo:"Rural",                  campos:["agua","benfeitorias","construida","quartos"]},
  {slug:"gleba-rural",        nome:"Gleba / área rural",        grupo:"Rural",                  campos:["agua","benfeitorias"]},
  {slug:"haras",              nome:"Haras",                     grupo:"Rural",                  campos:["agua","benfeitorias","construida"]}
];

/* ---------- 2. FILTROS DISPONÍVEIS ----------
   Campo numérico filtra por "a partir de". Campo de texto filtra
   por igualdade. Para acrescentar um filtro novo, declare-o aqui
   e cite o nome dele em `campos` das tipologias que o usam. */
window.CAMPOS = {
  /* --- principais: medida e contagem --- */
  construida:  {grupo:"principal", rotulo:"Área construída mín.", opcoes:[["","Qualquer"],["50","50 m²"],["100","100 m²"],["200","200 m²"],["500","500 m²"],["1000","1.000 m²"],["3000","3.000 m²"],["6000","6.000 m²"]]},
  quartos:     {grupo:"principal", rotulo:"Quartos",          opcoes:[["","Qualquer"],["1","1+"],["2","2+"],["3","3+"],["4","4+"]]},
  suites:      {grupo:"principal", rotulo:"Suítes",           opcoes:[["","Qualquer"],["1","1+"],["2","2+"],["3","3+"],["4","4+"]]},
  banheiros:   {grupo:"principal", rotulo:"Banheiros",        opcoes:[["","Qualquer"],["1","1+"],["2","2+"],["3","3+"],["4","4+"]]},
  vagas:       {grupo:"principal", rotulo:"Vagas",            opcoes:[["","Qualquer"],["1","1+"],["2","2+"],["3","3+"],["4","4+"]]},

  /* --- industriais: o que decide se a operação cabe --- */
  pedireito:   {grupo:"principal", rotulo:"Pé-direito mín.",  opcoes:[["","Qualquer"],["6","6 m"],["8","8 m"],["10","10 m"],["12","12 m"]]},
  docas:       {grupo:"principal", rotulo:"Docas",            opcoes:[["","Qualquer"],["1","Com docas"],["6","6 ou mais"],["12","12 ou mais"]]},
  piso:        {grupo:"principal", rotulo:"Piso mín.",        opcoes:[["","Qualquer"],["3","3 t/m²"],["5","5 t/m²"],["8","8 t/m²"]]},
  energia:     {grupo:"principal", rotulo:"Energia",          opcoes:[["","Qualquer"],["media","Média tensão"],["alta","Alta tensão"]]},
  zoneamento:  {grupo:"principal", rotulo:"Zoneamento",       opcoes:[["","Qualquer"],["industrial","Industrial"],["comercial","Comercial"],["misto","Misto"],["residencial","Residencial"]]},
  frente:      {grupo:"principal", rotulo:"Frente mín.",      opcoes:[["","Qualquer"],["10","10 m"],["20","20 m"],["40","40 m"],["80","80 m"]]},
  agua:        {grupo:"principal", rotulo:"Recurso hídrico",  opcoes:[["","Qualquer"],["sim","Com água"]]},
  benfeitorias:{grupo:"principal", rotulo:"Benfeitorias",     opcoes:[["","Qualquer"],["sim","Com benfeitorias"]]},

  /* --- comodidades, lazer e condomínio ---
     Entram como caixas de marcar: a pessoa quer somar o que precisa,
     não escolher um valor. Só aparecem na tipologia que os admite. */
  mobiliado:   {grupo:"comodidades", rotulo:"Mobiliado",        tipo:"sim"},
  varanda:     {grupo:"comodidades", rotulo:"Varanda",          tipo:"sim"},
  arcondicionado:{grupo:"comodidades", rotulo:"Ar-condicionado",tipo:"sim"},
  armarios:    {grupo:"comodidades", rotulo:"Armários",         tipo:"sim"},
  aceitapet:   {grupo:"comodidades", rotulo:"Aceita animais",   tipo:"sim"},

  piscina:     {grupo:"lazer", rotulo:"Piscina",                tipo:"sim"},
  churrasqueira:{grupo:"lazer", rotulo:"Churrasqueira",         tipo:"sim"},
  academia:    {grupo:"lazer", rotulo:"Academia",               tipo:"sim"},
  salaofestas: {grupo:"lazer", rotulo:"Salão de festas",        tipo:"sim"},
  playground:  {grupo:"lazer", rotulo:"Playground",             tipo:"sim"},

  elevador:    {grupo:"condominio", rotulo:"Elevador",          tipo:"sim"},
  portaria24h: {grupo:"condominio", rotulo:"Portaria 24h",      tipo:"sim"},
  seguranca:   {grupo:"condominio", rotulo:"Segurança",         tipo:"sim"},
  avcb:        {grupo:"condominio", rotulo:"AVCB",              tipo:"sim"}
};

/* As tipologias que admitem comodidades, lazer e condomínio. Fora
   daqui esses filtros não aparecem — churrasqueira em galpão foi o
   defeito que zerava a vitrine. */
window.GRUPOS_EXTRAS = {
  comodidades: ["apartamento","cobertura","studio","kitnet","flat","loft","casa","casa-condominio",
                "casa-vila","sobrado","chacara","casa-comercial","sala-comercial"],
  lazer:       ["apartamento","cobertura","flat","casa","casa-condominio","casa-vila","sobrado",
                "chacara","sitio","fazenda","terreno-urbano","hotel-pousada"],
  condominio:  ["apartamento","cobertura","studio","kitnet","flat","loft","casa-condominio",
                "sala-comercial","andar-corporativo","predio-comercial","terreno-urbano","galpao",
                "centro-distribuicao"]
};

/* Quais campos são "a partir de" em vez de igualdade exata. */
window.CAMPOS_NUMERICOS = ["construida","pedireito","docas","piso","quartos","suites","banheiros","vagas","frente"];

/* ---------- 3. A CARTEIRA ----------
   Campos obrigatórios: tipo, titulo, cidade, uf, onde, preco, area,
                        creci, arte, dados
   Campos opcionais:    qualquer nome declarado em CAMPOS acima
                        (construida, pedireito, docas, zoneamento…)
                        — é por eles que o imóvel aparece nos filtros.

   `arte`  escolhe a ilustração da capa: "industrial", "galpao",
           "terreno", "rural", "predio" ou "residencial".
   `ref`   é o código que aparece na ficha e na URL compartilhável
           (#imovel/REF). Sem ele, o site gera um automaticamente —
           mas um código estável é melhor: não muda se a ordem mudar.
   `descricao` é o texto corrido da ficha. Opcional, mas é ele que
           diferencia um anúncio de um registro de planilha.
   `creci` é a inscrição que responde pelo anúncio. Enquanto a PJ
           estiver em concessão, use a inscrição PF do corretor
           responsável por este imóvel.
   `dados` são as três linhas da fichinha do cartão, na ordem.
   ============================================================ */
window.IMOVEIS = [

  /* ---- DEMONSTRATIVO: substituir ---- */
  {
    ref:"AI-CPQ-001",
    tipo:"area-industrial",
    titulo:"Área industrial com frente para via coletora",
    descricao:"Gleba plana em zona estritamente industrial, com frente de 120 m para via coletora e acesso direto à malha de escoamento do distrito. Energia em alta tensão disponível na testada. Topografia dispensa movimentação de terra relevante, o que encurta o cronograma de implantação de quem for construir.",
    cidade:"Campinas", uf:"SP",
    onde:"Campinas/SP · Distrito Industrial",
    preco:12500000, area:18400,
    zoneamento:"industrial", energia:"alta", frente:120,
    creci:"CRECISP 300760", arte:"industrial",
    dados:[["Terreno","18.400 m²"],["Zoneamento","Industrial"],["Valor por m²","R$ 679"]]
  },

  /* ---- DEMONSTRATIVO: substituir ---- */
  {
    ref:"GA-JUN-002",
    tipo:"galpao",
    titulo:"Galpão logístico próximo à Anhanguera",
    descricao:"Galpão em terreno de 6.200 m² com 3.850 m² construídos, pé-direito de 11 m e oito docas niveladas. Estrutura pré-moldada, piso com capacidade para porta-paletes e pátio de manobra dimensionado para carreta. Localização no km 58 coloca o ativo dentro do raio de distribuição da região metropolitana.",
    cidade:"Jundiaí", uf:"SP",
    onde:"Jundiaí/SP · km 58",
    preco:8900000, area:6200,
    construida:3850, pedireito:11, docas:8,
    creci:"CRECISP 297692", arte:"galpao",
    dados:[["Terreno","6.200 m²"],["Construído","3.850 m²"],["Pé-direito","11 m"]]
  },

  /* ---- DEMONSTRATIVO: substituir ---- */
  {
    ref:"TU-IND-003",
    tipo:"terreno-urbano",
    titulo:"Terreno urbano no centro expandido",
    descricao:"Lote de 3.400 m² com 48 m de frente em zona de uso misto, admitindo comércio, serviços e residencial multifamiliar. Infraestrutura urbana completa na testada. Pela metragem e pelo zoneamento, é um ativo de incorporação mais do que de uso final.",
    cidade:"Indaiatuba", uf:"SP",
    onde:"Indaiatuba/SP · Centro expandido",
    preco:2650000, area:3400,
    zoneamento:"misto", frente:48,
    creci:"CRECISP 297692", arte:"terreno",
    dados:[["Terreno","3.400 m²"],["Zoneamento","Misto"],["Valor por m²","R$ 779"]]
  }

];

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
   Ao criar uma tipologia nova, acrescente também a elasticidade
   dela em assets/calibracao.js. */
window.TIPOS = [
  {slug:"area-industrial",    nome:"Área industrial",           grupo:"Industrial e logístico",  campos:["zoneamento","energia"]},
  {slug:"galpao",             nome:"Galpão / barracão",         grupo:"Industrial e logístico",  campos:["construida","pedireito","docas"]},
  {slug:"centro-distribuicao",nome:"Centro de distribuição",    grupo:"Industrial e logístico",  campos:["construida","pedireito","docas"]},
  {slug:"terreno-urbano",     nome:"Terreno urbano",            grupo:"Terrenos e glebas",       campos:["zoneamento","frente"]},
  {slug:"area-comercial",     nome:"Área comercial",            grupo:"Terrenos e glebas",       campos:["zoneamento","frente"]},
  {slug:"gleba-rural",        nome:"Gleba / área rural",        grupo:"Rural",                   campos:["agua","benfeitorias"]},
  {slug:"fazenda",            nome:"Fazenda",                   grupo:"Rural",                   campos:["agua","benfeitorias"]},
  {slug:"chacara-sitio",      nome:"Chácara / sítio",           grupo:"Rural",                   campos:["agua","benfeitorias"]},
  {slug:"predio-comercial",   nome:"Prédio comercial",          grupo:"Comercial",               campos:["construida","vagas","elevador"]},
  {slug:"sala-comercial",     nome:"Sala / conjunto comercial", grupo:"Comercial",               campos:["construida","vagas"]},
  {slug:"loja-ponto",         nome:"Loja / ponto comercial",    grupo:"Comercial",               campos:["construida","frente"]},
  {slug:"hotel-pousada",      nome:"Hotel / pousada",           grupo:"Comercial",               campos:["construida","quartos"]},
  {slug:"posto-combustivel",  nome:"Posto de combustível",      grupo:"Comercial",               campos:["frente"]},
  {slug:"casa",               nome:"Casa",                      grupo:"Residencial alto padrão", campos:["construida","quartos","vagas"]},
  {slug:"casa-condominio",    nome:"Casa em condomínio",        grupo:"Residencial alto padrão", campos:["construida","quartos","vagas"]},
  {slug:"apartamento",        nome:"Apartamento",               grupo:"Residencial alto padrão", campos:["construida","quartos","vagas"]},
  {slug:"cobertura",          nome:"Cobertura",                 grupo:"Residencial alto padrão", campos:["construida","quartos","vagas"]}
];

/* ---------- 2. FILTROS DISPONÍVEIS ----------
   Campo numérico filtra por "a partir de". Campo de texto filtra
   por igualdade. Para acrescentar um filtro novo, declare-o aqui
   e cite o nome dele em `campos` das tipologias que o usam. */
window.CAMPOS = {
  construida:  {rotulo:"Área construída mín.", opcoes:[["","Qualquer"],["500","500 m²"],["1000","1.000 m²"],["3000","3.000 m²"],["6000","6.000 m²"]]},
  pedireito:   {rotulo:"Pé-direito mín.",      opcoes:[["","Qualquer"],["8","8 m"],["10","10 m"],["12","12 m"]]},
  docas:       {rotulo:"Docas",                opcoes:[["","Qualquer"],["1","Com docas"],["6","6 ou mais"],["12","12 ou mais"]]},
  zoneamento:  {rotulo:"Zoneamento",           opcoes:[["","Qualquer"],["industrial","Industrial"],["comercial","Comercial"],["misto","Misto"]]},
  energia:     {rotulo:"Energia",              opcoes:[["","Qualquer"],["media","Média tensão"],["alta","Alta tensão"]]},
  frente:      {rotulo:"Frente mín.",          opcoes:[["","Qualquer"],["20","20 m"],["40","40 m"],["80","80 m"]]},
  agua:        {rotulo:"Recurso hídrico",      opcoes:[["","Qualquer"],["sim","Com água"]]},
  benfeitorias:{rotulo:"Benfeitorias",         opcoes:[["","Qualquer"],["sim","Com benfeitorias"]]},
  quartos:     {rotulo:"Quartos",              opcoes:[["","Qualquer"],["2","2+"],["3","3+"],["4","4+"]]},
  vagas:       {rotulo:"Vagas",                opcoes:[["","Qualquer"],["2","2+"],["4","4+"],["10","10+"]]},
  elevador:    {rotulo:"Elevador",             opcoes:[["","Qualquer"],["sim","Com elevador"]]}
};

/* Quais campos são "a partir de" em vez de igualdade exata. */
window.CAMPOS_NUMERICOS = ["construida","pedireito","docas","quartos","vagas","frente"];

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

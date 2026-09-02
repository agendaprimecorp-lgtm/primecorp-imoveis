/* ============================================================
   CALIBRAÇÃO DE MERCADO — PrimeCorp Imóveis
   ============================================================

   Este arquivo alimenta a "Consulta rápida de faixa" da página inicial.

   REGRA QUE NÃO DEVE SER QUEBRADA
   Só entre aqui município e tipologia onde vocês tenham pesquisa própria.
   O número exibido aqui é uma afirmação de mercado feita sob o CRECI de
   vocês, para um proprietário que vai decidir preço com base nela.
   Município sem entrada NÃO mostra faixa: o site convida a pedir o parecer,
   que é o que realmente converte em captação.

   Preencher a partir de:
     - anúncios pesquisados na própria micro-região (mínimo 7 por tipologia)
     - negócios fechados pela casa
     - quando o painel estiver com base carregada, MODO = 'api' abaixo faz o
       cálculo pelo motor de comparáveis e este arquivo deixa de ser usado

   FORMATO
     'slug-do-municipio': { tipo: [valor_m2_referencia, area_referencia_m2] }

   O valor é o R$/m² na área de referência. A página corrige pela metragem
   informada usando a elasticidade da tipologia (imóvel maior custa menos
   por m²) — a mesma lógica do motor do painel.

   REVISAR A CADA 6 MESES. Anote a data da última revisão abaixo.
   ============================================================ */

window.CALIBRACAO = {
  // 'api'    -> consulta o motor de comparáveis do painel (recomendado quando a base estiver carregada)
  // 'tabela' -> usa os valores deste arquivo
  MODO: 'tabela',

  ENDPOINT_API: '/api/publico/faixa',

  REVISADO_EM: '',        // preencher: 'AAAA-MM'
  RESPONSAVEL: '',        // preencher: nome e CRECI de quem calibrou

  // Elasticidade de área por tipologia. Negativa: imóvel maior vale menos por m².
  ELASTICIDADE: {
    'area-industrial': -0.22,
    'galpao':          -0.18,
    'terreno-urbano':  -0.20,
    'area-comercial':  -0.16,
    'gleba-rural':     -0.28,
    'fazenda':         -0.28,
    'chacara-sitio':   -0.24,
    'casa':            -0.12,
    'casa-condominio': -0.12,
    'apartamento':     -0.08,
    'sala-comercial':  -0.10,
    'loja-ponto':      -0.12,
    'predio-comercial':-0.14,
    'hotel-pousada':   -0.14,
    'posto-combustivel':-0.15,
    'centro-distribuicao': -0.18
  },

  // Amplitude da faixa exibida, em fração do valor de referência.
  // 0.14 = mostra de -14% a +14%. Aumente onde a amostra for mais dispersa.
  AMPLITUDE_PADRAO: 0.14,

  /* --------------------------------------------------------
     PREENCHER ABAIXO. Nada aqui é chute — cada linha precisa
     de pesquisa que vocês consigam defender numa conversa.

     Exemplo do formato (REMOVER e substituir por dado real):

     'campinas': {
       'area-industrial': [820, 15000],
       'galpao':          [1450, 4000]
     },
     'jundiai': {
       'area-industrial': [910, 15000]
     },
     -------------------------------------------------------- */
  MERCADO: {
    // vazio de propósito — ver bloco acima
  }
};

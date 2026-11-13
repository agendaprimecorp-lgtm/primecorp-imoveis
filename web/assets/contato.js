/* ============================================================
   CONTATO E DESTINO DOS LEADS — PrimeCorp Imóveis
   ============================================================
   Mudou de telefone, de e-mail ou de horário? É aqui. Não precisa
   abrir o index.html — o site inteiro lê deste arquivo: botão
   flutuante, rodapé, ficha do imóvel, schema do Google e o envio
   dos dois formulários.
   ============================================================ */
window.CONTATO = {

  /* Só dígitos, com 55 e DDD. É o formato que o wa.me exige. */
  whatsapp: "5519999194447",
  telefone: "(19) 99919-4447",
  horario:  "Seg a sex, 9h às 18h",

  email:          "contato@primecorpconsultoria.com.br",
  emailComercial: "comercial@primecorpconsultoria.com.br",

  /* ----------------------------------------------------------
     PARA ONDE VAI O LEAD

     "whatsapp"  Abre o WhatsApp com a mensagem já escrita — nome,
                 telefone, tipo, cidade, área e observações. Não
                 precisa de servidor, não custa nada e funciona
                 hoje. É o padrão, e é o que faz sentido enquanto
                 o backend não existe: formulário que não envia
                 para lugar nenhum perde o cliente em silêncio.

     "endpoint"  Envia por POST (JSON) para ENDPOINT. Use quando
                 houver Formspree, n8n ou API própria. Se o envio
                 falhar, o site cai no WhatsApp sozinho — o lead
                 não se perde porque o servidor caiu.

     "ambos"     Grava no ENDPOINT e abre o WhatsApp.
     ---------------------------------------------------------- */
  destino: "whatsapp",
  ENDPOINT: ""
};

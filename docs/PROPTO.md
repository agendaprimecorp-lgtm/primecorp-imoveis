# Propto → vitrine do site

O corretor capta no celular, publica no Propto, e o imóvel aparece em
`primecorpimoveis.com.br`. Ninguém edita arquivo, ninguém senta no
computador para copiar dados.

Este documento é o contrato entre os dois sistemas.

---

## Estado

| Lado | Situação |
|---|---|
| Site: adaptador, travas, cache, vitrine | **pronto, 40 verificações passando** |
| Propto: endpoint `/api/publicos` | **falta instalar** (arquivo pronto em `integracao/`) |

O site **já funciona hoje** sem o endpoint: ele tenta, não encontra, e
usa a lista local de `assets/carteira.js`. No dia em que o endpoint
subir, é trocar uma URL.

---

## Ligar em três passos

**1. Instalar a função no Propto.**
Copie `integracao/publicos.mts` para `netlify/functions/publicos.mts` no
projeto do Propto e preencha os dois pontos marcados no arquivo:

- `lerOfertas(org)` — a leitura do store, a mesma que `/api/dados` usa
- `urlDaFoto(chave)` — confirmar se `/api/foto` responde sem sessão

**2. Conferir que respondeu.**

```
curl "https://propto.com.br/api/publicos?org=primecorp"
```

Deve vir `{"org":"primecorp","total":N,"imoveis":[...]}`.

**3. Apontar o site.**
Em `assets/propto.js`, trocar:

```js
ENDPOINT: "https://propto.com.br/api/publicos?org=primecorp",
```

Publicar. A vitrine passa a ser o que o Propto publicou.

---

## As quatro travas

Valem nos **dois lados**. Repetição proposital: regra que mora em um
lugar só é regra que um dia alguém contorna sem perceber.

| Trava | Por quê |
|---|---|
| **Só venda** | O site não opera locação e isso está no rodapé. Oferta de locação publicada aqui desmente a própria página |
| **Só publicado** | "Em captação" é trabalho em andamento, sem autorização assinada |
| **Autorização do proprietário** | Art. 5º do Decreto 81.871/1978 — não se anuncia sem ela |
| **CRECI do responsável** | Art. 4º do mesmo decreto — todo anúncio leva a inscrição |

Mais o mínimo de conteúdo: tipo, cidade e preço. **Ficha vazia no ar é
pior que vitrine vazia.**

Quando uma oferta é recusada, o motivo aparece no console do navegador
— o corretor precisa saber por que o imóvel dele não apareceu.

---

## O que nunca sai do Propto

A função monta a resposta **campo a campo, por lista branca**. Um campo
novo no Propto não vaza sozinho para a vitrine no dia em que alguém o
criar.

Fica de fora, sempre:

- **anunciante** — nome, telefone, CRECI do terceiro
- **origem** — portal, leilão, corretor parceiro, imobiliária
- **endereço exato, matrícula, proprietário, certidões**
- **notas internas, semáforo, índice de verificação**

Os dois primeiros são o ativo comercial da operação. Os dois últimos são
dado de terceiro sob LGPD.

A vitrine mostra cidade, UF e o eixo de acesso — o suficiente para o
comprador se interessar, não o suficiente para ele passar por cima de
vocês.

---

## O contrato

```json
{
  "org": "primecorp",
  "gerado_em": "2026-11-14T15:40:00.000Z",
  "total": 1,
  "nao_publicados": 3,
  "imoveis": [
    {
      "ref": "PC-0021",
      "tipo": "Galpão",
      "operacao": "venda",
      "status": "publicado",
      "titulo": "Galpão com pátio para carreta",
      "descricao": "Estrutura pré-moldada com piso para porta-paletes.",
      "destaques": ["Pé-direito 12 m", "6 docas niveladas"],
      "cidade": "Sumaré",
      "uf": "SP",
      "regiao": "Rod. Anhanguera, km 110",
      "preco": 7400000,
      "area_terreno": 9000,
      "area_construida": 4200,
      "pedireito": 12,
      "docas": 6,
      "energia_kva": 500,
      "zoneamento": "Industrial",
      "corretor": "Rodrigo França Viana",
      "creci": "CRECISP 297692",
      "fotos": ["https://propto.com.br/api/foto?k=fotos%2F..."],
      "publicado_em": "2026-11-14T12:00:00.000Z"
    }
  ]
}
```

**Obrigatórios:** `ref`, `tipo`, `operacao`, `status`, `cidade`, `uf`,
`preco`, `creci`.
Todo o resto é opcional — o site mostra o que vier e omite o que faltar.

### Tipologias

A vitrine cobre **30 tipologias em 5 grupos** — residencial, industrial
e logístico, comercial, terrenos e glebas, rural. O adaptador traduz as
do Propto para esses slugs. O que não for reconhecido vira
`area-comercial` e **continua aparecendo** — nunca some da vitrine por
falta de tradução.

Os filtros seguem a tipologia: apartamento oferece quartos, suítes e
lazer; galpão oferece pé-direito, docas, energia e piso. Churrasqueira
não aparece em galpão, docas não aparecem em apartamento.

### Conversões automáticas

| Campo do Propto | Vira |
|---|---|
| `energia_kva` ≥ 300 | filtro "alta tensão" |
| `zoneamento` com "indust" | filtro `industrial` |
| `area_terreno`, `pedireito`, `docas`, `frente` | filtros numéricos da vitrine |
| `preco` ÷ área | "valor por m²" na fichinha |
| `piscina`, `elevador`, `avcb`… (true) | caixas de marcar do painel |
| `fotos[]` | foto do cartão e galeria da ficha |
| `regiao` | aparece junto da cidade, sem endereço |

Os campos de sim/não são lidos de `assets/carteira.js`, não de uma
lista escrita no adaptador: acrescentar uma característica lá já passa
a funcionar na integração.

### Fotos

Vêm em `fotos[]` como URLs completas. A primeira vira a capa do cartão,
com o número de fotos no canto; a ficha abre galeria com setas,
miniaturas e navegação por teclado.

Foto que não carrega vira a ilustração da tipologia — se o Propto cair,
a ficha não vira um retângulo cinza. Miniatura quebrada some da tira.

---

## Quando o Propto cai

Ordem de preferência: **Propto ao vivo → última carteira recebida →
lista local**.

O visitante nunca vê erro de integração. O site registra a queda no
console e continua mostrando imóvel. Verificado: Propto fora do ar,
Propto devolvendo lixo, tempo esgotado e endpoint inexistente — nos
quatro casos a página continua de pé.

O cache fica no navegador do visitante, por 12 horas.

---

## Tempo real

Hoje o site busca o endpoint **a cada carregamento de página**. Da
perspectiva de quem visita, isso já é tempo real: publicou no celular,
a próxima pessoa que abrir o site vê.

A função devolve `Cache-Control` de 5 minutos, então o Propto não é
consultado a cada visita.

Se mais tarde quiserem instantâneo, o caminho é um webhook do Propto
disparando rebuild no Netlify. Não é necessário para começar.

---

## Ajustes no comportamento

Em `assets/propto.js`:

| Opção | Padrão | O que faz |
|---|---|---|
| `ENDPOINT` | `""` | URL do Propto. Vazio = só lista local |
| `TIMEOUT` | `6` | Segundos antes de desistir |
| `CACHE` | `true` | Guardar a última carteira no navegador |
| `CACHE_HORAS` | `12` | Validade desse cache |

O endpoint também pode ser definido antes do arquivo carregar — por um
script do build ou variável do Netlify — sem editar o arquivo à mão.

---

## Testar

```
node testes/propto.test.js
```

Sobe um Propto falso, serve o site e verifica em navegador real:
alimentação da vitrine, as quatro travas, tradução dos campos, filtros
sobre dados do Propto, ficha do imóvel, e os três modos de falha.

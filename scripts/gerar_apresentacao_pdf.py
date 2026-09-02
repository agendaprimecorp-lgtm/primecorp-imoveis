#!/usr/bin/env python3
"""Gera o PDF de apresentação a partir do markdown, com a identidade PrimeCorp."""
import base64
import pathlib
import re

import markdown
from weasyprint import HTML

RAIZ = pathlib.Path(__file__).resolve().parent
MD = RAIZ / "APRESENTACAO_DESENVOLVEDOR.md"
SAIDA = pathlib.Path("/mnt/user-data/outputs/PrimeCorp_Apresentacao_Desenvolvedor.pdf")

CARMIM = "#D93438"
GRAFITE = "#4B4B4D"
TINTA = "#231F20"
PAUTA = "#DDD8D3"
APAGADO = "#78716C"

logo = base64.b64encode((RAIZ / "web/assets/marca-horizontal-negativa-600.png").read_bytes()).decode()
simbolo = base64.b64encode((RAIZ / "web/assets/marca-simbolo-512.png").read_bytes()).decode()

texto = MD.read_text(encoding="utf-8")

# título e subtítulo saem do corpo e viram capa
texto = re.sub(r"^# .*?\n", "", texto, count=1).lstrip()
texto = re.sub(r"^\*\*Documento para apresentação.*?\n\n", "", texto, count=1, flags=re.S).lstrip()
texto = texto.lstrip("-").lstrip()

corpo = markdown.markdown(texto, extensions=["tables", "sane_lists", "attr_list"])

# quebra de página antes de cada seção numerada, exceto a primeira
corpo = re.sub(r"<h2>(?!1\. )", '<h2 class="nova-pagina">', corpo)

CSS = f"""
@page {{
  size: A4;
  margin: 22mm 18mm 20mm 18mm;
  @top-left {{
    content: "PrimeCorp Imóveis · Estado do projeto e escopo de finalização";
    font-family: "DejaVu Sans", sans-serif; font-size: 7.5pt;
    color: {APAGADO}; letter-spacing: .04em;
    margin-bottom: 5mm;
  }}
  @bottom-left {{
    content: "V4 · 20/08/2026 · Documento interno";
    font-family: "DejaVu Sans Mono", monospace; font-size: 7pt; color: {APAGADO};
  }}
  @bottom-right {{
    content: counter(page) " / " counter(pages);
    font-family: "DejaVu Sans Mono", monospace; font-size: 7pt; color: {APAGADO};
  }}
}}
@page capa {{ margin: 0; @top-left {{ content: "" }} @bottom-left {{ content: "" }} @bottom-right {{ content: "" }} }}

* {{ box-sizing: border-box; }}
body {{
  font-family: "DejaVu Sans", sans-serif;
  font-size: 9.2pt; line-height: 1.55; color: {TINTA};
  hyphens: auto;
}}

/* ---------- capa ---------- */
.capa {{
  page: capa; height: 297mm; width: 210mm;
  position: relative; overflow: hidden;
  background: #393536; color: #fff;
  padding: 34mm 22mm;
}}
.capa .simbolo {{
  position: absolute; right: -46mm; top: -30mm;
  width: 168mm; opacity: .07;
}}
.capa .marca {{ width: 66mm; margin-bottom: 46mm; }}
.capa .olho {{
  font-family: "DejaVu Sans Mono", monospace;
  font-size: 8pt; letter-spacing: .26em; text-transform: uppercase;
  color: #FF6B71; margin-bottom: 7mm;
}}
.capa h1 {{
  font-size: 30pt; line-height: 1.14; font-weight: bold;
  margin: 0 0 8mm; letter-spacing: -.01em; max-width: 148mm;
}}
.capa .linha {{ width: 26mm; height: 3px; background: {CARMIM}; margin-bottom: 8mm; }}
.capa p.res {{ font-size: 11pt; color: #CFC9C7; max-width: 132mm; margin: 0; line-height: 1.6; }}
.capa .pe {{
  position: absolute; left: 22mm; right: 22mm; bottom: 26mm;
  border-top: 1px solid rgba(255,255,255,.2); padding-top: 6mm;
  font-family: "DejaVu Sans Mono", monospace; font-size: 8.2pt; color: #A39C9A; line-height: 1.9;
}}
.capa .pe b {{ color: #fff; font-weight: normal; }}

/* ---------- títulos ---------- */
h2 {{
  font-size: 15pt; font-weight: bold; color: {TINTA};
  margin: 0 0 5mm; padding-bottom: 2.5mm;
  border-bottom: 2px solid {CARMIM};
  letter-spacing: -.01em;
}}
h2.nova-pagina {{ break-before: page; margin-top: 0; }}
h3 {{
  font-size: 11pt; font-weight: bold; color: {GRAFITE};
  margin: 7mm 0 3mm; break-after: avoid;
}}
p {{ margin: 0 0 3.4mm; }}
strong {{ color: {TINTA}; }}

/* ---------- tabelas ---------- */
table {{
  width: 100%; border-collapse: collapse;
  margin: 3mm 0 5mm; font-size: 8.4pt;
  break-inside: avoid;
}}
thead {{ display: table-header-group; }}
th {{
  text-align: left; font-size: 7.2pt; font-weight: bold;
  letter-spacing: .1em; text-transform: uppercase; color: {APAGADO};
  padding: 2.4mm 2.6mm; border-bottom: 1.4px solid {GRAFITE};
  background: #FBFAF9;
  hyphens: none; word-break: keep-all;
}}
td {{
  padding: 2.4mm 2.6mm; border-bottom: .6px solid {PAUTA};
  vertical-align: top; line-height: 1.45;
}}
tbody tr:nth-child(even) {{ background: #FAF9F8; }}
td:first-child {{ hyphens: none; }}
table td code {{ white-space: nowrap; }}

/* ---------- listas ---------- */
ul, ol {{ margin: 0 0 4mm; padding-left: 5.5mm; }}
li {{ margin-bottom: 1.6mm; }}
li::marker {{ color: {CARMIM}; }}

/* ---------- código ---------- */
code {{
  font-family: "DejaVu Sans Mono", monospace; font-size: 8pt;
  background: #F1EFEC; padding: .4mm 1.2mm; border-radius: 2px;
  color: {GRAFITE};
}}
pre {{
  background: #FBFAF9; border: .6px solid {PAUTA}; border-left: 2.5px solid {CARMIM};
  padding: 3.5mm 4mm; font-size: 7.8pt; line-height: 1.5;
  overflow-wrap: break-word; white-space: pre-wrap;
  break-inside: avoid; margin: 3mm 0 5mm;
}}
pre code {{ background: none; padding: 0; }}

hr {{ border: 0; border-top: .6px solid {PAUTA}; margin: 6mm 0; }}
"""

CAPA = f"""
<div class="capa">
  <img class="simbolo" src="data:image/png;base64,{simbolo}">
  <img class="marca" src="data:image/png;base64,{logo}">
  <div class="olho">Documento técnico · Apresentação a desenvolvedor</div>
  <h1>Estado do projeto e escopo de finalização</h1>
  <div class="linha"></div>
  <p class="res">
    Plataforma de intermediação imobiliária para o Estado de São Paulo. Site de captação,
    painel operacional e Radar de varredura de oportunidade. Inventário do que está
    construído, do que falta desenvolver, do que depende de acesso contratado e do que
    exige decisão de negócio.
  </p>
  <div class="pe">
    PrimeCorp Imóveis · Campinas/SP<br>
    Joselia Junqueira Viana — <b>CRECISP 300760</b> · Rodrigo Franca Viana — <b>CRECISP 297692</b><br>
    Pacote V4 · 69 arquivos · 193 testes automatizados
  </div>
</div>
"""

html = f"""<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>PrimeCorp — Estado do projeto e escopo de finalização</title>
<style>{CSS}</style></head><body>{CAPA}{corpo}</body></html>"""

# a primeira <h2> após a capa não deve forçar página nova
html = html.replace('<h2>1. O que é o produto</h2>', '<h2 class="nova-pagina">1. O que é o produto</h2>')

SAIDA.parent.mkdir(parents=True, exist_ok=True)
HTML(string=html, base_url=str(RAIZ)).write_pdf(SAIDA)
print("gerado:", SAIDA, f"{SAIDA.stat().st_size/1024:.0f} KB")

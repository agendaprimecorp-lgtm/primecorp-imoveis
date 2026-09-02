#!/usr/bin/env python3
"""
Cadastro da organização e dos corretores habilitados.

Nota deliberada sobre dados pessoais: este arquivo registra apenas o que a
operação precisa — nome, número de inscrição, UF e validade. CPF, RG, filiação
e foto das carteiras NÃO entram no repositório nem no banco. Número de
inscrição no CRECI é dado profissional público (e obrigatório em toda
propaganda, por força do art. 4º do Decreto 81.871/1978); os demais são dados
pessoais que não têm finalidade nesta base.

Uso:
    export DATABASE_URL=...
    python scripts/cadastrar_equipe.py
"""
from __future__ import annotations

import getpass
import os
import sys
from datetime import date

import psycopg
from psycopg.rows import dict_row

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import security  # noqa: E402

VALIDADE_CIRP = date(2026, 9, 20)

EQUIPE = [
    {
        "email": "joselia@primecorpimoveis.com.br",
        "nome": "Joselia Junqueira Viana",
        "creci": "300760",
        "uf": "SP",
        "tipo": "PF",
        "validade": VALIDADE_CIRP,
        "papeis": ["admin", "corretor"],
        "responsavel_tecnico": True,   # sócia + corretora: atende Lei 6.530/78, art. 6º, §1º
    },
    {
        "email": "rodrigo@primecorpimoveis.com.br",
        "nome": "Rodrigo Franca Viana",
        "creci": "297692",
        "uf": "SP",
        "tipo": "PF",
        "validade": VALIDADE_CIRP,
        "papeis": ["admin", "corretor", "originacao"],
        "responsavel_tecnico": False,
    },
]

ORGANIZACAO = {
    "razao_social": "PrimeCorp Imóveis",       # ajustar para a razão social do contrato social
    "nome_fantasia": "PrimeCorp Imóveis",
    "situacao_pj": "em_concessao",
}


def main() -> int:
    url = os.getenv("DATABASE_URL")
    if not url:
        print("DATABASE_URL não definida.", file=sys.stderr)
        return 78

    dias = (VALIDADE_CIRP - date.today()).days
    print(f"Validade das habilitações PF: {VALIDADE_CIRP:%d/%m/%Y} — faltam {dias} dias.")
    if dias < 60:
        print("\n  ATENÇÃO: dentro da janela de alerta.")
        print("  A trigger `mandato_exige_creci` bloqueia a ATIVAÇÃO de mandatos")
        print("  a partir do vencimento. Renove antes da data para não travar a operação.\n")

    senhas: dict[str, str] = {}
    for p in EQUIPE:
        print(f"Senha para {p['nome']} ({p['email']}) — mínimo 12 caracteres:")
        s1 = getpass.getpass("  senha: ")
        if s1 != getpass.getpass("  confirme: "):
            print("ERRO: senhas não conferem.", file=sys.stderr)
            return 1
        try:
            senhas[p["email"]] = security.gerar_hash(s1)
        except security.SenhaFraca as e:
            print(f"ERRO: {e}", file=sys.stderr)
            return 1

    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        resp_tecnico_id = None

        for p in EQUIPE:
            cur.execute(
                """INSERT INTO users (email, full_name, password_hash,
                                      creci_number, creci_state, creci_type, creci_valid_until)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (email) DO UPDATE SET
                     creci_number = EXCLUDED.creci_number,
                     creci_state = EXCLUDED.creci_state,
                     creci_valid_until = EXCLUDED.creci_valid_until
                   RETURNING id""",
                (p["email"], p["nome"], senhas[p["email"]],
                 p["creci"], p["uf"], p["tipo"], p["validade"]),
            )
            uid = cur.fetchone()["id"]
            for papel in p["papeis"]:
                cur.execute(
                    """INSERT INTO user_roles (user_id, role_id)
                       SELECT %s, id FROM roles WHERE code = %s
                       ON CONFLICT DO NOTHING""",
                    (uid, papel),
                )
            if p["responsavel_tecnico"]:
                resp_tecnico_id = uid
            print(f"  usuário #{uid}: {p['nome']} — CRECI{p['uf']} {p['creci']}")

        cur.execute(
            """INSERT INTO organizacao
                 (id, razao_social, nome_fantasia, creci_pj_situacao,
                  creci_pj_solicitado_em, responsavel_tecnico_id)
               VALUES (1,%s,%s,%s::creci_pj_situacao, CURRENT_DATE, %s)
               ON CONFLICT (id) DO UPDATE SET
                 creci_pj_situacao = EXCLUDED.creci_pj_situacao,
                 responsavel_tecnico_id = EXCLUDED.responsavel_tecnico_id,
                 atualizado_em = now()""",
            (ORGANIZACAO["razao_social"], ORGANIZACAO["nome_fantasia"],
             ORGANIZACAO["situacao_pj"], resp_tecnico_id),
        )
        conn.commit()

    print("\nOrganização cadastrada com CRECI-J 'em_concessao'.")
    print("Enquanto isso, a publicidade sai automaticamente sob o CRECI PF do")
    print("responsável por cada mandato (Decreto 81.871/1978, art. 4º).")
    print("\nApós o deferimento, basta rodar:")
    print("  UPDATE organizacao SET creci_pj_situacao='ativo',")
    print("         creci_pj_numero='...', creci_pj_uf='SP', creci_pj_validade='AAAA-MM-DD';")
    print("A troca do número exibido em todos os anúncios é automática.")
    print("\nMFA é obrigatório para os papéis admin/corretor: cadastre no primeiro login.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

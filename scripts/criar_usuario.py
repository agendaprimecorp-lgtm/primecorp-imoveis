#!/usr/bin/env python3
"""
Criação de usuário. É o único caminho para o primeiro admin —
não existe conta padrão embutida no código (essa era a falha P0-1).

    python scripts/criar_usuario.py --email ana@primecorp.com.br \
        --nome "Ana Souza" --papeis admin,corretor \
        --creci 123456 --creci-uf SP --creci-tipo PF --creci-validade 2028-03-31
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys
from datetime import date

import psycopg
from psycopg.rows import dict_row

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import security  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", required=True)
    ap.add_argument("--nome", required=True)
    ap.add_argument("--papeis", required=True, help="admin,originacao,corretor,juridico,leitura")
    ap.add_argument("--creci")
    ap.add_argument("--creci-uf")
    ap.add_argument("--creci-tipo", choices=["PF", "PJ"])
    ap.add_argument("--creci-validade", type=date.fromisoformat)
    args = ap.parse_args()

    papeis = [p.strip() for p in args.papeis.split(",") if p.strip()]
    if "corretor" in papeis and not args.creci:
        print("ERRO: o papel 'corretor' exige CRECI (Lei 6.530/1978).", file=sys.stderr)
        return 1
    if args.creci and not all([args.creci_uf, args.creci_tipo, args.creci_validade]):
        print("ERRO: informe UF, tipo e validade do CRECI.", file=sys.stderr)
        return 1
    if args.creci_validade and args.creci_validade < date.today():
        print("ERRO: CRECI já vencido.", file=sys.stderr)
        return 1

    senha = getpass.getpass("Senha (mínimo 12 caracteres): ")
    if senha != getpass.getpass("Confirme: "):
        print("ERRO: senhas não conferem.", file=sys.stderr)
        return 1
    try:
        hash_senha = security.gerar_hash(senha)
    except security.SenhaFraca as e:
        print(f"ERRO: {e}", file=sys.stderr)
        return 1

    url = os.getenv("DATABASE_URL")
    if not url:
        print("ERRO: DATABASE_URL não definida.", file=sys.stderr)
        return 78

    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO users (email, full_name, password_hash,
                                  creci_number, creci_state, creci_type, creci_valid_until)
               VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (args.email, args.nome, hash_senha, args.creci,
             args.creci_uf, args.creci_tipo, args.creci_validade),
        )
        uid = cur.fetchone()["id"]
        for p in papeis:
            cur.execute(
                """INSERT INTO user_roles (user_id, role_id)
                   SELECT %s, id FROM roles WHERE code = %s""",
                (uid, p),
            )
            if cur.rowcount == 0:
                print(f"AVISO: papel desconhecido ignorado: {p}", file=sys.stderr)
        conn.commit()

    print(f"\nUsuário #{uid} criado: {args.email}")
    if set(papeis) & {"admin", "corretor", "juridico"}:
        print("MFA é obrigatório para este papel. No primeiro login o sistema")
        print("exigirá o cadastro em POST /api/auth/mfa/setup.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

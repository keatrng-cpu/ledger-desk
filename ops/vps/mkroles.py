"""install.sh helper: apply 002_ops_roles.sql and write /etc/ledger-ops/{paper,watchdog}.env (0600 root) with a DATABASE_URL
for the least-privilege role. Passwords are generated here, set via ALTER ROLE and written only to those files; nothing is printed.
Re-running keeps the existing files (pass --rotate to issue new passwords)."""
import os, secrets, sys, urllib.parse as u
import psycopg
from psycopg import sql
ROLES = {"paper": "ledger_ops_paper", "watchdog": "ledger_ops_watchdog"}
EXTRA = {"paper": "", "watchdog": "CARD_URL=https://ledgeyourtrades.netlify.app/api/desk/card\n"}

def role_url(admin_url, role, pw):
    p = u.urlparse(admin_url); user = p.username
    ref = user.split(".", 1)[1] if "." in user else None            # Supabase pooler wants role.<project-ref>
    login = f"{role}.{ref}" if ref else role
    netloc = f"{u.quote(login)}:{u.quote(pw, safe='')}@{p.hostname}" + (f":{p.port}" if p.port else "")
    return u.urlunparse(p._replace(netloc=netloc))

def main(sql_path, out_dir="/etc/ledger-ops"):
    rotate = "--rotate" in sys.argv; admin = os.environ["DATABASE_URL"]; os.makedirs(out_dir, mode=0o700, exist_ok=True)
    with psycopg.connect(admin, autocommit=True) as c:
        c.execute(open(sql_path).read())
        for name, role in ROLES.items():
            path = os.path.join(out_dir, f"{name}.env")
            if os.path.exists(path) and not rotate: print(f"{name}.env kept"); continue
            pw = secrets.token_urlsafe(32)
            c.execute(sql.SQL("alter role {} password {}").format(sql.Identifier(role), sql.Literal(pw)))
            fd = os.open(path + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f: f.write(f"DATABASE_URL={role_url(admin, role, pw)}\n{EXTRA[name]}")
            os.replace(path + ".tmp", path); print(f"{name}.env written (role {role})")

if __name__ == "__main__": main(sys.argv[1])

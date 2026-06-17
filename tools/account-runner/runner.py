#!/usr/bin/env python3
"""
Локальный раннер сетки аккаунтов: ProxyShard -> ShardBrowser -> Playwright.

Поток (на 1 аккаунт):
  1) ProxyShard  — собрать sticky residential-прокси (sid = id аккаунта => постоянный IP)
  2) ShardBrowser — создать профиль с этим прокси + отпечатком, запустить
  3) Playwright  — подключиться по CDP, открыть IP-чек (доказать изоляцию IP), скриншот

ЗАПУСК (на твоей машине, где открыт ShardBrowser):
  cp .env.example .env   # заполнить токены
  pip install -r requirements.txt
  python -m playwright install chromium
  python runner.py smoke --account acc1 --country ru

Это ПРОТОТИП-ПИЛОТ: открывает 1 профиль и проверяет связку. Постинг добавим после
валидации (выживаемость + заход контента).
"""
import argparse
import os
import sys
import time

import requests

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

# Если рядом лежит официальный модуль ProxyShard (из api-examples-ru) — используем его.
try:
    import proxyshard as ps_official  # type: ignore
except Exception:
    ps_official = None

SHARDX_BASE = os.environ.get("SHARDX_BASE", "http://127.0.0.1:40325")
SHARDX_TOKEN = os.environ.get("SHARDX_TOKEN", "")
PROXYSHARD_TOKEN = os.environ.get("PROXYSHARD_TOKEN", "")
PROXYSHARD_BASE = os.environ.get("PROXYSHARD_BASE", "https://user-api.proxyshard.com")
RELAY_HOST = os.environ.get("PROXYSHARD_RELAY", "relay-eu.proxyshard.com")


def die(msg: str):
    print(f"✗ {msg}", file=sys.stderr)
    sys.exit(1)


# ─────────────────────────── ProxyShard ───────────────────────────
def build_residential_username(proxy_type="standart", country="any", region=None,
                               city=None, sticky=True, sid=None, ttl=None) -> str:
    """Формат username residential (по докам ProxyShard)."""
    parts = [f"plan-{proxy_type}", f"country-{country}"]
    if region:
        parts.append(f"region-{region}")
    if city:
        parts.append(f"city-{city}")
    if sticky and sid:
        parts.append(f"sid-{sid}")
    if ttl:
        parts.append(f"ttl-{ttl}")
    return "-".join(parts)


def proxy_for_account(account: str, country="any", scheme="socks5"):
    """Вернуть строку прокси scheme://user:pass@host:port (sticky по sid=account)."""
    if not PROXYSHARD_TOKEN:
        die("PROXYSHARD_TOKEN не задан в .env")

    # 1) официальный модуль, если есть
    if ps_official:
        client = ps_official.ProxyshardClient(token=PROXYSHARD_TOKEN)
        me = client.me()
        subs = client.residential_subusers()
        if not subs:
            die("нет residential sub-users в аккаунте ProxyShard")
        sub = subs[0]
        username = ps_official.build_residential_username(
            proxy_type=sub.get("proxy_type", "standart"), country=country,
            sticky=True, sid=account)
        host = getattr(ps_official, "RELAY_HOSTS", {}).get("eu", RELAY_HOST)
        url = ps_official.build_proxy_url(username, sub["proxy_password"], host=host, scheme=scheme)
        return url, me

    # 2) инлайн-клиент (по докам)
    h = {"Authorization": f"Bearer {PROXYSHARD_TOKEN}", "Accept": "application/json"}
    me = requests.get(f"{PROXYSHARD_BASE}/user/api/me", headers=h, timeout=20).json()
    subs = requests.get(f"{PROXYSHARD_BASE}/user/api/proxies/sub-users", headers=h, timeout=20).json()
    subs = subs if isinstance(subs, list) else subs.get("data", subs.get("items", []))
    if not subs:
        die("нет residential sub-users (проверь тариф ProxyShard)")
    sub = subs[0]
    pwd = sub.get("proxy_password") or sub.get("password")
    ptype = sub.get("proxy_type", "standart")
    username = build_residential_username(proxy_type=ptype, country=country, sticky=True, sid=account)
    port = 1080 if scheme == "socks5" else 8080
    return f"{scheme}://{username}:{pwd}@{RELAY_HOST}:{port}", me


# ─────────────────────────── ShardBrowser ───────────────────────────
def sx(method: str, path: str, **kw):
    if not SHARDX_TOKEN:
        die("SHARDX_TOKEN не задан (ShardBrowser → Settings → Automation API)")
    h = kw.pop("headers", {})
    h["Authorization"] = f"Bearer {SHARDX_TOKEN}"
    try:
        r = requests.request(method, f"{SHARDX_BASE}{path}", headers=h, timeout=30, **kw)
    except requests.exceptions.ConnectionError:
        die(f"ShardBrowser не отвечает на {SHARDX_BASE} — запусти приложение")
    if not r.ok:
        die(f"ShardBrowser {method} {path} -> {r.status_code}: {r.text[:200]}")
    return r.json() if r.text else {}


def ensure_profile(account: str, proxy: str, platform="windows") -> str:
    """Создать (если нет) профиль ShardBrowser для аккаунта с прокси. Вернуть id."""
    name = f"acc:{account}"
    existing = sx("GET", "/profiles")
    items = existing if isinstance(existing, list) else existing.get("items", [])
    for p in items:
        fp = p.get("fingerprint", {})
        if fp.get("name") == name or p.get("name") == name:
            # обновим прокси на всякий
            sx("PATCH", f"/profiles/{p['id']}", json={"proxy": proxy})
            return p["id"]
    fp = sx("GET", f"/fingerprint/new/{platform}")
    body = {"fingerprint": {**fp, "name": name, "notes": "account-runner pilot"}, "proxy": proxy}
    created = sx("POST", "/profiles", json=body)
    return created.get("id") or created.get("profile_id")


def launch(profile_id: str):
    res = sx("POST", f"/profiles/{profile_id}/start")
    cdp = res.get("cdp", {})
    return cdp.get("http_url") or cdp.get("web_socket_debugger_url"), res


def stop(profile_id: str):
    try:
        sx("POST", f"/profiles/{profile_id}/stop")
    except SystemExit:
        pass


# ─────────────────────────── Playwright smoke ───────────────────────────
def smoke(account: str, country: str, keep_open: bool, scheme: str):
    print(f"▸ Аккаунт: {account} | страна прокси: {country} | scheme: {scheme}")

    proxy, me = proxy_for_account(account, country=country, scheme=scheme)
    bal = me.get("balance") or me.get("traffic") or me
    print(f"✓ ProxyShard ок (аккаунт: {me.get('email', me.get('id', '—'))})")
    print(f"  прокси (sticky sid={account}): {proxy.split('@')[-1]}  [user скрыт]")

    pid = ensure_profile(account, proxy)
    print(f"✓ ShardBrowser профиль: {pid}")

    endpoint, _ = launch(pid)
    print(f"✓ Запущен, CDP: {endpoint}")

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp(endpoint)
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://ipinfo.io/json", timeout=30000)
        ip_json = page.inner_text("body")
        print("✓ Egress IP через прокси (доказательство изоляции):")
        print("  " + ip_json.replace("\n", " ")[:200])
        page.screenshot(path=f"shot_{account}.png")
        print(f"✓ Скриншот: tools/account-runner/shot_{account}.png")
        if keep_open:
            print("  Профиль оставлен открытым (флаг --keep-open). Закрой вручную в ShardBrowser.")
        else:
            browser.close()
            stop(pid)
            print("✓ Профиль остановлен")
    print("\n✅ Связка ProxyShard → ShardBrowser → Playwright работает на 1 аккаунте.")


def main():
    ap = argparse.ArgumentParser(description="Account network runner (ProxyShard+ShardBrowser+Playwright)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sm = sub.add_parser("smoke", help="открыть 1 профиль с прокси и проверить IP")
    sm.add_argument("--account", required=True, help="id аккаунта (он же sticky sid прокси)")
    sm.add_argument("--country", default="any", help="ISO-код страны прокси (напр. ru)")
    sm.add_argument("--scheme", default="socks5", choices=["socks5", "http"])
    sm.add_argument("--keep-open", action="store_true", help="не закрывать профиль после теста")
    a = ap.parse_args()
    if a.cmd == "smoke":
        smoke(a.account, a.country, a.keep_open, a.scheme)


if __name__ == "__main__":
    main()

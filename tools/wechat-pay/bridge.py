"""Import WeChat Pay notifications into the existing SELF OS expense ledger."""

import argparse
from contextlib import closing, contextmanager
from datetime import date, datetime, time, timedelta, timezone
from hashlib import sha256
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import sqlite3
import sys
import tempfile
from threading import Lock, Thread
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import NAMESPACE_URL, UUID, uuid5
import webbrowser

from source import BUSINESS_TIME, WeChatSourceError, fetch_notifications

UTC = timezone.utc
STATE = Path.home() / "Library/Application Support/SELF OS/WeChat Pay"
BATCH = 100
LATE_WINDOW = timedelta(days=30)
PORT = 18766


class BridgeError(Exception):
    pass


class ConnectionExpired(BridgeError):
    pass


class LegacySync(BridgeError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def endpoint_url(raw):
    parts = urlsplit(raw)
    if parts.path not in ("", "/") or parts.query or parts.fragment or parts.username:
        raise BridgeError("请使用 SELF OS 网站的完整地址")
    if not (parts.scheme == "https" or
            (parts.scheme == "http" and parts.hostname == "127.0.0.1")) or not parts.hostname:
        raise BridgeError("正式 SELF OS 地址需要 HTTPS")
    return f"{parts.scheme}://{parts.netloc}"


def api_call(endpoint, path, token="", body=None):
    headers = {"Accept": "application/json", "X-Council-Request": "1"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = Request(endpoint + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
    try:
        with build_opener(NoRedirect()).open(request, timeout=12) as response:
            return json.load(response)
    except HTTPError as error:
        code = ""
        try:
            code = json.loads(error.read()).get("error", "")
        except (ValueError, OSError, AttributeError):
            pass
        if error.code in (401, 403):
            raise ConnectionExpired("SELF OS 连接已失效，需要重新连接") from None
        if error.code == 404 and path == "/v1/sync-state":
            raise LegacySync() from None
        if code in ("DATASET_MISMATCH", "GENERATION_MISMATCH", "CURSOR_AHEAD", "SYNC_UPGRADE_REQUIRED"):
            raise BridgeError("SELF OS 正在切换恢复后的账本，请刷新后再试") from None
        if code == "INVALID_CODE":
            raise BridgeError("连接码无效或已过期") from None
        if code.startswith("MISSING_REFERENCE"):
            raise BridgeError("用途分类已变更，请刷新后重试") from None
        raise BridgeError(f"SELF OS 请求失败（{error.code}）") from None
    except (URLError, TimeoutError, ValueError):
        raise BridgeError("暂时连不上 SELF OS，请稍后重试") from None


def command_for(payment, category=None, title=None):
    entity_id = str(uuid5(NAMESPACE_URL, "self-os:wechat-pay:expense:" + payment.source_id))
    data = {
        "title": title or payment.merchant or "微信支付",
        "wechatMerchant": payment.merchant,
        "day": payment.day,
        "amountMinor": str(payment.amount_minor),
        "mode": "immediate",
    }
    if payment.used_notification_date:
        data["note"] = "微信通知缺少可确认的交易日期，使用通知日期。"
    if category:
        data["categoryId"] = category.get("parentId") or category["id"]
        if category.get("parentId"):
            data["subcategoryId"] = category["id"]
        if isinstance(category.get("necessary"), bool):
            data["necessary"] = category["necessary"]
    # Replaying the same body uses the same operation ID; edits use the same expense ID.
    operation = uuid5(NAMESPACE_URL, entity_id + "/" + json.dumps(data, sort_keys=True))
    return {
        "action": "put", "baseVersion": 0, "entityType": "expense",
        "entityId": entity_id, "operationId": str(operation),
        "occurredAt": payment.occurred_at, "data": data,
    }


def read_private(path, default):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return default


def empty_state():
    return {"rules": {}, "automaticSince": None}


def write_private(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile(dir=path.parent, mode="w", encoding="utf-8", delete=False) as file:
        try:
            json.dump(value, file, ensure_ascii=False)
            file.flush()
            os.fsync(file.fileno())
            os.replace(file.name, path)
        finally:
            Path(file.name).unlink(missing_ok=True)


class ConnectionLedger:
    def __init__(self, path, legacy_path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.close(os.open(path, os.O_CREAT | os.O_WRONLY, 0o600))
        with closing(sqlite3.connect(path)) as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS ledger (
                    id INTEGER PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0,
                    state TEXT NOT NULL, cursor TEXT NOT NULL DEFAULT '0',
                    categories TEXT NOT NULL DEFAULT '{}'
                );
                CREATE TABLE IF NOT EXISTS sent (
                    ledger_id INTEGER NOT NULL, source_id TEXT NOT NULL, occurred_at TEXT NOT NULL,
                    PRIMARY KEY (ledger_id, source_id)
                ) WITHOUT ROWID;
                CREATE TABLE IF NOT EXISTS learned (
                    ledger_id INTEGER NOT NULL, expense_id TEXT NOT NULL, rule TEXT NOT NULL,
                    PRIMARY KEY (ledger_id, expense_id)
                ) WITHOUT ROWID;
            """)
        with self.transaction() as db:
            if db.execute("SELECT 1 FROM ledger LIMIT 1").fetchone():
                return
            legacy = read_private(legacy_path, {})
            sent = legacy.pop("sent", {})
            learned = legacy.pop("learnedRules", {})
            ledger = db.execute(
                "INSERT INTO ledger(state) VALUES (?)", (json.dumps({**empty_state(), **legacy}),)
            ).lastrowid
            db.executemany(
                "INSERT INTO sent VALUES (?, ?, ?)",
                ((ledger, key, occurred) for key, occurred in sent.items()),
            )
            db.executemany(
                "INSERT INTO learned VALUES (?, ?, ?)",
                ((ledger, key, json.dumps(rule)) for key, rule in learned.items()),
            )

    @contextmanager
    def transaction(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            yield db

    def read(self):
        with closing(sqlite3.connect(self.path)) as db:
            ledger, revision, state, cursor, categories = db.execute(
                "SELECT id, revision, state, cursor, categories FROM ledger ORDER BY id DESC LIMIT 1"
            ).fetchone()
        return ledger, revision, json.loads(state), cursor, json.loads(categories)

    def sent_ids(self, ledger, ids):
        found = set()
        with closing(sqlite3.connect(self.path)) as db:
            for index in range(0, len(ids), BATCH):
                batch = ids[index:index+BATCH]
                query = "SELECT source_id FROM sent WHERE ledger_id=? AND source_id IN (" + ",".join("?" for _ in batch) + ")"
                found.update(row[0] for row in db.execute(query, (ledger, *batch)))
        return found

    def learned_rules(self, ledger, ids):
        found = {}
        with closing(sqlite3.connect(self.path)) as db:
            for index in range(0, len(ids), BATCH):
                batch = ids[index:index+BATCH]
                query = "SELECT expense_id, rule FROM learned WHERE ledger_id=? AND expense_id IN (" + ",".join("?" for _ in batch) + ")"
                found.update((key, json.loads(rule)) for key, rule in db.execute(query, (ledger, *batch)))
        return found

    def update(self, ledger, revision, state, *, cursor=None, categories=None, sent=(), learned=None, reset=False):
        with self.transaction() as db:
            active = db.execute("SELECT id, revision FROM ledger ORDER BY id DESC LIMIT 1").fetchone()
            if active != (ledger, revision):
                raise BridgeError("另一个微信记账进程已更新进度，请重试")
            if reset:
                # Keep the previous ledger for reconciliation and start a new generation.
                db.execute("INSERT INTO ledger(state) VALUES (?)", (json.dumps(state),))
                return
            db.execute(
                "UPDATE ledger SET revision=revision+1, state=?, cursor=COALESCE(?, cursor), "
                "categories=COALESCE(?, categories) WHERE id=?",
                (json.dumps(state), cursor, json.dumps(categories) if categories is not None else None, ledger),
            )
            db.executemany(
                "INSERT INTO sent VALUES (?, ?, ?) ON CONFLICT(ledger_id, source_id) DO NOTHING",
                ((ledger, key, occurred) for key, occurred in sent),
            )
            if learned:
                db.executemany(
                    "INSERT INTO learned VALUES (?, ?, ?) "
                    "ON CONFLICT(ledger_id, expense_id) DO UPDATE SET rule=excluded.rule",
                    ((ledger, key, json.dumps(rule)) for key, rule in learned.items()),
                )


class Bridge:
    def __init__(self, endpoint, state_dir, source, api=api_call):
        self.endpoint = endpoint
        self.state_dir = state_dir
        self.auth_path = state_dir / "connection.json"
        self.source = source
        self.api = api
        self.lock = Lock()
        self.csrf = secrets.token_urlsafe()
        self.known_categories = {}
        self.category_cursor = "0"
        self.payments = {}
        self.visible_payments = []
        self.note = ""
        auth = read_private(self.auth_path, {})
        self.token = auth.get("credential", "") if auth.get("endpoint") == endpoint else ""
        self.state = empty_state()
        self.store = None
        self.state_path = self.connection_state_path(self.token)
        if self.token:
            legacy = self.state_path.with_suffix(".json")
            if not legacy.exists() and not auth.get("stateVersion"):
                # Only the previously saved connection may inherit its unscoped state.
                legacy = state_dir / "state.json"
            self.store = ConnectionLedger(self.state_path, legacy)
            self.load_ledger()
            if not auth.get("stateVersion"):
                write_private(self.auth_path, {**auth, "stateVersion": 1})

    def connection_state_path(self, token):
        key = sha256((self.endpoint + "\n" + token).encode()).hexdigest()
        return self.state_dir / ("connection-state-" + key + ".sqlite3")

    def load_ledger(self):
        self.ledger, self.revision, self.state, self.category_cursor, self.known_categories = self.store.read()

    def save_state(self, state=None, *, cursor=None, categories=None, sent=(), learned=None, reset=False):
        state = self.state if state is None else state
        try:
            self.store.update(
                self.ledger, self.revision, state, cursor=cursor, categories=categories,
                sent=sent, learned=learned, reset=reset,
            )
        except (BridgeError, sqlite3.Error):
            self.load_ledger()
            raise
        if reset:
            self.load_ledger()
        else:
            self.revision += 1
            self.state = state
            if cursor is not None:
                self.category_cursor = cursor
            if categories is not None:
                self.known_categories = categories

    def sent_ids(self, ids):
        ids = list(ids)
        return self.store.sent_ids(self.ledger, ids) if self.store and ids else set()

    def merchant_rule(self, merchant, state=None):
        saved = (self.state if state is None else state)["rules"].get(merchant, "")
        # Before custom names, this value was only a category ID.
        return saved if isinstance(saved, dict) else {"category": saved}

    def remember_merchant(self, merchant, category, title=None, *, state=None):
        state = self.state if state is None else state
        rule = {**self.merchant_rule(merchant, state), "category": category}
        if title is not None:
            rule["title"] = title
        state["rules"][merchant] = rule

    def pair(self, code):
        response = self.api(self.endpoint, "/v1/pair", body={"code": code})
        token = response.get("credential")
        if not token:
            raise BridgeError("请使用为微信记账工具生成的 CLI 连接码")
        state_path = self.connection_state_path(token)
        store = ConnectionLedger(state_path, state_path.with_suffix(".json"))
        write_private(self.auth_path, {"endpoint": self.endpoint, "credential": token, "stateVersion": 1})
        self.token = token
        self.state_path = state_path
        self.store = store
        self.load_ledger()
        self.payments.clear()
        self.visible_payments = []

    def prepare_scope(self):
        previous = self.state.get("scope")
        try:
            state = self.api(self.endpoint, "/v1/sync-state", self.token)
        except LegacySync:
            if previous:
                raise BridgeError("服务暂未提供账本代际，已暂停记账") from None
            return None
        try:
            scope = {key: str(UUID(state[key])) for key in ("datasetId", "generation")}
            watermark = int(state["watermark"])
            if watermark < 0:
                raise ValueError
        except (KeyError, TypeError, ValueError, AttributeError):
            raise BridgeError("无法确认当前账本，请刷新后再试") from None
        if ((previous and previous != scope) or (not previous and state.get("scopeRequired"))
                or int(self.category_cursor) > watermark):
            self.save_state({**empty_state(), "scope": scope}, reset=True)
            self.note = "账本已从备份恢复，微信自动记账已暂停。请先核对最近支付。"
        elif previous != scope:
            self.save_state({**self.state, "scope": scope})
        return scope

    def refresh_categories(self):
        if not self.token:
            return None
        scope = self.prepare_scope()
        query = "&" + urlencode(scope) if scope else ""
        while True:
            response = self.api(
                self.endpoint, "/v1/changes?cursor=" + self.category_cursor + "&limit=300" + query, self.token
            )
            cursor = response["nextCursor"]
            if not isinstance(cursor, str) or not cursor.isascii() or not cursor.isdecimal() or (
                int(cursor) < int(self.category_cursor)
                or response["hasMore"] and int(cursor) == int(self.category_cursor)
            ):
                raise BridgeError("分类同步暂时无法继续")

            categories = dict(self.known_categories)
            confirmations = {}
            for change in response["changes"]:
                item = change["entity"]
                if item["type"] == "category":
                    if item["deleted"]:
                        categories.pop(item["id"], None)
                    else:
                        categories[item["id"]] = {**item["data"], "id": item["id"]}
                elif item["type"] == "expense" and not item["deleted"]:
                    confirmed = item["data"].get("wechatMerchantRule")
                    if isinstance(confirmed, list) and len(confirmed) in (3, 4):
                        confirmations[item["id"]] = confirmed

            known = self.store.learned_rules(self.ledger, list(confirmations)) if confirmations else {}
            learned = {key: rule for key, rule in confirmations.items() if known.get(key) != rule}
            if cursor != self.category_cursor or categories != self.known_categories or learned:
                state = {**self.state, "rules": dict(self.state["rules"])}
                for confirmed in learned.values():
                    merchant, category, _ = confirmed[:3]
                    title = confirmed[3] if len(confirmed) == 4 else None
                    self.remember_merchant(merchant, category, title, state=state)
                self.save_state(state, cursor=cursor,
                                categories=categories if categories != self.known_categories else None,
                                learned=learned)
            if not response["hasMore"]:
                return scope

    def scan(self, start, end=None, *, display=True):
        try:
            result = self.source(start, end)
        except WeChatSourceError as error:
            raise BridgeError(str(error)) from None
        except (OSError, RuntimeError, ValueError):
            raise BridgeError("暂时读不到本机微信支付通知，请检查微信记录是否已同步到 Mac") from None
        if display:
            self.visible_payments = sorted(result, key=lambda item: (item.occurred_at, item.source_id), reverse=True)[:BATCH]
        self.payments = {item.source_id: item for item in self.visible_payments}
        if not display:
            self.payments.update((item.source_id, item) for item in result)
        return result

    def import_selected(self, ids, categories, remember=frozenset()):
        if not self.token:
            raise BridgeError("请先连接 SELF OS")
        if len(ids) > BATCH:
            raise BridgeError(f"一次最多选择 {BATCH} 条")
        if any(key not in self.payments for key in ids):
            raise BridgeError("请刷新支付记录后重试")
        if not ids:
            return (0, 0)
        scope = self.refresh_categories()
        return self.apply_payments(ids, categories, remember, scope)

    def apply_payments(self, ids, categories, remember, scope):
        added = existing = 0
        known_sent = self.sent_ids(ids)
        for key in ids:
            payment = self.payments[key]
            rule = self.merchant_rule(payment.merchant)
            category_id = categories.get(key, rule["category"])
            category = self.known_categories.get(category_id)
            parent = category.get("parentId") if category else None
            if parent and parent not in self.known_categories:
                category = None
            if key in known_sent:
                existing += 1
                continue
            command = command_for(payment, category, rule.get("title"))
            if scope:
                command["scope"] = scope
            result = self.api(self.endpoint, "/v1/commands", self.token, command)
            if result["outcome"] == "accepted":
                added += 1
            elif result["outcome"] == "conflict":
                current = result.get("current") or {}
                if current.get("id") != command["entityId"] or current.get("type") != "expense":
                    raise BridgeError("账单编号发生冲突，请核对此笔支付")
                data = current.get("data", {})
                if not current.get("deleted") and (
                    data.get("amountMinor") != payment.amount_minor or data.get("day") != payment.day
                    or (data.get("wechatMerchant") and data["wechatMerchant"] != payment.merchant)
                ):
                    raise BridgeError("已有账单与微信支付内容不同，请核对金额、日期或商户")
                existing += 1  # Includes a deleted expense; do not recreate it.
            else:
                raise BridgeError("有一笔支付暂时未保存，稍后可重试")
            state = self.state
            if key in remember and category:
                state = {**self.state, "rules": dict(self.state["rules"])}
                self.remember_merchant(payment.merchant, category["id"], state=state)
            self.save_state(state, sent=((key, payment.occurred_at),))
            known_sent.add(key)
        return added, existing

    def tick(self, now=None):
        if not self.state["automaticSince"] or not self.token:
            return
        scope = self.refresh_categories()
        if not self.state["automaticSince"]:
            return
        now = now or datetime.now(UTC)
        # Run the wider overlap once daily to catch messages synced late by the phone.
        since = datetime.fromisoformat(self.state["automaticSince"])
        last_sweep = self.state.get("lateSweepThrough")
        sweep = not last_sweep or now - datetime.fromisoformat(last_sweep) >= timedelta(days=1)
        if sweep:
            start = max(since, now - LATE_WINDOW)
        else:
            through = datetime.fromisoformat(self.state.get("scanThrough") or self.state["automaticSince"])
            start = max(since, through - timedelta(days=2), now - LATE_WINDOW)
        seen = self.scan(start, now, display=False)
        candidates = list(dict.fromkeys(item.source_id for item in seen))
        known_sent = self.sent_ids(candidates)
        upcoming = [key for key in candidates if key not in known_sent]
        for index in range(0, len(upcoming), BATCH):
            self.apply_payments(upcoming[index:index+BATCH], {}, frozenset(), scope)
        self.state["scanThrough"] = now.isoformat()
        if sweep:
            self.state["lateSweepThrough"] = now.isoformat()
        self.save_state()

    def category_options(self, current):
        yield option("", "待分类", current)
        for key, category in sorted(self.known_categories.items(), key=lambda row: row[1]["name"]):
            parent = self.known_categories.get(category.get("parentId"))
            if category.get("parentId") and not parent:
                continue
            yield option(key, (parent["name"] + " / " if parent else "") + category["name"], current)


def option(key, label, current):
    selected = " selected" if key == current else ""
    return f'<option value="{escape(key)}"{selected}>{escape(label)}</option>'


def render(bridge, nonce=None):
    token = escape(bridge.csrf)
    form = f'<input type="hidden" name="csrf" value="{token}">'
    if nonce:
        form += '<input type="hidden" name="embedded" value="1">'
    notice = f'<p class="notice" role="status">{escape(bridge.note)}</p>' if bridge.note else ""
    records = bridge.visible_payments
    enabled = bool(bridge.state["automaticSince"])
    pair = "" if bridge.token else f"""
      <section><h2>连接 SELF OS</h2><form method="post" action="/pair" class="toolbar">
        {form}<input name="code" placeholder="输入一次性连接码" aria-label="连接码" required autocomplete="off"><button>连接</button>
      </form></section>"""
    settings = f"""
      <section class="settings"><div><strong>自动同步新通知</strong><small>已记住的商户按原用途记账，其余进入待分类。</small></div>
        <form method="post" action="/automatic">{form}
        <button class="secondary" {"disabled" if not bridge.token else ""}>{ "关闭" if enabled else "开启" }</button>
        </form></section>"""
    rules = ""
    for merchant_name in sorted(bridge.state["rules"]):
        rule = bridge.merchant_rule(merchant_name)
        merchant = escape(merchant_name)
        title = rule.get("title")
        alias = f"<small>{escape(title)}</small>" if title and title != merchant_name else ""
        category = escape(bridge.known_categories.get(rule["category"], {}).get("name", "分类已移除"))
        rules += (f'<li><div>{merchant}{alias}</div><span>{category}</span><form method="post" action="/forget">'
                  f'{form}<button name="merchant" value="{merchant}" class="secondary">移除</button></form></li>')
    list_rows = ""
    known_sent = bridge.sent_ids(item.source_id for item in records)
    for item in records:
        key = escape(item.source_id)
        major, minor = divmod(int(item.amount_minor), 100)
        merchant = escape(item.merchant)
        rule = bridge.merchant_rule(item.merchant)
        sent = item.source_id in known_sent
        fields = '<span class="subtle">已记账</span>' if sent else f"""
          <label><select name="category-{key}" aria-label="{merchant}用途">{''.join(bridge.category_options(rule["category"]))}</select></label>
          <label class="remember"><input type="checkbox" name="remember" value="{key}">记住用途</label>"""
        if sent and bridge.token:
            fields = f"""<label><select name="category-{key}" aria-label="{merchant}以后用途">
              {''.join(bridge.category_options(rule["category"]))}</select></label>
              <button class="secondary" formaction="/rule" name="payment" value="{key}">记为以后用途</button>"""
        checkbox = "" if sent else f'<input type="checkbox" name="selected" value="{key}" aria-label="选择{merchant}">'
        try:
            time = datetime.fromisoformat(item.occurred_at).astimezone(timezone(timedelta(hours=8))).strftime("%H:%M")
        except ValueError:
            time = ""
        status = " · 已记账" if sent else ""
        if item.used_notification_date:
            status += " · 日期来自通知"
        list_rows += f'<div class="payment"><div class="merchant">{checkbox}<div>{merchant}<small>{escape(item.day)} {time}{status}</small></div></div><span class="amount">¥{major:,}.{minor:02}</span>{fields}</div>'
    can_write = "" if bridge.token and records else "disabled"
    ledger = escape(bridge.endpoint + "/expenses")
    header = "" if nonce else f'<header><h1>微信支付记账</h1><a href="{ledger}">打开花销 →</a></header>'
    parent = f' data-parent-origin="{escape(bridge.endpoint)}"' if nonce else ""
    script = f'<script nonce="{nonce}">{EMBED_SCRIPT}</script>' if nonce else ""
    style = ' class="embedded"' if nonce else ""
    return f"""<!doctype html><html lang="zh-CN"{style}><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>微信支付 · SELF OS</title><style>{STYLE}</style>
    <main{parent}>{header}{notice}{pair}{settings}
    <section><div class="toolbar heading"><h2>最近支付</h2><form method="post" action="/scan">{form}<button class="secondary">读取最近两天</button></form></div>
    <details><summary>按日期补扫</summary><form method="post" action="/scan" class="toolbar scan-dates">
    {form}<label>从 <input type="date" name="start" required></label><label>至 <input type="date" name="end" required></label>
    <button class="secondary">读取</button></form></details>
    <form method="post" action="/import">{form}
    {list_rows or '<p class="subtle">读取后，在这里选择要记账的支付。</p>'}
    <footer><button {can_write}>导入所选</button></footer></form></section>
    {('<section><h2>已记住的商户</h2><ul>'+rules+'</ul></section>') if rules else ''}
    </main>{script}</html>"""


STYLE = """
:root{color-scheme:light dark;font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;
--bg:light-dark(#f3f2ee,#181818);--surface:light-dark(#fbfaf7,#212121);--line:light-dark(#dcd9d1,#3a3a3a);
--text:light-dark(#2b2a27,#f5f5f5);--muted:light-dark(#5e5b55,#a0a0a0);--fill:light-dark(#e9e7e1,#303030);
--solid:light-dark(#55524c,#f5f5f5);--ink:light-dark(#fbfaf7,#181818);
--notice:light-dark(#e5eee0,#27332b);--accent:light-dark(#3f8f5a,#5fcf8a);
background:var(--bg);color:var(--text)}
:root.embedded{background:transparent}
:root[data-theme=dark]{color-scheme:dark}:root[data-theme=light]{color-scheme:light}
*{box-sizing:border-box}body{margin:0}main{max-width:880px;margin:56px auto;padding:0 20px}
main[data-parent-origin]{display:flow-root;margin:0;padding:0 0 2px}
main[data-parent-origin]>:first-child{margin-top:0}main[data-parent-origin]>:last-child{margin-bottom:0}
header,.toolbar,.settings,li{display:flex;align-items:center;justify-content:space-between;gap:14px}
.scan-dates{flex-wrap:wrap;justify-content:start;margin:8px 0}
h1{font-size:28px;letter-spacing:-.035em;margin:0 0 12px}h2{font-size:15px;margin:0}
a{color:var(--muted);text-decoration:none}a:hover{text-decoration:underline}
section{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:12px 0}
small,.subtle,.remember{color:var(--muted)}small{display:block;font-size:12px}
button,input,select{font:inherit}button{background:var(--solid);color:var(--ink);border:0;border-radius:8px;padding:6px 12px;font-weight:600;cursor:pointer;white-space:nowrap}
button.secondary{background:var(--fill);color:var(--text)}button:disabled{opacity:.4;cursor:default}
input:not([type=checkbox]),select{background:var(--fill);color:var(--text);border:1px solid var(--line);border-radius:7px;padding:5px 7px}
input[type=checkbox]{accent-color:var(--accent);width:16px;height:16px;margin:0;flex-shrink:0}
.payment{border-top:1px solid var(--line);display:grid;grid-template-columns:minmax(0,1fr) auto minmax(125px,auto) minmax(0,auto);align-items:center;gap:14px;padding:10px 0}
.merchant,.remember{display:flex;align-items:center;gap:8px}.merchant div{min-width:0;overflow-wrap:anywhere}
.amount{font-variant-numeric:tabular-nums;white-space:nowrap}select{width:100%;max-width:220px}
.heading{margin-bottom:10px}footer{margin-top:12px}ul{list-style:none;padding:0;margin:8px 0 0}li{border-top:1px solid var(--line);padding:8px 0}li span{margin-left:auto;color:var(--muted)}
.notice{background:var(--notice);border-radius:9px;padding:10px 14px}
@media(max-width:560px){main{margin:24px auto}.payment{grid-template-columns:minmax(0,1fr) auto}.remember{justify-content:flex-end}}
"""

EMBED_SCRIPT = """
const main = document.querySelector('main');
window.addEventListener('message', ({data, origin, source}) => {
  if (source === parent && origin === main.dataset.parentOrigin && data?.type === 'council-wechat-pay-theme' &&
      (data.theme === 'light' || data.theme === 'dark')) {
    document.documentElement.dataset.theme = data.theme;
  }
});
function reportSize() {
  parent.postMessage({
    type: 'council-wechat-pay-size', height: Math.ceil(main.getBoundingClientRect().height)
  }, main.dataset.parentOrigin);
}
reportSize();
new ResizeObserver(reportSize).observe(main);
"""


def run_server(bridge, port, browse):
    host = f"127.0.0.1:{port}"

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            if self.headers.get("Host") != host or self.path not in ("/", "/embedded"):
                self.send_error(404)
                return
            nonce = secrets.token_urlsafe() if self.path == "/embedded" else None
            policy = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'"
            if nonce:
                policy += f"; frame-ancestors {bridge.endpoint}; script-src 'nonce-{nonce}'"
            else:
                policy += "; frame-ancestors 'none'"
            try:
                with bridge.lock:
                    html = render(bridge, nonce).encode()
            except sqlite3.Error:
                self.send_error(503)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy", policy)
            self.end_headers()
            self.wfile.write(html)

        def do_POST(self):
            if self.headers.get("Host") != host or self.headers.get("Origin") not in (None, "http://" + host):
                self.send_error(403)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 96_000:
                    raise ValueError
                fields = parse_qs(self.rfile.read(length).decode(), keep_blank_values=True, max_num_fields=500)
            except (ValueError, UnicodeError):
                self.send_error(400)
                return
            if not secrets.compare_digest(fields.get("csrf", [""])[0], bridge.csrf):
                self.send_error(403)
                return
            with bridge.lock:
                try:
                    self.apply(fields)
                except BridgeError as error:
                    if isinstance(error, ConnectionExpired):
                        bridge.token = ""
                    bridge.note = str(error)
                except (OSError, ValueError, KeyError, sqlite3.Error):
                    bridge.note = "操作暂时失败，请稍后重试"
            self.send_response(303)
            self.send_header("Location", "/embedded" if fields.get("embedded") == ["1"] else "/")
            self.end_headers()

        def apply(self, fields):
            if self.path == "/pair":
                bridge.pair(fields.get("code", [""])[0].strip())
                bridge.refresh_categories()
                bridge.note = "已连接 SELF OS"
            elif self.path == "/scan":
                now = datetime.now(UTC)
                start, end = now - timedelta(days=2), now
                if "start" in fields or "end" in fields:
                    try:
                        first = date.fromisoformat(fields.get("start", [""])[0])
                        last = date.fromisoformat(fields.get("end", [""])[0])
                        if not 0 <= (last - first).days < 90 or first > now.astimezone(BUSINESS_TIME).date():
                            raise ValueError
                        start = datetime.combine(first, time.min, BUSINESS_TIME)
                        end = min(now, datetime.combine(last, time.max, BUSINESS_TIME))
                    except (ValueError, OverflowError):
                        raise BridgeError("请选择有效日期，补扫范围最多 90 天") from None
                new = bridge.scan(start, end)
                bridge.refresh_categories()
                bridge.note = f"已读取 {len(new)} 笔微信支付"
                if len(new) > BATCH:
                    bridge.note += f"，显示最近 {BATCH} 笔。更早的付款请缩小日期范围。"
            elif self.path == "/import":
                ids = list(dict.fromkeys(fields.get("selected", [])))
                categories = {key: values[0] for key, values in fields.items() if key.startswith("category-")}
                added, existing = bridge.import_selected(ids, {key: categories.get("category-" + key, "") for key in ids}, set(fields.get("remember", [])))
                bridge.note = f"已导入 {added} 笔，已存在 {existing} 笔" if ids else "请先勾选要导入的支付"
            elif self.path == "/automatic":
                if not bridge.token:
                    raise BridgeError("请先连接 SELF OS")
                active = not bridge.state["automaticSince"]
                bridge.state["automaticSince"] = datetime.now(UTC).isoformat() if active else None
                bridge.state.pop("scanThrough", None)
                bridge.state.pop("lateSweepThrough", None)
                bridge.save_state()
                bridge.note = "已开启，从现在起同步新支付" if active else "已关闭自动同步"
            elif self.path == "/forget":
                bridge.state["rules"].pop(fields.get("merchant", [""])[0], None)
                bridge.save_state()
                bridge.note = "已移除商户用途规则"
            elif self.path == "/rule":
                key = fields.get("payment", [""])[0]
                category = fields.get("category-" + key, [""])[0]
                bridge.refresh_categories()
                if key not in bridge.sent_ids([key]) or key not in bridge.payments or category not in bridge.known_categories:
                    raise BridgeError("请选择要记住的用途")
                bridge.remember_merchant(bridge.payments[key].merchant, category)
                bridge.save_state()
                bridge.note = "已记住商户用途，应用于后续支付"

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)

    def poll():
        import time
        while True:
            with bridge.lock:
                try:
                    bridge.tick()
                except BridgeError as error:
                    if isinstance(error, ConnectionExpired):
                        bridge.token = ""
                    bridge.note = str(error)
                except (OSError, ValueError, KeyError, sqlite3.Error):
                    bridge.note = "自动同步暂时失败，会稍后重试"
            time.sleep(300)

    Thread(target=poll, daemon=True).start()
    if browse:
        webbrowser.open("http://" + host)
    server.serve_forever()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--wechat-project", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, default=STATE)
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--open", action="store_true", dest="browse")
    parser.add_argument("--pair-stdin", action="store_true", help="从标准输入接收一次性连接码")
    args = parser.parse_args()
    bridge = Bridge(
        endpoint_url(args.endpoint), args.state_dir,
        lambda start, end: fetch_notifications(start, end, cli_project=args.wechat_project),
    )
    if args.pair_stdin:
        bridge.pair(sys.stdin.readline(64).strip())
        print("微信支付记账已连接 SELF OS")
        return
    run_server(bridge, args.port, args.browse)


if __name__ == "__main__":
    main()

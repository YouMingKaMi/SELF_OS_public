"""Read merchant payment receipts from the pinned WeChat Pay public account."""

from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from hashlib import md5, sha256
import json
from pathlib import Path
import re
import sqlite3
import sys
from tempfile import TemporaryDirectory
from xml.etree import ElementTree
from zoneinfo import ZoneInfo


WECHAT_PAY_ACCOUNT = "gh_3dfda90e39d6"
PAYMENT_TABLE = f"Msg_{md5(WECHAT_PAY_ACCOUNT.encode(), usedforsecurity=False).hexdigest()}"
BIZ_DB = re.compile(r"message/biz_message_\d+\.db")
CNY = re.compile(r"[¥￥]\s*((?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]{1,9})(?:\.[0-9]{1,2})?)\s*(?:元)?")
TRANSACTION_ID = re.compile(r"[0-9]{16,48}")
EXCLUDED_LABEL = re.compile(r"退款|收款金额|收款账户|提现|充值|转账")
BUSINESS_TIME = ZoneInfo("Asia/Shanghai")
PAYMENT_TIME_LABELS = {"支付时间", "付款时间", "交易时间", "扣款时间", "消费时间", "完成时间"}
PAYMENT_TIMES = (
    "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M",
    "%Y年%m月%d日 %H:%M:%S", "%Y年%m月%d日 %H:%M",
    "%Y-%m-%dT%H:%M:%S%z",
)


@dataclass(frozen=True)
class PaymentNotification:
    source_id: str
    merchant: str
    amount_minor: str
    day: str
    occurred_at: str
    used_notification_date: bool = False


class WeChatSourceError(RuntimeError):
    """A local source problem whose message is safe to display."""


def cny_minor(value: str) -> str | None:
    match = CNY.fullmatch(value.strip())
    if not match:
        return None
    whole, _, fractional = match[1].replace(",", "").partition(".")
    minor = int(whole) * 100 + int(fractional.ljust(2, "0"))
    return str(minor) if minor else None


def _business_day(fields: list[tuple[str, str]], received_at: datetime) -> tuple[str, bool]:
    candidates = set()
    for label, value in fields:
        if label not in PAYMENT_TIME_LABELS:
            continue
        for pattern in PAYMENT_TIMES:
            try:
                parsed = datetime.strptime(value, pattern)
            except ValueError:
                continue
            paid_at = parsed if parsed.tzinfo else parsed.replace(tzinfo=BUSINESS_TIME)
            if paid_at <= received_at + timedelta(minutes=2):
                candidates.add(paid_at.astimezone(BUSINESS_TIME).date().isoformat())
            break
    if len(candidates) == 1:
        return candidates.pop(), False
    return received_at.astimezone(BUSINESS_TIME).date().isoformat(), True


def parse_receipt(
    content: str | None, server_id: int, received_at: int
) -> PaymentNotification | None:
    """Parse one row whose local message sender was verified by the reader."""
    if not content or len(content) > 262_144 or re.search(r"<!DOCTYPE|<!ENTITY", content, re.I):
        return None
    try:
        root = ElementTree.fromstring(content)
    except ElementTree.ParseError:
        return None
    if root.tag != "msg" or root.findtext("fromusername") != WECHAT_PAY_ACCOUNT:
        return None

    header = root.find("./appmsg/mmreader/template_header")
    detail = root.find("./appmsg/mmreader/template_detail")
    if header is None or detail is None:
        return None
    if detail.findtext("is_pay_recepit") != "1":
        return None

    title = (root.findtext("appmsg/title") or "").strip()
    header_title = (header.findtext("title") or "").strip()
    if header_title != "微信支付凭证":
        if not header_title.startswith("微信支付") or not title.startswith(("¥", "￥")):
            return None
        if any(word in header_title for word in ("退款", "收款", "提现", "转账", "充值")):
            return None

    top = detail.find("line_content/topline")
    if top is None or EXCLUDED_LABEL.search(top.findtext("key/word") or ""):
        return None
    amount = cny_minor(top.findtext("value/word") or "")
    if amount is None:
        return None

    # The standard receipt title repeats the amount. A disagreement is ambiguous.
    if title.startswith("已支付") and cny_minor(title.removeprefix("已支付")) != amount:
        return None
    fields = [
        ((line.findtext("key/word") or "").strip().rstrip(":："),
         (line.findtext("value/word") or "").strip())
        for line in detail.findall(".//lines/line")
    ]
    if any(label == "交易状态" and not value.startswith(("支付成功", "付款成功", "交易成功", "扣款成功"))
           for label, value in fields):
        return None

    merchant = " ".join((header.findtext("display_name") or "").split())[:200]
    if not merchant:
        return None

    transaction = (header.findtext("transaction_id") or "").strip()
    if TRANSACTION_ID.fullmatch(transaction):
        identity = "wechatpay:transaction:" + transaction
    elif type(server_id) is int and server_id:
        identity = "wechatpay:receipt:" + str(server_id)
    else:
        return None

    try:
        instant = datetime.fromtimestamp(received_at, tz=timezone.utc)
    except (ValueError, TypeError, OverflowError, OSError):
        return None
    day, used_notification_date = _business_day(fields, instant)
    return PaymentNotification(
        source_id=sha256(identity.encode()).hexdigest(),
        merchant=merchant,
        amount_minor=amount,
        day=day,
        occurred_at=instant.isoformat(timespec="seconds").replace("+00:00", "Z"),
        used_notification_date=used_notification_date,
    )


def _read_receipts(path, start_ts, end_ts, decompress_content):
    uri = Path(path).as_uri() + "?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as db:
        if not db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            (PAYMENT_TABLE,),
        ).fetchone():
            return None

        trusted_sender = db.execute(
            "SELECT rowid FROM Name2Id WHERE user_name=?", (WECHAT_PAY_ACCOUNT,)
        ).fetchone()
        if trusted_sender is None:
            raise WeChatSourceError("微信支付消息表无法核验发送方。")

        rows = db.execute(
            f"""SELECT server_id, create_time, message_content, WCDB_CT_message_content
                FROM [{PAYMENT_TABLE}]
                WHERE real_sender_id=? AND create_time>=? AND create_time<=?
                  AND local_type & 4294967295 = 49
                ORDER BY create_time, server_id""",
            (trusted_sender[0], start_ts, end_ts),
        )
        receipts = []
        for server_id, stamp, body, encoding in rows:
            receipt = parse_receipt(decompress_content(body, encoding), server_id, stamp)
            if receipt is not None:
                receipts.append(receipt)
        return receipts


def fetch_notifications(
    start: datetime,
    end: datetime | None = None,
    *,
    cli_project: Path | None = None,
    config_path: Path | None = None,
) -> list[PaymentNotification]:
    """Query only the official Pay table; never invoke the global chat commands."""
    end = end or datetime.now(timezone.utc)
    if start.utcoffset() is None or end.utcoffset() is None or start > end:
        raise ValueError("Invalid WeChat Pay date window")

    if cli_project is not None:
        sys.path.insert(0, str(Path(cli_project).resolve()))
    try:
        from wechat_cli.core.config import CONFIG_FILE, load_config
        from wechat_cli.core.db_cache import DBCache
        from wechat_cli.core.key_utils import strip_key_metadata
        from wechat_cli.core.messages import decompress_content
    except ImportError as exc:
        raise WeChatSourceError("无法加载本机 wechat-cli 的 Python 模块。") from exc
    finally:
        if cli_project is not None:
            sys.path.pop(0)

    config_path = Path(config_path or CONFIG_FILE).expanduser().resolve()
    try:
        # Require a configured account; avoid wechat-cli automatically choosing one.
        if not json.loads(config_path.read_text(encoding="utf-8")).get("db_dir"):
            raise WeChatSourceError("请先为本机 wechat-cli 选择微信账号。")
        config = load_config(str(config_path))
        keys = strip_key_metadata(json.loads(Path(config["keys_file"]).read_text(encoding="utf-8")))
        paths = [key for key in keys if BIZ_DB.fullmatch(key.replace("\\", "/"))]
        if not paths:
            raise WeChatSourceError("本机 wechat-cli 缺少微信支付所在的公众号消息库。")

        receipts = {}
        has_payment_table = False
        with TemporaryDirectory(prefix="selfos-wechat-pay-") as scratch:
            # The source library decrypts database files to disk. Confine those
            # temporary files to one mode-0700 directory and remove them at exit.
            class PrivateDBCache(DBCache):
                CACHE_DIR = scratch
                MTIME_FILE = str(Path(scratch) / "cache.json")

            cache = PrivateDBCache(keys, config["db_dir"])
            for path in sorted(paths):
                try:
                    (Path(config["db_dir"]) / path.replace("\\", "/")).stat()
                except FileNotFoundError:
                    continue
                database = cache.get(path)
                if not database:
                    continue
                batch = _read_receipts(database, int(start.timestamp()), int(end.timestamp()), decompress_content)
                if batch is None:
                    continue
                has_payment_table = True
                for receipt in batch:
                    old = receipts.get(receipt.source_id)
                    if old is not None and old.amount_minor != receipt.amount_minor:
                        raise WeChatSourceError("微信支付凭证金额不一致，已暂停导入。")
                    if old is None or receipt.occurred_at < old.occurred_at:
                        receipts[receipt.source_id] = receipt
        if not has_payment_table:
            raise WeChatSourceError("本机公众号消息库里没有微信支付会话。")
        return sorted(receipts.values(), key=lambda item: (item.occurred_at, item.source_id))
    except PermissionError as exc:
        raise WeChatSourceError("macOS 没有允许后台入口访问微信本机数据。") from exc
    except (OSError, sqlite3.Error, ValueError, KeyError, TypeError, AttributeError) as exc:
        raise WeChatSourceError("读取本机微信支付通知失败，请确认微信与 wechat-cli 还可正常使用。") from exc

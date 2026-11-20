from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
from unittest import TestCase, main

from source import PAYMENT_TABLE, WECHAT_PAY_ACCOUNT, _read_receipts, cny_minor, parse_receipt


def receipt(
    *,
    merchant="合成食堂",
    amount="￥24.50",
    title="已支付¥24.50",
    header="微信支付凭证",
    label="零钱支付",
    paid="1",
    transaction="4200000000000000000000012345",
    status="支付成功 对方已收款",
    sender=WECHAT_PAY_ACCOUNT,
    payment_time="",
):
    return f"""<msg><appmsg><title>{title}</title><type>5</type><mmreader>
      <template_header><title>{header}</title><display_name>{merchant}</display_name>
      <transaction_id>{transaction}</transaction_id></template_header>
      <template_detail><line_content><topline><key><word>{label}</word></key>
      <value><word>{amount}</word></value></topline><lines>
      <line><key><word>交易状态</word></key><value><word>{status}</word></value></line>
      <line><key><word>支付时间</word></key><value><word>{payment_time}</word></value></line>
      </lines></line_content><is_pay_recepit>{paid}</is_pay_recepit></template_detail>
    </mmreader></appmsg><fromusername>{sender}</fromusername></msg>"""


STAMP = int(datetime(2026, 11, 15, 17, 1, tzinfo=timezone.utc).timestamp())


class SourceTests(TestCase):
    def test_extracts_cent_amount_and_uses_beijing_business_date(self):
        payment = parse_receipt(receipt(), 123, STAMP)
        self.assertIsNotNone(payment)
        self.assertEqual(payment.merchant, "合成食堂")
        self.assertEqual(payment.amount_minor, "2450")
        self.assertEqual(payment.day, "2026-11-16")
        self.assertEqual(payment.occurred_at, "2026-11-15T17:01:00Z")
        self.assertTrue(payment.used_notification_date)

    def test_same_transaction_is_stable_across_repeated_message(self):
        first = parse_receipt(receipt(), 123, STAMP)
        copy = parse_receipt(receipt(), 456, STAMP + 15)
        self.assertEqual(first.source_id, copy.source_id)
        missing_transaction = receipt(transaction="")
        a = parse_receipt(missing_transaction, 123, STAMP)
        b = parse_receipt(missing_transaction, 456, STAMP)
        self.assertNotEqual(a.source_id, b.source_id)
        self.assertIsNone(parse_receipt(missing_transaction, 0, STAMP))

    def test_prefers_explicit_payment_day_but_keeps_receipt_scan_time(self):
        late_notice = parse_receipt(receipt(payment_time="2026年11月15日 23:45:00"), 123, STAMP)
        self.assertEqual(late_notice.day, "2026-11-15")
        self.assertEqual(late_notice.occurred_at, "2026-11-15T17:01:00Z")
        self.assertFalse(late_notice.used_notification_date)
        for impossible in ("2026-11-17 00:00:00", "昨天", "2026-02-30 23:59"):
            payment = parse_receipt(receipt(payment_time=impossible), 123, STAMP)
            self.assertEqual(payment.day, "2026-11-16")

    def test_rejects_unconfirmed_refund_credit_or_non_cny(self):
        for example in (
            receipt(paid="0"),
            receipt(header="退款到账通知", label="退款金额"),
            receipt(label="收款金额"),
            receipt(header="微信支付退款", title="¥24.50 已退款"),
            receipt(status="支付失败"),
            receipt(amount="￥25.50"),
            receipt(sender="gh_synthetic_other"),
            receipt(amount="HK$24.50"),
            "<!DOCTYPE msg>" + receipt(),
        ):
            self.assertIsNone(parse_receipt(example, 123, STAMP))

    def test_formats_amount_without_rounding(self):
        self.assertEqual(cny_minor("¥1,234.5"), "123450")
        self.assertEqual(cny_minor("￥24 元"), "2400")
        self.assertIsNone(cny_minor("¥24.567"))
        self.assertIsNone(cny_minor("¥24.50 或 ¥36.00"))
        self.assertIsNone(cny_minor("¥0.00"))

    def test_scope_uses_exact_account_and_sender(self):
        with TemporaryDirectory() as temp:
            path = Path(temp) / "cache.sqlite"
            with closing(sqlite3.connect(path)) as db:
                db.execute("CREATE TABLE Name2Id(user_name TEXT)")
                db.executemany(
                    "INSERT INTO Name2Id VALUES (?)", [(WECHAT_PAY_ACCOUNT,), ("gh_other",)]
                )
                db.execute(
                    f"""CREATE TABLE [{PAYMENT_TABLE}] (
                        server_id INTEGER, create_time INTEGER,
                        message_content TEXT, WCDB_CT_message_content INTEGER,
                        real_sender_id INTEGER, local_type INTEGER)"""
                )
                db.executemany(
                    f"INSERT INTO [{PAYMENT_TABLE}] VALUES (?, ?, ?, ?, ?, ?)",
                    [
                        (101, STAMP, receipt(), 0, 1, (5 << 32) | 49),
                        (102, STAMP, receipt(transaction=""), 0, 2, (5 << 32) | 49),
                        (103, STAMP - 1, receipt(transaction=""), 0, 1, (5 << 32) | 49),
                        (104, STAMP, receipt(transaction=""), 0, 1, 1),
                    ],
                )
                db.commit()
            decoded = []
            def decompress(content, _encoding):
                decoded.append(content)
                return content
            result = _read_receipts(path, STAMP, STAMP + 1, decompress)
            self.assertEqual(len(result), 1)
            self.assertEqual(len(decoded), 1)
            self.assertEqual(result[0].amount_minor, "2450")


if __name__ == "__main__":
    main()

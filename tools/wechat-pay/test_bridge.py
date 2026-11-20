from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest

from bridge import Bridge, BridgeError, command_for, endpoint_url, render


@dataclass(frozen=True)
class Payment:
    source_id: str
    merchant: str
    amount_minor: str
    day: str = "2026-11-16"
    occurred_at: str = "2026-11-16T04:20:00Z"
    used_notification_date: bool = False


CATEGORY = "00000000-0000-4000-a000-000000000001"
CHILD = "00000000-0000-4000-a000-000000000002"


class MockAPI:
    def __init__(self):
        self.created = {}
        self.posts = 0
        self.fail_next = False

    def __call__(self, endpoint, path, token="", body=None):
        if path == "/v1/pair":
            return {"credential": "test-credential"}
        if path.startswith("/v1/changes"):
            changed = [
                {"entity": {"id": CATEGORY, "type": "category", "deleted": False,
                            "data": {"name": "餐饮"}}},
                {"entity": {"id": CHILD, "type": "category", "deleted": False,
                            "data": {"name": "食堂", "parentId": CATEGORY, "necessary": True}}},
                {"entity": {"id": "other-module", "type": "task", "deleted": False,
                            "data": {"title": "must not be retained"}}},
            ] if "cursor=0" in path else []
            return {"nextCursor": "3", "hasMore": False, "changes": changed}
        self.posts += 1
        if self.fail_next:
            self.fail_next = False
            raise BridgeError("network error")
        entity = body["entityId"]
        if entity in self.created:
            saved = self.created[entity]
            return {"outcome": "conflict", "current": {
                "id": entity, "type": saved["entityType"], "data": saved["data"],
                "deleted": saved.get("deleted", False),
            }}
        self.created[entity] = body
        return {"outcome": "accepted"}


class BridgeTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        self.api = MockAPI()
        self.old = Payment("old", "大学食堂", "1380")
        self.repeat = Payment("repeat", "大学食堂", "1550")
        self.unknown = Payment("unknown", "公共缴费", "100")
        self.rows = [self.old]
        self.bridge = self.client()
        self.bridge.pair("ABC-123")
        self.bridge.scan(datetime.now(timezone.utc))

    def source(self, start, end):
        return self.rows

    def client(self, directory=None):
        return Bridge("https://example.test", directory or self.directory, self.source, self.api)

    def test_manual_import_and_confirmed_merchant_for_new_notifications(self):
        self.assertEqual(self.bridge.import_selected(["old"], {"old": CHILD}, {"old"}), (1, 0))
        self.rows = [self.old, self.repeat, self.unknown]
        worker = self.client()
        worker.state["automaticSince"] = datetime.now(timezone.utc).isoformat()
        worker.tick(datetime.now(timezone.utc) + timedelta(minutes=5))
        repeat = self.api.created[command_for(self.repeat)["entityId"]]["data"]
        self.assertEqual(repeat["amountMinor"], "1550")
        self.assertEqual(repeat["title"], "大学食堂")
        self.assertEqual(repeat["categoryId"], CATEGORY)
        self.assertEqual(repeat["subcategoryId"], CHILD)
        self.assertTrue(repeat["necessary"])
        unknown = self.api.created[command_for(self.unknown)["entityId"]]["data"]
        self.assertNotIn("categoryId", unknown)
        self.assertNotIn("necessary", unknown)
        self.assertEqual(self.api.posts, 3)

    def test_duplicate_on_a_new_device_does_not_overwrite_categorized_record(self):
        self.bridge.import_selected(["old"], {"old": CHILD})
        second = self.client(self.directory / "another")
        second.pair("DEF-456")
        second.scan(datetime.now(timezone.utc))
        self.assertEqual(second.import_selected(["old"], {}), (0, 1))
        self.assertEqual(len(self.api.created), 1)
        self.assertEqual(next(iter(self.api.created.values()))["data"]["categoryId"], CATEGORY)

    def test_repair_to_a_new_credential_does_not_adopt_prior_bookkeeping(self):
        self.bridge.import_selected(["old"], {"old": CHILD}, {"old"})
        self.bridge.state["automaticSince"] = "2026-11-01T00:00:00+00:00"
        self.bridge.save_state()
        old_state = self.bridge.state_path
        self.bridge.api = lambda *args, **kwargs: {"credential": "separate-ledger"}
        self.bridge.pair("XYZ-456")
        self.assertTrue(old_state.exists())
        self.assertEqual(self.bridge.state, {"sent": {}, "rules": {}, "automaticSince": None})
        self.assertEqual(self.bridge.visible_payments, [])
        self.assertEqual(self.client().state, self.bridge.state)

    def test_daily_sweep_finds_three_and_thirty_day_late_receipts(self):
        now = datetime(2026, 11, 30, 4, 20, tzinfo=timezone.utc)
        old = Payment("late-30", "同一食堂", "1380", "2026-10-31", "2026-10-31T04:20:00Z")
        recent = Payment("late-3", "同一食堂", "1380", "2026-11-27", "2026-11-27T04:20:00Z")
        self.bridge.source = lambda start, end: [item for item in (old, recent)
                                                if start <= datetime.fromisoformat(item.occurred_at) <= end]
        self.bridge.state.update({"automaticSince": "2026-10-01T00:00:00+00:00",
                                  "scanThrough": (now - timedelta(minutes=5)).isoformat(),
                                  "lateSweepThrough": (now - timedelta(days=1)).isoformat()})
        self.bridge.tick(now)
        self.assertEqual(set(self.bridge.state["sent"]), {"late-3", "late-30"})
        self.bridge.tick(now + timedelta(minutes=5))
        self.assertEqual(self.api.posts, 2)

    def test_conflicts_preserve_deleted_expense_and_flag_changed_amount(self):
        self.bridge.import_selected(["old"], {})
        record = self.api.created[command_for(self.old)["entityId"]]
        record["data"]["amountMinor"] = "500"
        second = self.client(self.directory / "second")
        second.pair("SECOND")
        second.scan(datetime.now(timezone.utc))
        with self.assertRaisesRegex(BridgeError, "已有账单"):
            second.import_selected(["old"], {})
        self.assertNotIn("old", second.state["sent"])
        record["deleted"] = True
        self.assertEqual(second.import_selected(["old"], {}), (0, 1))
        self.assertTrue(record["deleted"])

    def test_rule_from_ledger_is_used_before_the_next_import_and_not_replayed_after_removal(self):
        def read_rule(endpoint, path, token="", body=None):
            result = self.api(endpoint, path, token, body)
            if path.startswith("/v1/changes"):
                result["changes"].append({"entity": {
                    "id": "approved-expense", "type": "expense", "deleted": False,
                    "data": {"wechatMerchantRule": ["大学食堂", CHILD, "2026-11-16T04:30:00Z"],
                             "categoryId": CATEGORY},
                }})
            return result

        self.bridge.api = read_rule
        self.bridge.state["automaticSince"] = datetime.now(timezone.utc).isoformat()
        self.rows = [self.repeat]
        self.bridge.tick()
        entry = self.api.created[command_for(self.repeat)["entityId"]]
        self.assertEqual(entry["data"]["subcategoryId"], CHILD)
        del self.bridge.state["rules"]["大学食堂"]
        self.bridge.save_state()

        restarted = self.client()
        restarted.api = read_rule
        restarted.refresh_categories()
        self.assertNotIn("大学食堂", restarted.state["rules"])

    def test_remembered_title_is_independent_of_a_one_time_rename(self):
        self.bridge.state["rules"]["大学食堂"] = CATEGORY  # Old Mac state used a category ID string.
        self.assertEqual(self.bridge.merchant_rule("大学食堂"), {"category": CATEGORY})

        def read_rule(endpoint, path, token="", body=None):
            result = self.api(endpoint, path, token, body)
            if path.startswith("/v1/changes"):
                result["changes"].extend([
                    {"entity": {"id": "confirmed", "type": "expense", "deleted": False, "data": {
                        "wechatMerchantRule": ["大学食堂", CHILD, "2026-11-16T04:30:00Z", "日常午饭"],
                        "wechatMerchant": "大学食堂", "title": "临时加餐",
                    }}},
                    {"entity": {"id": "one-off", "type": "expense", "deleted": False, "data": {
                        "wechatMerchant": "公共缴费", "title": "这次是打印",
                    }}},
                ])
            return result

        self.bridge.api = read_rule
        self.bridge.state["automaticSince"] = datetime.now(timezone.utc).isoformat()
        self.rows = [self.repeat, self.unknown]
        self.bridge.tick()
        repeat = self.api.created[command_for(self.repeat)["entityId"]]["data"]
        self.assertEqual(repeat["title"], "日常午饭")
        self.assertEqual(repeat["wechatMerchant"], "大学食堂")
        self.assertEqual(repeat["subcategoryId"], CHILD)
        unknown = self.api.created[command_for(self.unknown)["entityId"]]["data"]
        self.assertEqual(unknown["title"], "公共缴费")
        self.assertNotIn("categoryId", unknown)

    def test_retry_does_not_advance_when_server_did_not_accept(self):
        self.bridge.state["automaticSince"] = datetime.now(timezone.utc).isoformat()
        self.api.fail_next = True
        with self.assertRaises(BridgeError):
            self.bridge.tick()
        self.assertNotIn("old", self.bridge.state["sent"])
        self.assertNotIn("scanThrough", self.bridge.state)
        self.bridge.tick()
        self.assertEqual(len(self.api.created), 1)

    def test_binds_to_https_in_production_and_escapes_page(self):
        with self.assertRaises(BridgeError):
            endpoint_url("http://evil.example")
        self.rows = [Payment("test", '<script>alert(1)</script>', "50")]
        self.bridge.scan(datetime.now(timezone.utc))
        document = render(self.bridge)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", document)
        self.assertNotIn("<script>", document)
        self.assertNotIn("test-credential", document)

    def test_embedded_forms_keep_the_finance_view(self):
        document = render(self.bridge, nonce="test-nonce")
        self.assertNotIn("打开花销", document)
        self.assertIn('data-parent-origin="https://example.test"', document)
        self.assertIn('<script nonce="test-nonce">', document)
        self.assertEqual(document.count('name="embedded" value="1"'), document.count("<form "))
        self.assertEqual(document.count('name="csrf"'), document.count("<form "))


if __name__ == "__main__":
    unittest.main()

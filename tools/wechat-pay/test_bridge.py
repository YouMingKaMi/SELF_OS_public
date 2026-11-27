from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from bridge import Bridge, BridgeError, command_for, endpoint_url, render, write_private


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
        self.generation = "00000000-0000-4000-a000-000000000010"
        self.scope_required = False

    def __call__(self, endpoint, path, token="", body=None):
        if path == "/v1/pair":
            return {"credential": "test-credential"}
        if path == "/v1/sync-state":
            return {"datasetId": CATEGORY, "generation": self.generation,
                    "scopeRequired": self.scope_required, "watermark": "3"}
        if path.startswith("/v1/changes"):
            self.last_query = path
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
        self.assertEqual(self.bridge.state, {"rules": {}, "automaticSince": None})
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
        self.assertEqual(self.bridge.sent_ids(["late-3", "late-30"]), {"late-3", "late-30"})
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
        self.assertNotIn("old", second.sent_ids(["old"]))
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

    def test_restore_pauses_auto_import_until_explicit_review(self):
        self.bridge.state["automaticSince"] = datetime.now(timezone.utc).isoformat()
        self.bridge.tick()
        self.assertEqual(self.api.posts, 1)
        self.assertIn("generation=" + self.api.generation, self.api.last_query)
        self.api.generation = "00000000-0000-4000-a000-000000000011"
        self.api.scope_required = True
        self.api.created.clear()  # The first payment did not exist in the restored backup.
        self.bridge.tick()
        self.assertEqual(self.api.posts, 1)
        self.assertIsNone(self.bridge.state["automaticSince"])
        self.assertIn("已暂停", self.bridge.note)
        with closing(sqlite3.connect(self.bridge.state_path)) as db:
            archived = [
                (ledger, json.loads(state))
                for ledger, state in db.execute("SELECT id,state FROM ledger WHERE id < ?", (self.bridge.ledger,))
            ]
            self.assertEqual(len(archived), 1)
            self.assertIsNotNone(archived[0][1]["automaticSince"])
            self.assertEqual(db.execute("SELECT source_id FROM sent WHERE ledger_id=?", (archived[0][0],)).fetchall(),
                             [("old",)])
        self.assertNotIn("old", self.bridge.sent_ids(["old"]))
        self.bridge.scan(datetime.now(timezone.utc))
        self.assertEqual(self.bridge.import_selected(["old"], {}), (1, 0))
        saved = self.api.created[command_for(self.old)["entityId"]]
        self.assertEqual(saved["scope"]["generation"], self.api.generation)

    def test_retry_does_not_advance_when_server_did_not_accept(self):
        self.bridge.state["automaticSince"] = datetime.now(timezone.utc).isoformat()
        self.api.fail_next = True
        with self.assertRaises(BridgeError):
            self.bridge.tick()
        self.assertNotIn("old", self.bridge.sent_ids(["old"]))
        self.assertNotIn("scanThrough", self.bridge.state)
        self.bridge.tick()
        self.assertEqual(len(self.api.created), 1)

    def test_sqlite_migrates_only_the_previous_connections_json_once(self):
        for scoped in (False, True):
            with self.subTest(scoped=scoped):
                directory = self.directory / ("scoped" if scoped else "unscoped")
                worker = self.client(directory)
                credentials = {"endpoint": worker.endpoint, "credential": "old-mac"}
                if scoped:
                    credentials["stateVersion"] = 1
                write_private(worker.auth_path, credentials)
                legacy = worker.connection_state_path("old-mac").with_suffix(".json") if scoped else directory / "state.json"
                write_private(legacy, {
                    "sent": {"old": self.old.occurred_at},
                    "rules": {"大学食堂": CHILD},
                    "learnedRules": {"approved": ["大学食堂", CHILD, self.old.occurred_at]},
                    "automaticSince": "2026-11-01T05:00:00+00:00",
                    "scanThrough": self.old.occurred_at,
                })
                restarted = self.client(directory)
                self.assertEqual(restarted.sent_ids(["old", "missing"]), {"old"})
                self.assertEqual(restarted.merchant_rule("大学食堂"), {"category": CHILD})
                self.assertEqual(restarted.state["scanThrough"], self.old.occurred_at)
                self.assertEqual(restarted.state_path.stat().st_mode & 0o777, 0o600)
                self.assertEqual(restarted.store.learned_rules(restarted.ledger, ["approved"]),
                                 {"approved": ["大学食堂", CHILD, self.old.occurred_at]})
                self.assertTrue(legacy.exists())
                write_private(legacy, {"sent": {"from-later-json": self.old.occurred_at}})
                self.assertEqual(self.client(directory).sent_ids(["old", "from-later-json"]), {"old"})
                other = Bridge("https://other.test", directory, self.source, self.api)
                self.assertEqual(other.sent_ids(["old"]), set())
                self.assertIsNone(other.state["automaticSince"])

    def test_restart_uses_the_same_category_snapshot_and_cursor_with_tombstones(self):
        self.bridge.refresh_categories()
        self.assertEqual(self.bridge.category_cursor, "3")
        worker = self.client()
        self.assertEqual(worker.known_categories[CHILD]["name"], "食堂")
        worker.refresh_categories()
        self.assertIn("cursor=3", self.api.last_query)

        def delete_category(endpoint, path, token="", body=None):
            if path.startswith("/v1/changes"):
                self.assertIn("cursor=3", path)
                return {"nextCursor": "4", "hasMore": False, "changes": [
                    {"entity": {"id": CHILD, "type": "category", "deleted": True, "data": {}}},
                ]}
            return self.api(endpoint, path, token, body)

        worker.api = delete_category
        worker.refresh_categories()
        restarted = self.client()
        self.assertEqual(restarted.category_cursor, "4")
        self.assertNotIn(CHILD, restarted.known_categories)

    def test_page_progress_rolls_back_with_categories_and_learned_rules_on_error(self):
        def page(endpoint, path, token="", body=None):
            result = self.api(endpoint, path, token, body)
            if path.startswith("/v1/changes"):
                result["changes"].append({"entity": {
                    "id": "approved-expense", "type": "expense", "deleted": False,
                    "data": {"wechatMerchantRule": ["大学食堂", CHILD, self.old.occurred_at]},
                }})
            return result

        self.bridge.api = page
        with self.bridge.store.transaction() as db:
            db.execute("CREATE TRIGGER interrupt_projection BEFORE INSERT ON learned "
                       "BEGIN SELECT RAISE(ABORT, 'interrupted'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.bridge.refresh_categories()

        restarted = self.client()
        self.assertEqual(restarted.category_cursor, "0")
        self.assertEqual(restarted.known_categories, {})
        self.assertEqual(restarted.state["rules"], {})
        with restarted.store.transaction() as db:
            db.execute("DROP TRIGGER interrupt_projection")
        restarted.api = page
        restarted.refresh_categories()
        self.assertEqual(restarted.category_cursor, "3")
        self.assertIn(CHILD, restarted.known_categories)
        self.assertEqual(restarted.merchant_rule("大学食堂"), {"category": CHILD})

    def test_acknowledgement_failure_after_server_acceptance_can_retry_safely(self):
        with self.bridge.store.transaction() as db:
            db.execute("CREATE TRIGGER interrupt_ack BEFORE INSERT ON sent "
                       "BEGIN SELECT RAISE(ABORT, 'interrupted'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.bridge.import_selected(["old"], {"old": CHILD}, {"old"})
        self.assertEqual(len(self.api.created), 1)
        self.assertNotIn("old", self.bridge.sent_ids(["old"]))
        self.assertEqual(self.bridge.state["rules"], {})
        with self.bridge.store.transaction() as db:
            db.execute("DROP TRIGGER interrupt_ack")
        self.assertEqual(self.bridge.import_selected(["old"], {"old": CHILD}, {"old"}), (0, 1))
        restarted = self.client()
        self.assertEqual(len(self.api.created), 1)
        self.assertEqual(restarted.sent_ids(["old"]), {"old"})
        self.assertEqual(restarted.merchant_rule("大学食堂"), {"category": CHILD})

    def test_stale_local_worker_cannot_replace_a_new_projection(self):
        behind = self.client()
        self.bridge.refresh_categories()
        behind.state["rules"]["旧工作进程"] = CATEGORY
        with self.assertRaisesRegex(BridgeError, "另一个微信记账进程"):
            behind.save_state()
        self.assertEqual(behind.category_cursor, "3")
        self.assertIn(CHILD, behind.known_categories)
        self.assertNotIn("旧工作进程", behind.state["rules"])

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

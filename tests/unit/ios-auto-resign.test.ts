import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const suite = String.raw`
import importlib.util
import os
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import patch

os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
spec = importlib.util.spec_from_file_location('resign', 'scripts/ios-auto-resign.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class RenewalTests(unittest.TestCase):
    def test_database_marker_checks_original_database_only(self):
        self.assertIsNone(m.database_marker({"files": [
            {"name": "council.sqlite-wal", "metadata": {"lastModDate": "old", "size": 10}},
            {"name": "council.sqlite", "metadata": {"lastModDate": "old", "size": 0}},
        ]}))
        self.assertEqual(m.database_marker({"files": [
            {"name": "Library/council.sqlite", "metadata": {"lastModDate": "old", "size": 4096}},
        ]}), ("old", 4096))

    def test_versions_fail_closed(self):
        current = m.version("0.3.2", "8")
        m.guard_version(m.version("0.3.2", "8"), current)
        for wrong in [("0.3.1", "5"), ("0.3.2", "7"), ("0.3.3", "7"), ("0.3.2", "9"), ("0.3.3", "10")]:
            with self.assertRaises(m.RenewalError):
                m.guard_version(m.version(*wrong), current)
        with self.assertRaises(m.RenewalError):
            m.version("0.3.2", None)
        self.assertGreater(m.version("0.3.10", "10"), current)

    def test_windows_and_error_messages(self):
        now = 1000000
        self.assertFalse(m.should_renew(now, now + m.RENEW_WINDOW + 1))
        self.assertTrue(m.should_renew(now, now + m.RENEW_WINDOW))
        self.assertTrue(m.should_renew(now, now + m.RENEW_WINDOW + 1, True))
        self.assertFalse(m.should_warn(now, now + m.WARNING_WINDOW + 1, 0))
        self.assertTrue(m.should_warn(now, now + m.WARNING_WINDOW, now - m.WARNING_INTERVAL))
        self.assertFalse(m.should_warn(now, now - 1, now - m.WARNING_INTERVAL + 1))
        self.assertIn("解锁", m.reason(b"Device is locked", "fallback"))
        self.assertIn("Xcode", m.reason(b"No Accounts", "fallback"))

    def test_lock_and_launch_agent_rendering(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with m.lock(root):
                with self.assertRaises(m.RenewalError):
                    with m.lock(root):
                        self.fail("two workers acquired the lock")
            with m.lock(root):
                data = plistlib.loads(m.launch_plist("/usr/bin/python3", "/space here/tool.py", root))
                self.assertEqual(data["StartInterval"], 10800)
                self.assertTrue(data["RunAtLoad"])
                self.assertEqual(data["ProgramArguments"], ["/usr/bin/python3", "/space here/tool.py", "--home", str(root), "poll"])
                shortcut = m.launcher("/usr/bin/python3", "/space here/tool.py", root).decode()
                self.assertIn("'/space here/tool.py'", shortcut)
                self.assertIn(" force", shortcut)
                self.assertEqual(sorted(p.name for p in root.iterdir()), ["operation.lock"])

    def test_poll_never_probes_early_and_throttles_unavailable_phone(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            notices = []
            calls = []
            def mocked_devices(*args):
                calls.append(args)
                return {"devices": []}
            def no_build(*args):
                self.fail("cannot build or install without a device")
            with patch.object(m.time, "time", return_value=1000000):
                config = {"expires": 1000000 + m.RENEW_WINDOW + 1, "device": "fixture"}
                m.cycle(root, config, {}, False, devices=mocked_devices, renew=no_build, notification=notices.append)
                self.assertEqual(calls, [])
                config["expires"] = 1000000 + m.WARNING_WINDOW
                for _ in range(2):
                    m.cycle(root, config, {}, False, devices=mocked_devices, renew=no_build, notification=notices.append)
                self.assertEqual(len(calls), 2)
                self.assertEqual(len(notices), 1)
                self.assertIn("iPhone", notices[0])
                with self.assertRaises(m.RenewalError):
                    m.cycle(root, config, {}, True, devices=mocked_devices, renew=no_build, notification=notices.append)
                self.assertEqual(len(notices), 1)

    def test_pin_blocks_tampered_content_and_wrong_device(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            baseline = root / "baseline"
            baseline.mkdir()
            binary = baseline / "example"
            binary.write_bytes(b"original")
            config = {"pin": m.digest_tree(baseline)}
            binary.write_bytes(b"mutated")
            with self.assertRaises(m.RenewalError):
                m.refresh(root, config, {}, {}, 0)
        item = {"identifier": "fixture", "hardwareProperties": {"platform": "iOS", "deviceType": "iPhone"},
                "connectionProperties": {"pairingState": "paired", "transportType": "localNetwork"}}
        self.assertEqual(m.pick_device([item], "fixture"), item)
        with self.assertRaises(m.RenewalError):
            m.pick_device([item], "other")
        with self.assertRaises(m.RenewalError):
            m.pick_device([item, item])

if __name__ == "__main__":
    unittest.main()
`;

test("iPhone renewal policies, pin, launch entry and lock use isolated fixtures", () => {
  const result = spawnSync("python3", ["-B", "-c", suite], {
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  assert.match(result.stderr, /Ran 6 tests/);
});

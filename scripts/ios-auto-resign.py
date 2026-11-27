#!/usr/bin/python3
"""Renew signatures for a pinned SELF OS release artifact on one paired iPhone."""
import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time

APP_ID = "org.personalcouncil.next.studio"
LABEL = APP_ID + ".resign"
WIDGET = Path("PlugIns/CouncilWidgets.appex")
TARGETS = [(Path("."), APP_ID, "CouncilStudio", "app"), (WIDGET, APP_ID + ".widgets", "CouncilWidgets", "appex")]
RENEW_WINDOW = 36 * 3600
WARNING_WINDOW = 24 * 3600
WARNING_INTERVAL = 12 * 3600
XCODE = "/Applications/Xcode.app/Contents/Developer"
DEFAULT_HOME = Path.home() / "Library/Application Support/SELF OS iPhone Resign"


class RenewalError(Exception):
    pass


def version(marketing, build):
    def parts(value):
        if not isinstance(value, str) or not re.fullmatch(r"[0-9]{1,9}(\.[0-9]{1,9}){0,2}", value):
            raise RenewalError("无法可靠读取应用版本，已停止安装。")
        values = tuple(map(int, value.split(".")))
        return values + (0,) * (3 - len(values))
    return parts(marketing), parts(build)


def guard_version(candidate, installed):
    if any(a < b for a, b in zip(candidate, installed)):
        raise RenewalError("待安装版本或构建号低于手机，已阻止降级。")
    if candidate != installed:
        raise RenewalError("手机版本与续签基线不一致，已停止安装。")


def should_renew(now, expires, force=False):
    return force or expires - now <= RENEW_WINDOW


def should_warn(now, expires, last):
    return expires - now <= WARNING_WINDOW and now - last >= WARNING_INTERVAL


def reason(output, fallback):
    message = output.decode(errors="replace").lower()
    if any(term in message for term in ("locked", "passcode", "first unlock")):
        return "请解锁 iPhone 后重试。"
    if any(term in message for term in ("no accounts", "invalid session", "authentication", "sign in", "session has expired", "unable to log in", "account details", "development certificate")):
        return "请在 Xcode 的 Accounts 中检查原 Apple 账号及开发证书。"
    return fallback


@contextlib.contextmanager
def lock(root):
    with (root / "operation.lock").open("a") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RenewalError("另一次续签或配置操作正在进行。") from None
        yield


def atomic_write(path, data, mode=0o600):
    fd, name = tempfile.mkstemp(dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(mode)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def save_state(root, state):
    atomic_write(root / "state.json", json.dumps(state).encode())


def digest_tree(root):
    digest = hashlib.sha256()
    for item in sorted(root.rglob("*")):
        digest.update(os.fsencode(str(item.relative_to(root))) + b"\0")
        if item.is_symlink():
            raise RenewalError("基线包含符号链接，已停止。")
        if item.is_file():
            digest.update(b"file\0")
            with item.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
        elif item.is_dir():
            digest.update(b"dir\0")
        else:
            raise RenewalError("基线包含不支持的文件类型。")
        digest.update(b"\0")
    return digest.hexdigest()


def run(args, *, env=None, timeout=60, fallback="本机命令执行失败。"):
    with subprocess.Popen(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          start_new_session=True) as process:
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
            raise RenewalError("设备或签名操作超时，将在下次轮询重试。") from None
    if process.returncode:
        raise RenewalError(reason(stdout + stderr, fallback))
    return stdout


def device_json(env, *args):
    seconds = 120 if args[:2] == ("device", "install") else 25
    data = run(["/usr/bin/xcrun", "devicectl", "--timeout", str(seconds), "--json-output", "-", *args],
               env=env, timeout=seconds + 10, fallback="iPhone 操作失败，请检查热点、无线配对和解锁状态。")
    return json.loads(data)["result"]


def pick_device(devices, selected=None):
    matches = [item for item in devices
               if item.get("hardwareProperties", {}).get("platform") == "iOS"
               and item["hardwareProperties"].get("deviceType") == "iPhone"
               and item.get("connectionProperties", {}).get("pairingState") == "paired"
               and item["connectionProperties"].get("transportType") in ("localNetwork", "wired")
               and (not selected or item.get("identifier") == selected)]
    if len(matches) != 1:
        raise RenewalError("找不到唯一的目标 iPhone，请连接并解锁原配对手机。")
    return matches[0]


def installed_info(env, identifier):
    apps = device_json(env, "device", "info", "apps", "--device", identifier, "--bundle-id", APP_ID,
                       "--include-container-paths")["apps"]
    matching = [a for a in apps if a.get("bundleIdentifier") == APP_ID]
    if len(matching) != 1:
        raise RenewalError("无法确认手机已安装 SELF OS，已停止覆盖安装。")
    return matching[0]


def installed_version(app):
    return version(app.get("version"), app.get("bundleVersion"))


def database_marker(result):
    def objects(value):
        if isinstance(value, dict):
            yield value
            for child in value.values():
                yield from objects(child)
        elif isinstance(value, list):
            for child in value:
                yield from objects(child)

    for entry in objects(result):
        if not any(isinstance(value, str) and value.rsplit("/", 1)[-1] == "council.sqlite"
                   for value in entry.values()):
            continue
        for metadata in objects(entry):
            modified, size = metadata.get("lastModDate"), metadata.get("size")
            if isinstance(modified, str) and isinstance(size, int) and size > 0:
                return modified, size
    return None


def installed_database_marker(env, identifier):
    try:
        return database_marker(device_json(env, "device", "info", "files", "--device", identifier,
            "--domain-type", "appDataContainer", "--domain-identifier", APP_ID, "--search", "council.sqlite"))
    except RenewalError:
        return None


def load_plist(path):
    with path.open("rb") as stream:
        return plistlib.load(stream)


def profile(bundle):
    data = run(["/usr/bin/openssl", "smime", "-verify", "-inform", "DER", "-noverify",
                "-in", bundle / "embedded.mobileprovision"], fallback="无法读取签名描述文件。")
    return plistlib.loads(data)


def expiry(profiles):
    return min(p["ExpirationDate"].replace(tzinfo=dt.timezone.utc).timestamp() for p in profiles)


def artifact_version(app):
    values = []
    for subpath, identifier, _, _ in TARGETS:
        info = load_plist(app / subpath / "Info.plist")
        if info.get("CFBundleIdentifier") != identifier:
            raise RenewalError("App 与小组件标识不符合续签基线。")
        values.append((info["CFBundleShortVersionString"], info["CFBundleVersion"]))
    if values[0] != values[1]:
        raise RenewalError("App 与小组件版本不一致。")
    return values[0]


def check_profile(provision, entitlements, udid):
    import fnmatch
    team = entitlements["com.apple.developer.team-identifier"]
    allowed = provision["Entitlements"]
    if (team not in provision.get("TeamIdentifier", [])
            or udid not in provision.get("ProvisionedDevices", [])
            or allowed.get("get-task-allow") is not True
            or not fnmatch.fnmatchcase(entitlements["application-identifier"], allowed.get("application-identifier", ""))):
        raise RenewalError("描述文件不匹配原签名团队、设备或应用标识。")


def signing_identity(profiles):
    pins = [{hashlib.sha1(cert).hexdigest().upper() for cert in p["DeveloperCertificates"]}
            for p in profiles]
    identities = run(["/usr/bin/security", "find-identity", "-v", "-p", "codesigning"],
                     fallback="无法读取 Xcode 的签名证书。")
    owned = set(re.findall(rb'^\s*\d+\) ([0-9A-F]{40}) ', identities, re.MULTILINE))
    candidates = set.intersection(*pins, {cert.decode("ascii") for cert in owned})
    if len(candidates) != 1:
        raise RenewalError("未找到唯一同时适用 App 和小组件的有效本机开发证书。")
    return candidates.pop()


def launch_plist(python, script, root, interval=10800):
    return plistlib.dumps({
        "Label": LABEL, "ProgramArguments": [str(python), str(script), "--home", str(root), "poll"],
        "RunAtLoad": True, "StartInterval": interval, "ProcessType": "Background",
        "StandardOutPath": str(root / "renew.log"), "StandardErrorPath": str(root / "renew.log"),
    })


def launcher(python, script, root):
    command = shlex.join([str(python), str(script), "--home", str(root), "force"])
    return ("#!/bin/sh\n# " + LABEL + "\n" + command +
            '\nstatus=$?\nprintf "\\n按回车关闭窗口…"\nread -r line\nexit "$status"\n').encode()


def bootstrap(root, args, env):
    if (root / "config.json").exists():
        raise RenewalError("已有固定续签基线，请使用现有配置。")
    artifact = args.artifact.resolve()
    release_version = artifact_version(artifact)
    device = pick_device(device_json(env, "list", "devices")["devices"], args.device)
    installed = installed_info(env, device["identifier"])
    guard_version(version(*release_version), installed_version(installed))
    ent_dir = args.entitlements.resolve()
    profiles = []
    with tempfile.TemporaryDirectory(dir=root) as location:
        staged = Path(location) / "baseline"
        staged.mkdir()
        shutil.copytree(artifact, staged / "CouncilStudio.app", symlinks=True)
        for subpath, _, target, extension in TARGETS:
            filename = target + "." + extension + ".xcent"
            raw = ent_dir / (target + ".build") / filename
            ent = load_plist(raw)
            original = profile(artifact / subpath)
            check_profile(original, ent, device["hardwareProperties"]["udid"])
            shutil.copyfile(raw, staged / filename)
            profiles.append(original)
        pin = digest_tree(staged)
        staged.rename(root / "baseline")
    config = {"version": release_version, "pin": pin, "project": str(args.project.resolve()),
              "device": device["identifier"], "expires": expiry(profiles), "xcode": env["DEVELOPER_DIR"]}
    atomic_write(root / "config.json", json.dumps(config).encode())
    print("续签基线已固定为 " + " (".join(release_version) + ")。", flush=True)


def refresh(root, config, env, device, old_expiry):
    baseline = root / "baseline"
    if digest_tree(baseline) != config["pin"]:
        raise RenewalError("固定构建产物校验失败，已停止安装。")
    original = baseline / "CouncilStudio.app"
    marketing, build = artifact_version(original)
    candidate = version(marketing, build)
    if [marketing, build] != config["version"]:
        raise RenewalError("固定构建版本不匹配。")
    identifier, udid = device["identifier"], device["hardwareProperties"]["udid"]
    guard_version(candidate, installed_version(installed_info(env, identifier)))
    first_ent = load_plist(baseline / "CouncilStudio.app.xcent")
    team = first_ent["com.apple.developer.team-identifier"]
    with tempfile.TemporaryDirectory(prefix="sign-", dir=root) as location:
        temp = Path(location)
        derived = temp / "derived"
        print("正在请求 Xcode 刷新 App 与小组件签名描述文件…", flush=True)
        run(["/usr/bin/xcodebuild", "-project", config["project"], "-scheme", "CouncilStudio",
             "-configuration", "Debug", "-destination", "id=" + udid,
             "-derivedDataPath", str(derived), "-clonedSourcePackagesDirPath", str(root / "Packages"),
             "-allowProvisioningUpdates", "DEVELOPMENT_TEAM=" + team,
             "MARKETING_VERSION=" + marketing, "CURRENT_PROJECT_VERSION=" + build, "build"],
            env=env, timeout=900, fallback="Xcode 无法刷新描述文件，请检查账号登录、网络和设备签名。")
        signed = derived / "Build/Products/Debug-iphoneos/CouncilStudio.app"
        artifact_version(signed)
        profiles = [profile(signed / target[0]) for target in TARGETS]
        new_expiry = expiry(profiles)
        if new_expiry <= old_expiry or new_expiry - time.time() <= RENEW_WINDOW:
            raise RenewalError("Xcode 尚未签发有效期更长的描述文件，本次未覆盖安装。")
        # Use an identity authorized by both new profiles; ship only the pinned executable/resources.
        cert = signing_identity(profiles)
        output = temp / "CouncilStudio.app"
        shutil.copytree(original, output)
        for (subpath, _, target, extension), provision in reversed(list(zip(TARGETS, profiles))):
            ent_file = baseline / (target + "." + extension + ".xcent")
            check_profile(provision, load_plist(ent_file), udid)
            shutil.copyfile(signed / subpath / "embedded.mobileprovision", output / subpath / "embedded.mobileprovision")
            run(["/usr/bin/codesign", "--force", "--sign", cert, "--entitlements", ent_file,
                 "--generate-entitlement-der", output / subpath], timeout=120,
                fallback="无法使用 Xcode 当前开发证书签署固定版本。")
        run(["/usr/bin/codesign", "--verify", "--deep", "--strict", output],
            fallback="本机验签失败，已停止安装。")
        old_database = installed_database_marker(env, identifier)
        before = installed_info(env, identifier)
        guard_version(version(*artifact_version(output)), installed_version(before))
        print("正在向已配对的 iPhone 安装同版本续签包…", flush=True)
        device_json(env, "device", "install", "app", "--device", identifier, str(output))
        after = installed_info(env, identifier)
        guard_version(candidate, installed_version(after))
        before_container = before.get("dataContainerPath")
        after_container = after.get("dataContainerPath")
        if before_container and after_container:
            if before_container != after_container:
                if old_database is None or old_database != installed_database_marker(env, identifier):
                    raise RenewalError("安装完成，但未能确认原本地数据库已迁移，请检查手机资料。")
                print("已核对原本地数据库随容器迁移。", flush=True)
            else:
                print("已核对安装前后的数据容器一致。", flush=True)
        return new_expiry


def notify(message):
    with contextlib.suppress(RenewalError):
        run(["/usr/bin/osascript", "-e",
             'on run argv\ndisplay notification (item 1 of argv) with title "SELF OS iPhone"\nend run', message],
            timeout=10)


def cycle(root, config, env, force, *, devices=device_json, renew=refresh, notification=notify):
    statefile = root / "state.json"
    state = json.loads(statefile.read_text()) if statefile.exists() else {}
    now = time.time()
    expires = state.get("expires", config["expires"])
    if not should_renew(now, expires, force):
        return
    try:
        device = pick_device(devices(env, "list", "devices")["devices"], config["device"])
        new_expiry = renew(root, config, env, device, expires)
    except RenewalError as error:
        if should_warn(now, expires, state.get("lastWarning", 0)):
            state["lastWarning"] = now
            save_state(root, state)
            notification(str(error))
        if force:
            raise
        print(time.strftime("%F %T"), error, flush=True)
    else:
        save_state(root, {"expires": new_expiry})
        through = dt.datetime.fromtimestamp(new_expiry).strftime("%m-%d %H:%M")
        message = "续签安装成功，有效至 " + through + "。"
        print(message, flush=True)
        notification(message)


def configure_agent(root, args):
    home = Path.home()
    agent = home / "Library/LaunchAgents" / (LABEL + ".plist")
    shortcut = args.shortcut.expanduser().absolute() if args.shortcut else home / "Desktop/SELF OS iPhone 续签.command"
    gui = "gui/" + str(os.getuid())
    service = gui + "/" + LABEL
    python = Path("/usr/bin/python3")
    managed = root / "ios-auto-resign.py"
    if args.action == "enable":
        if not (root / "config.json").is_file():
            raise RenewalError("请先固定续签基线。")
        expected_agent = launch_plist(python, managed, root)
        expected_shortcut = launcher(python, managed, root)
        for path, expected in [(agent, expected_agent), (shortcut, expected_shortcut)]:
            if path.is_symlink() or (path.exists() and (not path.is_file() or path.read_bytes() != expected)):
                raise RenewalError("已有同名文件，已停止覆盖。")
        atomic_write(managed, Path(__file__).read_bytes())
        agent.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(agent, expected_agent)
        atomic_write(shortcut, expected_shortcut, 0o700)
        shown = subprocess.run(["/bin/launchctl", "print", service], capture_output=True)
        if shown.returncode:
            run(["/bin/launchctl", "bootstrap", gui, str(agent)], fallback="无法加载定时任务，请确认 Mac 当前用户已登录。")
        run(["/bin/launchctl", "print", service], fallback="未能确认定时任务已加载。")
        print("后台每 3 小时检查一次，桌面入口已就绪。")
    else:
        shown = subprocess.run(["/bin/launchctl", "print", service], capture_output=True)
        if not shown.returncode:
            run(["/bin/launchctl", "bootout", service], fallback="定时任务卸载失败。")
        for path, expected in [(agent, launch_plist(python, managed, root)), (shortcut, launcher(python, managed, root))]:
            if not path.is_symlink() and path.is_file() and path.read_bytes() == expected:
                path.unlink()
        print("已停用定时任务和双击入口。")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=DEFAULT_HOME)
    sub = parser.add_subparsers(dest="action", required=True)
    setup = sub.add_parser("pin")
    setup.add_argument("--artifact", type=Path, required=True)
    setup.add_argument("--entitlements", type=Path, required=True)
    setup.add_argument("--project", type=Path, required=True)
    setup.add_argument("--device")
    for name in ("enable", "disable"):
        sub.add_parser(name).add_argument("--shortcut", type=Path)
    for name in ("poll", "force"):
        sub.add_parser(name)
    args = parser.parse_args()
    os.umask(0o077)
    root = args.home.expanduser().resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        with lock(root):
            if args.action in ("enable", "disable"):
                configure_agent(root, args)
                return 0
            env = os.environ.copy()
            env["DEVELOPER_DIR"] = env.get("DEVELOPER_DIR") or XCODE
            if args.action == "pin":
                bootstrap(root, args, env)
            else:
                config = json.loads((root / "config.json").read_text())
                env["DEVELOPER_DIR"] = config["xcode"]
                cycle(root, config, env, args.action == "force")
    except RenewalError as error:
        print(error, file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError, plistlib.InvalidFileException):
        print("续签配置、签名资料或设备结果无法验证。", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

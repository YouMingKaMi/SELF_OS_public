"""Install the user's local WeChat Pay bridge as a login LaunchAgent."""
import argparse
import os
from pathlib import Path
import plistlib
import subprocess
import sys

LABEL = "org.personalcouncil.wechat-pay"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--wechat-project", type=Path, required=True)
    args = parser.parse_args()
    bridge = Path(__file__).resolve().with_name("bridge.py")
    agent = Path.home() / "Library/LaunchAgents" / (LABEL + ".plist")
    agent.parent.mkdir(parents=True, exist_ok=True)
    target = f"gui/{os.getuid()}"
    launchctl = "/bin/launchctl"
    subprocess.run([launchctl, "bootout", f"{target}/{LABEL}"], capture_output=True)
    config = {
        "Label": LABEL,
        "ProgramArguments": [
            str(Path(sys.executable).resolve()), str(bridge),
            "--endpoint", args.endpoint, "--wechat-project", str(args.wechat_project.resolve()),
        ],
        "EnvironmentVariables": {"PYTHONDONTWRITEBYTECODE": "1"},
        "ProcessType": "Background",
        "RunAtLoad": True,
        "KeepAlive": {"SuccessfulExit": False},
        "StandardOutPath": "/dev/null",
        "StandardErrorPath": "/dev/null",
    }
    if wechat_state := os.environ.get("WECHAT_CLI_STATE"):
        config["EnvironmentVariables"]["WECHAT_CLI_STATE"] = str(Path(wechat_state).expanduser().resolve())
    agent.write_bytes(plistlib.dumps(config))
    subprocess.run([launchctl, "bootstrap", target, str(agent)], check=True)
    print("微信支付记账入口：http://127.0.0.1:18766/")


if __name__ == "__main__":
    main()

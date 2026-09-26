"""Watch successful GitHub builds and deploy them to this PC's Docker Desktop."""

import io
import json
import msvcrt
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile


REPOSITORY = "mintechstrategy/kimgosu"
DEPLOY_ROOT = Path(r"G:\docker\kimgosu")
STATE_FILE = DEPLOY_ROOT / "deployment-state.json"
LOG_FILE = DEPLOY_ROOT / "deployment-agent.log"
POLL_SECONDS = 30
FILES = {"docker-compose.yml", "deploy/nginx.conf", "deploy/deploy.ps1", "DOCKER.md"}
_credential_cache = None


def log(message):
    with LOG_FILE.open("a", encoding="utf-8") as stream:
        stream.write(time.strftime("%Y-%m-%d %H:%M:%S ") + message + "\n")


def credential():
    global _credential_cache
    if _credential_cache is not None:
        return _credential_cache
    result = subprocess.run(
        ["git", "credential-manager", "get"],
        input="protocol=https\nhost=github.com\npath=mintechstrategy/kimgosu.git\nusername=mintechstrategy\n\n",
        text=True,
        capture_output=True,
        check=True,
        timeout=15,
    )
    values = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    _credential_cache = ("mintechstrategy", values["password"])
    return _credential_cache


def request(url, token):
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "kimgosu-deployment-agent",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read()


def latest_run(token):
    url = f"https://api.github.com/repos/{REPOSITORY}/actions/workflows/ci.yml/runs?branch=main&per_page=1"
    runs = json.loads(request(url, token))["workflow_runs"]
    return runs[0] if runs else None


def stage_source(sha, token):
    archive = request(f"https://api.github.com/repos/{REPOSITORY}/zipball/{sha}", token)
    target = DEPLOY_ROOT / "staging" / sha
    target.mkdir(parents=True, exist_ok=True)
    found = set()
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        for member in bundle.infolist():
            parts = member.filename.split("/", 1)
            if len(parts) != 2 or parts[1] not in FILES or member.is_dir():
                continue
            relative = parts[1]
            output = target / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(bundle.read(member))
            found.add(relative)
    if found != FILES:
        raise RuntimeError(f"Deployment files missing: {sorted(FILES - found)}")
    return target


def deploy(run, username, token):
    sha = run["head_sha"]
    if len(sha) != 40 or any(c not in "0123456789abcdef" for c in sha):
        raise RuntimeError("Invalid commit SHA from GitHub")
    stage = stage_source(sha, token)
    environment = os.environ.copy()
    environment.update(
        BACKEND_IMAGE=f"ghcr.io/mintechstrategy/kimgosu-backend:{sha}",
        GHCR_USERNAME=username,
        GHCR_TOKEN=token,
    )
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(stage / "deploy/deploy.ps1")],
        cwd=stage,
        env=environment,
        capture_output=True,
        timeout=1800,
    )
    output = (result.stdout + b"\n" + result.stderr).decode("utf-8", "replace")
    for line in output.splitlines():
        if token not in line and line.strip():
            log(line[:500])
    if result.returncode:
        raise RuntimeError(f"Deployment script failed with exit code {result.returncode}")
    STATE_FILE.write_text(json.dumps({"run_id": run["id"], "sha": sha}), encoding="utf-8")
    log(f"Deployment completed: {sha}")


def check_once():
    global _credential_cache
    username, token = credential()
    try:
        run = latest_run(token)
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            _credential_cache = None
        raise
    if not run or run["status"] != "completed" or run["conclusion"] != "success":
        return
    state = json.loads(STATE_FILE.read_text(encoding="utf-8")) if STATE_FILE.exists() else {}
    if state.get("run_id") == run["id"]:
        return
    deploy(run, username, token)


def main():
    lock_file = (DEPLOY_ROOT / "deployment-agent.lock").open("a+b")
    lock_file.seek(0)
    if not lock_file.read(1):
        lock_file.write(b"1")
        lock_file.flush()
    lock_file.seek(0)
    try:
        msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        return
    once = "--once" in sys.argv
    while True:
        try:
            check_once()
        except Exception as exc:
            log(f"ERROR {type(exc).__name__}: {exc}")
            if once:
                raise
        if once:
            return
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()

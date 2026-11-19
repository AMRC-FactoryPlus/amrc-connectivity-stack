#!/usr/bin/env python3
# ACS Cell Gateway depot
# The part of the Gateway Depot that runs on the gateway.
# Copyright 2026 University of Sheffield AMRC
#
# It has three jobs, chosen by the first argument:
#
#   scout   Runs inside the Ubuntu installer, before anything is written
#           to disk. Tells the Gateway Depot service what hardware this
#           machine has, then waits. When someone approves the machine on
#           the service's page, it writes the installer settings they
#           chose and exits, and the installer carries on with them.
#   report  Runs at the end of the install to say it finished.
#   agent   Runs on the installed gateway. Checks in with the service and
#           runs the jobs it hands over: onboarding, and making a join
#           token so another gateway can join this one's cluster.
#
# Standard library only, because it has to run in the installer.

import json
import os
import secrets
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid

STICK_CONF = "/cdrom/fplus-gw/depot.json"
STICK_CA = "/cdrom/fplus-gw/ca.pem"
LIVE_CONF = "/run/fplus-gw/depot.json"
ETC = "/etc/fplus-gw"
STATE = "/var/lib/fplus-gw"
ROOT = "/opt/fplus-gw"
LOG = "/var/log/fplus-gw.log"


def say(msg):
    print(f"fplus-gw: {msg}", flush=True)


def read(path, default=""):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return default


def run(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=20).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


class Service:
    """The Gateway Depot service, as this gateway sees it."""

    def __init__(self, conf, ca=None):
        self.url = conf["url"].rstrip("/")
        self.id = conf["id"]
        self.secret = conf["secret"]
        self.ctx = ssl.create_default_context(cafile=ca) if ca and os.path.exists(ca) else None

    def post(self, path, body, auth=False):
        # The secret goes in the body. The service's HTTP layer would
        # take an Authorization header for a Factory+ credential.
        if auth:
            body = {**body, "secret": self.secret}
        req = urllib.request.Request(
            self.url + path, data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=20, context=self.ctx) as res:
            return json.load(res)


# ---- inventory ----

def nics():
    out = []
    for name in sorted(os.listdir("/sys/class/net")):
        base = f"/sys/class/net/{name}"
        if not os.path.exists(f"{base}/device") or os.path.isdir(f"{base}/wireless"):
            continue
        if read(f"{base}/type") != "1":
            continue
        addr = run(["ip", "-o", "-4", "addr", "show", "dev", name, "scope", "global"]).split()
        out.append({
            "name": name,
            "mac": read(f"{base}/address").lower(),
            "link": read(f"{base}/carrier") == "1",
            "speed": read(f"{base}/speed"),
            "driver": os.path.basename(os.path.realpath(f"{base}/device/driver")),
            "ipv4": addr[3] if len(addr) > 3 else "",
        })
    return out


def disks():
    try:
        data = json.loads(run(["lsblk", "-J", "-d", "-b", "-o", "NAME,SIZE,MODEL,SERIAL,TYPE,TRAN,RM"]))
    except ValueError:
        return []
    out = []
    for d in data.get("blockdevices", []):
        # Not the USB stick we booted from, and not CD drives or loop devices.
        if d.get("type") != "disk" or d.get("rm") in (True, "1", 1) or d.get("tran") == "usb":
            continue
        out.append({
            "path": f"/dev/{d['name']}",
            "size": int(d.get("size") or 0),
            "model": (d.get("model") or "").strip(),
            "serial": (d.get("serial") or "").strip(),
            "transport": d.get("tran") or "",
        })
    return out


def inventory():
    dmi = "/sys/class/dmi/id"
    arch = {"x86_64": "amd64", "aarch64": "arm64"}.get(os.uname().machine, os.uname().machine)
    mem = 0
    for line in read("/proc/meminfo").splitlines():
        if line.startswith("MemTotal:"):
            mem = int(line.split()[1]) * 1024
    return {
        "serial": read(f"{dmi}/product_serial"),
        "vendor": read(f"{dmi}/sys_vendor"),
        "model": read(f"{dmi}/product_name"),
        "arch": arch,
        "memory": mem,
        "cpus": os.cpu_count(),
        "nics": nics(),
        "disks": disks(),
    }


# ---- scout ----

def scout():
    stick = json.loads(read(STICK_CONF))
    conf = {"url": stick["url"], "id": str(uuid.uuid4()), "secret": secrets.token_urlsafe(48)}
    # The installed system needs these to keep talking to the service. A
    # late-command copies this file onto the disk.
    os.makedirs(os.path.dirname(LIVE_CONF), exist_ok=True)
    with open(os.open(LIVE_CONF, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        json.dump(conf, f)

    svc = Service(conf, STICK_CA)
    say(f"Scout started. Dialling {svc.url}")
    told = False
    while True:
        try:
            answer = svc.post("/v1/box/scout",
                              {"id": conf["id"], "secret": conf["secret"], "inventory": inventory()})
        except (OSError, ValueError) as err:
            say(f"Cannot reach the Gateway Depot yet ({err}). Trying again.")
            time.sleep(5)
            continue
        if answer.get("state") == "approved":
            with open("/autoinstall.yaml", "w") as f:
                json.dump(answer["autoinstall"], f)
            say("Approved. Installing now.")
            return 0
        if not told:
            say("Waiting for someone to approve this gateway in the Gateway Depot.")
            told = True
        time.sleep(3)


def report(phase):
    conf = json.loads(read(LIVE_CONF))
    Service(conf, STICK_CA).post(f"/v1/box/{conf['id']}/checkin", {"phase": phase}, auth=True)
    return 0


# ---- agent ----

def gateway_report():
    ports = dict(line.split("=", 1) for line in read(f"{STATE}/ports").splitlines() if "=" in line)
    k3s = run(["/usr/local/bin/k3s", "--version"]).split()
    return {
        "hostname": os.uname().nodename,
        "nics": nics(),
        "north": ports.get("ENN", ""),
        "south": ports.get("ENS", ""),
        "k3s": k3s[2] if len(k3s) > 2 else "",
    }


def set_conf(values):
    """Change settings in gateway.conf, keeping the others."""
    path = f"{ETC}/gateway.conf"
    lines = [l for l in read(path).splitlines()
             if l.split("=", 1)[0] not in values]
    for key, value in values.items():
        quoted = "'" + str(value).replace("'", "'\\''") + "'"
        lines.append(f"{key}={quoted}")
    with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        f.write("\n".join(lines) + "\n")


def run_quiet(cmd):
    """Run a command that writes its own output to the gateway log."""
    return subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode


def run_bootstrap(url, token, ctx):
    """Run the Factory+ bootstrap script with an enrolment token.

    The script is the one the Cluster Manager gives to a person. With a
    token it asks no questions.
    """
    script = "/run/fplus-gw/bootstrap.sh"
    os.makedirs(os.path.dirname(script), exist_ok=True)
    with urllib.request.urlopen(url, timeout=60, context=ctx) as res:
        body = res.read()
    with open(os.open(script, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o700), "wb") as f:
        f.write(body)

    env = {**os.environ,
           "ACS_ENROL_TOKEN": token,
           "KUBECONFIG": "/etc/rancher/k3s/k3s.yaml",
           "PATH": "/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}
    try:
        with open(LOG, "ab") as log:
            return subprocess.run(["/bin/sh", script], env=env, stdin=subprocess.DEVNULL,
                                  stdout=log, stderr=subprocess.STDOUT,
                                  timeout=30 * 60).returncode
    except subprocess.TimeoutExpired:
        with open(LOG, "a") as log:
            log.write("\nfplus-gw: bootstrap timed out after 30 minutes\n")
        return 1
    finally:
        os.unlink(script)


def onboard(job, svc):
    if job["mode"] == "join":
        set_conf({"K3S_DEFER": "no", "K3S_MODE": "join",
                  "K3S_URL": job["k3s_url"], "K3S_TOKEN": job["k3s_token"]})
    else:
        set_conf({"K3S_DEFER": "no", "K3S_MODE": "create"})

    if run_quiet(["/bin/bash", f"{ROOT}/sh/configure.sh"]) != 0:
        return "Setting up K3s failed. See the log."
    if job["mode"] == "join":
        return None

    code = run_bootstrap(job["bootstrap_url"], job["token"], svc.ctx)
    if code != 0:
        return "The Factory+ bootstrap failed. See the log."
    return None


def join_token():
    """Make a short-lived token that lets one more gateway join this
    cluster, and open the firewall for cluster traffic."""
    set_conf({"MULTI_NODE": "yes"})
    if run_quiet(["/bin/bash", f"{ROOT}/sh/configure.sh"]) != 0:
        raise RuntimeError("Could not open the firewall for another gateway. See the log.")
    out = subprocess.run(
        ["/usr/local/bin/k3s", "token", "create", "--ttl", "1h",
         "--description", "Gateway Depot join"],
        capture_output=True, text=True, timeout=60)
    token = out.stdout.strip().splitlines()[-1] if out.stdout.strip() else ""
    if out.returncode != 0 or not token:
        raise RuntimeError(f"K3s did not make a join token: {out.stderr.strip()[:200]}")
    return {"token": token}


class Job(threading.Thread):
    """A job from the service, run beside the check-in loop so the
    gateway keeps reporting, and sending its log, while the job runs."""

    def __init__(self, job, svc):
        super().__init__(daemon=True)
        self.job = job
        self.svc = svc
        self.result = None

    def run(self):
        done = {"id": self.job.get("id")}
        try:
            if self.job["type"] == "onboard":
                error = onboard(self.job, self.svc)
                if error is None:
                    open(f"{STATE}/onboarded", "w").close()
            elif self.job["type"] == "join-token":
                done["result"] = join_token()
                error = None
            else:
                error = f"This gateway does not know the job type {self.job['type']}."
        except Exception as err:  # pylint: disable=broad-except
            error = f"The gateway agent stopped with an error: {err}"
        if error is not None:
            with open(LOG, "a") as log:
                log.write(f"\nfplus-gw: job failed: {error}\n")
            done["error"] = error
        done["ok"] = error is None
        self.result = done


def agent():
    conf = json.loads(read(f"{ETC}/depot.json"))
    svc = Service(conf, f"{ETC}/ca.pem")
    os.makedirs(STATE, exist_ok=True)
    # Where in the gateway log we have sent up to, kept across restarts.
    log_pos = int(read(f"{STATE}/agent-log-pos", "0") or 0)
    job = None

    while True:
        if os.path.exists(f"{STATE}/onboarded"):
            phase = "onboarded"
        elif os.path.exists(f"{STATE}/configured"):
            phase = "ready"
        else:
            phase = "configuring"

        new_log = b""
        if os.path.exists(LOG):
            with open(LOG, "rb") as f:
                f.seek(log_pos)
                new_log = f.read(8000)

        done = job.result if job and not job.is_alive() else None
        body = {"phase": phase, "report": gateway_report(),
                "log": new_log.decode(errors="replace"),
                "busy": bool(job and job.is_alive())}
        if done is not None:
            body["job_done"] = done
        try:
            answer = svc.post(f"/v1/box/{conf['id']}/checkin", body, auth=True)
        except (OSError, ValueError) as err:
            say(f"Cannot reach the Gateway Depot ({err}). Trying again.")
            time.sleep(10)
            continue
        log_pos += len(new_log)
        with open(f"{STATE}/agent-log-pos", "w") as f:
            f.write(str(log_pos))

        if done is not None:
            job = None

        new = answer.get("job")
        if new and job is None:
            say(f"Job received: {new.get('type')}")
            job = Job(new, svc)
            job.start()

        # A gateway in service has little to say, so it calls less often.
        # It keeps calling so the list shows it is alive, and so it can be
        # asked for a join token when another gateway joins its cluster.
        time.sleep(30 if phase == "onboarded" and job is None else 5)


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "scout":
        sys.exit(scout())
    if mode == "report":
        sys.exit(report(sys.argv[2]))
    if mode == "agent":
        sys.exit(agent())
    sys.exit("usage: agent.py scout | report <phase> | agent")

# ACS Edge Agent driver library
# Edge Scout: a driver reconnecting to an older agent's broker
# Copyright 2026 University of Sheffield
#
# This runs a real driver against mosquitto in Docker. It first sees the
# scout feature from a broker with today's ACL, then the broker is
# replaced by one with the ACL from before v6.8.0, as after an agent
# rollback, and the agent's addr has no features key. The driver must
# not ask for the scout topic again, so it is never refused or
# disconnected.
#
# The agent's own broker drops a driver that subscribes outside its
# ACL. Mosquitto 2 instead grants the subscription and filters what it
# delivers, so the test reads mosquitto's log to see every topic the
# driver asked for.
#
# The Python library does not reconnect to the broker by itself, so the
# test connects the same client again, as a restarted driver would.
#
# It needs Docker. Without it the test is skipped, unless
# SCOUT_MOSQUITTO=1 is set, as CI does, and then it fails.

import asyncio
import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import time
import uuid

import paho.mqtt.client as mqtt
import pytest
from paho.mqtt.enums import CallbackAPIVersion

from amrc.factoryplus.edge_driver import Handler
from amrc.factoryplus.edge_driver.driver import Driver

IMAGE = os.environ.get("MOSQUITTO_IMAGE", "eclipse-mosquitto:2.0.20")
REQUIRED = os.environ.get("SCOUT_MOSQUITTO") == "1"

OLD_ACL = """
pattern read fpEdge1/%u/active
pattern read fpEdge1/%u/conf
pattern read fpEdge1/%u/addr
pattern read fpEdge1/%u/cmd/#
pattern read fpEdge1/%u/poll
pattern write fpEdge1/%u/status
pattern write fpEdge1/%u/data/+
pattern write fpEdge1/%u/err/+

user agent
topic readwrite #
"""
NEW_ACL = """
pattern read fpEdge1/%u/write/#
pattern read fpEdge1/%u/rsp/+
pattern read fpEdge1/%u/scout
pattern write fpEdge1/%u/req/+
pattern write fpEdge1/%u/result/+
pattern write fpEdge1/%u/found/+
""" + OLD_ACL


def docker(*args):
    return subprocess.run(["docker", *args], check=True, capture_output=True,
                          text=True, timeout=60).stdout


def have_docker():
    if not shutil.which("docker"):
        return False
    try:
        docker("info", "--format", "{{.ServerVersion}}")
        return True
    except (subprocess.SubprocessError, OSError):
        return False


DOCKER = have_docker()


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def wait_for(what, check, timeout=10.0):
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        if check():
            return
        await asyncio.sleep(0.05)
    pytest.fail(f"Timed out waiting for {what}")


def listening(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.2):
            return True
    except OSError:
        return False


async def start_broker(port, acl, tmp):
    conf_dir = tempfile.mkdtemp(prefix="scout-mosq-", dir=tmp)
    with open(os.path.join(conf_dir, "acl"), "w") as f:
        f.write(acl)
    with open(os.path.join(conf_dir, "mosquitto.conf"), "w") as f:
        f.write("\n".join([
            "listener 1883",
            "allow_anonymous true",
            "acl_file /mosquitto/config/acl",
            "persistence false",
            "log_dest stdout",
            "log_type all",
        ]) + "\n")
    os.chmod(conf_dir, 0o755)
    os.chmod(os.path.join(conf_dir, "acl"), 0o644)
    os.chmod(os.path.join(conf_dir, "mosquitto.conf"), 0o644)

    name = f"scout-py-{os.getpid()}-{port}-{uuid.uuid4().hex[:6]}"
    docker("run", "-d", "--name", name, "-p", f"127.0.0.1:{port}:1883",
           "-v", f"{conf_dir}:/mosquitto/config", IMAGE)
    await wait_for("mosquitto to listen", lambda: listening(port))
    return name


def broker_log(name):
    try:
        return docker("logs", name)
    except subprocess.SubprocessError:
        return ""


def stop_broker(name):
    try:
        docker("rm", "-f", name)
    except subprocess.SubprocessError:
        pass


def subscriptions(log, client):
    """The topics mosquitto logged a client subscribing to."""
    subs = []
    inside = False
    for line in log.split("\n"):
        if line.endswith(f"Received SUBSCRIBE from {client}"):
            inside = True
        elif line.endswith(f"Sending SUBACK to {client}"):
            inside = False
        elif inside:
            m = re.match(r"^\d+: \t(.*) \(QoS \d\)$", line)
            if m:
                subs.append(m.group(1))
    return subs


class ScoutingHandler(Handler):
    scouts = True

    @classmethod
    def create(cls, driver, conf):
        return cls()

    def close(self, callback=None):
        if callback:
            callback()

    async def connect(self):
        return "UP"

    async def scout(self, request, out):
        return {"exhaustive": True}


@pytest.mark.skipif(not DOCKER and not REQUIRED, reason="Docker is not available")
async def test_a_driver_that_saw_the_feature_never_subscribes_on_an_old_acl(tmp_path):
    assert DOCKER, "SCOUT_MOSQUITTO=1 is set but Docker is not available"
    port = free_port()
    brokers = []
    agent = driver = None

    try:
        brokers.append(await start_broker(port, NEW_ACL, str(tmp_path)))

        # A stand-in Edge Agent. It answers READY with conf and addr,
        # with the features key only while `state["features"]` is set.
        state = {"features": {"scout": 1}, "subacks": 0}
        hellos = []
        agent = mqtt.Client(client_id="agent", callback_api_version=CallbackAPIVersion.VERSION2)
        agent.username_pw_set("agent")
        agent.reconnect_delay_set(0.1, 0.5)

        def agent_connected(client, *args):
            client.subscribe([("fpEdge1/Conn/status", 0), ("fpEdge1/Conn/found/#", 0)])

        def agent_message(client, userdata, msg):
            if msg.topic == "fpEdge1/Conn/status" and msg.payload == b"READY":
                client.publish("fpEdge1/Conn/conf", "{}")
                addr = {"version": 1, "addrs": {"1": "a"}, "groups": {}}
                if state["features"]:
                    addr["features"] = state["features"]
                client.publish("fpEdge1/Conn/addr", json.dumps(addr))
            if msg.topic == "fpEdge1/Conn/found/hello":
                hellos.append(json.loads(msg.payload))

        def agent_subscribed(*args):
            state["subacks"] += 1

        agent.on_connect = agent_connected
        agent.on_subscribe = agent_subscribed
        agent.on_message = agent_message
        agent.connect("127.0.0.1", port)
        agent.loop_start()
        await wait_for("the agent to subscribe", lambda: state["subacks"] == 1)

        driver = Driver(ScoutingHandler, "Conn", f"mqtt://127.0.0.1:{port}", "x")
        counts = {"connects": 0, "disconnects": 0}
        on_connect = driver.mqtt.on_connect

        def counting_connect(*args, **kwargs):
            counts["connects"] += 1
            on_connect(*args, **kwargs)

        def counting_disconnect(*args, **kwargs):
            counts["disconnects"] += 1

        driver.mqtt.on_connect = counting_connect
        driver.mqtt.on_disconnect = counting_disconnect
        await driver.run()

        # Today's broker: the driver subscribes and answers a hello.
        await wait_for("the scout subscription", lambda: "fpEdge1/Conn/scout" in
                       subscriptions(broker_log(brokers[0]), "Conn"))
        await asyncio.sleep(0.2)
        agent.publish("fpEdge1/Conn/scout", json.dumps({"op": "hello", "version": 1}))
        await wait_for("the hello answer", lambda: len(hellos) == 1)
        assert hellos[0]["supported"] is True
        assert counts == {"connects": 1, "disconnects": 0}

        # Roll back: the broker comes back with the old ACL and the
        # agent sends no features key.
        state["features"] = None
        stop_broker(brokers[0])
        await wait_for("the driver to see the broker go",
                       lambda: counts["disconnects"] == 1)
        brokers.append(await start_broker(port, OLD_ACL, str(tmp_path)))
        await wait_for("the agent to subscribe again", lambda: state["subacks"] == 2)

        driver.mqtt.loop_stop()
        driver.mqtt.connect_async("127.0.0.1", port)
        driver.mqtt.loop_start()
        await wait_for("the driver to reconnect", lambda: counts["connects"] == 2)
        await wait_for("the driver to be UP", lambda: driver.status == "UP")
        assert driver.scout_seen is False

        # Give a wrong subscription time to happen.
        agent.publish("fpEdge1/Conn/scout", json.dumps({"op": "hello", "version": 1}))
        await asyncio.sleep(2)

        log = broker_log(brokers[1])
        subs = subscriptions(log, "Conn")
        assert "fpEdge1/Conn/conf" in subs, subs
        assert not any("scout" in s for s in subs), subs
        assert "Denied" not in log
        assert counts == {"connects": 2, "disconnects": 1}
        assert len(hellos) == 1
    finally:
        for client in (driver.mqtt if driver else None, agent):
            if client is not None:
                client.disconnect()
                client.loop_stop()
        for name in brokers:
            stop_broker(name)

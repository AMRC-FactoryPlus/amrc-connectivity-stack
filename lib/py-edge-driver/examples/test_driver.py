import time
import logging
import math
from amrc.factoryplus.edge_driver import PolledDriver, BufferX, Handler
import asyncio

funcs = {
    'const': lambda p, a: lambda t: a,
    'sin': lambda p, a: lambda t: a * math.sin(2 * math.pi * (t / p)),
    'saw': lambda p, a: lambda t: (a / p) * (t % p),
}

packing = {
    'bd': [8, lambda v: BufferX.fromDoubleBE(v)],
    'ld': [8, lambda v: BufferX.fromDoubleLE(v)],
    'bf': [4, lambda v: BufferX.fromFloatBE(v)],
    'lf': [4, lambda v: BufferX.fromFloatLE(v)],
}


class TestHandler(Handler):
    @classmethod
    def create(cls, driver, conf):
        return TestHandler()

    def close(self, callback = None):
        return None

    async def connect(self):
        return "UP"

    def parseAddr(self, addr):
        parts = addr.split(":")
        if len(parts) != 4:
            return None

        func = funcs.get(parts[0])
        if not func:
            return None
        
        try:
            period = float(parts[1])
            amplitude = float(parts[2])
        except ValueError:
            return None

        pack = packing.get(parts[3])
        if not pack:
            return None

        return {
            'func': func(period, amplitude),
            'size': pack[0],
            'pack': pack[1],
        }

    async def poll(self, spec):
        val = spec['func'](time.perf_counter() * 1000)  # Convert to milliseconds
        buf = spec['pack'](val)
        
        return buf

driver = PolledDriver(handler=TestHandler, edge_username="my_connection", edge_mqtt="mqtt://localhost", edge_password="my_password")


logging.basicConfig(level=logging.DEBUG)

async def main():
    try:
        await driver.run()
        await asyncio.Event().wait()
    except KeyboardInterrupt:
        logging.info("Shutting down.")

asyncio.run(main())


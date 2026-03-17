use std::f64::consts::TAU;
use std::time::Instant;

use async_trait::async_trait;
use bytes::{BufMut, Bytes, BytesMut};
use rs_edge_driver::*;

/// A parsed address spec describing a waveform to generate.
#[derive(Clone, Hash, PartialEq, Eq)]
struct WaveSpec {
    func: WaveFunc,
    period_ms: u64,
    amplitude_bits: u64,
    packing: Packing,
}

#[derive(Clone, Copy, Hash, PartialEq, Eq)]
enum WaveFunc {
    Const,
    Sin,
    Saw,
}

#[derive(Clone, Copy, Hash, PartialEq, Eq)]
enum Packing {
    DoubleBE,
    DoubleLE,
    FloatBE,
    FloatLE,
}

impl WaveFunc {
    fn eval(&self, period: f64, amplitude: f64, t: f64) -> f64 {
        match self {
            WaveFunc::Const => amplitude,
            WaveFunc::Sin => amplitude * (TAU * (t / period)).sin(),
            WaveFunc::Saw => (amplitude / period) * (t % period),
        }
    }
}

impl Packing {
    fn pack(&self, val: f64) -> Bytes {
        let mut buf = BytesMut::with_capacity(8);
        match self {
            Packing::DoubleBE => buf.put_f64(val),
            Packing::DoubleLE => buf.put_f64_le(val),
            Packing::FloatBE => buf.put_f32(val as f32),
            Packing::FloatLE => buf.put_f32_le(val as f32),
        }
        buf.freeze()
    }
}

struct TestHandler {
    start: Instant,
}

#[async_trait]
impl Handler for TestHandler {
    type Addr = WaveSpec;

    fn create(_handle: DriverHandle, _config: serde_json::Value) -> Result<Self, HandlerError> {
        Ok(Self {
            start: Instant::now(),
        })
    }

    fn parse_addr(&self, addr: &str) -> Option<WaveSpec> {
        let parts: Vec<&str> = addr.split(':').collect();
        if parts.len() != 4 {
            return None;
        }

        let func = match parts[0] {
            "const" => WaveFunc::Const,
            "sin" => WaveFunc::Sin,
            "saw" => WaveFunc::Saw,
            _ => return None,
        };

        let period_ms = parts[1].parse().ok()?;
        let amplitude_bits = parts[2].parse().ok()?;

        let packing = match parts[3] {
            "bd" => Packing::DoubleBE,
            "ld" => Packing::DoubleLE,
            "bf" => Packing::FloatBE,
            "lf" => Packing::FloatLE,
            _ => return None,
        };

        Some(WaveSpec {
            func,
            period_ms,
            amplitude_bits,
            packing,
        })
    }

    async fn connect(&mut self) -> Result<(), ConnectError> {
        Ok(())
    }

    async fn poll(&mut self, spec: &WaveSpec) -> Option<Bytes> {
        let t = self.start.elapsed().as_secs_f64() * 1000.0;
        let val = spec
            .func
            .eval(spec.period_ms as f64, spec.amplitude_bits as f64, t);
        Some(spec.packing.pack(val))
    }

    async fn close(&mut self) {}
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt::init();

    let config = DriverConfig::from_env()?;
    let mut driver = Driver::<TestHandler>::new(config);
    driver.run().await
}

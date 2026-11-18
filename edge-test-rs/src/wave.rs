// ACS Rust test driver
// Wave values and packing
// Copyright 2026 University of Sheffield

//! The device side of the driver: the value of an address at a time.

use std::f64::consts::TAU;

use bytes::{BufMut, Bytes, BytesMut};

use crate::addr::{Addr, Func, Packing};

impl Func {
    /// The wave's value at time `t` ms, written as the JS driver
    /// writes it so the floating-point steps are the same.
    pub fn eval(self, period: f64, amplitude: f64, t: f64) -> f64 {
        match self {
            Func::Const => amplitude,
            // JS: a * Math.sin(2 * Math.PI * (t / p)). TAU is exactly
            // 2 * PI, and libm::sin is the fdlibm code V8 uses.
            Func::Sin => amplitude * libm::sin(TAU * (t / period)),
            // JS's % on numbers is fmod, which is what Rust's % does.
            Func::Saw => (amplitude / period) * (t % period),
        }
    }
}

impl Packing {
    /// Pack a value. Floats are rounded to nearest, as JS's
    /// `writeFloatBE` does, and too big a value becomes infinity.
    pub fn pack(self, val: f64) -> Bytes {
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

/// The bytes an address gives at time `t` ms.
pub fn value(addr: &Addr, t: f64) -> Bytes {
    let val = addr.func.eval(addr.period, addr.amplitude, t);
    addr.packing.pack(val)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(addr: &str, t: f64) -> String {
        let b = value(&Addr::parse(addr).unwrap(), t);
        b.iter().map(|x| format!("{x:02x}")).collect()
    }

    #[test]
    fn const_packs_the_amplitude() {
        assert_eq!(hex("const:1:1:bd", 0.0), "3ff0000000000000");
        assert_eq!(hex("const:1:1:ld", 0.0), "000000000000f03f");
        assert_eq!(hex("const:1:1:bf", 0.0), "3f800000");
        assert_eq!(hex("const:1:1:lf", 0.0), "0000803f");
    }

    #[test]
    fn sin_and_saw_follow_the_period() {
        let v = |a: &str, t| Func::eval(Addr::parse(a).unwrap().func, 1000.0, 2.0, t);
        assert_eq!(v("sin:1000:2:bd", 0.0), 0.0);
        assert_eq!(v("sin:1000:2:bd", 250.0), 2.0);
        assert_eq!(v("saw:1000:2:bd", 500.0), 1.0);
        assert_eq!(v("saw:1000:2:bd", 1500.0), 1.0);
    }

    #[test]
    fn float_overflow_is_infinity() {
        assert_eq!(hex("const:1:1e39:bf", 0.0), "7f800000");
        assert_eq!(hex("const:1:-1e39:lf", 0.0), "000080ff");
    }

    #[test]
    fn zero_period_gives_nan() {
        for a in ["sin:0:1:bd", "saw:0:1:bd"] {
            let b = value(&Addr::parse(a).unwrap(), 5.0);
            let v = f64::from_be_bytes(b[..].try_into().unwrap());
            assert!(v.is_nan(), "{a}");
        }
    }
}

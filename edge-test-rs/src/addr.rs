// ACS Rust test driver
// Address parsing
// Copyright 2026 University of Sheffield

//! Address strings.
//!
//! An address is `func:period:amplitude:packing`, for example
//! `sin:1000:5:bd` for a sine wave with a 1000 ms period and an
//! amplitude of 5, sent as a big-endian double. See [`Func`] and
//! [`Packing`] for the names.
//!
//! The JS driver reads the period and amplitude with
//! `Number.parseFloat`, which takes the longest number at the start of
//! the text and ignores the rest, so `10abc` is 10 and ` 42` is 42.
//! [`js_parse_float`] copies that, so every address the JS driver
//! accepts means the same here.

use std::hash::{Hash, Hasher};

/// The wave an address asks for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Func {
    /// `const`: always the amplitude.
    Const,
    /// `sin`: a sine wave, `a * sin(2π t / p)`.
    Sin,
    /// `saw`: a sawtooth from 0 up to the amplitude, `(a / p) * (t % p)`.
    Saw,
}

/// How a value is packed into bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Packing {
    /// `bd`: 8-byte big-endian double.
    DoubleBE,
    /// `ld`: 8-byte little-endian double.
    DoubleLE,
    /// `bf`: 4-byte big-endian float.
    FloatBE,
    /// `lf`: 4-byte little-endian float.
    FloatLE,
}

/// A parsed address.
#[derive(Clone, Copy, Debug)]
pub struct Addr {
    pub func: Func,
    /// The period in milliseconds. Not checked: a period of 0 gives
    /// NaN for `sin` and `saw`, as in the JS driver.
    pub period: f64,
    pub amplitude: f64,
    pub packing: Packing,
}

// The driver keeps addresses in a hash map, and f64 has no Eq or
// Hash. Comparing the bits is right here: parsing never gives NaN.
impl PartialEq for Addr {
    fn eq(&self, other: &Self) -> bool {
        self.func == other.func
            && self.period.to_bits() == other.period.to_bits()
            && self.amplitude.to_bits() == other.amplitude.to_bits()
            && self.packing == other.packing
    }
}

impl Eq for Addr {}

impl Hash for Addr {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.func.hash(state);
        self.period.to_bits().hash(state);
        self.amplitude.to_bits().hash(state);
        self.packing.hash(state);
    }
}

impl Func {
    fn from_name(name: &str) -> Option<Self> {
        match name {
            "const" => Some(Self::Const),
            "sin" => Some(Self::Sin),
            "saw" => Some(Self::Saw),
            _ => None,
        }
    }
}

impl Packing {
    fn from_name(name: &str) -> Option<Self> {
        match name {
            "bd" => Some(Self::DoubleBE),
            "ld" => Some(Self::DoubleLE),
            "bf" => Some(Self::FloatBE),
            "lf" => Some(Self::FloatLE),
            _ => None,
        }
    }
}

impl Addr {
    /// Parse an address string, or `None` if it is not valid.
    pub fn parse(spec: &str) -> Option<Self> {
        let parts: Vec<&str> = spec.split(':').collect();
        let [func, period, amplitude, packing] = parts[..] else {
            return None;
        };

        let func = Func::from_name(func)?;
        let period = js_parse_float(period)?;
        let amplitude = js_parse_float(amplitude)?;
        let packing = Packing::from_name(packing)?;

        Some(Self {
            func,
            period,
            amplitude,
            packing,
        })
    }
}

/// The characters JS counts as white space before a number: the
/// `WhiteSpace` and `LineTerminator` sets of ECMA-262. This is not the
/// same set as `char::is_whitespace`, which adds U+0085 and leaves out
/// U+FEFF.
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// JavaScript's `Number.parseFloat`, returning `None` where it would
/// return NaN.
///
/// It skips leading white space, then reads the longest prefix that is
/// a decimal number (`1`, `-1.5`, `.5`, `5.`, `1e3`) or `Infinity`
/// with an optional sign, and ignores anything after it. There is no
/// hex, and `NaN` counts as no number.
pub fn js_parse_float(text: &str) -> Option<f64> {
    let s = text.trim_start_matches(is_js_space);
    let b = s.as_bytes();
    let mut i = 0;

    if matches!(b.first(), Some(b'+' | b'-')) {
        i += 1;
    }
    if s[i..].starts_with("Infinity") {
        let inf = f64::INFINITY;
        return Some(if b[0] == b'-' { -inf } else { inf });
    }

    let digits = |from: usize| b[from..].iter().take_while(|c| c.is_ascii_digit()).count();

    let int = digits(i);
    i += int;
    let mut frac = 0;
    if b.get(i) == Some(&b'.') {
        frac = digits(i + 1);
        if int + frac > 0 {
            i += 1 + frac;
        }
    }
    if int + frac == 0 {
        return None;
    }

    // An exponent only counts if it has digits.
    if matches!(b.get(i), Some(b'e' | b'E')) {
        let mut j = i + 1;
        if matches!(b.get(j), Some(b'+' | b'-')) {
            j += 1;
        }
        let exp = digits(j);
        if exp > 0 {
            i = j + exp;
        }
    }

    // Rust's parser rounds correctly, as JS does, and accepts every
    // form the scan above lets through.
    s[..i].parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pf(s: &str) -> Option<f64> {
        js_parse_float(s)
    }

    #[test]
    fn parses_an_address() {
        let a = Addr::parse("sin:1000:2.5:bd").unwrap();
        assert_eq!(a.func, Func::Sin);
        assert_eq!(a.period, 1000.0);
        assert_eq!(a.amplitude, 2.5);
        assert_eq!(a.packing, Packing::DoubleBE);

        let a = Addr::parse("saw:-250:0:lf").unwrap();
        assert_eq!((a.func, a.packing), (Func::Saw, Packing::FloatLE));
        assert_eq!((a.period, a.amplitude), (-250.0, 0.0));

        assert_eq!(Addr::parse("const:1:1:ld").unwrap().func, Func::Const);
        assert_eq!(
            Addr::parse("const:1:1:bf").unwrap().packing,
            Packing::FloatBE
        );
    }

    #[test]
    fn rejects_bad_addresses() {
        for bad in [
            "",
            "sin",
            "sin:1000:1",
            "sin:1000:1:bd:",
            "cos:1000:1:bd",
            "SIN:1000:1:bd",
            "sin:1000:1:BD",
            "sin::1:bd",
            "sin:x:1:bd",
            "sin:NaN:1:bd",
            "sin:1000:1:bd ",
        ] {
            assert_eq!(Addr::parse(bad), None, "{bad:?}");
        }
    }

    // The JS driver looks names up in a plain object, so `constructor`
    // and `__proto__` find Object.prototype's properties and the
    // address breaks later, in parseAddr or poll. Rejecting them here
    // is the only sensible match.
    #[test]
    fn rejects_object_prototype_names() {
        for bad in [
            "constructor:1:1:bd",
            "__proto__:1:1:bd",
            "toString:1:1:bd",
            "sin:1:1:constructor",
            "sin:1:1:hasOwnProperty",
        ] {
            assert_eq!(Addr::parse(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn parse_float_takes_the_leading_number() {
        assert_eq!(pf("42"), Some(42.0));
        assert_eq!(pf("10abc"), Some(10.0));
        assert_eq!(pf(" \t\u{A0}\u{FEFF}42"), Some(42.0));
        assert_eq!(pf(".5"), Some(0.5));
        assert_eq!(pf("5."), Some(5.0));
        assert_eq!(pf("+3"), Some(3.0));
        assert_eq!(pf("1e3"), Some(1000.0));
        assert_eq!(pf("1E-1"), Some(0.1));
        assert_eq!(pf("1e"), Some(1.0));
        assert_eq!(pf("1e+2x"), Some(100.0));
        assert_eq!(pf("1e+"), Some(1.0));
        assert_eq!(pf("0x10"), Some(0.0));
        assert_eq!(pf("5.e2"), Some(500.0));
        assert_eq!(pf("Infinity"), Some(f64::INFINITY));
        assert_eq!(pf("-Infinityx"), Some(f64::NEG_INFINITY));
        assert_eq!(pf("1e999"), Some(f64::INFINITY));
        assert!(pf("-0").unwrap().is_sign_negative());
    }

    #[test]
    fn parse_float_finds_no_number() {
        for s in [
            "", "x", "-", "+", ".", "-.", ".e5", "e5", "NaN", "inf", "infinity", "Inf", "\u{85}1",
        ] {
            assert_eq!(pf(s), None, "{s:?}");
        }
    }
}

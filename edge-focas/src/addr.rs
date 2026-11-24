// ACS FOCAS driver
// Address strings: what each one reads from the control
// Copyright 2026 University of Sheffield

//! An address names one read from the control. Every read answers with
//! a JSON object, and the metric's path picks a value out of it with
//! JSONPath, so one address can feed several metrics.
//!
//! | Address              | Answer                                           |
//! |----------------------|--------------------------------------------------|
//! | `sysinfo`            | `{"cnc_type","mt_type","series","version","axes","max_axes"}` |
//! | `status`             | `{"auto","run","motion","mstb","emergency","alarm","edit"}` |
//! | `alarm`              | `{"active","bits"}`                              |
//! | `program`            | `{"running","main"}`                             |
//! | `speeds`             | `{"feed","spindle"}`                             |
//! | `position`           | `{"absolute":[..],"relative":[..],"machine":[..],"distance":[..]}` |
//! | `macro:<n>`          | `{"value"}`                                      |
//! | `param:<n>`          | `{"values":[v]}` for a parameter with no axis    |
//! | `param:<n>:all`      | `{"values":[..]}`, one per axis                  |
//! | `param:<n>:<axis>`   | `{"values":[v]}` for one axis (1-based)          |
//! | `pmc:<area><n>[:<size>]` | `{"value"}`; size is `byte` (default), `word` or `long` |

/// A PMC address letter. The number is the area code FOCAS uses for
/// it, from the `adr_type` table of `pmc_rdpmcrng`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PmcArea {
    G,
    F,
    Y,
    X,
    A,
    R,
    T,
    K,
    C,
    D,
    M,
    N,
    E,
    Z,
}

impl PmcArea {
    pub const ALL: [PmcArea; 14] = [
        Self::G,
        Self::F,
        Self::Y,
        Self::X,
        Self::A,
        Self::R,
        Self::T,
        Self::K,
        Self::C,
        Self::D,
        Self::M,
        Self::N,
        Self::E,
        Self::Z,
    ];

    pub fn code(self) -> i32 {
        Self::ALL.iter().position(|a| *a == self).unwrap() as i32
    }

    pub fn from_code(code: i32) -> Option<Self> {
        Self::ALL.get(usize::try_from(code).ok()?).copied()
    }

    fn from_letter(c: char) -> Option<Self> {
        let letters = "GFYXARTKCDMNEZ";
        letters.find(c.to_ascii_uppercase()).map(|i| Self::ALL[i])
    }
}

/// How many bytes a PMC read takes, as FOCAS's size code: the read is
/// `1 << code` bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PmcSize {
    Byte = 0,
    Word = 1,
    Long = 2,
}

impl PmcSize {
    pub fn code(self) -> i32 {
        self as i32
    }

    pub fn from_code(code: i32) -> Option<Self> {
        match code {
            0 => Some(Self::Byte),
            1 => Some(Self::Word),
            2 => Some(Self::Long),
            _ => None,
        }
    }

    pub fn bytes(self) -> usize {
        1 << self.code()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Addr {
    SysInfo,
    Status,
    Alarm,
    Program,
    Speeds,
    Position,
    Macro(i32),
    /// The parameter number and the axis, as FANUC's `cnc_rdparam`
    /// numbers it: 0 for a parameter with no axis, 1 to the number of
    /// axes for one axis, and -1 (`ALL_AXES`) for every axis.
    Param(i32, i32),
    Pmc(PmcArea, i32, PmcSize),
}

impl Addr {
    pub fn parse(s: &str) -> Option<Self> {
        let parts: Vec<&str> = s.trim().split(':').collect();
        let num = |p: &str| p.parse::<i32>().ok().filter(|n| *n >= 0);
        match parts.as_slice() {
            ["sysinfo"] => Some(Self::SysInfo),
            ["status"] => Some(Self::Status),
            ["alarm"] => Some(Self::Alarm),
            ["program"] => Some(Self::Program),
            ["speeds"] => Some(Self::Speeds),
            ["position"] => Some(Self::Position),
            ["macro", n] => Some(Self::Macro(num(n)?)),
            ["param", n] => Some(Self::Param(num(n)?, 0)),
            ["param", n, "all"] => Some(Self::Param(num(n)?, -1)),
            ["param", n, axis] => Some(Self::Param(num(n)?, num(axis).filter(|a| *a > 0)?)),
            ["pmc", a] => Self::parse_pmc(a, PmcSize::Byte),
            ["pmc", a, size] => Self::parse_pmc(
                a,
                match *size {
                    "byte" => PmcSize::Byte,
                    "word" => PmcSize::Word,
                    "long" => PmcSize::Long,
                    _ => return None,
                },
            ),
            _ => None,
        }
    }

    fn parse_pmc(a: &str, size: PmcSize) -> Option<Self> {
        let mut chars = a.chars();
        let area = PmcArea::from_letter(chars.next()?)?;
        let n = chars.as_str().parse::<i32>().ok().filter(|n| *n >= 0)?;
        Some(Self::Pmc(area, n, size))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_good_addresses() {
        assert_eq!(Addr::parse("status"), Some(Addr::Status));
        assert_eq!(Addr::parse(" position "), Some(Addr::Position));
        assert_eq!(Addr::parse("macro:500"), Some(Addr::Macro(500)));
        assert_eq!(Addr::parse("param:6711"), Some(Addr::Param(6711, 0)));
        assert_eq!(Addr::parse("param:1320:all"), Some(Addr::Param(1320, -1)));
        assert_eq!(Addr::parse("param:1320:2"), Some(Addr::Param(1320, 2)));
        assert_eq!(
            Addr::parse("pmc:R100"),
            Some(Addr::Pmc(PmcArea::R, 100, PmcSize::Byte))
        );
        assert_eq!(
            Addr::parse("pmc:d8:long"),
            Some(Addr::Pmc(PmcArea::D, 8, PmcSize::Long))
        );
    }

    #[test]
    fn rejects_bad_addresses() {
        for bad in [
            "",
            "Status",
            "macro",
            "macro:x",
            "macro:-1",
            "param:1320:0",
            "param:1320:-1",
            "param:1320:ALL",
            "pmc:Q1",
            "pmc:R",
            "pmc:R1:float",
            "position:1",
        ] {
            assert_eq!(Addr::parse(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn pmc_codes() {
        assert_eq!(PmcArea::G.code(), 0);
        assert_eq!(PmcArea::R.code(), 5);
        assert_eq!(PmcArea::D.code(), 9);
        assert_eq!(PmcArea::from_code(9), Some(PmcArea::D));
        assert_eq!(PmcArea::from_code(14), None);
        assert_eq!(PmcSize::Long.bytes(), 4);
    }
}

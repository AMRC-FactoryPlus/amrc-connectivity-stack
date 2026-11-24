// ACS FOCAS driver
// A fake FANUC control for testing without a machine
// Copyright 2026 University of Sheffield

//! A FOCAS server that plays a three-axis mill running a 60-second
//! cycle, so the driver can be tried and tested without a machine.
//!
//! | Seconds into the cycle | What the machine does                          |
//! |------------------------|-------------------------------------------------|
//! | 0 to 45                | Cutting: program O1234 running, spindle at 1200 rpm, feed 500 mm/min, X and Y moving in a 50 mm circle every 10 s, Z stepping down |
//! | 45 to 55               | Idle at home, program stopped                   |
//! | 55 to 60               | In alarm (alarm bit 1 set), stopped             |
//!
//! Every value is a pure function of the time since the server
//! started (see [`answer`]), so the tests can ask for any moment.
//!
//! It answers these reads, and refuses anything else with
//! `EW_FUNC` (1) or an unknown number with `EW_NUMBER` (3):
//!
//! - system information: a Series 31i-B (`31`, ` M`, `G4A1`, `14.0`)
//!   with 3 of 8 axes;
//! - status, alarm, program number, feed and spindle speed;
//! - absolute, relative, machine and distance-to-go positions;
//! - macro variables `#100` (12.345), `#101` (empty) and `#3901`
//!   (parts made, one per finished cycle);
//! - parameters 6711 (parts made, long), 1320 (per-axis stroke limits,
//!   long, in 0.001 mm) and 1020 (per-axis names as ASCII, byte);
//! - PMC memory in every area up to address 9999, all zero except
//!   `R0`-`R3` (the cycle count as a long) and `D10`-`D11` (1234 as a
//!   word).

use std::f64::consts::TAU;
use std::time::Instant;

use bytes::{BufMut, Bytes, BytesMut};
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};

use crate::addr::{PmcArea, PmcSize};
use crate::protocol::{
    Answer, Request, cmd, decode_requests, encode_frame, encode_real, encode_responses, ew, ftype,
    read_frame,
};

pub const CYCLE_S: f64 = 60.0;
pub const AXES: usize = 3;
const MAX_AXES: u16 = 8;
const PMC_TOP: i32 = 9999;
/// Places used for positions and speeds, as on a 0.001 mm machine.
const PLACES: u16 = 3;

/// The state of the machine at a moment.
#[derive(Debug, Clone, PartialEq)]
pub struct Machine {
    pub cycles: u32,
    pub running: bool,
    pub alarm: bool,
    pub absolute: [f64; AXES],
    pub distance: [f64; AXES],
    pub spindle: f64,
    pub feed: f64,
}

/// Where the machine origin sits from the work origin, so machine
/// positions differ from absolute ones.
const MACHINE_OFFSET: [f64; AXES] = [-250.0, -150.0, -300.0];

impl Machine {
    pub fn at(t: f64) -> Self {
        let cycles = (t / CYCLE_S).floor() as u32;
        let phase = t % CYCLE_S;
        let running = phase < 45.0;
        let alarm = phase >= 55.0;
        if running {
            let a = TAU * phase / 10.0;
            let ramp = (phase / 2.0).min(1.0);
            Self {
                cycles,
                running,
                alarm,
                absolute: [50.0 * a.cos(), 50.0 * a.sin(), -5.0 - 0.1 * phase],
                distance: [5.0 * a.sin(), -5.0 * a.cos(), 0.0],
                spindle: (1200.0 * ramp).round(),
                feed: 500.0,
            }
        } else {
            Self {
                cycles,
                running,
                alarm,
                absolute: [0.0, 0.0, 50.0],
                distance: [0.0; AXES],
                spindle: 0.0,
                feed: 0.0,
            }
        }
    }

    fn position(&self, code: i32) -> Option<[f64; AXES]> {
        match code {
            // absolute and relative
            4 | 6 => Some(self.absolute),
            // machine
            1 => Some(std::array::from_fn(|i| {
                self.absolute[i] + MACHINE_OFFSET[i]
            })),
            // distance to go
            7 => Some(self.distance),
            _ => None,
        }
    }

    /// One byte of PMC memory.
    fn pmc_byte(&self, area: PmcArea, addr: i32) -> u8 {
        match (area, addr) {
            (PmcArea::R, 0..=3) => self.cycles.to_be_bytes()[addr as usize],
            (PmcArea::D, 10..=11) => 1234u16.to_be_bytes()[addr as usize - 10],
            _ => 0,
        }
    }
}

fn reals(vs: &[Option<f64>]) -> Bytes {
    let mut b = BytesMut::new();
    for v in vs {
        encode_real(*v, PLACES, &mut b);
    }
    b.freeze()
}

/// A parameter record: number, axis (-1 for every axis), type, and
/// `MAX_AXES` four-byte slots.
fn param(n: i32, axis: i16, kind: u16, values: &[i32]) -> Bytes {
    let mut b = BytesMut::new();
    b.put_u32(n as u32);
    b.put_i16(axis);
    b.put_u16(kind);
    for i in 0..MAX_AXES as usize {
        b.put_i32(values.get(i).copied().unwrap_or(0));
    }
    b.freeze()
}

/// The answer to one sub-request at `t` seconds after start.
pub fn answer(req: &Request, t: f64) -> Answer {
    let m = Machine::at(t);
    let [a0, a1, a2, _, _] = req.args;
    match (req.class, req.cmd) {
        (1, cmd::SYSINFO) => {
            let mut b = BytesMut::new();
            b.put_u16(0);
            b.put_u16(MAX_AXES);
            b.put_slice(b"31 MG4A114.0 3");
            Ok(b.freeze())
        }
        (1, cmd::STATINFO) => {
            let mut b = BytesMut::new();
            // auto (1 = MEM), run (3 = started, 0 = reset), motion,
            // mstb, emergency, alarm, edit
            for w in [
                1,
                if m.running { 3 } else { 0 },
                m.running as u16,
                0,
                0,
                m.alarm as u16,
                0,
            ] {
                b.put_u16(w);
            }
            Ok(b.freeze())
        }
        (1, cmd::ALARM) => Ok(Bytes::copy_from_slice(
            &(if m.alarm { 1u32 << 1 } else { 0 }).to_be_bytes(),
        )),
        (1, cmd::PROGNUM) => {
            let mut b = BytesMut::new();
            b.put_i32(if m.running { 1234 } else { 0 });
            b.put_i32(1234);
            Ok(b.freeze())
        }
        (1, cmd::ACT_FEED) => Ok(reals(&[Some(m.feed)])),
        (1, cmd::ACT_SPINDLE) => Ok(reals(&[Some(m.spindle)])),
        (1, cmd::POSITION) => {
            let pos = m.position(a0).ok_or(ew::ATTRIB)?;
            match a1 {
                -1 => Ok(reals(&pos.map(Some))),
                1..=3 => Ok(reals(&[Some(pos[a1 as usize - 1])])),
                _ => Err(ew::NUMBER),
            }
        }
        (1, cmd::READ_MACRO) => {
            if a0 != a1 {
                return Err(ew::LENGTH);
            }
            match a0 {
                100 => Ok(reals(&[Some(12.345)])),
                101 => Ok(reals(&[None])),
                3901 => {
                    let mut b = BytesMut::new();
                    encode_real(Some(m.cycles as f64), 0, &mut b);
                    Ok(b.freeze())
                }
                _ => Err(ew::NUMBER),
            }
        }
        (1, cmd::READ_PARAM) => {
            if a0 != a1 {
                return Err(ew::LENGTH);
            }
            let per_axis: Option<[i32; AXES]> = match a0 {
                1320 => Some([500_000, 400_000, 300_000]),
                1020 => Some([b'X' as i32, b'Y' as i32, b'Z' as i32]),
                _ => None,
            };
            let kind = if a0 == 1020 { 0 } else { 3 };
            match (a0, per_axis, a2) {
                (6711, _, _) => Ok(param(6711, 0, 3, &[m.cycles as i32])),
                (n, Some(vs), -1) => Ok(param(n, -1, kind, &vs)),
                (n, Some(vs), 1..=3) => Ok(param(n, a2 as i16, kind, &[vs[a2 as usize - 1]])),
                (_, Some(_), _) => Err(ew::NUMBER),
                _ => Err(ew::NUMBER),
            }
        }
        (2, cmd::READ_PMC) => {
            let [first, last, area, size, _] = req.args;
            let area = PmcArea::from_code(area).ok_or(ew::ATTRIB)?;
            let size = PmcSize::from_code(size).ok_or(ew::ATTRIB)?;
            if first < 0
                || last > PMC_TOP
                || last < first
                || !((last - first + 1) as usize).is_multiple_of(size.bytes())
            {
                return Err(ew::NUMBER);
            }
            Ok((first..=last).map(|a| m.pmc_byte(area, a)).collect())
        }
        _ => Err(ew::FUNC),
    }
}

/// Accept connections for ever, timing the machine from now.
pub async fn serve(listener: TcpListener) -> std::io::Result<()> {
    let start = Instant::now();
    loop {
        let (stream, peer) = listener.accept().await?;
        tokio::spawn(async move {
            tracing::info!("{peer} connected");
            match session(stream, start).await {
                Ok(()) => tracing::info!("{peer} closed the session"),
                Err(e) => tracing::info!("{peer} went away: {e}"),
            }
        });
    }
}

async fn session(mut stream: TcpStream, start: Instant) -> Result<(), crate::protocol::ProtoError> {
    stream.set_nodelay(true)?;
    loop {
        let frame = read_frame(&mut stream).await?;
        let reply = match frame.ftype {
            ftype::OPEN_REQ => encode_frame(ftype::OPEN_RESP, &[]),
            ftype::CLOSE_REQ => {
                stream
                    .write_all(&encode_frame(ftype::CLOSE_RESP, &[]))
                    .await?;
                return Ok(());
            }
            ftype::VAR_REQ => {
                let t = start.elapsed().as_secs_f64();
                let reqs = decode_requests(frame.payload)?;
                let answers: Vec<_> = reqs.iter().map(|r| (*r, answer(r, t))).collect();
                tracing::debug!("{answers:?}");
                encode_frame(ftype::VAR_RESP, &encode_responses(&answers))
            }
            other => return Err(crate::protocol::ProtoError::UnexpectedFrame(other)),
        };
        stream.write_all(&reply).await?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cycle_phases() {
        let m = Machine::at(2.5);
        assert!(m.running && !m.alarm);
        assert_eq!((m.spindle, m.feed), (1200.0, 500.0));
        let m = Machine::at(50.0);
        assert!(!m.running && !m.alarm);
        let m = Machine::at(125.0 + 57.0 - 5.0);
        assert!(m.alarm);
        assert_eq!(m.cycles, 2);
    }

    #[test]
    fn unknown_reads_are_refused() {
        assert_eq!(answer(&Request::cnc(0x7777, [0; 5]), 0.0), Err(ew::FUNC));
        assert_eq!(
            answer(&Request::cnc(cmd::READ_MACRO, [9999, 9999, 0, 0, 0]), 0.0),
            Err(ew::NUMBER)
        );
        assert_eq!(answer(&Request::pmc(5, 1, 9999), 0.0), Err(ew::NUMBER));
    }
}

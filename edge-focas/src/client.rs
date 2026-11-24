// ACS FOCAS driver
// A connection to one control, and the reads behind each address
// Copyright 2026 University of Sheffield

//! A FOCAS client over one TCP connection. Requests go one at a time:
//! the control answers in order and the frames carry no request id.

use std::time::Duration;

use bytes::Bytes;
use serde_json::{Value, json};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::time::timeout;

use crate::addr::{Addr, PmcSize};
use crate::protocol::{
    Answer, ProtoError, Request, cmd, decode_real, decode_responses, encode_frame, encode_requests,
    ftype, read_frame,
};

/// The control's description of itself, read once when connecting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SysInfo {
    /// "16", "18", "21", "0", "30", "31" and so on.
    pub cnc_type: String,
    /// " M" for a mill, " T" for a lathe and so on.
    pub mt_type: String,
    pub series: String,
    pub version: String,
    /// The number of controlled axes.
    pub axes: usize,
    /// The most axes the control can have, which sets the size of
    /// per-axis records.
    pub max_axes: usize,
}

impl SysInfo {
    pub fn parse(d: &[u8]) -> Option<Self> {
        if d.len() < 18 {
            return None;
        }
        let text = |b: &[u8]| {
            String::from_utf8_lossy(b)
                .trim_end_matches('\0')
                .to_string()
        };
        let max_axes = u16::from_be_bytes([d[2], d[3]]) as usize;
        let axes_text = text(&d[16..18]);
        Some(Self {
            cnc_type: text(&d[4..6]),
            mt_type: text(&d[6..8]),
            series: text(&d[8..12]),
            version: text(&d[12..16]),
            axes: axes_text.trim().parse().unwrap_or(max_axes),
            max_axes,
        })
    }

    fn to_json(&self) -> Value {
        json!({
            "cnc_type": self.cnc_type.trim(),
            "mt_type": self.mt_type.trim(),
            "series": self.series,
            "version": self.version,
            "axes": self.axes,
            "max_axes": self.max_axes,
        })
    }
}

/// Why a read gave no value.
#[derive(Debug)]
pub enum ReadError {
    /// The connection failed or the control sent something that is not
    /// FOCAS. The connection cannot be trusted after this.
    Link(ProtoError),
    /// The control refused the read with this `EW_` code, for example
    /// 3 for a parameter or variable number it does not have.
    Cnc(i16),
    /// The control answered, but not with the data this read expects.
    Data(&'static str),
}

impl std::fmt::Display for ReadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Link(e) => write!(f, "{e}"),
            Self::Cnc(code) => match ew_name(*code) {
                Some(name) => write!(f, "control returned error {code} ({name})"),
                None => write!(f, "control returned error {code}"),
            },
            Self::Data(what) => write!(f, "unexpected data: {what}"),
        }
    }
}

/// The name and meaning FANUC's library gives an error code, from the
/// `EW_` list in `fwlib32.h`.
pub fn ew_name(code: i16) -> Option<&'static str> {
    Some(match code {
        -1 => "EW_BUSY: the control is busy",
        1 => "EW_FUNC: not available on this control",
        2 => "EW_LENGTH: wrong data length",
        3 => "EW_NUMBER: no such number on this control",
        4 => "EW_ATTRIB: wrong attribute, for example an axis for a parameter that has none",
        5 => "EW_DATA: bad data",
        6 => "EW_NOOPT: the control does not have the option",
        7 => "EW_PROT: write protected",
        _ => return None,
    })
}

impl From<ProtoError> for ReadError {
    fn from(e: ProtoError) -> Self {
        Self::Link(e)
    }
}

/// Which position each `position` array holds, and the code FOCAS
/// uses for it in a position read.
const POSITIONS: [(&str, i32); 4] = [
    ("absolute", 4),
    ("relative", 6),
    ("machine", 1),
    ("distance", 7),
];

pub struct Client {
    stream: TcpStream,
    timeout: Duration,
    pub info: SysInfo,
}

fn timed_out() -> ProtoError {
    ProtoError::Io(std::io::Error::new(
        std::io::ErrorKind::TimedOut,
        "no answer from the control",
    ))
}

impl Client {
    /// Connect, open a FOCAS session and read the system information.
    pub async fn connect(host: &str, port: u16, limit: Duration) -> Result<Self, ReadError> {
        let stream = timeout(limit, TcpStream::connect((host, port)))
            .await
            .map_err(|_| timed_out())?
            .map_err(ProtoError::Io)?;
        stream.set_nodelay(true).map_err(ProtoError::Io)?;

        let mut client = Self {
            stream,
            timeout: limit,
            info: SysInfo::parse(&[0; 18]).unwrap(),
        };

        let open = encode_frame(ftype::OPEN_REQ, &crate::protocol::OPEN_PAYLOAD);
        let resp = client.exchange(&open).await?;
        if resp.ftype != ftype::OPEN_RESP {
            return Err(ProtoError::UnexpectedFrame(resp.ftype).into());
        }

        let sys = client.one(Request::cnc(cmd::SYSINFO, [0; 5])).await?;
        client.info = SysInfo::parse(&sys).ok_or(ReadError::Data("sysinfo length"))?;
        Ok(client)
    }

    /// Send a frame and read the one frame that answers it.
    async fn exchange(&mut self, frame: &[u8]) -> Result<crate::protocol::Frame, ProtoError> {
        let stream = &mut self.stream;
        timeout(self.timeout, async {
            stream.write_all(frame).await?;
            read_frame(stream).await
        })
        .await
        .map_err(|_| timed_out())?
    }

    /// Send sub-requests in one frame and return an answer for each.
    pub async fn request(&mut self, reqs: &[Request]) -> Result<Vec<Answer>, ProtoError> {
        let frame = encode_frame(ftype::VAR_REQ, &encode_requests(reqs));
        let resp = self.exchange(&frame).await?;
        if resp.ftype != ftype::VAR_RESP {
            return Err(ProtoError::UnexpectedFrame(resp.ftype));
        }
        decode_responses(resp.payload, reqs)
    }

    /// One sub-request, with the control's refusal as an error.
    async fn one(&mut self, req: Request) -> Result<Bytes, ReadError> {
        self.request(&[req])
            .await?
            .pop()
            .unwrap()
            .map_err(ReadError::Cnc)
    }

    /// Read an address and give its JSON answer.
    pub async fn read(&mut self, addr: &Addr) -> Result<Value, ReadError> {
        match *addr {
            Addr::SysInfo => Ok(self.info.to_json()),

            Addr::Status => {
                let d = self.one(Request::cnc(cmd::STATINFO, [0; 5])).await?;
                if d.len() != 14 {
                    return Err(ReadError::Data("status length"));
                }
                let w = |i: usize| u16::from_be_bytes([d[2 * i], d[2 * i + 1]]);
                Ok(json!({
                    "auto": w(0), "run": w(1), "motion": w(2), "mstb": w(3),
                    "emergency": w(4), "alarm": w(5), "edit": w(6),
                }))
            }

            Addr::Alarm => {
                let d = self.one(Request::cnc(cmd::ALARM, [0; 5])).await?;
                let bits = u32::from_be_bytes(
                    d[..]
                        .try_into()
                        .map_err(|_| ReadError::Data("alarm length"))?,
                );
                Ok(json!({ "active": bits != 0, "bits": bits }))
            }

            Addr::Program => {
                let d = self.one(Request::cnc(cmd::PROGNUM, [0; 5])).await?;
                if d.len() < 8 {
                    return Err(ReadError::Data("program length"));
                }
                let i = |o: usize| i32::from_be_bytes(d[o..o + 4].try_into().unwrap());
                Ok(json!({ "running": i(0), "main": i(4) }))
            }

            Addr::Speeds => {
                let ans = self
                    .request(&[
                        Request::cnc(cmd::ACT_FEED, [0; 5]),
                        Request::cnc(cmd::ACT_SPINDLE, [0; 5]),
                    ])
                    .await?;
                let real = |a: &Answer| a.as_ref().ok().and_then(|d| decode_real(d));
                Ok(json!({ "feed": real(&ans[0]), "spindle": real(&ans[1]) }))
            }

            Addr::Position => {
                let reqs: Vec<Request> = POSITIONS
                    .iter()
                    .map(|(_, code)| Request::cnc(cmd::POSITION, [*code, -1, 0, 0, 0]))
                    .collect();
                let ans = self.request(&reqs).await?;
                let axes = self.info.axes;
                let mut out = serde_json::Map::new();
                for ((name, _), a) in POSITIONS.iter().zip(ans) {
                    let v = match a {
                        Ok(d) => Value::from(
                            d.as_chunks::<8>()
                                .0
                                .iter()
                                .take(axes)
                                .map(|c| decode_real(c))
                                .collect::<Vec<_>>(),
                        ),
                        Err(_) => Value::Null,
                    };
                    out.insert(name.to_string(), v);
                }
                Ok(Value::Object(out))
            }

            Addr::Macro(n) => {
                let d = self
                    .one(Request::cnc(cmd::READ_MACRO, [n, n, 0, 0, 0]))
                    .await?;
                if d.len() < 8 {
                    return Err(ReadError::Data("macro length"));
                }
                Ok(json!({ "value": decode_real(&d[0..8]) }))
            }

            Addr::Param(n, axis) => {
                let d = self
                    .one(Request::cnc(cmd::READ_PARAM, [n, n, axis, 0, 0]))
                    .await?;
                Ok(json!({ "values": decode_param(&d, self.info.axes)? }))
            }

            Addr::Pmc(area, first, size) => {
                let d = self
                    .one(Request::pmc(area.code(), size.code(), first))
                    .await?;
                if d.len() < size.bytes() {
                    return Err(ReadError::Data("pmc length"));
                }
                // FANUC's IODBPMC holds words and longs as signed
                // `short` and `long`, so those come back signed. A byte
                // is usually a set of bits, so it stays 0 to 255.
                let v: i64 = match size {
                    PmcSize::Byte => d[0] as i64,
                    PmcSize::Word => i16::from_be_bytes([d[0], d[1]]) as i64,
                    PmcSize::Long => i32::from_be_bytes(d[0..4].try_into().unwrap()) as i64,
                };
                Ok(json!({ "value": v }))
            }
        }
    }

    /// End the FOCAS session politely. Errors are ignored, because the
    /// connection is being dropped anyway.
    pub async fn close(mut self) {
        let frame = encode_frame(ftype::CLOSE_REQ, &[]);
        let _ = timeout(Duration::from_secs(1), async {
            self.stream.write_all(&frame).await?;
            read_frame(&mut self.stream).await
        })
        .await;
    }
}

/// Decode one parameter record: a `u32` number, an `i16` axis (-1 for
/// a per-axis parameter read for every axis), a `u16` type and then
/// four-byte slots, one per axis or one in all.
///
/// The types, as pyfanuc reads them, are 0 byte, 1 bits (given here
/// as the byte they make up), 2 word and 3 long. Each value sits at
/// the end of its slot.
pub fn decode_param(d: &[u8], axes: usize) -> Result<Vec<i64>, ReadError> {
    if d.len() < 12 {
        return Err(ReadError::Data("param length"));
    }
    let axis = i16::from_be_bytes([d[4], d[5]]);
    let kind = u16::from_be_bytes([d[6], d[7]]);
    let slots = d[8..].as_chunks::<4>().0.iter();
    let count = if axis == -1 { axes } else { 1 };
    slots
        .take(count)
        .map(|s| match kind {
            0 | 1 => Ok(s[3] as i64),
            2 => Ok(i16::from_be_bytes([s[2], s[3]]) as i64),
            3 => Ok(i32::from_be_bytes(*s) as i64),
            _ => Err(ReadError::Data("param type")),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sysinfo_fields() {
        let mut d = vec![0, 0, 0, 32];
        d.extend(b"31 MG4A114.0 3");
        let s = SysInfo::parse(&d).unwrap();
        assert_eq!(s.cnc_type, "31");
        assert_eq!(s.mt_type, " M");
        assert_eq!(s.series, "G4A1");
        assert_eq!(s.version, "14.0");
        assert_eq!((s.axes, s.max_axes), (3, 32));
    }

    #[test]
    fn param_records() {
        // Parameter 1320, all axes, long, three axes of a four-slot record.
        let mut d = vec![0, 0, 5, 40, 0xff, 0xff, 0, 3];
        for v in [1000i32, -2000, 3000, 0] {
            d.extend(v.to_be_bytes());
        }
        assert_eq!(decode_param(&d, 3).unwrap(), vec![1000, -2000, 3000]);

        // A word parameter for one axis.
        let d = [0, 0, 0, 1, 0, 2, 0, 2, 0, 0, 0xff, 0xfe];
        assert_eq!(decode_param(&d, 3).unwrap(), vec![-2]);
    }
}

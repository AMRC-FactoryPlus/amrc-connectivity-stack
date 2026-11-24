// ACS FOCAS driver
// The FOCAS Ethernet wire format: frames, requests, responses, numbers
// Copyright 2026 University of Sheffield

//! The bytes FOCAS sends over TCP (port 8193 by default).
//!
//! FANUC does not publish this format. It is taken from the open
//! protocol analysis in pyfanuc (github.com/diohpix/pyfanuc), and both
//! the driver and the fake CNC in [`crate::sim`] are written from the
//! same reading, so the tests here prove the two agree with each other
//! and with pyfanuc's worked examples, not with a real control.
//!
//! Every number is big-endian. A frame is:
//!
//! ```text
//! a0 a0 a0 a0   magic
//! u16           version (1 from a client)
//! u16           frame type
//! u16           payload length, not counting these 10 bytes
//! ...           payload
//! ```
//!
//! A read is a `VAR` request frame holding one or more sub-requests,
//! answered by a `VAR` response frame with one element per sub-request
//! in the same order.

use bytes::{Buf, BufMut, Bytes, BytesMut};
use tokio::io::{AsyncRead, AsyncReadExt};

pub const MAGIC: [u8; 4] = [0xa0; 4];
pub const HEADER_LEN: usize = 10;

/// Frame types.
pub mod ftype {
    pub const OPEN_REQ: u16 = 0x0101;
    pub const OPEN_RESP: u16 = 0x0102;
    pub const CLOSE_REQ: u16 = 0x0201;
    pub const CLOSE_RESP: u16 = 0x0202;
    pub const VAR_REQ: u16 = 0x2101;
    pub const VAR_RESP: u16 = 0x2102;
}

/// The payload of an open request. pyfanuc sends `00 02` on the main
/// channel and `00 01` on the second channel it uses for file
/// transfer.
pub const OPEN_PAYLOAD: [u8; 2] = [0x00, 0x02];

/// Command codes, the third field of a sub-request.
pub mod cmd {
    pub const READ_PARAM: u16 = 0x000e;
    pub const READ_MACRO: u16 = 0x0015;
    pub const SYSINFO: u16 = 0x0018;
    pub const STATINFO: u16 = 0x0019;
    pub const ALARM: u16 = 0x001a;
    pub const PROGNUM: u16 = 0x001c;
    pub const ACT_FEED: u16 = 0x0024;
    pub const ACT_SPINDLE: u16 = 0x0025;
    pub const POSITION: u16 = 0x0026;
    /// PMC reads use class 2 instead of 1, see [`super::Request::pmc`].
    pub const READ_PMC: u16 = 0x8001;
}

/// Error codes a control puts in a response element. These are the
/// `EW_` return codes of FANUC's own library; only the ones the fake
/// CNC sends are named.
pub mod ew {
    pub const FUNC: i16 = 1;
    pub const LENGTH: i16 = 2;
    pub const NUMBER: i16 = 3;
    pub const ATTRIB: i16 = 4;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub version: u16,
    pub ftype: u16,
    pub payload: Bytes,
}

/// Why bytes could not be read as FOCAS.
#[derive(Debug)]
pub enum ProtoError {
    Io(std::io::Error),
    BadMagic([u8; 4]),
    /// The frame or element is shorter than its fields need.
    Short(&'static str),
    /// A response frame of the wrong type.
    UnexpectedFrame(u16),
    /// A response that does not answer the request sent.
    Mismatch(&'static str),
}

impl std::fmt::Display for ProtoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "{e}"),
            Self::BadMagic(m) => write!(f, "bad frame magic {m:02x?}"),
            Self::Short(what) => write!(f, "{what} too short"),
            Self::UnexpectedFrame(t) => write!(f, "unexpected frame type {t:#06x}"),
            Self::Mismatch(what) => write!(f, "response does not match request: {what}"),
        }
    }
}

impl std::error::Error for ProtoError {}

impl From<std::io::Error> for ProtoError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

/// Encode a whole frame, header and payload.
pub fn encode_frame(ftype: u16, payload: &[u8]) -> Bytes {
    let mut buf = BytesMut::with_capacity(HEADER_LEN + payload.len());
    buf.put_slice(&MAGIC);
    buf.put_u16(1);
    buf.put_u16(ftype);
    buf.put_u16(payload.len() as u16);
    buf.put_slice(payload);
    buf.freeze()
}

/// Read exactly one frame. pyfanuc assumes a frame arrives in one TCP
/// read; this reads the header and then exactly the length it gives.
pub async fn read_frame<R: AsyncRead + Unpin>(r: &mut R) -> Result<Frame, ProtoError> {
    let mut head = [0u8; HEADER_LEN];
    r.read_exact(&mut head).await?;
    let magic: [u8; 4] = head[0..4].try_into().unwrap();
    if magic != MAGIC {
        return Err(ProtoError::BadMagic(magic));
    }
    let version = u16::from_be_bytes([head[4], head[5]]);
    let ftype = u16::from_be_bytes([head[6], head[7]]);
    let len = u16::from_be_bytes([head[8], head[9]]) as usize;
    let mut payload = vec![0u8; len];
    r.read_exact(&mut payload).await?;
    Ok(Frame {
        version,
        ftype,
        payload: payload.into(),
    })
}

/// One sub-request: a three-part command and five arguments, whose
/// meaning depends on the command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Request {
    pub class: u16,
    pub sub: u16,
    pub cmd: u16,
    pub args: [i32; 5],
}

impl Request {
    /// An ordinary CNC read, class 1.
    pub const fn cnc(cmd: u16, args: [i32; 5]) -> Self {
        Self {
            class: 1,
            sub: 1,
            cmd,
            args,
        }
    }

    /// A PMC read, class 2. `area` is the address letter's code (see
    /// [`crate::addr::PmcArea`]), `size_code` is 0 for bytes, 1 for
    /// words and 2 for longs, and `first` is the byte address.
    pub const fn pmc(area: i32, size_code: i32, first: i32) -> Self {
        let last = first + (1 << size_code) - 1;
        Self {
            class: 2,
            sub: 1,
            cmd: cmd::READ_PMC,
            args: [first, last, area, size_code, 0],
        }
    }

    const LEN: usize = 26;

    fn put(&self, buf: &mut BytesMut) {
        buf.put_u16(self.class);
        buf.put_u16(self.sub);
        buf.put_u16(self.cmd);
        for a in self.args {
            buf.put_i32(a);
        }
    }
}

/// Encode the payload of a `VAR` request frame.
pub fn encode_requests(reqs: &[Request]) -> Bytes {
    let mut buf = BytesMut::with_capacity(2 + reqs.len() * (2 + Request::LEN));
    buf.put_u16(reqs.len() as u16);
    for r in reqs {
        // The length counts its own two bytes.
        buf.put_u16((Request::LEN + 2) as u16);
        r.put(&mut buf);
    }
    buf.freeze()
}

/// Decode the payload of a `VAR` request frame. Used by the fake CNC.
/// Any bytes after the five arguments, which some writes carry, are
/// ignored.
pub fn decode_requests(mut p: Bytes) -> Result<Vec<Request>, ProtoError> {
    if p.len() < 2 {
        return Err(ProtoError::Short("request payload"));
    }
    let n = p.get_u16() as usize;
    let mut out = Vec::with_capacity(n);
    for _ in 0..n {
        if p.len() < 2 {
            return Err(ProtoError::Short("request"));
        }
        let len = p.get_u16() as usize;
        if len < Request::LEN + 2 || p.len() < len - 2 {
            return Err(ProtoError::Short("request"));
        }
        let mut el = p.split_to(len - 2);
        let class = el.get_u16();
        let sub = el.get_u16();
        let cmd = el.get_u16();
        let mut args = [0i32; 5];
        for a in &mut args {
            *a = el.get_i32();
        }
        out.push(Request {
            class,
            sub,
            cmd,
            args,
        });
    }
    Ok(out)
}

/// The answer to one sub-request: the data, or the control's error
/// code.
pub type Answer = Result<Bytes, i16>;

/// Encode the payload of a `VAR` response frame. Used by the fake CNC.
///
/// Each element echoes the request's three command fields, then six
/// status bytes (an `i16` error code and four bytes that are zero in
/// every capture pyfanuc decodes), then a `u16` data length and the
/// data.
pub fn encode_responses(answers: &[(Request, Answer)]) -> Bytes {
    let mut buf = BytesMut::new();
    buf.put_u16(answers.len() as u16);
    for (req, ans) in answers {
        let data: &[u8] = match ans {
            Ok(d) => d,
            Err(_) => &[],
        };
        buf.put_u16((2 + 6 + 6 + 2 + data.len()) as u16);
        buf.put_u16(req.class);
        buf.put_u16(req.sub);
        buf.put_u16(req.cmd);
        buf.put_i16(*ans.as_ref().err().unwrap_or(&0));
        buf.put_u32(0);
        buf.put_u16(data.len() as u16);
        buf.put_slice(data);
    }
    buf.freeze()
}

/// Decode the payload of a `VAR` response frame and match it to the
/// requests that were sent.
pub fn decode_responses(mut p: Bytes, reqs: &[Request]) -> Result<Vec<Answer>, ProtoError> {
    if p.len() < 2 {
        return Err(ProtoError::Short("response payload"));
    }
    let n = p.get_u16() as usize;
    if n != reqs.len() {
        return Err(ProtoError::Mismatch("element count"));
    }
    let mut out = Vec::with_capacity(n);
    for req in reqs {
        if p.len() < 2 {
            return Err(ProtoError::Short("response"));
        }
        let len = p.get_u16() as usize;
        if len < 2 + 12 || p.len() < len - 2 {
            return Err(ProtoError::Short("response element"));
        }
        let mut el = p.split_to(len - 2);
        if el.get_u16() != req.class || el.get_u16() != req.sub || el.get_u16() != req.cmd {
            return Err(ProtoError::Mismatch("command echo"));
        }
        let status = el.split_to(6);
        if status.iter().any(|&b| b != 0) {
            // pyfanuc counts any non-zero status byte as a failure and
            // reads the code from the first two.
            let code = i16::from_be_bytes([status[0], status[1]]);
            out.push(Err(if code == 0 { -1 } else { code }));
            continue;
        }
        if el.len() < 2 {
            out.push(Ok(Bytes::new()));
            continue;
        }
        let dlen = el.get_u16() as usize;
        if el.len() < dlen {
            return Err(ProtoError::Short("response data"));
        }
        out.push(Ok(el.split_to(dlen)));
    }
    Ok(out)
}

/// FOCAS sends positions, speeds and macro variables as eight bytes:
/// an `i32` mantissa, a `u16` radix (10, or 2 for binary) and an `i16`
/// exponent, so the value is `mantissa / radix^exponent`.
///
/// FANUC's `cnc_rdmacro` documentation gives the exponent as signed,
/// from -128 to 127, and marks an empty ("vacant") macro variable
/// with an exponent of -1. pyfanuc uses the same -1 (`ff ff`) for an
/// axis that is not there, so -1 always means no value.
pub fn decode_real(b: &[u8]) -> Option<f64> {
    if b.len() < 8 {
        return None;
    }
    let mantissa = i32::from_be_bytes(b[0..4].try_into().unwrap());
    let radix = u16::from_be_bytes([b[4], b[5]]);
    let exponent = i16::from_be_bytes([b[6], b[7]]);
    if exponent == -1 || !(radix == 10 || radix == 2) {
        return None;
    }
    Some(mantissa as f64 / (radix as f64).powi(exponent as i32))
}

/// Encode a value in the eight-byte format with `places` decimal
/// places, or as empty for `None`. Used by the fake CNC.
pub fn encode_real(v: Option<f64>, places: u16, buf: &mut BytesMut) {
    match v {
        Some(v) => {
            buf.put_i32((v * 10f64.powi(places as i32)).round() as i32);
            buf.put_u16(10);
            buf.put_u16(places);
        }
        None => {
            buf.put_i32(0);
            buf.put_u16(10);
            buf.put_u16(0xffff);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// pyfanuc's own example: the sysinfo request, byte for byte.
    #[test]
    fn sysinfo_request_matches_pyfanuc() {
        let payload = encode_requests(&[Request::cnc(cmd::SYSINFO, [0; 5])]);
        let frame = encode_frame(ftype::VAR_REQ, &payload);
        let mut want = vec![
            0xa0, 0xa0, 0xa0, 0xa0, 0x00, 0x01, 0x21, 0x01, 0x00, 0x1e, 0x00, 0x01, 0x00, 0x1c,
            0x00, 0x01, 0x00, 0x01, 0x00, 0x18,
        ];
        want.extend([0u8; 20]);
        assert_eq!(&frame[..], &want[..]);
    }

    #[test]
    fn open_and_close_match_pyfanuc() {
        assert_eq!(
            &encode_frame(ftype::OPEN_REQ, &OPEN_PAYLOAD)[..],
            &[0xa0, 0xa0, 0xa0, 0xa0, 0, 1, 1, 1, 0, 2, 0, 2]
        );
        assert_eq!(
            &encode_frame(ftype::CLOSE_REQ, &[])[..],
            &[0xa0, 0xa0, 0xa0, 0xa0, 0, 1, 2, 1, 0, 0]
        );
    }

    #[test]
    fn pmc_request_range() {
        let r = Request::pmc(5, 1, 100);
        assert_eq!((r.class, r.cmd), (2, cmd::READ_PMC));
        assert_eq!(r.args, [100, 101, 5, 1, 0]);
    }

    #[test]
    fn requests_round_trip() {
        let reqs = [
            Request::cnc(cmd::POSITION, [4, -1, 0, 0, 0]),
            Request::pmc(9, 2, 8),
        ];
        assert_eq!(decode_requests(encode_requests(&reqs)).unwrap(), reqs);
    }

    #[test]
    fn responses_round_trip() {
        let a = Request::cnc(cmd::ALARM, [0; 5]);
        let b = Request::cnc(cmd::READ_MACRO, [9999, 9999, 0, 0, 0]);
        let enc = encode_responses(&[
            (a, Ok(Bytes::from_static(&[0, 0, 0, 5]))),
            (b, Err(ew::NUMBER)),
        ]);
        let dec = decode_responses(enc, &[a, b]).unwrap();
        assert_eq!(dec[0].as_deref().unwrap(), &[0, 0, 0, 5]);
        assert_eq!(dec[1], Err(ew::NUMBER));
    }

    #[test]
    fn response_echo_must_match() {
        let a = Request::cnc(cmd::ALARM, [0; 5]);
        let b = Request::cnc(cmd::PROGNUM, [0; 5]);
        let enc = encode_responses(&[(a, Ok(Bytes::new()))]);
        assert!(decode_responses(enc, &[b]).is_err());
    }

    #[test]
    fn real_numbers() {
        // pyfanuc's example: 12345 with 3 places is 12.345.
        let b = [0, 0, 0x30, 0x39, 0, 10, 0, 3];
        assert_eq!(decode_real(&b), Some(12.345));
        assert_eq!(decode_real(&[0, 0, 0, 1, 0, 2, 0, 1]), Some(0.5));
        assert_eq!(decode_real(&[0, 0, 0, 0, 0, 10, 0xff, 0xff]), None);
        assert_eq!(decode_real(&[0, 0, 0, 0, 0, 7, 0, 0]), None);

        // FANUC's example: 12.345 as a nine-digit mantissa and 7 places.
        let b = [0x07, 0x5b, 0xb2, 0x90, 0, 10, 0, 7];
        assert_eq!(i32::from_be_bytes(b[0..4].try_into().unwrap()), 123_450_000);
        assert!((decode_real(&b).unwrap() - 12.345).abs() < 1e-12);

        // A negative exponent other than -1 multiplies: 3 * 2^2.
        assert_eq!(decode_real(&[0, 0, 0, 3, 0, 2, 0xff, 0xfe]), Some(12.0));

        let mut buf = BytesMut::new();
        encode_real(Some(-1.5), 4, &mut buf);
        assert_eq!(decode_real(&buf), Some(-1.5));
    }
}

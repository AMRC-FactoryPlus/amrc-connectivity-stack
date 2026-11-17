// ACS REST driver
// Addresses: a path after the base URL, optionally with a page counter
// Copyright 2026 University of Sheffield

//! An address is the part of the URL after the connection's `baseURL`,
//! for example `/api/status`. The driver GETs `baseURL + address`, the
//! two strings joined with nothing added, as the built-in connection
//! does.
//!
//! An address may carry a page counter, `${n:m}`, which the built-in
//! connection found with the JS regex `/\${(\d):(\w)}/`: one digit to
//! start from and one word character to stop before. A digit stops
//! the pages before that number, and a letter or `_` means no stop
//! number. The pages are fetched by replacing, as the built-in's
//! `/\${.+}/g` does, everything from the first `${` to the last `}`
//! with the page number. Anything else that looks like a counter, such
//! as `${10:20}`, is not one and is sent as it is.

/// A parsed address.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Addr {
    raw: String,
    paging: Option<Paging>,
}

/// The page counter in an address.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Paging {
    /// The address before the first `${`.
    prefix: String,
    /// The address after the last `}`.
    suffix: String,
    /// The first page number.
    pub start: u32,
    /// The page number to stop before, or `None` for no stop number.
    pub stop: Option<u32>,
}

impl Addr {
    /// Parse an address. Every string is a valid address, because the
    /// built-in connection sent any address it was given.
    pub fn parse(raw: &str) -> Self {
        Self {
            raw: raw.to_owned(),
            paging: Paging::find(raw),
        }
    }

    /// The address as the Edge Agent sent it.
    pub fn raw(&self) -> &str {
        &self.raw
    }

    /// The page counter, if the address has one.
    pub fn paging(&self) -> Option<&Paging> {
        self.paging.as_ref()
    }
}

impl Paging {
    /// Find a counter as the built-in's regex did, and the span its
    /// replacement covered.
    fn find(raw: &str) -> Option<Self> {
        // JS `.` does not match line ends, so `${.+}` can't span one.
        // No URL path holds one, so an address that does is simply not
        // paged rather than reproducing the exact match.
        if raw.contains(['\n', '\r', '\u{2028}', '\u{2029}']) {
            return None;
        }
        let b = raw.as_bytes();
        let at = (0..b.len().saturating_sub(5)).find(|&i| {
            b[i] == b'$'
                && b[i + 1] == b'{'
                && b[i + 2].is_ascii_digit()
                && b[i + 3] == b':'
                && (b[i + 4].is_ascii_alphanumeric() || b[i + 4] == b'_')
                && b[i + 5] == b'}'
        })?;
        let start = u32::from(b[at + 2] - b'0');
        let stop = b[at + 4]
            .is_ascii_digit()
            .then(|| u32::from(b[at + 4] - b'0'));

        // `${` at `at` and `}` at `at + 5` exist, so the first `${` is
        // at or before `at` and the last `}` at or after `at + 5`.
        let open = raw.find("${")?;
        let close = raw.rfind('}')?;
        Some(Self {
            prefix: raw[..open].to_owned(),
            suffix: raw[close + 1..].to_owned(),
            start,
            stop,
        })
    }

    /// The address of page `n`.
    pub fn page(&self, n: u32) -> String {
        format!("{}{n}{}", self.prefix, self.suffix)
    }
}

/// The URL for an address: the base URL and the address joined as
/// strings, as the built-in connection did. `baseURL` `http://h/api`
/// and address `/x` give `http://h/api/x`, and a trailing `/` on the
/// base and a leading one on the address give `//`.
pub fn url(base: &str, address: &str) -> String {
    format!("{base}{address}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_addresses_have_no_paging() {
        for a in ["", "/status", "/a?b=c&d=e", "/p/${x}", "/p/{0:5}", "$"] {
            let addr = Addr::parse(a);
            assert_eq!(addr.raw(), a);
            assert_eq!(addr.paging(), None, "{a}");
        }
    }

    #[test]
    fn url_joins_base_and_address_as_strings() {
        assert_eq!(
            url("http://h:8080/api", "/x?y=1"),
            "http://h:8080/api/x?y=1"
        );
        assert_eq!(url("http://h/", "/x"), "http://h//x");
        assert_eq!(url("http://h", "x"), "http://hx");
        assert_eq!(url("http://h/x", ""), "http://h/x");
    }

    #[test]
    fn a_digit_stop_bounds_the_pages() {
        let addr = Addr::parse("/p/${0:5}/items");
        let p = addr.paging().unwrap();
        assert_eq!((p.start, p.stop), (0, Some(5)));
        assert_eq!(p.page(0), "/p/0/items");
        assert_eq!(p.page(12), "/p/12/items");
    }

    #[test]
    fn a_word_stop_means_no_stop_number() {
        for a in ["/p?page=${1:n}", "/p?page=${1:_}", "/p?page=${1:Z}"] {
            let p = Addr::parse(a).paging().cloned().unwrap();
            assert_eq!((p.start, p.stop), (1, None), "{a}");
            assert_eq!(p.page(3), "/p?page=3");
        }
    }

    /// Only one digit and one word character, as the regex had.
    #[test]
    fn longer_counters_are_not_counters() {
        for a in [
            "/p/${10:5}",
            "/p/${1:10}",
            "/p/${a:5}",
            "/p/${1-5}",
            "/p/${1:é}",
        ] {
            assert_eq!(Addr::parse(a).paging(), None, "{a}");
        }
    }

    /// The replacement runs from the first `${` to the last `}`, as
    /// `/\${.+}/g` does.
    #[test]
    fn the_replacement_spans_first_open_to_last_close() {
        let p = Addr::parse("/a${x}/b/${0:3}/c}d")
            .paging()
            .cloned()
            .unwrap();
        assert_eq!(p.page(2), "/a2d");
        let p = Addr::parse("/a/${0:3}${1:2}/b").paging().cloned().unwrap();
        assert_eq!((p.start, p.stop), (0, Some(3)));
        assert_eq!(p.page(7), "/a/7/b");
    }

    #[test]
    fn line_ends_turn_paging_off() {
        assert_eq!(Addr::parse("/p/${0:5}\n").paging(), None);
    }
}

// A directory module. Its own children live beside it, not under a
// `store/store/` directory, because this file IS `mod.rs`.
mod row;

pub use self::row::Row;

use super::util::trim;

pub fn first(s: &str) -> String { trim(s) }

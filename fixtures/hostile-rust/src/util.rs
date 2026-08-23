// A non-mod.rs file, so any child module of THIS one would live under `util/`.
use self::helpers::squeeze;

mod helpers;

pub fn trim(s: &str) -> String { squeeze(s) }

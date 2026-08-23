//! The crate root. `mod` here declares modules as sibling files or directories.
//!
//! use crate::never::Extracted;

mod store;
pub mod util;

/* mod also_not_extracted; */

use std::collections::HashMap;
use crate::store::Row;

// A raw string holding what reads exactly like a use.
pub const SAMPLE: &str = r#"
use crate::in_a::RawString;
"#;

pub struct Widget {
    pub rows: HashMap<String, Row>,
}

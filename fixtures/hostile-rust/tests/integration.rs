// An integration test: its own crate, so it names the library by crate name.
use widget::Widget;
use serde::Serialize;

#[test]
fn builds() { let _ = Widget { rows: Default::default() }; }

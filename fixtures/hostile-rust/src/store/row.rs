// An inline module declares no file, so `mod` here must not resolve to one.
mod inner {
    pub const N: usize = 1;
}

pub struct Row(pub String);

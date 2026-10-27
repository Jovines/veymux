//! Product identity is selected by the release build, never by a service page.
pub fn is_preview() -> bool {
    option_env!("VEYMUX_DESKTOP_CHANNEL") == Some("preview")
}
pub fn name() -> &'static str {
    if is_preview() { "Veymux Preview" } else { "Veymux" }
}
pub fn identifier() -> &'static str {
    if is_preview() { "com.jovines.veymux.preview" } else { "com.jovines.veymux" }
}

fn main() {
    if veymux_preview::clipboard_helper_entry() {
        return;
    }
    veymux_preview::run();
}

// Prevents a console window appearing on Windows release builds. macOS
// ignores the attribute but it's harmless.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mashi_helper_lib::run();
}

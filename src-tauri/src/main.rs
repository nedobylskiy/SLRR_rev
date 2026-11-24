// Release builds are a GUI application without a console window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    slrr_standalone_lib::run()
}

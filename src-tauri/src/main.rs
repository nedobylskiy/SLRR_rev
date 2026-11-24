// A GUI application in every build: no console window opens beside the game,
// debug builds included. Java and page logs are in the in-game console (`).
#![windows_subsystem = "windows"]

fn main() {
    slrr_standalone_lib::run()
}

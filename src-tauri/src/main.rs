// 윈도우에서 앱을 켤 때 검은 명령 창이 함께 뜨지 않게 해요.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    gilog_lib::run()
}

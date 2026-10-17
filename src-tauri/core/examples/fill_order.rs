//! 지시부 채우기 시험: cargo run --example fill_order -- 양식 결과 '{"text":{..},"images":{..}}'
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let fill: gilog_core::OrderFill = serde_json::from_str(&a[3]).unwrap();
    let r = gilog_core::fill_order(a[1].as_ref(), a[2].as_ref(), &fill).unwrap();
    println!("없는 자리: {:?}", r.missing);
}

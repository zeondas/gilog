// 파주시 도로명주소 ↔ 지번 표(data/paju_roadaddr.txt, 2.8MB)를 압축해 앱에 넣어요(약 400KB).
// 읽기는 address.rs가 처음 쓸 때 한 번 풀어 메모리에 색인해요.
use std::io::Write;
use std::path::PathBuf;

fn main() {
    let src = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("../../data/paju_roadaddr.txt");
    println!("cargo:rerun-if-changed={}", src.display());
    let text = std::fs::read(&src).unwrap_or_default();
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("roadaddr.zip");
    let file = std::fs::File::create(&out).expect("roadaddr.zip");
    let mut zip = zip::ZipWriter::new(file);
    let opt = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(9));
    zip.start_file("paju_roadaddr.txt", opt).expect("zip");
    zip.write_all(&text).expect("zip");
    zip.finish().expect("zip");
}

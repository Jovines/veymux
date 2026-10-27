#[path = "../build/runtime_icon.rs"]
mod runtime_icon;
use sha2::{Digest, Sha256};
use std::{fs, io::Cursor, path::Path};
#[test]
fn actual_pwa_icon_becomes_exact_rgba8_without_changing_stable_asset() {
    let input = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../public/pwa-512x512.png");
    let original = fs::read(&input).unwrap();
    let digest = Sha256::digest(&original);
    let mut decoder = png::Decoder::new(Cursor::new(&original));
    decoder.set_transformations(png::Transformations::STRIP_16 | png::Transformations::EXPAND);
    let mut original_reader = decoder.read_info().unwrap();
    let mut raw = vec![0; original_reader.output_buffer_size()];
    let original_frame = original_reader.next_frame(&mut raw).unwrap();
    assert_eq!(original_frame.buffer_size(), 512 * 512 * 4);
    let dir = tempfile::tempdir().unwrap();
    let output = dir.path().join("icon.png");
    runtime_icon::generate(&input, &output).unwrap();
    let encoded = fs::read(&output).unwrap();
    let mut reader = png::Decoder::new(Cursor::new(&encoded))
        .read_info()
        .unwrap();
    assert_eq!(reader.info().bit_depth, png::BitDepth::Eight);
    assert_eq!(reader.info().color_type, png::ColorType::Rgba);
    let mut pixels = vec![0; reader.output_buffer_size()];
    let frame = reader.next_frame(&mut pixels).unwrap();
    assert_eq!((frame.width, frame.height), (512, 512));
    assert_eq!(
        frame.buffer_size(),
        frame.width as usize * frame.height as usize * 4
    );
    assert_eq!(pixels, raw);
    assert_eq!(Sha256::digest(fs::read(input).unwrap()), digest);
    assert!(runtime_icon::rgba8(b"invalid PNG").is_err());
}

#[test]
fn strips_16bit_samples_to_their_high_bytes() {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Sixteen);
        encoder.write_header().unwrap().write_image_data(&[1, 2, 3, 4, 5, 6, 255, 254]).unwrap();
    }
    let (width, height, pixels) = runtime_icon::rgba8(&bytes).unwrap();
    assert_eq!((width, height), (1, 1));
    assert_eq!(pixels, [1, 3, 5, 255]);
}

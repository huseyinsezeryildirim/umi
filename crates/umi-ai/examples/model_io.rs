//! Prints a model's inputs and outputs (downloading it if needed).
//! cargo run -p umi-ai --example model_io -- segmentation|face
use umi_ai::models::Model;
fn main() {
    let model = match std::env::args().nth(1).as_deref() {
        Some("face") => Model::FaceDetection,
        _ => Model::Segmentation,
    };
    let path = model.ensure(&|_| {}).unwrap();
    println!("{} ({} bytes)", path.display(), std::fs::metadata(&path).unwrap().len());
    let session = umi_ai::onnx::session(&path).unwrap();
    for i in session.inputs() {
        println!("in  {} {:?}", i.name(), i.dtype());
    }
    for o in session.outputs() {
        println!("out {} {:?}", o.name(), o.dtype());
    }
}

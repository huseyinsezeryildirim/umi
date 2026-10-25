//! Puts already-encoded streams into one file without re-encoding: e.g. a video-only and
//! an audio-only download (HLS renditions) into an MP4.

use crate::{MediaError, init};
use ffmpeg_next as ff;
use std::path::Path;

/// Copies the first video stream and the first audio stream found in `inputs` into
/// `output` (container from its extension), interleaved by time.
pub fn remux(inputs: &[&Path], output: &Path) -> Result<(), MediaError> {
    init();
    let mut opened = inputs.iter().map(|p| ff::format::input(p).map_err(|e| MediaError::open(p, e))).collect::<Result<Vec<_>, _>>()?;
    let mut out = ff::format::output(output).map_err(|e| MediaError::open(output, e))?;

    // (input, stream index) → output stream, for the first video and the first audio.
    let mut routes: Vec<(usize, usize, usize, ff::Rational)> = vec![];
    for kind in [ff::media::Type::Video, ff::media::Type::Audio] {
        let found = opened.iter().enumerate().find_map(|(i, input)| input.streams().best(kind).map(|s| (i, s.index())));
        let Some((i, index)) = found else { continue };
        let stream = opened[i].stream(index).ok_or_else(|| MediaError::NoVideo(inputs[i].into()))?;
        let mut target = out.add_stream(ff::encoder::find(ff::codec::Id::None))?;
        target.set_parameters(stream.parameters());
        // The container picks its own tag (TS and MP4 tag codecs differently).
        // SAFETY: plain field write on the stream's own codec parameters.
        #[allow(unsafe_code)]
        unsafe {
            (*target.parameters().as_mut_ptr()).codec_tag = 0;
        }
        routes.push((i, index, target.index(), stream.time_base()));
    }
    if !routes.iter().any(|r| opened[r.0].stream(r.1).is_some_and(|s| s.parameters().medium() == ff::media::Type::Video)) {
        return Err(MediaError::NoVideo(inputs.first().map(|p| p.to_path_buf()).unwrap_or_default()));
    }
    out.write_header()?;
    let out_tb: Vec<ff::Rational> = routes.iter().map(|r| out.stream(r.2).map(|s| s.time_base()).unwrap_or(r.3)).collect();

    // One pending packet per input; always write the earliest.
    let mut pending: Vec<Option<(usize, ff::Packet)>> = vec![None; opened.len()];
    let mut finished = vec![false; opened.len()];
    loop {
        for (i, input) in opened.iter_mut().enumerate() {
            while pending[i].is_none() && !finished[i] {
                match input.packets().next() {
                    Some((stream, packet)) => {
                        if let Some(r) = routes.iter().position(|r| r.0 == i && r.1 == stream.index()) {
                            pending[i] = Some((r, packet));
                        }
                    }
                    None => finished[i] = true,
                }
            }
        }
        let seconds = |r: usize, p: &ff::Packet| {
            let ts = p.dts().or(p.pts()).unwrap_or(0);
            ts as f64 * f64::from(routes[r].3)
        };
        let next = pending
            .iter()
            .enumerate()
            .filter_map(|(i, p)| p.as_ref().map(|(r, packet)| (i, seconds(*r, packet))))
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(i, _)| i);
        let Some(i) = next else { break };
        let (r, mut packet) = pending[i].take().unwrap_or_else(|| unreachable!());
        packet.rescale_ts(routes[r].3, out_tb[r]);
        packet.set_stream(routes[r].2);
        packet.set_position(-1);
        packet.write_interleaved(&mut out)?;
    }
    out.write_trailer()?;
    Ok(())
}

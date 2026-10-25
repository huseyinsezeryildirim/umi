//! The editor session in the browser. No wasm-bindgen: JavaScript writes a JSON request into
//! memory it got from [`umi_alloc`], calls [`umi_call`], and reads the JSON answer at the
//! returned pointer ([`umi_result_len`] bytes). Randomness (new ids) comes from the page's
//! `crypto.getRandomValues` through the imported `umi_random`.
#![allow(unsafe_code)]

use serde::Deserialize;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::HashMap;
use umi_editor::{Media, Op, Session};
use umi_project::edit::{CaptionWord, EditSettings};
use umi_project::{CursorData, Document, RecordingProject, Selection};

struct Open {
    session: Session,
    name: String,
}

thread_local! {
    static SESSIONS: RefCell<HashMap<u32, Open>> = RefCell::new(HashMap::new());
    static NEXT: RefCell<u32> = const { RefCell::new(1) };
    static RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Silences measured by the page (it has the audio); durations come with the operation.
struct PageMedia(Vec<(f64, f64)>);
impl Media for PageMedia {
    fn duration(&self, _: &str) -> Option<f64> {
        None
    }
    fn silences(&self, min: f64) -> Vec<(f64, f64)> {
        self.0.iter().copied().filter(|(a, b)| b - a >= min).collect()
    }
}

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum Request {
    /// Opens a recording: its project.json, cursor.json (optional) and the screen video's length.
    Open { name: String, project: Box<RecordingProject>, cursor: Option<CursorData>, media_duration: f64 },
    State { session: u32, selection: Option<Selection> },
    Apply { session: u32, op: Box<Op>, silences: Option<Vec<(f64, f64)>> },
    /// Puts transcribed words in the captions (turned on) and names the recording from them.
    SetWords { session: u32, words: Vec<Word>, language: String },
    Insights { session: u32 },
    Subtitles { session: u32, vtt: bool },
    /// The project as it should be saved (project.json with the edit inside).
    Project { session: u32 },
    Close { session: u32 },
}

#[derive(Deserialize)]
struct Word {
    start: f64,
    end: f64,
    text: String,
}

fn handle(req: Request) -> Result<Value, String> {
    let with = |id: u32, f: &mut dyn FnMut(&mut Open) -> Result<Value, String>| {
        SESSIONS.with(|s| s.borrow_mut().get_mut(&id).map(f).unwrap_or_else(|| Err("No such editor.".into())))
    };
    let state = |o: &Open, id: u32, sel: Option<Selection>| serde_json::to_value(o.session.state(&id.to_string(), o.name.clone(), o.name.clone().into(), sel)).map_err(|e| e.to_string());
    match req {
        Request::Open { name, project, cursor, media_duration } => {
            let edit: EditSettings = project.effective_edit(None);
            let doc = Document::new(*project, edit, cursor.unwrap_or_default(), media_duration);
            let id = NEXT.with(|n| {
                let mut n = n.borrow_mut();
                *n += 1;
                *n - 1
            });
            let open = Open { session: Session::new(doc), name };
            let out = state(&open, id, None)?;
            SESSIONS.with(|s| s.borrow_mut().insert(id, open));
            Ok(out)
        }
        Request::State { session, selection } => with(session, &mut |o| state(o, session, selection)),
        Request::Apply { session, op, silences } => {
            let mut op = Some(*op);
            with(session, &mut |o| {
                let op = op.take().ok_or("used")?;
                let sel = o.session.apply(op, &PageMedia(silences.clone().unwrap_or_default()));
                state(o, session, sel)
            })
        }
        Request::SetWords { session, words, language } => with(session, &mut |o| {
            let mut edit = o.session.doc.edit.clone();
            edit.captions.words = words.iter().map(|w| CaptionWord { id: uuid::Uuid::new_v4(), start: w.start, end: w.end, text: w.text.clone() }).collect();
            edit.captions.language = language.clone();
            edit.captions.enabled = true;
            if let Some(found) = umi_project::insights::insights(&edit.captions.words) {
                if o.session.doc.project.suggest_title(&found.title) {
                    o.session.dirty = true;
                }
            }
            let sel = o.session.apply(Op::SetEdit { edit: Box::new(edit) }, &PageMedia(Vec::new()));
            state(o, session, sel)
        }),
        Request::Insights { session } => with(session, &mut |o| {
            let doc = &o.session.doc;
            Ok(match umi_project::insights::insights(&doc.edit.captions.words) {
                None => Value::Null,
                Some(mut found) => {
                    found.chapters.retain(|c| doc.output_time(c.start).is_some() || c.start == 0.0);
                    let text = umi_project::insights::chapter_text(&found.chapters, |t| doc.output_time(t));
                    json!({ "title": found.title, "summary": found.summary, "chapters": found.chapters, "chapterText": text })
                }
            })
        }),
        Request::Subtitles { session, vtt } => with(session, &mut |o| {
            let format = if vtt { umi_project::captions::SubtitleFormat::Vtt } else { umi_project::captions::SubtitleFormat::Srt };
            Ok(Value::String(umi_project::captions::subtitles(&o.session.doc, format)))
        }),
        Request::Project { session } => with(session, &mut |o| {
            let mut project = o.session.doc.project.clone();
            project.edit = Some(o.session.doc.edit.clone());
            o.session.dirty = false;
            serde_json::to_value(&project).map_err(|e| e.to_string())
        }),
        Request::Close { session } => {
            SESSIONS.with(|s| s.borrow_mut().remove(&session));
            Ok(Value::Null)
        }
    }
}

/// Memory for a request of `len` bytes.
#[unsafe(no_mangle)]
pub extern "C" fn umi_alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len.max(1));
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Gives back memory from [`umi_alloc`].
///
/// # Safety
/// `ptr` and `len` must come from one `umi_alloc` call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn umi_free(ptr: *mut u8, len: usize) {
    unsafe { drop(Vec::from_raw_parts(ptr, 0, len.max(1))) };
}

/// Runs a JSON request; returns a pointer to the JSON answer `{"ok":…}` or `{"error":"…"}`.
///
/// # Safety
/// `ptr`/`len` must be a request written into memory from [`umi_alloc`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn umi_call(ptr: *const u8, len: usize) -> *const u8 {
    let input = unsafe { std::slice::from_raw_parts(ptr, len) };
    let answer = match serde_json::from_slice::<Request>(input) {
        Ok(req) => match handle(req) {
            Ok(v) => json!({ "ok": v }),
            Err(e) => json!({ "error": e }),
        },
        Err(e) => json!({ "error": format!("Bad request: {e}") }),
    };
    RESULT.with(|r| {
        let mut r = r.borrow_mut();
        *r = serde_json::to_vec(&answer).unwrap_or_default();
        r.as_ptr()
    })
}

/// Length of the last answer.
#[unsafe(no_mangle)]
pub extern "C" fn umi_result_len() -> usize {
    RESULT.with(|r| r.borrow().len())
}

#[cfg(target_arch = "wasm32")]
mod random {
    #[link(wasm_import_module = "env")]
    unsafe extern "C" {
        fn umi_random(ptr: *mut u8, len: usize);
    }

    /// getrandom's custom backend (new ids): the page's crypto.getRandomValues.
    #[unsafe(no_mangle)]
    unsafe extern "Rust" fn __getrandom_v03_custom(dest: *mut u8, len: usize) -> Result<(), getrandom::Error> {
        unsafe { umi_random(dest, len) };
        Ok(())
    }
}

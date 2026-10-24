//! Undo/redo of edits by snapshot, with gesture grouping: a whole slider drag or timeline
//! drag is one undo step.

use crate::edit::EditSettings;

#[derive(Debug, Default)]
pub struct History {
    undo: Vec<EditSettings>,
    redo: Vec<EditSettings>,
    gesture: Option<EditSettings>,
    limit: usize,
}

impl History {
    pub fn new(limit: usize) -> Self {
        Self { limit, ..Default::default() }
    }

    /// Call after a change: `before` is the edit as it was. Ignored during a gesture.
    pub fn record(&mut self, before: &EditSettings, after: &EditSettings) {
        if self.gesture.is_some() || before == after {
            return;
        }
        self.push(before.clone());
    }

    pub fn begin_gesture(&mut self, current: &EditSettings) {
        if self.gesture.is_none() {
            self.gesture = Some(current.clone());
        }
    }

    pub fn end_gesture(&mut self, current: &EditSettings) {
        if let Some(start) = self.gesture.take()
            && &start != current
        {
            self.push(start);
        }
    }

    pub fn in_gesture(&self) -> bool {
        self.gesture.is_some()
    }

    fn push(&mut self, snapshot: EditSettings) {
        self.undo.push(snapshot);
        if self.limit > 0 && self.undo.len() > self.limit {
            self.undo.remove(0);
        }
        self.redo.clear();
    }

    pub fn undo(&mut self, current: &EditSettings) -> Option<EditSettings> {
        let previous = self.undo.pop()?;
        self.redo.push(current.clone());
        Some(previous)
    }

    pub fn redo(&mut self, current: &EditSettings) -> Option<EditSettings> {
        let next = self.redo.pop()?;
        self.undo.push(current.clone());
        Some(next)
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gesture_is_one_step() {
        let mut h = History::new(100);
        let a = EditSettings::default();
        let mut b = a.clone();
        h.begin_gesture(&a);
        b.padding = 0.1;
        h.record(&a, &b);
        b.padding = 0.2;
        h.end_gesture(&b);
        assert!(h.can_undo());
        assert_eq!(h.undo(&b).unwrap(), a);
        assert!(!h.can_undo());
        assert_eq!(h.redo(&a).unwrap().padding, 0.2);
    }
}

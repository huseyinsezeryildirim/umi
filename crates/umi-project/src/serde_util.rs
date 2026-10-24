//! Serde helpers that keep the JSON identical to what the Swift app writes, so projects
//! move between versions both ways.

use serde::{Deserialize, Deserializer, Serializer};
use uuid::Uuid;

/// Tolerant field decoding: a missing *or unreadable* value falls back to the default,
/// so projects written by older (or newer) versions keep opening as fields evolve.
pub fn tolerant<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: serde::de::DeserializeOwned + Default,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(T::deserialize(value).unwrap_or_default())
}

/// Like [`tolerant`] for optional fields: unreadable → `None`.
pub fn tolerant_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: serde::de::DeserializeOwned,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(Option::<T>::deserialize(value).unwrap_or(None))
}

/// UUIDs are written upper-case (Foundation's `UUID.uuidString`) and read in any case.
pub mod uuid_upper {
    use super::*;

    pub fn serialize<S: Serializer>(id: &Uuid, s: S) -> Result<S::Ok, S::Error> {
        let mut buf = Uuid::encode_buffer();
        s.serialize_str(id.hyphenated().encode_upper(&mut buf))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Uuid, D::Error> {
        let s = String::deserialize(d)?;
        Uuid::parse_str(&s).map_err(serde::de::Error::custom)
    }
}

/// A fresh random id (default for new items).
pub fn new_id() -> Uuid {
    Uuid::new_v4()
}

/// Dates as ISO 8601 without fractional seconds (`JSONEncoder.DateEncodingStrategy.iso8601`).
pub mod iso8601 {
    use chrono::{DateTime, SecondsFormat, Utc};
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(date: &DateTime<Utc>, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&date.to_rfc3339_opts(SecondsFormat::Secs, true))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<DateTime<Utc>, D::Error> {
        let s = String::deserialize(d)?;
        DateTime::parse_from_rfc3339(&s).map(|d| d.with_timezone(&Utc)).map_err(serde::de::Error::custom)
    }
}

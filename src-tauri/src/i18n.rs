use std::collections::HashMap;
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};

type Catalog = HashMap<String, HashMap<String, String>>;

static TRANSLATIONS: LazyLock<Catalog> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../src/shared/translations.json"))
        .expect("translations.json must be valid")
});

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Locale {
    #[default]
    Pl,
    En,
}

impl Locale {
    fn code(self) -> &'static str {
        match self {
            Locale::Pl => "pl",
            Locale::En => "en",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    #[default]
    Auto,
    Light,
    Dark,
}

pub fn t(locale: Locale, key: &str) -> String {
    tr(locale, key, &[])
}

pub fn tr(locale: Locale, key: &str, replacements: &[(&str, &dyn ToString)]) -> String {
    let template = TRANSLATIONS
        .get(locale.code())
        .and_then(|catalog| catalog.get(key))
        .or_else(|| TRANSLATIONS.get(Locale::Pl.code())?.get(key))
        .cloned()
        .unwrap_or_else(|| key.to_owned());

    replacements.iter().fold(template, |text, (name, value)| {
        text.replace(&format!("{{{name}}}"), &value.to_string())
    })
}

pub fn format_mode(width: u32, height: u32, refresh_rate: u32) -> String {
    format!("{width}x{height} @ {refresh_rate} Hz")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_placeholders_and_falls_back_to_key() {
        assert_eq!(
            tr(Locale::En, "monitor.groupTitle", &[("number", &2)]),
            "Monitor 2"
        );
        assert_eq!(t(Locale::En, "missing.key"), "missing.key");
    }
}

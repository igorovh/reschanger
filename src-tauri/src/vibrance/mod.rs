//! Digital vibrance (NVIDIA DVC) and saturation (AMD ADL), using the same driver calls as vibranceGUI.

mod amd;
mod nvidia;

/// Percent shown in the UI: 50 is the driver default, 100 the maximum, like NVIDIA Control Panel.
pub const MIN_PERCENT: u32 = 50;
pub const MAX_PERCENT: u32 = 100;

/// Driver-specific level range for one display; `neutral` is the level that maps to 50%.
pub(crate) struct LevelRange {
    pub current: i32,
    pub neutral: i32,
    pub max: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Vendor {
    Nvidia,
    Amd,
}

/// Raw driver level captured before a preset changed it, so it can be restored exactly.
#[derive(Clone, Copy, Debug)]
pub struct Snapshot {
    vendor: Vendor,
    level: i32,
}

pub struct Reading {
    pub percent: u32,
    pub snapshot: Snapshot,
}

pub enum SetError {
    Unsupported,
    Failed(Vendor, i32),
}

pub fn read(device_name: &str) -> Option<Reading> {
    let (vendor, range) = find(device_name)?;
    Some(Reading {
        percent: level_to_percent(&range, range.current),
        snapshot: Snapshot {
            vendor,
            level: range.current,
        },
    })
}

pub fn set_percent(device_name: &str, percent: u32) -> Result<(), SetError> {
    let (vendor, range) = find(device_name).ok_or(SetError::Unsupported)?;
    let level = percent_to_level(&range, percent);
    if level == range.current {
        return Ok(());
    }
    set_level(vendor, device_name, level)
}

pub fn restore(device_name: &str, snapshot: Snapshot) -> Result<(), SetError> {
    set_level(snapshot.vendor, device_name, snapshot.level)
}

fn find(device_name: &str) -> Option<(Vendor, LevelRange)> {
    nvidia::range(device_name)
        .map(|range| (Vendor::Nvidia, range))
        .or_else(|| amd::range(device_name).map(|range| (Vendor::Amd, range)))
}

fn set_level(vendor: Vendor, device_name: &str, level: i32) -> Result<(), SetError> {
    let result = match vendor {
        Vendor::Nvidia => nvidia::set_level(device_name, level),
        Vendor::Amd => amd::set_level(device_name, level),
    };
    match result {
        Some(0) => Ok(()),
        Some(status) => Err(SetError::Failed(vendor, status)),
        None => Err(SetError::Unsupported),
    }
}

fn level_to_percent(range: &LevelRange, level: i32) -> u32 {
    let span = f64::from(range.max - range.neutral);
    let ratio = (f64::from(level - range.neutral) / span).clamp(0.0, 1.0);
    (f64::from(MIN_PERCENT) + ratio * f64::from(MAX_PERCENT - MIN_PERCENT)).round() as u32
}

fn percent_to_level(range: &LevelRange, percent: u32) -> i32 {
    let percent = percent.clamp(MIN_PERCENT, MAX_PERCENT);
    let ratio = f64::from(percent - MIN_PERCENT) / f64::from(MAX_PERCENT - MIN_PERCENT);
    range.neutral + (ratio * f64::from(range.max - range.neutral)).round() as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_nvidia_levels_like_control_panel() {
        let range = LevelRange {
            current: 0,
            neutral: 0,
            max: 63,
        };
        assert_eq!(level_to_percent(&range, 0), 50);
        assert_eq!(level_to_percent(&range, 63), 100);
        assert_eq!(percent_to_level(&range, 75), 32);
        assert_eq!(percent_to_level(&range, 10), 0);
    }

    #[test]
    fn maps_amd_saturation_from_default_to_max() {
        let range = LevelRange {
            current: 100,
            neutral: 100,
            max: 200,
        };
        assert_eq!(level_to_percent(&range, 100), 50);
        assert_eq!(level_to_percent(&range, 40), 50);
        assert_eq!(percent_to_level(&range, 100), 200);
        assert_eq!(percent_to_level(&range, 75), 150);
    }

    #[test]
    #[ignore = "briefly changes the real display's vibrance; run manually with --ignored"]
    fn sets_and_restores_vibrance_on_primary_display() {
        let device = "\\\\.\\DISPLAY1";
        let Some(before) = read(device) else {
            return;
        };
        assert!(set_percent(device, 75).is_ok());
        assert_eq!(read(device).map(|r| r.percent), Some(75));
        std::thread::sleep(std::time::Duration::from_millis(800));
        assert!(restore(device, before.snapshot).is_ok());
        assert_eq!(read(device).map(|r| r.percent), Some(before.percent));
    }

    #[test]
    #[ignore = "reads the real GPU; run manually with --ignored --nocapture"]
    fn reads_vibrance_of_connected_displays() {
        for index in 1..=4 {
            let name = format!("\\\\.\\DISPLAY{index}");
            let reading = read(&name).map(|r| (r.percent, r.snapshot));
            println!("{name}: {reading:?}");
        }
    }
}

use std::mem::size_of;

use serde::Serialize;
use windows::Win32::Graphics::Gdi::{
    CDS_TEST, CDS_TYPE, CDS_UPDATEREGISTRY, ChangeDisplaySettingsExW, DEVMODEW,
    DISP_CHANGE_SUCCESSFUL, DISPLAY_DEVICE_ACTIVE, DISPLAY_DEVICEW, DM_DISPLAYFREQUENCY,
    DM_PELSHEIGHT, DM_PELSWIDTH, ENUM_CURRENT_SETTINGS, ENUM_DISPLAY_SETTINGS_MODE,
    EnumDisplayDevicesW, EnumDisplaySettingsW,
};
use windows::core::PCWSTR;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayMode {
    pub width: u32,
    pub height: u32,
    pub refresh_rate: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub device_name: String,
    pub current: DisplayMode,
    pub modes: Vec<DisplayMode>,
    /// Digital vibrance percent (50-100), filled in by the core; None when the GPU does not support it.
    pub vibrance: Option<u32>,
}

pub enum ApplyError {
    ReadCurrentFailed,
    TestRejected(i32),
    ApplyFailed(i32),
}

pub fn list_monitors() -> Vec<MonitorInfo> {
    let mut monitors = Vec::new();

    for index in 0.. {
        let Some(adapter) = enum_device(None, index) else {
            break;
        };
        if (adapter.StateFlags & DISPLAY_DEVICE_ACTIVE).0 == 0 {
            continue;
        }

        let device_name = wide_to_string(&adapter.DeviceName);
        let device_name_wide = to_wide(&device_name);
        let Some(current) = current_mode(&device_name_wide) else {
            continue;
        };

        let monitor = find_monitor_device(&device_name_wide);
        monitors.push(MonitorInfo {
            id: stable_monitor_id(&adapter, monitor.as_ref(), &device_name),
            name: monitor_name(&adapter, monitor.as_ref(), &device_name),
            modes: list_modes(&device_name_wide),
            device_name,
            current,
            vibrance: None,
        });
    }

    monitors
}

pub fn apply_mode(device_name: &str, mode: DisplayMode) -> Result<(), ApplyError> {
    let device_name_wide = to_wide(device_name);
    let mut devmode = new_devmode();
    let name = PCWSTR(device_name_wide.as_ptr());

    // SAFETY: devmode is a properly sized DEVMODEW and the name buffer is NUL-terminated.
    unsafe {
        if !EnumDisplaySettingsW(name, ENUM_CURRENT_SETTINGS, &mut devmode).as_bool() {
            return Err(ApplyError::ReadCurrentFailed);
        }

        devmode.dmPelsWidth = mode.width;
        devmode.dmPelsHeight = mode.height;
        devmode.dmDisplayFrequency = mode.refresh_rate;
        devmode.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY;

        let test = change_settings(name, &devmode, CDS_TEST);
        if test != DISP_CHANGE_SUCCESSFUL.0 {
            return Err(ApplyError::TestRejected(test));
        }

        let applied = change_settings(name, &devmode, CDS_UPDATEREGISTRY);
        if applied != DISP_CHANGE_SUCCESSFUL.0 {
            return Err(ApplyError::ApplyFailed(applied));
        }
    }

    Ok(())
}

unsafe fn change_settings(name: PCWSTR, devmode: &DEVMODEW, flags: CDS_TYPE) -> i32 {
    unsafe { ChangeDisplaySettingsExW(name, Some(devmode), None, flags, None).0 }
}

fn enum_device(parent: Option<&[u16]>, index: u32) -> Option<DISPLAY_DEVICEW> {
    let mut device = DISPLAY_DEVICEW {
        cb: size_of::<DISPLAY_DEVICEW>() as u32,
        ..Default::default()
    };
    let parent = parent.map_or(PCWSTR::null(), |name| PCWSTR(name.as_ptr()));

    // SAFETY: device.cb is initialized and parent is either null or NUL-terminated.
    unsafe { EnumDisplayDevicesW(parent, index, &mut device, 0) }
        .as_bool()
        .then_some(device)
}

fn find_monitor_device(adapter_name: &[u16]) -> Option<DISPLAY_DEVICEW> {
    let mut fallback = None;

    for index in 0.. {
        let Some(monitor) = enum_device(Some(adapter_name), index) else {
            break;
        };
        if (monitor.StateFlags & DISPLAY_DEVICE_ACTIVE).0 != 0 {
            return Some(monitor);
        }
        fallback.get_or_insert(monitor);
    }

    fallback
}

fn current_mode(device_name: &[u16]) -> Option<DisplayMode> {
    enum_mode(device_name, ENUM_CURRENT_SETTINGS)
}

fn enum_mode(device_name: &[u16], mode: ENUM_DISPLAY_SETTINGS_MODE) -> Option<DisplayMode> {
    let mut devmode = new_devmode();

    // SAFETY: devmode is a properly sized DEVMODEW and the name buffer is NUL-terminated.
    unsafe { EnumDisplaySettingsW(PCWSTR(device_name.as_ptr()), mode, &mut devmode) }
        .as_bool()
        .then_some(DisplayMode {
            width: devmode.dmPelsWidth,
            height: devmode.dmPelsHeight,
            refresh_rate: devmode.dmDisplayFrequency,
        })
}

fn list_modes(device_name: &[u16]) -> Vec<DisplayMode> {
    let mut modes: Vec<DisplayMode> = Vec::new();

    for index in 0.. {
        let Some(mode) = enum_mode(device_name, ENUM_DISPLAY_SETTINGS_MODE(index)) else {
            break;
        };
        if mode.width == 0 || mode.height == 0 || mode.refresh_rate == 0 || modes.contains(&mode) {
            continue;
        }
        modes.push(mode);
    }

    modes.sort_by(|left, right| {
        (u64::from(right.width) * u64::from(right.height))
            .cmp(&(u64::from(left.width) * u64::from(left.height)))
            .then(right.width.cmp(&left.width))
            .then(right.refresh_rate.cmp(&left.refresh_rate))
    });
    modes
}

fn stable_monitor_id(
    adapter: &DISPLAY_DEVICEW,
    monitor: Option<&DISPLAY_DEVICEW>,
    device_name: &str,
) -> String {
    let adapter_key = first_non_blank(&[&adapter.DeviceID, &adapter.DeviceKey]);
    let monitor_key = monitor
        .map(|monitor| first_non_blank(&[&monitor.DeviceID, &monitor.DeviceKey]))
        .unwrap_or_default();

    if !monitor_key.is_empty() {
        format!("monitor:{monitor_key}|adapter:{adapter_key}")
    } else if !adapter_key.is_empty() {
        format!("adapter:{adapter_key}")
    } else {
        device_name.to_owned()
    }
}

fn monitor_name(
    adapter: &DISPLAY_DEVICEW,
    monitor: Option<&DISPLAY_DEVICEW>,
    device_name: &str,
) -> String {
    let monitor_string = monitor.map(|monitor| wide_to_string(&monitor.DeviceString));
    let adapter_string = wide_to_string(&adapter.DeviceString);
    let name = [
        monitor_string.as_deref().unwrap_or(""),
        &adapter_string,
        device_name,
    ]
    .into_iter()
    .find(|value| !value.trim().is_empty())
    .unwrap_or_default()
    .to_owned();

    let hardware_code = monitor
        .map(|monitor| wide_to_string(&monitor.DeviceID))
        .and_then(|id| id.split('\\').nth(1).map(str::to_owned))
        .filter(|code| !code.trim().is_empty());

    match hardware_code {
        Some(code) if !name.to_lowercase().contains(&code.to_lowercase()) => {
            format!("{name} ({code})")
        }
        _ => name,
    }
}

fn first_non_blank(values: &[&[u16]]) -> String {
    values
        .iter()
        .map(|value| wide_to_string(value))
        .find(|value| !value.trim().is_empty())
        .unwrap_or_default()
}

fn new_devmode() -> DEVMODEW {
    DEVMODEW {
        dmSize: size_of::<DEVMODEW>() as u16,
        ..Default::default()
    }
}

fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn wide_to_string(value: &[u16]) -> String {
    let end = value.iter().position(|&ch| ch == 0).unwrap_or(value.len());
    String::from_utf16_lossy(&value[..end])
}

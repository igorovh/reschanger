use std::collections::HashSet;
use std::mem::size_of;
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};

use windows::Win32::Foundation::{CloseHandle, HWND};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Registry::{HKEY_CURRENT_USER, RegDeleteKeyValueW};
use windows::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MB_SETFOREGROUND, MessageBoxW};
use windows::core::{PCWSTR, w};

use crate::settings::normalize_process_name;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DETACHED_PROCESS: u32 = 0x0000_0008;

pub fn running_process_names() -> Result<HashSet<String>, String> {
    // SAFETY: the snapshot handle is closed below and the entry size is initialized.
    unsafe {
        let snapshot =
            CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).map_err(|error| error.message())?;
        let mut entry = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut names = HashSet::new();

        let mut has_entry = Process32FirstW(snapshot, &mut entry).is_ok();
        while has_entry {
            let end = entry
                .szExeFile
                .iter()
                .position(|&ch| ch == 0)
                .unwrap_or(entry.szExeFile.len());
            names.insert(normalize_process_name(&String::from_utf16_lossy(
                &entry.szExeFile[..end],
            )));
            has_entry = Process32NextW(snapshot, &mut entry).is_ok();
        }

        let _ = CloseHandle(snapshot);
        Ok(names)
    }
}

pub fn restart_explorer() {
    let _ = Command::new("taskkill")
        .args(["/f", "/im", "explorer.exe"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .status();

    let _ = Command::new("explorer.exe")
        .creation_flags(DETACHED_PROCESS)
        .spawn();
}

pub fn show_error_box(title: String, message: String) {
    std::thread::spawn(move || {
        let title = to_wide(&title);
        let message = to_wide(&message);
        // SAFETY: both buffers are NUL-terminated and outlive the call.
        unsafe {
            MessageBoxW(
                Some(HWND::default()),
                PCWSTR(message.as_ptr()),
                PCWSTR(title.as_ptr()),
                MB_OK | MB_ICONERROR | MB_SETFOREGROUND,
            );
        }
    });
}

/// Removes the Run entries written by the old Electron build so the app does not start twice.
pub fn remove_legacy_autostart_entries() {
    for name in [w!("pl.reschanger.app"), w!("electron.app.reschanger")] {
        // SAFETY: all strings are static NUL-terminated literals.
        unsafe {
            let _ = RegDeleteKeyValueW(
                HKEY_CURRENT_USER,
                w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run"),
                name,
            );
        }
    }
}

fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

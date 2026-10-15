use std::ffi::{CString, c_char, c_void};
use std::sync::OnceLock;

use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows::core::{s, w};

use super::LevelRange;

const ID_INITIALIZE: u32 = 0x0150_E828;
const ID_GET_ASSOCIATED_DISPLAY_HANDLE: u32 = 0x35C2_9134;
const ID_GET_DVC_INFO: u32 = 0x4085_DE45;
const ID_SET_DVC_LEVEL: u32 = 0x1724_09B4;

type DisplayHandle = *mut c_void;
type QueryInterface = unsafe extern "C" fn(u32) -> *const c_void;
type Initialize = unsafe extern "C" fn() -> i32;
type GetAssociatedDisplayHandle = unsafe extern "C" fn(*const c_char, *mut DisplayHandle) -> i32;
type GetDvcInfo = unsafe extern "C" fn(DisplayHandle, u32, *mut DvcInfo) -> i32;
type SetDvcLevel = unsafe extern "C" fn(DisplayHandle, u32, i32) -> i32;

#[repr(C)]
#[derive(Default)]
struct DvcInfo {
    version: u32,
    current_level: i32,
    min_level: i32,
    max_level: i32,
}

struct Nvapi {
    get_handle: GetAssociatedDisplayHandle,
    get_info: GetDvcInfo,
    set_level: SetDvcLevel,
}

static NVAPI: OnceLock<Option<Nvapi>> = OnceLock::new();

fn nvapi() -> Option<&'static Nvapi> {
    NVAPI.get_or_init(load).as_ref()
}

fn load() -> Option<Nvapi> {
    // SAFETY: pointers come from nvapi_QueryInterface and are cast to their documented signatures.
    unsafe {
        let library = LoadLibraryW(w!("nvapi64.dll")).ok()?;
        let query: QueryInterface =
            std::mem::transmute(GetProcAddress(library, s!("nvapi_QueryInterface"))?);
        let resolve = |id: u32| {
            let pointer = query(id);
            (!pointer.is_null()).then_some(pointer)
        };

        let initialize: Initialize = std::mem::transmute(resolve(ID_INITIALIZE)?);
        if initialize() != 0 {
            return None;
        }

        Some(Nvapi {
            get_handle: std::mem::transmute::<*const c_void, GetAssociatedDisplayHandle>(resolve(
                ID_GET_ASSOCIATED_DISPLAY_HANDLE,
            )?),
            get_info: std::mem::transmute::<*const c_void, GetDvcInfo>(resolve(ID_GET_DVC_INFO)?),
            set_level: std::mem::transmute::<*const c_void, SetDvcLevel>(resolve(
                ID_SET_DVC_LEVEL,
            )?),
        })
    }
}

fn display_handle(api: &Nvapi, device_name: &str) -> Option<DisplayHandle> {
    let name = CString::new(device_name).ok()?;
    let mut handle: DisplayHandle = std::ptr::null_mut();
    // SAFETY: name is NUL-terminated and handle is a valid out pointer.
    let status = unsafe { (api.get_handle)(name.as_ptr(), &mut handle) };
    (status == 0 && !handle.is_null()).then_some(handle)
}

pub(super) fn range(device_name: &str) -> Option<LevelRange> {
    let api = nvapi()?;
    let handle = display_handle(api, device_name)?;
    let mut info = DvcInfo {
        version: size_of::<DvcInfo>() as u32 | (1 << 16),
        ..Default::default()
    };
    // SAFETY: info is a correctly versioned NV_DISPLAY_DVC_INFO.
    let status = unsafe { (api.get_info)(handle, 0, &mut info) };
    (status == 0 && info.max_level > info.min_level).then_some(LevelRange {
        current: info.current_level,
        neutral: info.min_level,
        max: info.max_level,
    })
}

pub(super) fn set_level(device_name: &str, level: i32) -> Option<i32> {
    let api = nvapi()?;
    let handle = display_handle(api, device_name)?;
    // SAFETY: handle was returned by NVAPI for this display.
    Some(unsafe { (api.set_level)(handle, 0, level) })
}

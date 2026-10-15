use std::ffi::c_void;
use std::sync::{Mutex, OnceLock};

use windows::Win32::Foundation::HMODULE;
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows::core::{PCSTR, s, w};

use super::LevelRange;

const ADL_OK: i32 = 0;
const ADL_MAX_PATH: usize = 256;
const ADL_DISPLAY_COLOR_SATURATION: i32 = 1 << 2;
const DISPLAY_CONNECTED_AND_MAPPED: i32 = 0x1 | 0x2;

type MallocCallback = unsafe extern "C" fn(i32) -> *mut c_void;
type ControlCreate = unsafe extern "C" fn(MallocCallback, i32) -> i32;
type NumberOfAdaptersGet = unsafe extern "C" fn(*mut i32) -> i32;
type AdapterInfoGet = unsafe extern "C" fn(*mut AdapterInfo, i32) -> i32;
type DisplayInfoGet = unsafe extern "C" fn(i32, *mut i32, *mut *mut DisplayInfo, i32) -> i32;
type ColorGet =
    unsafe extern "C" fn(i32, i32, i32, *mut i32, *mut i32, *mut i32, *mut i32, *mut i32) -> i32;
type ColorSet = unsafe extern "C" fn(i32, i32, i32, i32) -> i32;

unsafe extern "C" {
    fn malloc(size: usize) -> *mut c_void;
    fn free(pointer: *mut c_void);
}

unsafe extern "C" fn adl_malloc(size: i32) -> *mut c_void {
    // SAFETY: ADL frees nothing itself; buffers it returns are released with `free` below.
    unsafe { malloc(size.max(0) as usize) }
}

#[repr(C)]
struct AdapterInfo {
    size: i32,
    adapter_index: i32,
    udid: [u8; ADL_MAX_PATH],
    bus_number: i32,
    device_number: i32,
    function_number: i32,
    vendor_id: i32,
    adapter_name: [u8; ADL_MAX_PATH],
    display_name: [u8; ADL_MAX_PATH],
    present: i32,
    exist: i32,
    driver_path: [u8; ADL_MAX_PATH],
    driver_path_ext: [u8; ADL_MAX_PATH],
    pnp_string: [u8; ADL_MAX_PATH],
    os_display_index: i32,
}

#[repr(C)]
struct DisplayId {
    logical_index: i32,
    physical_index: i32,
    logical_adapter_index: i32,
    physical_adapter_index: i32,
}

#[repr(C)]
struct DisplayInfo {
    id: DisplayId,
    controller_index: i32,
    name: [u8; ADL_MAX_PATH],
    manufacturer_name: [u8; ADL_MAX_PATH],
    display_type: i32,
    output_type: i32,
    connector: i32,
    info_mask: i32,
    info_value: i32,
}

struct Adl {
    number_of_adapters: NumberOfAdaptersGet,
    adapter_info: AdapterInfoGet,
    display_info: DisplayInfoGet,
    color_get: ColorGet,
    color_set: ColorSet,
}

/// The legacy ADL API keeps a global context and is not thread-safe.
static ADL: OnceLock<Option<Mutex<Adl>>> = OnceLock::new();

fn adl() -> Option<&'static Mutex<Adl>> {
    ADL.get_or_init(|| load().map(Mutex::new)).as_ref()
}

fn load() -> Option<Adl> {
    // SAFETY: exported ADL functions are cast to their documented cdecl signatures.
    unsafe {
        let library = LoadLibraryW(w!("atiadlxx.dll"))
            .or_else(|_| LoadLibraryW(w!("atiadlxy.dll")))
            .ok()?;
        let create: ControlCreate = resolve(library, s!("ADL_Main_Control_Create"))?;
        if create(adl_malloc, 1) != ADL_OK {
            return None;
        }

        Some(Adl {
            number_of_adapters: resolve(library, s!("ADL_Adapter_NumberOfAdapters_Get"))?,
            adapter_info: resolve(library, s!("ADL_Adapter_AdapterInfo_Get"))?,
            display_info: resolve(library, s!("ADL_Display_DisplayInfo_Get"))?,
            color_get: resolve(library, s!("ADL_Display_Color_Get"))?,
            color_set: resolve(library, s!("ADL_Display_Color_Set"))?,
        })
    }
}

unsafe fn resolve<T: Copy>(library: HMODULE, name: PCSTR) -> Option<T> {
    // SAFETY: T is always an `extern "C" fn` type of pointer size.
    unsafe {
        let pointer = GetProcAddress(library, name)?;
        Some(std::mem::transmute_copy(&pointer))
    }
}

/// Resolves a Windows device name such as `\\.\DISPLAY1` to ADL adapter and display indices.
fn locate(api: &Adl, device_name: &str) -> Option<(i32, i32)> {
    // SAFETY: buffers are sized from ADL's adapter count and the display list is freed after use.
    unsafe {
        let mut count = 0;
        if (api.number_of_adapters)(&mut count) != ADL_OK || count <= 0 {
            return None;
        }

        let mut adapters: Vec<AdapterInfo> = (0..count).map(|_| std::mem::zeroed()).collect();
        for adapter in &mut adapters {
            adapter.size = size_of::<AdapterInfo>() as i32;
        }
        let byte_size = (size_of::<AdapterInfo>() * adapters.len()) as i32;
        if (api.adapter_info)(adapters.as_mut_ptr(), byte_size) != ADL_OK {
            return None;
        }

        for adapter in adapters
            .iter()
            .filter(|adapter| c_string(&adapter.display_name).eq_ignore_ascii_case(device_name))
        {
            let mut display_count = 0;
            let mut displays: *mut DisplayInfo = std::ptr::null_mut();
            if (api.display_info)(adapter.adapter_index, &mut display_count, &mut displays, 0)
                != ADL_OK
                || displays.is_null()
            {
                continue;
            }

            let list = std::slice::from_raw_parts(displays, display_count.max(0) as usize);
            let owned = list
                .iter()
                .filter(|display| display.id.logical_adapter_index == adapter.adapter_index);
            let found = owned
                .clone()
                .find(|display| {
                    display.info_value & DISPLAY_CONNECTED_AND_MAPPED
                        == DISPLAY_CONNECTED_AND_MAPPED
                })
                .or_else(|| owned.clone().next())
                .map(|display| (adapter.adapter_index, display.id.logical_index));
            free(displays.cast());

            if found.is_some() {
                return found;
            }
        }
        None
    }
}

pub(super) fn range(device_name: &str) -> Option<LevelRange> {
    let api = adl()?.lock().ok()?;
    let (adapter, display) = locate(&api, device_name)?;
    let (mut current, mut default, mut min, mut max, mut step) = (0, 0, 0, 0, 0);
    // SAFETY: all out pointers are valid for the duration of the call.
    let status = unsafe {
        (api.color_get)(
            adapter,
            display,
            ADL_DISPLAY_COLOR_SATURATION,
            &mut current,
            &mut default,
            &mut min,
            &mut max,
            &mut step,
        )
    };
    (status == ADL_OK && max > default).then_some(LevelRange {
        current,
        neutral: default,
        max,
    })
}

pub(super) fn set_level(device_name: &str, level: i32) -> Option<i32> {
    let api = adl()?.lock().ok()?;
    let (adapter, display) = locate(&api, device_name)?;
    // SAFETY: indices come from ADL for a connected display.
    Some(unsafe { (api.color_set)(adapter, display, ADL_DISPLAY_COLOR_SATURATION, level) })
}

fn c_string(bytes: &[u8]) -> String {
    let end = bytes
        .iter()
        .position(|&byte| byte == 0)
        .unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).into_owned()
}

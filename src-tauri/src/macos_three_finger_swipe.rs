use std::ffi::{c_int, c_void};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

const RAW_SWIPE_THRESHOLD: f32 = 0.12;
const HORIZONTAL_DOMINANCE: f32 = 1.5;

#[repr(C)]
#[derive(Clone, Copy)]
struct MTVector {
    x: f32,
    y: f32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct MTReadout {
    position: MTVector,
    velocity: MTVector,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct MTContact {
    frame: i32,
    timestamp: f64,
    identifier: i32,
    state: i32,
    finger_id: i32,
    hand_id: i32,
    normalized: MTReadout,
    size: f32,
    zero1: i32,
    angle: f32,
    major_axis: f32,
    minor_axis: f32,
    mm: MTReadout,
    zero2a: i32,
    zero2b: i32,
    density: f32,
}

#[derive(Default)]
struct GestureState {
    start: Option<(f32, f32)>,
    last: Option<(f32, f32)>,
    had_three_fingers: bool,
}

type MTDeviceRef = *mut c_void;
type MTContactCallback =
    unsafe extern "C" fn(MTDeviceRef, *const MTContact, c_int, f64, c_int) -> c_int;

#[link(name = "MultitouchSupport", kind = "framework")]
unsafe extern "C" {
    fn MTDeviceCreateList() -> *const c_void;
    fn MTRegisterContactFrameCallback(device: MTDeviceRef, callback: MTContactCallback);
    fn MTDeviceStart(device: MTDeviceRef, mode: c_int) -> c_int;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFArrayGetCount(array: *const c_void) -> isize;
    fn CFArrayGetValueAtIndex(array: *const c_void, index: isize) -> *const c_void;
}

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static GESTURE: Mutex<GestureState> = Mutex::new(GestureState {
    start: None,
    last: None,
    had_three_fingers: false,
});

pub fn install(app: AppHandle) {
    let _ = APP_HANDLE.set(app);
    unsafe {
        let devices = MTDeviceCreateList();
        if devices.is_null() {
            return;
        }
        // MTDeviceCreateList returns a retained array. It intentionally lives for the
        // process lifetime so its device references remain valid for the callbacks.
        let count = CFArrayGetCount(devices);
        for index in 0..count {
            let device = CFArrayGetValueAtIndex(devices, index) as MTDeviceRef;
            if device.is_null() {
                continue;
            }
            MTRegisterContactFrameCallback(device, raw_touch_callback);
            let _ = MTDeviceStart(device, 0);
        }
    }
}

unsafe extern "C" fn raw_touch_callback(
    _device: MTDeviceRef,
    contacts: *const MTContact,
    contact_count: c_int,
    _timestamp: f64,
    _frame: c_int,
) -> c_int {
    if contacts.is_null() || contact_count < 0 {
        return 0;
    }
    let contacts = unsafe { std::slice::from_raw_parts(contacts, contact_count as usize) };
    let active: Vec<&MTContact> = contacts.iter().filter(|contact| plausible(contact)).collect();
    let Ok(mut gesture) = GESTURE.lock() else {
        return 0;
    };

    if !app_is_focused() {
        *gesture = GestureState::default();
        return 0;
    }
    if active.len() != 3 {
        if gesture.had_three_fingers {
            finish_gesture(&gesture);
        }
        *gesture = GestureState::default();
        return 0;
    }

    let centroid = active.iter().fold((0.0, 0.0), |sum, contact| {
        (
            sum.0 + contact.normalized.position.x / 3.0,
            sum.1 + contact.normalized.position.y / 3.0,
        )
    });
    gesture.start.get_or_insert(centroid);
    gesture.last = Some(centroid);
    gesture.had_three_fingers = true;
    0
}

fn plausible(contact: &MTContact) -> bool {
    let position = contact.normalized.position;
    (0.0..=1.0).contains(&position.x)
        && (0.0..=1.0).contains(&position.y)
        && contact.size > 0.01
        && contact.size < 20.0
}

fn app_is_focused() -> bool {
    APP_HANDLE
        .get()
        .and_then(|app| app.get_webview_window("main"))
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false)
}

fn finish_gesture(gesture: &GestureState) {
    let (Some(start), Some(end)) = (gesture.start, gesture.last) else {
        return;
    };
    let delta_x = end.0 - start.0;
    let delta_y = end.1 - start.1;
    if delta_x.abs() < RAW_SWIPE_THRESHOLD
        || delta_x.abs() <= delta_y.abs() * HORIZONTAL_DOMINANCE
    {
        return;
    }
    if let Some(app) = APP_HANDLE.get() {
        let event = if delta_x > 0.0 {
            "navigate-forward"
        } else {
            "navigate-back"
        };
        let _ = app.emit("menu-event", event);
    }
}

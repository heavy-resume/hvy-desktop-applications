// Keeping the computer from idle sleep while a scheduled job is running (scheduledJobs.ts), as Electron's
// powerSaveBlocker 'prevent-app-suspension' does: the display may still sleep. A sync command, so it runs on the main
// thread, which holds the macOS activity and Windows' execution state.

#[cfg(target_os = "macos")]
thread_local! {
    static KEEP_AWAKE_ACTIVITY: std::cell::RefCell<Option<objc2::rc::Retained<objc2::runtime::ProtocolObject<dyn objc2::runtime::NSObjectProtocol>>>> =
        const { std::cell::RefCell::new(None) };
}

#[tauri::command]
fn set_keep_awake(on: bool) {
    #[cfg(target_os = "macos")]
    {
        use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};
        KEEP_AWAKE_ACTIVITY.with(|activity| {
            let mut activity = activity.borrow_mut();
            let info = NSProcessInfo::processInfo();
            if on && activity.is_none() {
                let reason = NSString::from_str("Running a scheduled job");
                *activity = Some(info.beginActivityWithOptions_reason(NSActivityOptions::IdleSystemSleepDisabled, &reason));
            } else if !on {
                if let Some(token) = activity.take() {
                    unsafe { info.endActivity(&token) };
                }
            }
        });
    }
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED};
        unsafe { SetThreadExecutionState(if on { ES_CONTINUOUS | ES_SYSTEM_REQUIRED } else { ES_CONTINUOUS }) };
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let _ = on;
}

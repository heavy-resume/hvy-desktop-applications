fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    if args.iter().any(|arg| arg == "--mcp-stdio") {
        if let Err(error) = hvy_galaxy_lib::run_mcp_stdio_main() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    if !should_run_tauri_shell() {
        match launch_electron_shell(&args[1..]) {
            Ok(code) => std::process::exit(code),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
    }
    hvy_galaxy_lib::run();
}

fn should_run_tauri_shell() -> bool {
    if let Ok(runtime) = std::env::var("HVY_GALAXY_RUNTIME") {
        if runtime.eq_ignore_ascii_case("tauri") {
            return true;
        }
        if runtime.eq_ignore_ascii_case("electron") {
            return false;
        }
    }
    should_run_tauri_shell_for_platform()
}

#[cfg(target_os = "macos")]
fn should_run_tauri_shell_for_platform() -> bool {
    macos_major_version().map(|major| major >= 13).unwrap_or(true)
}

#[cfg(not(target_os = "macos"))]
fn should_run_tauri_shell_for_platform() -> bool {
    false
}

#[cfg(target_os = "macos")]
fn macos_major_version() -> Option<u64> {
    let output = std::process::Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .split('.')
        .next()
        .and_then(|major| major.parse().ok())
}

fn launch_electron_shell(args: &[String]) -> Result<i32, String> {
    let executable = electron_executable_path()?;
    let status = std::process::Command::new(&executable)
        .args(args)
        .status()
        .map_err(|error| format!("Could not launch Electron shell at {}: {error}", executable.display()))?;
    Ok(status.code().unwrap_or(1))
}

fn electron_executable_path() -> Result<std::path::PathBuf, String> {
    if let Ok(path) = std::env::var("HVY_GALAXY_ELECTRON_PATH") {
        return Ok(path.into());
    }
    let current = std::env::current_exe().map_err(|error| error.to_string())?;
    let directory = current
        .parent()
        .ok_or_else(|| "Could not find current executable directory.".to_string())?;
    #[cfg(target_os = "macos")]
    let candidate = directory.join("HVY Galaxy Electron.app/Contents/MacOS/HVY Galaxy Electron");
    #[cfg(target_os = "windows")]
    let candidate = directory.join("HVY Galaxy Electron.exe");
    #[cfg(all(unix, not(target_os = "macos")))]
    let candidate = directory.join("hvy-galaxy-electron");
    Ok(candidate)
}

// Tauri side of web automation's BrowserHost (src/webAutomation/host.ts), the
// counterpart of src-electron/web-automation-host.cjs: hidden worker windows
// that share a browser profile's session, the visible sign-in window, page
// inspection through the integration inspector, page commands, same-origin
// requests from inside a page, and cookie-free file reads. What runs inside a
// page is shared with Electron (src/web-automation-page.js).
//
// Webviews here return only synchronous values from scripts, so a page call is
// started in the page and its result read back by polling (`start` and `take`
// in the page script). Navigation is followed through page load events.

const WEB_AUTOMATION_PAGE: &str = include_str!("../../src/web-automation-page.js");
const WEB_AUTOMATION_NAVIGATION_TIMEOUT: StdDuration = StdDuration::from_secs(30);
const WEB_AUTOMATION_CALL_TIMEOUT: StdDuration = StdDuration::from_secs(120);
const WEB_AUTOMATION_POLL_INTERVAL: StdDuration = StdDuration::from_millis(50);
/// How long a command has to start a navigation (a link's click starts one at once) before it is taken not to.
const WEB_AUTOMATION_NAVIGATION_GRACE: StdDuration = StdDuration::from_millis(1000);
/// A finished page is settled once no other load starts this soon. Going back, WebKit finishes the history entry
/// and then loads the page again; a page may also send itself on as soon as it loads.
const WEB_AUTOMATION_SETTLE: StdDuration = StdDuration::from_millis(300);

/// Page loads in one window, counted as they start and finish, so a caller can wait for the next one.
#[derive(Default)]
struct WebAutomationPageLoads {
    counts: Mutex<(u64, u64)>,
    changed: std::sync::Condvar,
}

impl WebAutomationPageLoads {
    fn record(&self, finished: bool) {
        if let Ok(mut counts) = self.counts.lock() {
            if finished { counts.1 += 1; } else { counts.0 += 1; }
        }
        self.changed.notify_all();
    }

    fn counts(&self) -> (u64, u64) {
        self.counts.lock().map(|counts| *counts).unwrap_or_default()
    }

    /// Waits until a load finishes after `finished_before` and the page settles; with a grace, first until one starts
    /// after `started_before` (none starting is no navigation).
    fn wait(&self, started_before: u64, finished_before: u64, grace: Option<StdDuration>) -> AppResult<()> {
        let mut counts = self.counts.lock().map_err(|error| AppError::Message(error.to_string()))?;
        if let Some(grace) = grace {
            let (next, timeout) = self.changed.wait_timeout_while(counts, grace, |counts| counts.0 <= started_before)
                .map_err(|error| AppError::Message(error.to_string()))?;
            counts = next;
            if timeout.timed_out() { return Ok(()); }
        }
        let mut finished_before = finished_before;
        loop {
            let (next, timeout) = self.changed.wait_timeout_while(counts, WEB_AUTOMATION_NAVIGATION_TIMEOUT, |counts| counts.1 <= finished_before)
                .map_err(|error| AppError::Message(error.to_string()))?;
            if timeout.timed_out() { return Err(AppError::Message("The page did not finish loading.".into())); }
            let started = next.0;
            let (next, quiet) = self.changed.wait_timeout_while(next, WEB_AUTOMATION_SETTLE, |counts| counts.0 == started)
                .map_err(|error| AppError::Message(error.to_string()))?;
            if quiet.timed_out() { return Ok(()); }
            finished_before = next.1;
            counts = next;
        }
    }
}

struct WebAutomationWorker {
    label: String,
    profile_id: String,
    loads: Arc<WebAutomationPageLoads>,
}

static WEB_AUTOMATION_WORKERS: OnceLock<Mutex<HashMap<String, WebAutomationWorker>>> = OnceLock::new();
static WEB_AUTOMATION_NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn web_automation_next_id() -> u64 {
    WEB_AUTOMATION_NEXT_ID.fetch_add(1, Ordering::SeqCst)
}

fn web_automation_workers() -> AppResult<std::sync::MutexGuard<'static, HashMap<String, WebAutomationWorker>>> {
    WEB_AUTOMATION_WORKERS.get_or_init(|| Mutex::new(HashMap::new())).lock().map_err(|error| AppError::Message(error.to_string()))
}

fn web_automation_profile_label(profile_id: &str) -> String {
    profile_id.chars().filter(|character| character.is_ascii_alphanumeric() || *character == '-').collect()
}

/// One persistent store per browser profile, shared by its workers and its sign-in window, apart from the integration browser's.
#[cfg(target_os = "macos")]
fn web_automation_data_store_id(profile_id: &str) -> [u8; 16] {
    let half = |seed: u64| {
        let mut hash = seed;
        for byte in format!("hvy-galaxy-web-automation:{profile_id}").bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        hash.to_be_bytes()
    };
    let mut id = [0_u8; 16];
    id[..8].copy_from_slice(&half(0xcbf2_9ce4_8422_2325));
    id[8..].copy_from_slice(&half(0x8422_2325_cbf2_9ce4));
    id
}

fn web_automation_window(app: &AppHandle, label: &str, profile_id: &str, visible: bool, loads: Arc<WebAutomationPageLoads>, user: bool) -> AppResult<tauri::WebviewWindow> {
    let blank = tauri::Url::parse("about:blank").map_err(|error| AppError::Message(error.to_string()))?;
    let event_app = app.clone();
    let event_profile_id = profile_id.to_string();
    let builder = tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::External(blank))
        .title("HVY Galaxy")
        .visible(visible)
        .inner_size(1180.0, 820.0)
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        // The inspector reports some results by navigating to hvy-integration:// URLs; workers read return values instead.
        .on_navigation(|url| !url.as_str().starts_with("hvy-integration://"))
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_page_load(move |_, payload| {
            let finished = payload.event() == tauri::webview::PageLoadEvent::Finished;
            loads.record(finished);
            // The sign-in window's navigations report back, once each as in Electron, so the renderer sees sign-in
            // complete.
            if user && finished {
                let _ = event_app.emit("web-automation-navigation", serde_json::json!({ "profileId": event_profile_id, "window": "user", "url": payload.url().as_str() }));
            }
        });
    #[cfg(target_os = "macos")]
    let builder = builder.data_store_identifier(web_automation_data_store_id(profile_id));
    #[cfg(not(target_os = "macos"))]
    let builder = builder.data_directory(app.path().app_local_data_dir().map_err(|error| AppError::Message(error.to_string()))?
        .join("web-automation").join(web_automation_profile_label(profile_id)));
    builder.build().map_err(|error| AppError::Message(error.to_string()))
}

fn web_automation_worker(app: &AppHandle, worker_id: &str) -> AppResult<(tauri::WebviewWindow, Arc<WebAutomationPageLoads>)> {
    let workers = web_automation_workers()?;
    let worker = workers.get(worker_id).ok_or_else(|| AppError::Message(format!("Unknown worker {worker_id}.")))?;
    let window = app.get_webview_window(&worker.label).ok_or_else(|| AppError::Message(format!("Unknown worker {worker_id}.")))?;
    Ok((window, worker.loads.clone()))
}

fn web_automation_create_worker(app: &AppHandle, worker_id: &str, profile_id: &str) -> AppResult<()> {
    let loads = Arc::new(WebAutomationPageLoads::default());
    let label = format!("web-automation-worker-{}", web_automation_next_id());
    web_automation_window(app, &label, profile_id, false, loads.clone(), false)?;
    web_automation_workers()?.insert(worker_id.into(), WebAutomationWorker { label, profile_id: profile_id.into(), loads });
    Ok(())
}

fn web_automation_close_worker(app: &AppHandle, worker_id: &str) -> AppResult<Option<String>> {
    let worker = web_automation_workers()?.remove(worker_id);
    let Some(worker) = worker else { return Ok(None) };
    if let Some(window) = app.get_webview_window(&worker.label) {
        window.destroy().map_err(|error| AppError::Message(error.to_string()))?;
    }
    Ok(Some(worker.profile_id))
}

/// Evaluates a script and returns its (synchronous) result, as the JSON the webview serializes it to.
fn web_automation_eval(window: &tauri::WebviewWindow, script: String) -> AppResult<Option<serde_json::Value>> {
    let (sender, receiver) = std::sync::mpsc::channel();
    window.eval_with_callback(script, move |result| { let _ = sender.send(result); })
        .map_err(|error| AppError::Message(error.to_string()))?;
    // No answer while the page is navigating: the caller tries again.
    match receiver.recv_timeout(StdDuration::from_secs(5)) {
        Ok(result) => Ok(serde_json::from_str(&result).ok()),
        Err(_) => Ok(None),
    }
}

enum WebAutomationPageResult {
    Value(serde_json::Value),
    /// The page went away before the call finished (a command that navigates).
    Navigated,
}

/// Calls a function of the shared page script, after the inspector it uses, and waits for its result.
fn web_automation_page_call(window: &tauri::WebviewWindow, name: &str, argument: &serde_json::Value) -> AppResult<WebAutomationPageResult> {
    let call_id = format!("call-{}", web_automation_next_id());
    window.eval(format!("{INTEGRATION_INSPECTOR}\n{WEB_AUTOMATION_PAGE}\nwindow.__hvyGalaxyAutomation.start({call_id:?}, {name:?}, {argument});"))
        .map_err(|error| AppError::Message(error.to_string()))?;
    let started = std::time::Instant::now();
    while started.elapsed() < WEB_AUTOMATION_CALL_TIMEOUT {
        let taken = web_automation_eval(window, format!("window.__hvyGalaxyAutomation ? window.__hvyGalaxyAutomation.take({call_id:?}) : 'unknown'"))?;
        match taken {
            Some(serde_json::Value::String(text)) if text == "unknown" => return Ok(WebAutomationPageResult::Navigated),
            Some(serde_json::Value::String(text)) => {
                let result: serde_json::Value = serde_json::from_str(&text)?;
                if let Some(error) = result.get("error").and_then(serde_json::Value::as_str) {
                    return Err(AppError::Message(error.into()));
                }
                return Ok(WebAutomationPageResult::Value(result.get("value").cloned().unwrap_or(serde_json::Value::Null)));
            }
            _ => std::thread::sleep(WEB_AUTOMATION_POLL_INTERVAL),
        }
    }
    Err(AppError::Message(format!("The page did not answer {name} in time.")))
}

/// Where the window is. A window that has loaded nothing has no URL to ask for (wry panics on it).
fn web_automation_location(window: &tauri::WebviewWindow, loads: &WebAutomationPageLoads) -> AppResult<serde_json::Value> {
    if loads.counts().1 == 0 { return Ok(serde_json::json!({ "url": "about:blank" })); }
    Ok(serde_json::json!({ "url": window.url().map_err(|error| AppError::Message(error.to_string()))?.as_str() }))
}

fn web_automation_url(args: &serde_json::Value, key: &str) -> AppResult<tauri::Url> {
    args.get(key).and_then(serde_json::Value::as_str).unwrap_or_default().parse::<tauri::Url>()
        .map_err(|error| AppError::Message(error.to_string()))
}

fn web_automation_text<'a>(args: &'a serde_json::Value, key: &str) -> AppResult<&'a str> {
    args.get(key).and_then(serde_json::Value::as_str).ok_or_else(|| AppError::Message(format!("Missing {key}.")))
}

fn web_automation_user_label(profile_id: &str) -> String {
    format!("web-automation-user-{}", web_automation_profile_label(profile_id))
}

/// The host commands that wait on pages: run off the async runtime, since they block until the page answers.
fn web_automation_page_command(app: &AppHandle, command: &str, args: &serde_json::Value) -> AppResult<serde_json::Value> {
    match command {
        "create-worker" => {
            let worker_id = format!("worker-{}", web_automation_next_id());
            web_automation_create_worker(app, &worker_id, web_automation_text(args, "profileId")?)?;
            Ok(serde_json::Value::String(worker_id))
        }
        // History cannot be cleared in a webview, so the worker gets a fresh window in the same profile, on the page
        // the old one was on: as in Electron, only the history goes (an API worker stays on its service's page).
        "reset-worker" => {
            let worker_id = web_automation_text(args, "workerId")?;
            let (window, loads) = web_automation_worker(app, worker_id)?;
            let location = web_automation_location(&window, &loads)?;
            if let Some(profile_id) = web_automation_close_worker(app, worker_id)? {
                web_automation_create_worker(app, worker_id, &profile_id)?;
                if let Some(url) = location["url"].as_str().filter(|url| *url != "about:blank") {
                    let (window, loads) = web_automation_worker(app, worker_id)?;
                    let (_, finished) = loads.counts();
                    window.navigate(url.parse::<tauri::Url>().map_err(|error| AppError::Message(error.to_string()))?)
                        .map_err(|error| AppError::Message(error.to_string()))?;
                    loads.wait(0, finished, None)?;
                }
            }
            Ok(serde_json::Value::Null)
        }
        "close-worker" => {
            web_automation_close_worker(app, web_automation_text(args, "workerId")?)?;
            Ok(serde_json::Value::Null)
        }
        "show-worker" => {
            let (window, _) = web_automation_worker(app, web_automation_text(args, "workerId")?)?;
            window.show().map_err(|error| AppError::Message(error.to_string()))?;
            window.set_focus().map_err(|error| AppError::Message(error.to_string()))?;
            Ok(serde_json::Value::Null)
        }
        "hide-worker" => {
            let (window, _) = web_automation_worker(app, web_automation_text(args, "workerId")?)?;
            window.hide().map_err(|error| AppError::Message(error.to_string()))?;
            Ok(serde_json::Value::Null)
        }
        "navigate" => {
            let (window, loads) = web_automation_worker(app, web_automation_text(args, "workerId")?)?;
            let (_, finished) = loads.counts();
            let before = web_automation_location(&window, &loads)?;
            let url = web_automation_url(args, "url")?;
            window.navigate(url.clone()).map_err(|error| AppError::Message(error.to_string()))?;
            loads.wait(0, finished, None)?;
            // A page that fails to load still finishes, leaving the window where it was.
            let after = web_automation_location(&window, &loads)?;
            if after == before && after["url"].as_str() != Some(url.as_str()) {
                return Err(AppError::Message(format!("The page failed to load: {url}")));
            }
            Ok(after)
        }
        "back" => {
            let (window, loads) = web_automation_worker(app, web_automation_text(args, "workerId")?)?;
            let (started, finished) = loads.counts();
            window.eval("window.history.back()").map_err(|error| AppError::Message(error.to_string()))?;
            // With no page to go back to, nothing loads.
            loads.wait(started, finished, Some(WEB_AUTOMATION_NAVIGATION_GRACE))?;
            web_automation_location(&window, &loads)
        }
        "inspect" | "request" => {
            let (window, _) = web_automation_worker(app, web_automation_text(args, "workerId")?)?;
            let argument = args.get("request").cloned().unwrap_or(serde_json::Value::Null);
            match web_automation_page_call(&window, command, &argument)? {
                WebAutomationPageResult::Value(value) => Ok(value),
                WebAutomationPageResult::Navigated => Err(AppError::Message("The page changed before it answered.".into())),
            }
        }
        // A page command (such as Next) or an item command; waits for the page it opens, if any.
        "run-command" => {
            let (window, loads) = web_automation_worker(app, web_automation_text(args, "workerId")?)?;
            let (started, finished) = loads.counts();
            let payload = args.get("payload").cloned().unwrap_or(serde_json::Value::Null);
            let result = match web_automation_page_call(&window, "runCommand", &payload)? {
                WebAutomationPageResult::Value(value) => value,
                // The page it left was the command's doing: it ran.
                WebAutomationPageResult::Navigated => serde_json::json!({ "status": "executed" }),
            };
            loads.wait(started, finished, Some(WEB_AUTOMATION_NAVIGATION_GRACE))?;
            Ok(result)
        }
        // The site's own sign-in page, shown to the user.
        "open-user-window" => {
            let profile_id = web_automation_text(args, "profileId")?;
            let label = web_automation_user_label(profile_id);
            let window = match app.get_webview_window(&label) {
                Some(window) => window,
                None => web_automation_window(app, &label, profile_id, true, Arc::new(WebAutomationPageLoads::default()), true)?,
            };
            window.navigate(web_automation_url(args, "url")?).map_err(|error| AppError::Message(error.to_string()))?;
            window.show().map_err(|error| AppError::Message(error.to_string()))?;
            window.set_focus().map_err(|error| AppError::Message(error.to_string()))?;
            Ok(serde_json::Value::Null)
        }
        "hide-user-window" => {
            if let Some(window) = app.get_webview_window(&web_automation_user_label(web_automation_text(args, "profileId")?)) {
                window.close().map_err(|error| AppError::Message(error.to_string()))?;
            }
            Ok(serde_json::Value::Null)
        }
        _ => Err(AppError::Message(format!("Unknown web automation host command {command}."))),
    }
}

/// A served document's file, read into memory outside any page: no cookies, no redirects (a redirect is an error), no
/// referrer, no cache.
async fn web_automation_fetch_file(url: &str, max_bytes: u64) -> AppResult<serde_json::Value> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| AppError::Message(error.to_string()))?;
    let mut response = client.get(url).header("Cache-Control", "no-store").send().await
        .map_err(|error| AppError::Message(error.to_string()))?;
    if !response.status().is_success() {
        return Err(AppError::Message(format!("Reading the file returned {}.", response.status().as_u16())));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| AppError::Message(error.to_string()))? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() as u64 > max_bytes {
            return Err(AppError::Message(format!("The file is larger than {max_bytes} bytes.")));
        }
    }
    Ok(serde_json::Value::Array(bytes.into_iter().map(serde_json::Value::from).collect()))
}

#[tauri::command]
async fn web_automation_host(app: AppHandle, command: String, args: serde_json::Value) -> AppResult<serde_json::Value> {
    if command == "fetch-file" {
        let max_bytes = args.get("maxBytes").and_then(serde_json::Value::as_u64).unwrap_or(0);
        return web_automation_fetch_file(web_automation_text(&args, "url")?, max_bytes).await;
    }
    tauri::async_runtime::spawn_blocking(move || web_automation_page_command(&app, &command, &args))
        .await
        .map_err(|error| AppError::Message(error.to_string()))?
}

// A browser window's chrome (src-electron/browser-chrome.cjs is Electron's): the toolbar above the page
// (src/integrationToolbar/toolbar.ts) with back, forward, reload, the address and its security, Site information (the
// page's certificate, or why the browser refused it), and close. The integration browser, the web automation sign-in
// window, and the pop-ups a sign-in page opens all use it. The integration browser adds its own: its page menu,
// picking's buttons, and navigation inside its allowed sites.

const INTEGRATION_TOOLBAR_HEIGHT: f64 = 52.0;
/// The toolbar's height while it shows Site information, below its bar and over the page.
const INTEGRATION_SITE_INFO_HEIGHT: f64 = 360.0;
#[cfg(target_os = "macos")]
const INTEGRATION_TOOLBAR_WINDOW_INSET: f64 = 15.0;
#[cfg(not(target_os = "macos"))]
const INTEGRATION_TOOLBAR_WINDOW_INSET: f64 = 0.0;

/// What a browser's toolbar asks (src/integrationToolbar/toolbar.ts).
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum IntegrationToolbarMessage {
    Browser { command: String },
    Navigate { url: String },
    ToolbarAction { action: String },
    InspectorControl { id: String },
    /// Site information, opened (the toolbar is made taller over the page for it) or closed.
    SiteInfo { open: bool },
}

type IntegrationToolbarHandler = Arc<dyn Fn(IntegrationToolbarMessage) + Send + Sync>;

/// Each open browser's toolbar handler, by the toolbar's webview label: it holds the browser it acts on.
static INTEGRATION_TOOLBAR_HANDLERS: OnceLock<Mutex<HashMap<String, IntegrationToolbarHandler>>> = OnceLock::new();

fn register_integration_toolbar_handler(label: &str, handler: IntegrationToolbarHandler) {
    let handlers = INTEGRATION_TOOLBAR_HANDLERS.get_or_init(|| Mutex::new(HashMap::new()));
    handlers.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).insert(label.into(), handler);
}

fn forget_integration_toolbar_handler(label: &str) {
    if let Some(handlers) = INTEGRATION_TOOLBAR_HANDLERS.get() {
        handlers.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).remove(label);
    }
}

/// The toolbar's IPC: its message, to the handler its browser registered for it.
#[tauri::command]
fn integration_toolbar_message(webview: tauri::Webview, message: IntegrationToolbarMessage) -> AppResult<()> {
    let handler = INTEGRATION_TOOLBAR_HANDLERS.get()
        .and_then(|handlers| handlers.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).get(webview.label()).cloned());
    if let Some(handler) = handler {
        handler(message);
    }
    Ok(())
}

/// What a browser's chrome follows: its toolbar, where its page is, and the sites it allows (none for a plain browser).
#[derive(Clone)]
struct BrowserChrome {
    toolbar_label: String,
    current_url: Arc<Mutex<Option<tauri::Url>>>,
    allowed_origins: Arc<Mutex<Vec<String>>>,
}

impl BrowserChrome {
    /// A plain browser's (the sign-in window, a pop-up): its toolbar labelled after its window.
    fn plain(window_label: &str) -> Self {
        BrowserChrome {
            toolbar_label: format!("{window_label}-toolbar"),
            current_url: Arc::new(Mutex::new(None)),
            allowed_origins: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// The toolbar told where the page is.
    fn show_location(&self, app: &AppHandle, url: &tauri::Url) {
        if let Some(toolbar) = app.get_webview(&self.toolbar_label) {
            let allowed = self.allowed_origins.lock().map(|origins| origins.clone()).unwrap_or_default();
            let state = serde_json::json!({ "url": url.as_str(), "allowed": allowed });
            let _ = toolbar.eval(format!("window.hvySetBrowserState({state})"));
        }
    }

    /// A page load: where the page is noted, and once it has loaded, the toolbar told.
    fn page_loaded(&self, app: &AppHandle, url: &tauri::Url, finished: bool) {
        if let Ok(mut current) = self.current_url.lock() {
            *current = Some(url.clone());
        }
        if finished {
            self.show_location(app, url);
        }
    }
}

struct BrowserChromeOptions {
    /// An integration's browser (its page menu and allowed sites); otherwise a plain browser's.
    integration: bool,
    /// The browser profile's name, for Site information.
    profile_name: String,
    /// What the toolbar asks beyond its browser buttons and Site information. Without it, an address typed loads.
    on_message: Option<IntegrationToolbarHandler>,
}

/// Puts the toolbar over `page` in its window, and the page below it, laid out again as the window resizes. Runs off the
/// main thread: adding a webview waits on it.
fn attach_browser_chrome(app: &AppHandle, window: &tauri::Window, page: &tauri::Webview, chrome: &BrowserChrome, options: BrowserChromeOptions) -> AppResult<tauri::Webview> {
    let scale = window.scale_factor().map_err(|error| AppError::Message(error.to_string()))?;
    let logical_size = window.inner_size().map_err(|error| AppError::Message(error.to_string()))?.to_logical::<f64>(scale);
    let toolbar_view_height = INTEGRATION_TOOLBAR_HEIGHT + INTEGRATION_TOOLBAR_WINDOW_INSET;
    page.set_auto_resize(false).map_err(|error| AppError::Message(error.to_string()))?;
    page.set_bounds(tauri::Rect {
        position: tauri::LogicalPosition::new(0.0, toolbar_view_height).into(),
        size: tauri::LogicalSize::new(logical_size.width, (logical_size.height - toolbar_view_height).max(0.0)).into(),
    }).map_err(|error| AppError::Message(error.to_string()))?;
    keep_fraudulent_website_warnings(page).map_err(|error| AppError::Message(error.to_string()))?;
    let toolbar_label = chrome.toolbar_label.clone();
    // Site information: whether it is open (the window's resizing keeps the toolbar's height then), and the browser
    // profile it names.
    let site_info_open = Arc::new(AtomicBool::new(false));
    // Site information, opened on the page shown, or on a page the browser refused (`blocked`: its address, and why):
    // the toolbar made taller over the page, and told what Galaxy knows of the site.
    let show_site_info: Arc<dyn Fn(Option<(String, String)>) + Send + Sync> = {
        let app = app.clone();
        let label = toolbar_label.clone();
        let window = window.clone();
        let open = site_info_open.clone();
        let current_url = chrome.current_url.clone();
        let origins = chrome.allowed_origins.clone();
        let page = page.clone();
        let profile_name = options.profile_name.clone();
        Arc::new(move |blocked: Option<(String, String)>| {
            open.store(true, Ordering::SeqCst);
            let Some(toolbar) = app.get_webview(&label) else { return };
            let width = window.inner_size().map(|size| size.to_logical::<f64>(scale).width).unwrap_or(0.0);
            let _ = toolbar.set_size(tauri::LogicalSize::new(width, INTEGRATION_SITE_INFO_HEIGHT));
            let allowed = origins.lock().map(|origins| origins.clone()).unwrap_or_default();
            let profile_name = profile_name.clone();
            // A refused page has no certificate to read: the page shown is still the one before it.
            if let Some((url, reason)) = blocked {
                let info = serde_json::json!({
                    "url": url,
                    "allowed": allowed,
                    "profileName": profile_name,
                    "certificate": null,
                    "certificateNote": "This browser doesn’t show a certificate it refused.",
                    "blocked": reason,
                });
                let _ = toolbar.eval(format!("window.hvySetSiteInfo?.({info})"));
                return;
            }
            let url = current_url.lock().ok().and_then(|url| url.as_ref().map(ToString::to_string)).unwrap_or_default();
            let secure = url.starts_with("https:");
            let _ = integration_page_security(&page, move |certificate, only_secure_content| {
                let note = if certificate.is_some() {
                    None
                } else if !secure {
                    Some("This page isn’t on a secure connection, so it has no certificate.")
                } else if cfg!(target_os = "macos") {
                    Some("The certificate couldn’t be read.")
                } else {
                    Some("This browser doesn’t show certificate details for a secure connection.")
                };
                let info = serde_json::json!({
                    "url": url,
                    "allowed": allowed,
                    "profileName": profile_name,
                    "certificate": certificate,
                    "certificateNote": note,
                    "onlySecureContent": only_secure_content,
                });
                let _ = toolbar.eval(format!("window.hvySetSiteInfo?.({info})"));
            });
        })
    };
    // A page the browser refuses for its certificate or secure connection opens Site information on it, saying why.
    let refused_show_site_info = show_site_info.clone();
    watch_refused_pages(page, Arc::new(move |url: String, reason: String| refused_show_site_info(Some((url, reason)))))
        .map_err(|error| AppError::Message(error.to_string()))?;
    // What the toolbar asks comes over IPC (integration_toolbar_message), to this browser's handler: the toolbar is known
    // by its webview's label. The browser's buttons and Site information are handled here; anything else goes to the
    // browser's own handler.
    {
        let app = app.clone();
        let window = window.clone();
        let page = page.clone();
        let open = site_info_open.clone();
        let label = toolbar_label.clone();
        let on_message = options.on_message;
        register_integration_toolbar_handler(&toolbar_label, Arc::new(move |message: IntegrationToolbarMessage| match message {
            IntegrationToolbarMessage::Browser { command } => match command.as_str() {
                "back" => { let _ = integration_world::eval(&page, "window.history.back()"); }
                "forward" => { let _ = integration_world::eval(&page, "window.history.forward()"); }
                "reload" => { let _ = page.reload(); }
                "close" => { let _ = window.close(); }
                _ => {}
            },
            IntegrationToolbarMessage::SiteInfo { open: true } => show_site_info(None),
            IntegrationToolbarMessage::SiteInfo { open: false } => {
                open.store(false, Ordering::SeqCst);
                let Some(toolbar) = app.get_webview(&label) else { return };
                let width = window.inner_size().map(|size| size.to_logical::<f64>(scale).width).unwrap_or(0.0);
                let _ = toolbar.set_size(tauri::LogicalSize::new(width, toolbar_view_height));
            }
            other => match &on_message {
                Some(on_message) => on_message(other),
                None => {
                    if let IntegrationToolbarMessage::Navigate { url } = other {
                        if let Ok(url) = url.parse::<tauri::Url>() {
                            if url.scheme() == "https" || url.scheme() == "http" { let _ = page.navigate(url); }
                        }
                    }
                }
            },
        }));
    }
    let mode = if options.integration { "integration" } else { "browse" };
    let toolbar = window.add_child(
        tauri::webview::WebviewBuilder::new(&toolbar_label, tauri::WebviewUrl::App(format!("pages/integration-toolbar.html?mode={mode}").into())),
        tauri::LogicalPosition::new(0.0, 0.0),
        tauri::LogicalSize::new(logical_size.width, toolbar_view_height),
    ).map_err(|error| AppError::Message(error.to_string()))?;
    let resized_page = page.clone();
    let resized_toolbar = toolbar.clone();
    let destroyed_label = toolbar_label;
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Resized(size) => {
            let logical_size = size.to_logical::<f64>(scale);
            let _ = resized_page.set_bounds(tauri::Rect {
                position: tauri::LogicalPosition::new(0.0, toolbar_view_height).into(),
                size: tauri::LogicalSize::new(logical_size.width, (logical_size.height - toolbar_view_height).max(0.0)).into(),
            });
            let height = if site_info_open.load(Ordering::SeqCst) { INTEGRATION_SITE_INFO_HEIGHT } else { toolbar_view_height };
            let _ = resized_toolbar.set_bounds(tauri::Rect {
                position: tauri::LogicalPosition::new(0.0, 0.0).into(),
                size: tauri::LogicalSize::new(logical_size.width, height).into(),
            });
        }
        tauri::WindowEvent::Destroyed => forget_integration_toolbar_handler(&destroyed_label),
        _ => {}
    });
    Ok(toolbar)
}

/// What to do when a page closes itself (`window.close()`), by web view: wry's UI delegate is told, and finds the web
/// view's here.
#[cfg(target_os = "macos")]
static PAGE_CLOSE_HANDLERS: OnceLock<Mutex<HashMap<usize, Arc<dyn Fn() + Send + Sync>>>> = OnceLock::new();

/// `webViewDidClose:`, which wry's UI delegate doesn't have: the page called `window.close()`.
#[cfg(target_os = "macos")]
unsafe extern "C-unwind" fn webkit_did_close(_delegate: *mut objc2::runtime::AnyObject, _command: objc2::runtime::Sel, webview: *mut objc2::runtime::AnyObject) {
    let handler = PAGE_CLOSE_HANDLERS.get()
        .and_then(|handlers| handlers.lock().ok().and_then(|mut handlers| handlers.remove(&(webview as usize))));
    if let Some(handler) = handler {
        handler();
    }
}

/// Closes `window` when its page closes itself, as a pop-up does once it has answered its opener (Google's account
/// picker). WebKit tells a web view's UI delegate, and wry's has no method for it: it is added to the delegate's own class
/// (wry names its classes with its version, so they aren't looked up by name), unless wry gains its own, and the
/// delegate set again, as WebKit looks at which methods a delegate has when it is set.
#[cfg(target_os = "macos")]
fn close_window_when_page_closes(page: &tauri::Webview, window: tauri::Window) -> tauri::Result<()> {
    use objc2_web_kit::WKWebView;
    page.with_webview(move |platform| unsafe {
        let view = &*(platform.inner() as *const WKWebView);
        let Some(delegate) = view.UIDelegate() else { return };
        let object: &objc2::runtime::AnyObject = delegate.as_ref();
        let method: unsafe extern "C-unwind" fn(_, _, _) = webkit_did_close;
        let imp: objc2::runtime::Imp = std::mem::transmute(method);
        // Added once: a class that already has it (an earlier pop-up's) keeps it.
        objc2::ffi::class_addMethod(object.class() as *const _ as *mut _, objc2::sel!(webViewDidClose:), imp, c"v@:@".as_ptr());
        if let Ok(mut handlers) = PAGE_CLOSE_HANDLERS.get_or_init(|| Mutex::new(HashMap::new())).lock() {
            handlers.insert(view as *const WKWebView as usize, Arc::new(move || {
                let window = window.clone();
                tauri::async_runtime::spawn(async move { let _ = window.close(); });
            }));
        }
        view.setUIDelegate(Some(&*delegate));
    })
}

/// Closes `window` when its page closes itself, as the macOS one does: WebView2 tells it as WindowCloseRequested.
#[cfg(target_os = "windows")]
fn close_window_when_page_closes(page: &tauri::Webview, window: tauri::Window) -> tauri::Result<()> {
    use webview2_com::{Microsoft::Web::WebView2::Win32::ICoreWebView2, WindowCloseRequestedEventHandler};
    page.with_webview(move |platform| unsafe {
        let Ok(core_webview): Result<ICoreWebView2, _> = platform.controller().CoreWebView2() else { return };
        let mut token = 0;
        let _ = core_webview.add_WindowCloseRequested(
            &WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
                let window = window.clone();
                tauri::async_runtime::spawn(async move { let _ = window.close(); });
                Ok(())
            })),
            &mut token,
        );
    })
}

/// WebKitGTK: not hooked yet, so a pop-up stays open once it has answered.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn close_window_when_page_closes(_page: &tauri::Webview, _window: tauri::Window) -> tauri::Result<()> {
    Ok(())
}

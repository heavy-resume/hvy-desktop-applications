// What an integration browser shows of a page's security (Site information, on its toolbar): the certificate its
// connection presented, read from the certificate itself (DER), and where the webview tells, whether all of the page
// loaded over a secure connection.

/// One DER element: its tag, its contents, and what follows it.
fn der_element(data: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    let (&tag, rest) = data.split_first()?;
    let (&first, rest) = rest.split_first()?;
    let (length, rest) = if first < 0x80 {
        (first as usize, rest)
    } else {
        let count = (first & 0x7f) as usize;
        if count == 0 || count > 4 || rest.len() < count {
            return None;
        }
        (rest[..count].iter().fold(0usize, |length, byte| (length << 8) | *byte as usize), &rest[count..])
    };
    if rest.len() < length {
        return None;
    }
    Some((tag, &rest[..length], &rest[length..]))
}

/// The elements inside a constructed one, in order.
fn der_children(mut data: &[u8]) -> Vec<(u8, &[u8])> {
    let mut children = Vec::new();
    while let Some((tag, contents, rest)) = der_element(data) {
        children.push((tag, contents));
        data = rest;
    }
    children
}

/// A directory string as text: UTF-8, printable, IA5, or T.61 as bytes; BMP as UTF-16.
fn der_text(tag: u8, contents: &[u8]) -> Option<String> {
    match tag {
        0x0c | 0x13 | 0x14 | 0x16 => Some(String::from_utf8_lossy(contents).into_owned()),
        0x1e => {
            let units: Vec<u16> = contents.chunks_exact(2).map(|pair| u16::from_be_bytes([pair[0], pair[1]])).collect();
            Some(String::from_utf16_lossy(&units))
        }
        _ => None,
    }
}

/// A name as people read it: its common name, then its organization in parentheses, when it has them.
fn der_name(name: &[u8]) -> String {
    let (mut common_name, mut organization) = (None, None);
    for (_, set) in der_children(name) {
        for (_, attribute) in der_children(set) {
            let parts = der_children(attribute);
            let (Some((0x06, oid)), Some((tag, value))) = (parts.first().copied(), parts.get(1).copied()) else { continue };
            match oid {
                [0x55, 0x04, 0x03] => common_name = der_text(tag, value),
                [0x55, 0x04, 0x0a] => organization = der_text(tag, value),
                _ => {}
            }
        }
    }
    match (common_name, organization) {
        (Some(name), Some(organization)) if name != organization => format!("{name} ({organization})"),
        (Some(name), _) => name,
        (None, Some(organization)) => organization,
        (None, None) => "Unknown".into(),
    }
}

/// A certificate time (UTCTime or GeneralizedTime) as ISO 8601.
fn der_time(tag: u8, contents: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(contents).ok()?;
    let digits = text.trim_end_matches('Z');
    let full = match tag {
        // UTCTime: two-digit years, 50 and up in the 1900s.
        0x17 if digits.len() >= 12 => format!("{}{digits}", if digits[..2].parse::<u32>().ok()? >= 50 { "19" } else { "20" }),
        0x18 if digits.len() >= 14 => digits.to_string(),
        _ => return None,
    };
    Some(format!("{}-{}-{}T{}:{}:{}Z", &full[0..4], &full[4..6], &full[6..8], &full[8..10], &full[10..12], &full[12..14]))
}

/// What Site information shows of a certificate (DER): who it was issued to and by, when it is valid, and its SHA-256
/// fingerprint. None for one it can't read.
fn certificate_summary(der: &[u8]) -> Option<serde_json::Value> {
    use sha2::Digest;
    let (0x30, certificate, _) = der_element(der)? else { return None };
    let (0x30, tbs, _) = der_element(certificate)? else { return None };
    let mut fields = der_children(tbs).into_iter();
    // The version, [0], is there in every certificate but the first version's.
    let mut field = fields.next()?;
    if field.0 == 0xa0 {
        field = fields.next()?;
    }
    let _serial = field;
    let _signature = fields.next()?;
    let (0x30, issuer) = fields.next()? else { return None };
    let (0x30, validity) = fields.next()? else { return None };
    let (0x30, subject) = fields.next()? else { return None };
    let times = der_children(validity);
    let (from, to) = (times.first()?, times.get(1)?);
    let fingerprint = sha2::Sha256::digest(der).iter().map(|byte| format!("{byte:02X}")).collect::<Vec<_>>().join(":");
    Some(serde_json::json!({
        "subject": der_name(subject),
        "issuer": der_name(issuer),
        "validFrom": der_time(from.0, from.1)?,
        "validTo": der_time(to.0, to.1)?,
        "sha256": fingerprint,
    }))
}

/// The page's certificate (the first of its connection's chain, as WebKit verified it) and whether all of the page
/// loaded over a secure connection, given to `done` on the main thread, where WebKit's objects live.
#[cfg(target_os = "macos")]
fn integration_page_security(webview: &tauri::Webview, done: impl FnOnce(Option<serde_json::Value>, Option<bool>) + Send + 'static) -> tauri::Result<()> {
    use objc2_web_kit::WKWebView;
    webview.with_webview(move |platform| unsafe {
        let view = &*(platform.inner() as *const WKWebView);
        let certificate = view.serverTrust()
            .and_then(|trust| trust.certificate_chain())
            .filter(|chain| chain.count() > 0)
            .and_then(|chain| {
                let first = &*(chain.value_at_index(0) as *const objc2_security::SecCertificate);
                certificate_summary(&first.data().to_vec())
            });
        done(certificate, Some(view.hasOnlySecureContent()));
    })
}

/// WebView2 tells a page's certificate only when it fails: a good connection's is not there to show.
#[cfg(not(target_os = "macos"))]
fn integration_page_security(_webview: &tauri::Webview, done: impl FnOnce(Option<serde_json::Value>, Option<bool>) + Send + 'static) -> tauri::Result<()> {
    done(None, None);
    Ok(())
}

/// WebKit's warnings for suspected phishing and malware sites, kept on for an integration browser's page (WebKit's
/// default, set so nothing else turns them off). WebView2 checks a page's reputation with SmartScreen unless told not to.
#[cfg(target_os = "macos")]
fn keep_fraudulent_website_warnings(webview: &tauri::Webview) -> tauri::Result<()> {
    use objc2_web_kit::WKWebView;
    webview.with_webview(|platform| unsafe {
        let view = &*(platform.inner() as *const WKWebView);
        view.configuration().preferences().setFraudulentWebsiteWarningEnabled(true);
    })
}

#[cfg(not(target_os = "macos"))]
fn keep_fraudulent_website_warnings(_webview: &tauri::Webview) -> tauri::Result<()> {
    Ok(())
}

/// What a page refused by WebKit was refused for, by its error (NSURLErrorDomain): its certificate, or its secure
/// connection. None for any other failure (a page that didn't load for another reason isn't blocked).
fn webkit_refused_reason(domain: &str, code: i64) -> Option<&'static str> {
    if domain != "NSURLErrorDomain" {
        return None;
    }
    match code {
        -1201 | -1204 => Some("its certificate has expired, or isn’t valid yet."),
        -1202 | -1203 => Some("its certificate isn’t trusted: it is for another site, or not from an authority this browser trusts."),
        -1205 | -1206 => Some("it asks for a certificate from you, which this browser doesn’t give."),
        -1200 => Some("a secure connection to it couldn’t be set up."),
        _ => None,
    }
}

/// What a page refused by WebView2 was refused for, by its web error status: its certificate. None for anything else.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn webview2_refused_reason(status: i32) -> Option<&'static str> {
    match status {
        1 => Some("its certificate is for a different site."),
        2 => Some("its certificate has expired."),
        3 => Some("it asks for a certificate from you, which this browser doesn’t give."),
        4 => Some("its certificate has been revoked."),
        5 => Some("its certificate isn’t valid."),
        _ => None,
    }
}

/// A page refused for its certificate or secure connection, told with its address and why.
type OnRefusedPage = Arc<dyn Fn(String, String) + Send + Sync>;

/// WebKit's handlers for refused pages, by web view: wry's navigation delegate is told, and finds the web view's here.
#[cfg(target_os = "macos")]
static REFUSED_PAGE_HANDLERS: std::sync::OnceLock<Mutex<HashMap<usize, OnRefusedPage>>> = std::sync::OnceLock::new();

/// `webView:didFailProvisionalNavigation:withError:`, which wry's delegate doesn't have: a page WebKit refused before it
/// loaded, with why.
#[cfg(target_os = "macos")]
unsafe extern "C-unwind" fn webkit_did_fail_provisional_navigation(
    _delegate: *mut objc2::runtime::AnyObject,
    _command: objc2::runtime::Sel,
    webview: *mut objc2::runtime::AnyObject,
    _navigation: *mut objc2::runtime::AnyObject,
    error: *mut objc2_foundation::NSError,
) {
    use objc2_foundation::NSString;
    let Some(error) = (unsafe { error.as_ref() }) else { return };
    let Some(reason) = webkit_refused_reason(&error.domain().to_string(), error.code() as i64) else { return };
    let url = error.userInfo().objectForKey(&NSString::from_str("NSErrorFailingURLStringKey"))
        .and_then(|value| value.downcast::<NSString>().ok())
        .map(|value| value.to_string())
        .unwrap_or_default();
    let handler = REFUSED_PAGE_HANDLERS.get()
        .and_then(|handlers| handlers.lock().ok().and_then(|handlers| handlers.get(&(webview as usize)).cloned()));
    if let Some(handler) = handler {
        handler(url, reason.into());
    }
}

/// Tells `on_refused` of each page the browser refuses for its certificate or secure connection. WebKit tells a web view's
/// navigation delegate, and wry's has no method for it: it is added to the delegate's own class (wry names its classes
/// with its version, so they aren't looked up by name), unless wry gains its own, and the delegate set again, as WebKit
/// looks at which methods a delegate has when it is set.
#[cfg(target_os = "macos")]
fn watch_refused_pages(webview: &tauri::Webview, on_refused: OnRefusedPage) -> tauri::Result<()> {
    use objc2_web_kit::WKWebView;
    webview.with_webview(move |platform| unsafe {
        let view = &*(platform.inner() as *const WKWebView);
        let Some(delegate) = view.navigationDelegate() else { return };
        let object: &objc2::runtime::AnyObject = delegate.as_ref();
        let method: unsafe extern "C-unwind" fn(_, _, _, _, _) = webkit_did_fail_provisional_navigation;
        let imp: objc2::runtime::Imp = std::mem::transmute(method);
        // Added once: a class that already has it (an earlier browser's) keeps it.
        objc2::ffi::class_addMethod(object.class() as *const _ as *mut _, objc2::sel!(webView:didFailProvisionalNavigation:withError:), imp, c"v@:@@@".as_ptr());
        if let Ok(mut handlers) = REFUSED_PAGE_HANDLERS.get_or_init(|| Mutex::new(HashMap::new())).lock() {
            handlers.insert(view as *const WKWebView as usize, on_refused);
        }
        view.setNavigationDelegate(Some(&*delegate));
    })
}

/// WebView2 tells each navigation's outcome (NavigationCompleted), and a certificate it refused by its web error status.
#[cfg(target_os = "windows")]
fn watch_refused_pages(webview: &tauri::Webview, on_refused: OnRefusedPage) -> tauri::Result<()> {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{ICoreWebView2, COREWEBVIEW2_WEB_ERROR_STATUS},
        NavigationCompletedEventHandler,
    };
    use windows_core::{BOOL, PWSTR};
    webview.with_webview(move |platform| unsafe {
        let Ok(core_webview): Result<ICoreWebView2, _> = platform.controller().CoreWebView2() else { return };
        let mut token = 0;
        let _ = core_webview.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(move |sender, args| {
                let Some(args) = args else { return Ok(()) };
                let mut success = BOOL::default();
                args.IsSuccess(&mut success)?;
                if success.as_bool() {
                    return Ok(());
                }
                let mut status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
                args.WebErrorStatus(&mut status)?;
                let Some(reason) = webview2_refused_reason(status.0) else { return Ok(()) };
                let mut source = PWSTR::null();
                if let Some(sender) = sender {
                    sender.Source(&mut source)?;
                }
                on_refused(webview2_com::take_pwstr(source), reason.into());
                Ok(())
            })),
            &mut token,
        );
    })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn watch_refused_pages(_webview: &tauri::Webview, _on_refused: OnRefusedPage) -> tauri::Result<()> {
    Ok(())
}

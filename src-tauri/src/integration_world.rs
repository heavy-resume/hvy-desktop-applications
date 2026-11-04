//! Where Galaxy's scripts run in a page it reads (the integration browser's, a worker's). On macOS, in their own
//! content world (WKContentWorld), as Electron's isolated world: the page shares the document with them, but cannot see
//! them, change the browser's functions they call, or watch what they send, which goes to the host over a message
//! handler only their world has. Elsewhere, in the page's own world, with what they send as navigations carrying the
//! browser's token (integration-inspector.js).

use std::sync::Arc;

/// Whether Galaxy's scripts run out of the page's world: if not, the inspector goes in with the page's own scripts.
pub const ISOLATED: bool = cfg!(target_os = "macos");

#[cfg(target_os = "macos")]
mod native {
    use std::sync::Arc;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, ProtocolObject};
    use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
    use objc2_foundation::{NSError, NSObject, NSObjectProtocol, NSString};
    use objc2_web_kit::{WKContentWorld, WKScriptMessage, WKScriptMessageHandler, WKUserContentController, WKWebView};

    const WORLD: &str = "HVY Galaxy";
    const HANDLER: &str = "hvyGalaxy";

    /// Galaxy's channel in its world (integration-inspector.js `__hvyGalaxyHost`), to the message handler only its world
    /// has, before whatever runs there.
    const HOST: &str = "window.__hvyGalaxyHost ??= {
  publish: (value) => window.webkit.messageHandlers.hvyGalaxy.postMessage(JSON.stringify({ kind: 'publish', value })),
  toolbarState: (value) => window.webkit.messageHandlers.hvyGalaxy.postMessage(JSON.stringify({ kind: 'toolbar-state', value })),
  cancel: () => window.webkit.messageHandlers.hvyGalaxy.postMessage(JSON.stringify({ kind: 'cancel' })),
};";

    pub struct HandlerIvars {
        on_message: Arc<dyn Fn(String) + Send + Sync>,
    }

    define_class!(
        // What Galaxy's scripts send from their world: each message, as the JSON they post.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "HvyGalaxyIntegrationMessageHandler"]
        #[ivars = HandlerIvars]
        struct MessageHandler;

        unsafe impl NSObjectProtocol for MessageHandler {}

        unsafe impl WKScriptMessageHandler for MessageHandler {
            #[unsafe(method(userContentController:didReceiveScriptMessage:))]
            fn did_receive_script_message(&self, _controller: &WKUserContentController, message: &WKScriptMessage) {
                if let Ok(body) = unsafe { message.body() }.downcast::<NSString>() {
                    (self.ivars().on_message)(body.to_string());
                }
            }
        }
    );

    impl MessageHandler {
        fn new(mtm: MainThreadMarker, on_message: Arc<dyn Fn(String) + Send + Sync>) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(HandlerIvars { on_message });
            unsafe { msg_send![super(this), init] }
        }
    }

    thread_local! {
        // Held for the app's run, on the main thread, where it is used: WebKit keeps what runs in a world only while the
        // world is held, so a page's inspector would be gone between one call and the next.
        static CONTENT_WORLD: Retained<WKContentWorld> = unsafe { WKContentWorld::worldWithName(&NSString::from_str(WORLD), MainThreadMarker::new_unchecked()) };
    }

    fn world() -> Retained<WKContentWorld> {
        CONTENT_WORLD.with(Clone::clone)
    }

    // `with_webview` runs on the main thread, where WebKit's objects live.
    pub fn eval(webview: &tauri::Webview, script: String, callback: Option<Box<dyn Fn(String) + Send>>) -> tauri::Result<()> {
        webview.with_webview(move |platform| unsafe {
            let view = &*(platform.inner() as *const WKWebView);
            let source = NSString::from_str(&format!("{HOST}\n{script}"));
            match callback {
                None => view.evaluateJavaScript_inFrame_inContentWorld_completionHandler(&source, None, &world(), None),
                Some(callback) => {
                    let completion = block2::RcBlock::new(move |result: *mut AnyObject, _error: *mut NSError| {
                        let text = result.as_ref().and_then(|value| value.downcast_ref::<NSString>()).map(ToString::to_string);
                        callback(text.unwrap_or_else(|| "null".into()));
                    });
                    view.evaluateJavaScript_inFrame_inContentWorld_completionHandler(&source, None, &world(), Some(&completion));
                }
            }
        })
    }

    pub fn call_in_page(webview: &tauri::Webview, body: String, callback: Box<dyn Fn(Option<String>) + Send>) -> tauri::Result<()> {
        webview.with_webview(move |platform| unsafe {
            let mtm = MainThreadMarker::new_unchecked();
            let view = &*(platform.inner() as *const WKWebView);
            let completion = block2::RcBlock::new(move |result: *mut AnyObject, _error: *mut NSError| {
                callback(result.as_ref().and_then(|value| value.downcast_ref::<NSString>()).map(ToString::to_string));
            });
            view.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(&NSString::from_str(&body), None, None, &WKContentWorld::pageWorld(mtm), Some(&completion));
        })
    }

    pub fn listen(webview: &tauri::Webview, on_message: Arc<dyn Fn(String) + Send + Sync>) -> tauri::Result<()> {
        webview.with_webview(move |platform| unsafe {
            let mtm = MainThreadMarker::new_unchecked();
            let controller = &*(platform.controller() as *const WKUserContentController);
            let handler = MessageHandler::new(mtm, on_message);
            controller.addScriptMessageHandler_contentWorld_name(ProtocolObject::from_ref(&*handler), &world(), &NSString::from_str(HANDLER));
        })
    }
}

/// Runs a script where Galaxy's scripts run in the page.
pub fn eval(webview: &tauri::Webview, script: impl Into<String>) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    return native::eval(webview, script.into(), None);
    #[cfg(not(target_os = "macos"))]
    return webview.eval(script);
}

/// Runs an expression where Galaxy's scripts run in the page, and gives its value back as JSON.
pub fn eval_with_callback(webview: &tauri::Webview, expression: String, callback: impl Fn(String) + Send + 'static) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    return native::eval(webview, format!("JSON.stringify(({expression}) ?? null)"), Some(Box::new(callback)));
    #[cfg(not(target_os = "macos"))]
    return webview.eval_with_callback(expression, callback);
}

/// Runs a function body that gives back text, in the page's own world (where a page's own scripts and WebMCP tools are),
/// and waits for it, promise and all: `callback` has the text, or none if the page went away first. On macOS only, where
/// WebKit waits for a script's promise.
#[cfg(target_os = "macos")]
pub fn call_in_page(webview: &tauri::Webview, body: String, callback: impl Fn(Option<String>) + Send + 'static) -> tauri::Result<()> {
    native::call_in_page(webview, body, Box::new(callback))
}

/// Takes what Galaxy's scripts in the page send from their own world (each message's JSON), where they have one.
pub fn listen(webview: &tauri::Webview, on_message: Arc<dyn Fn(String) + Send + Sync>) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    return native::listen(webview, on_message);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (webview, on_message);
        Ok(())
    }
}

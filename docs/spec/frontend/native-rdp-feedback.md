# Native RDP connection feedback

The Windows RDP desktop is an ActiveX child HWND outside the React tree. Its connection feedback lives in a small native child surface above that desktop. It must not hide the desktop or infer connection success from painting, display resize success, or elapsed time.

## Contract

- `rdpLaunchConnection` reads resolved app tokens through the lazy shared `nativeAppearance` helper. The optional `appearance` request field contains native RGB colors and the reduced-motion preference; it does not belong to the saved connection profile.
- The native surface snapshots light, explicit dark, or system-dark appearance at launch. Changing theme while a native session is open takes effect on its next launch. Older callers without appearance use Windows system colors and a static indicator.
- `OnConnecting` starts feedback. `OnConnected` changes it to waiting for login and moves it above the remote sign-in controls. Only `OnLoginComplete` / `OnLoginCompleted` or `OnAutoReconnected` removes pending feedback.
- Waiting longer than 20 seconds changes the hint only. It does not create a timeout, failure, or success state.
- The initial resolution is configured before Connect. Subsequent display updates wait for login completion, then restart the existing resize retry window, including for slow logins. Transport connection alone does not guarantee that the server accepts display updates.
- Authentication/dialog events temporarily hide feedback so remote prompts remain operable.
- Disconnect and fatal events stop animation and retain numeric reason codes. Do not treat every Classic `OnLogonError` as fatal: some codes are informational.
- Retry reuses the control with a fresh event subscription and state. It must not store a second copy of credentials. Closing the native tab cancels the session through the existing close path.
- COM callbacks enqueue values and post a host message. They must not borrow host state, call Connect/Disconnect, or mutate byref decision parameters.
- Drop the subscription before disconnecting or destroying its control. Inactive tabs hide their feedback; only the active pending tab runs the animation timer. This timer must never initiate display negotiation.

## Verification

- Run TypeScript checking, production build, startup module boundary checking, Rust formatting, and the focused `rdp::` tests.
- Windows ignored tests explicitly create installed controls or native preview windows. They never connect to a remote server. The native preview covers active/inactive visibility, authentication dialogs, login completion, retry routing, dark colors and reduced motion.
- The Windows test executable needs the Common Controls v6 manifest used by the desktop application. If the test runner exits with `0xc0000139`, add this dependency to a disposable test executable with the Windows SDK manifest tool before running assertions. Do not count `--no-run` as passing tests.
- Verify actual remote login, slow login, certificate prompts, disconnect/retry, automatic reconnection, multiple tabs, and DPI changes in the desktop app. The login-completed event is not a first-frame guarantee.
- On the current Windows machine, Classic subscription and cleanup are verified against the installed COM control. Creating the Modern control independently returns `0x80070005`; its event mapping is tested through IDispatch, while actual Modern control integration still needs an environment that supports it.

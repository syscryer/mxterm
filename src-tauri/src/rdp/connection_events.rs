//! COM event callbacks only enqueue values. UI/COM changes run later on the host STA.
use std::ffi::c_void;
use std::sync::{
    atomic::{AtomicU32, Ordering},
    mpsc::{self, Receiver, Sender},
};
use windows::core::{IUnknown, IUnknown_Vtbl, Interface, GUID, HRESULT, PCWSTR};
use windows::Win32::Foundation::{E_NOINTERFACE, E_NOTIMPL, E_POINTER, HWND, LPARAM, S_OK, WPARAM};
use windows::Win32::System::Com::{
    IConnectionPoint, IConnectionPointContainer, IDispatch, IDispatch_Vtbl, DISPATCH_FLAGS,
    DISPPARAMS, EXCEPINFO,
};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::WindowsAndMessaging::PostMessageW;

use super::{connection_state::ConnectionEvent, HostedActiveXClient};

const CLASSIC_EVENTS: GUID = GUID::from_u128(0x336d5562_efa8_482e_8cb3_c5c0fc7a7db6);
const MODERN_EVENTS: GUID = GUID::from_u128(0x079863b7_6d47_4105_8bfe_0cdcb360e67d);
pub const EVENTS_MESSAGE: u32 = windows::Win32::UI::WindowsAndMessaging::WM_APP + 43;

pub struct Subscription {
    point: IConnectionPoint,
    cookie: u32,
    pub events: Receiver<ConnectionEvent>,
}

impl Subscription {
    pub fn new(client: &HostedActiveXClient, hwnd: HWND) -> windows::core::Result<Self> {
        let (container, iid): (IConnectionPointContainer, _) = match client {
            HostedActiveXClient::Classic(client) => (client.cast()?, CLASSIC_EVENTS),
            HostedActiveXClient::Modern(client) => (client.cast()?, MODERN_EVENTS),
        };
        let (sender, events) = mpsc::channel();
        unsafe {
            let point = container.FindConnectionPoint(&iid)?;
            let sink = IUnknown::from_raw(
                Box::into_raw(Box::new(EventSink {
                    vtable: &VTABLE,
                    refs: AtomicU32::new(1),
                    iid,
                    sender,
                    hwnd,
                }))
                .cast(),
            );
            let cookie = point.Advise(&sink)?;
            Ok(Self {
                point,
                cookie,
                events,
            })
        }
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        if let Err(error) = unsafe { self.point.Unadvise(self.cookie) } {
            eprintln!("[rdp] event unsubscription failed: {error}");
        }
    }
}

#[repr(C)]
struct EventSink {
    vtable: &'static IDispatch_Vtbl,
    refs: AtomicU32,
    iid: GUID,
    sender: Sender<ConnectionEvent>,
    hwnd: HWND,
}

static VTABLE: IDispatch_Vtbl = IDispatch_Vtbl {
    base__: IUnknown_Vtbl {
        QueryInterface: query_interface,
        AddRef: add_ref,
        Release: release,
    },
    GetTypeInfoCount: type_info_count,
    GetTypeInfo: type_info,
    GetIDsOfNames: names,
    Invoke: invoke,
};

unsafe extern "system" fn query_interface(
    this: *mut c_void,
    iid: *const GUID,
    out: *mut *mut c_void,
) -> HRESULT {
    if out.is_null() || iid.is_null() {
        return E_POINTER;
    }
    unsafe {
        *out = std::ptr::null_mut();
        let sink = &*this.cast::<EventSink>();
        if *iid == IUnknown::IID || *iid == IDispatch::IID || *iid == sink.iid {
            *out = this;
            add_ref(this);
            S_OK
        } else {
            E_NOINTERFACE
        }
    }
}

unsafe extern "system" fn add_ref(this: *mut c_void) -> u32 {
    unsafe { &*this.cast::<EventSink>() }
        .refs
        .fetch_add(1, Ordering::Relaxed)
        + 1
}

unsafe extern "system" fn release(this: *mut c_void) -> u32 {
    let remaining = unsafe { &*this.cast::<EventSink>() }
        .refs
        .fetch_sub(1, Ordering::Release)
        - 1;
    if remaining == 0 {
        std::sync::atomic::fence(Ordering::Acquire);
        unsafe {
            drop(Box::from_raw(this.cast::<EventSink>()));
        }
    }
    remaining
}

unsafe extern "system" fn type_info_count(_: *mut c_void, count: *mut u32) -> HRESULT {
    if count.is_null() {
        return E_POINTER;
    }
    unsafe {
        *count = 0;
    }
    S_OK
}
unsafe extern "system" fn type_info(
    _: *mut c_void,
    _: u32,
    _: u32,
    _: *mut *mut c_void,
) -> HRESULT {
    E_NOTIMPL
}
unsafe extern "system" fn names(
    _: *mut c_void,
    _: *const GUID,
    _: *const PCWSTR,
    _: u32,
    _: u32,
    _: *mut i32,
) -> HRESULT {
    E_NOTIMPL
}

unsafe extern "system" fn invoke(
    this: *mut c_void,
    id: i32,
    _: *const GUID,
    _: u32,
    _: DISPATCH_FLAGS,
    params: *const DISPPARAMS,
    _: *mut VARIANT,
    _: *mut EXCEPINFO,
    _: *mut u32,
) -> HRESULT {
    let sink = unsafe { &*this.cast::<EventSink>() };
    let args = if params.is_null() || unsafe { (*params).cArgs == 0 || (*params).rgvarg.is_null() }
    {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts((*params).rgvarg, (*params).cArgs as usize) }
    };
    // IDispatch stores arguments in reverse order. Never modify byref event decisions.
    let number = |index: usize| {
        args.iter()
            .rev()
            .nth(index)
            .and_then(|v| i32::try_from(v).ok())
    };
    let event = if sink.iid == CLASSIC_EVENTS {
        match id {
            1 => Some(ConnectionEvent::Connecting),
            2 => Some(ConnectionEvent::Connected),
            3 => Some(ConnectionEvent::LoginComplete),
            4 => number(0).map(|reason| ConnectionEvent::Disconnected {
                reason,
                extended: None,
            }),
            10 => number(0).map(ConnectionEvent::Fatal),
            17 | 34 => Some(ConnectionEvent::Reconnecting),
            18 => Some(ConnectionEvent::Dialog(true)),
            19 => Some(ConnectionEvent::Dialog(false)),
            33 => Some(ConnectionEvent::Reconnected),
            _ => None,
        }
    } else {
        match id {
            750 => Some(ConnectionEvent::Connecting),
            751 => Some(ConnectionEvent::Connected),
            752 => Some(ConnectionEvent::LoginComplete),
            753 => number(0).map(|reason| ConnectionEvent::Disconnected {
                reason,
                extended: number(1),
            }),
            755 => Some(ConnectionEvent::Reconnecting),
            756 => Some(ConnectionEvent::Reconnected),
            757 => Some(ConnectionEvent::Dialog(true)),
            758 => Some(ConnectionEvent::Dialog(false)),
            _ => None,
        }
    };
    if let Some(event) = event {
        if sink.sender.send(event).is_ok() {
            unsafe {
                let _ = PostMessageW(Some(sink.hwnd), EVENTS_MESSAGE, WPARAM(0), LPARAM(0));
            }
        }
    }
    S_OK
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, DISPATCH_METHOD,
    };

    fn test_sink(iid: GUID) -> (IDispatch, Receiver<ConnectionEvent>) {
        let (sender, receiver) = mpsc::channel();
        let sink = unsafe {
            IUnknown::from_raw(
                Box::into_raw(Box::new(EventSink {
                    vtable: &VTABLE,
                    refs: AtomicU32::new(1),
                    iid,
                    sender,
                    hwnd: HWND::default(),
                }))
                .cast(),
            )
        };
        (sink.cast().unwrap(), receiver)
    }

    fn emit(sink: &IDispatch, id: i32, args: &mut [VARIANT]) {
        let params = DISPPARAMS {
            rgvarg: args.as_mut_ptr(),
            cArgs: args.len() as u32,
            ..Default::default()
        };
        unsafe {
            sink.Invoke(
                id,
                &GUID::zeroed(),
                0,
                DISPATCH_METHOD,
                &params,
                None,
                None,
                None,
            )
            .unwrap();
        }
    }

    #[test]
    fn dispatch_uses_each_controls_event_ids_and_reversed_arguments() {
        let (classic, events) = test_sink(CLASSIC_EVENTS);
        emit(&classic, 2, &mut []);
        assert_eq!(events.try_recv().unwrap(), ConnectionEvent::Connected);
        emit(&classic, 3, &mut []);
        assert_eq!(events.try_recv().unwrap(), ConnectionEvent::LoginComplete);
        emit(&classic, 4, &mut [3.into()]);
        assert_eq!(
            events.try_recv().unwrap(),
            ConnectionEvent::Disconnected {
                reason: 3,
                extended: None
            }
        );
        // LogonError also reports informational codes; it is not a terminal failure.
        emit(&classic, 22, &mut [(-2).into()]);
        assert!(events.try_recv().is_err());

        let (modern, events) = test_sink(MODERN_EVENTS);
        emit(&modern, 752, &mut []);
        assert_eq!(events.try_recv().unwrap(), ConnectionEvent::LoginComplete);
        emit(
            &modern,
            753,
            &mut [VARIANT::from("local test"), 7.into(), 3.into()],
        );
        assert_eq!(
            events.try_recv().unwrap(),
            ConnectionEvent::Disconnected {
                reason: 3,
                extended: Some(7)
            }
        );
        emit(&modern, 757, &mut []);
        assert_eq!(events.try_recv().unwrap(), ConnectionEvent::Dialog(true));
    }

    #[test]
    #[ignore = "Requires locally installed Windows MSTSC controls; never connects to a server"]
    fn installed_classic_control_accepts_and_releases_event_subscription() {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
        }
        struct Apartment;
        impl Drop for Apartment {
            fn drop(&mut self) {
                unsafe {
                    CoUninitialize();
                }
            }
        }
        let _apartment = Apartment;
        let classic = HostedActiveXClient::Classic(unsafe {
            CoCreateInstance(
                &GUID::from_u128(0x8b918b82_7985_4c24_89df_c33ad2bbfbcd),
                None,
                CLSCTX_INPROC_SERVER,
            )
            .unwrap()
        });
        for client in [classic] {
            let subscription = Subscription::new(&client, HWND::default()).unwrap();
            let point = subscription.point.clone();
            let cookie = subscription.cookie;
            drop(subscription);
            assert!(
                unsafe { point.Unadvise(cookie) }.is_err(),
                "Drop must have removed the connection"
            );
            drop(Subscription::new(&client, HWND::default()).unwrap());
        }
    }
}

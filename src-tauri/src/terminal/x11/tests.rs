use super::*;
use tokio::io::duplex;
use tokio::net::TcpListener;

fn run(future: impl std::future::Future<Output = ()>) {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            timeout(Duration::from_secs(15), future)
                .await
                .expect("test timed out");
        });
}

fn forwarding(target: DisplayTarget) -> X11Session {
    X11Session(Arc::new(X11Forwarder {
        display: Display { target, screen: 0 },
        fake_cookie: [0x11; 16],
        local_cookie: [0x22; 16],
        active: AtomicBool::new(true),
        cancel: watch::channel(false).0,
        slots: Arc::new(Semaphore::new(MAX_CHANNELS)),
        deadline: None,
    }))
}

fn setup(little: bool, cookie: &[u8; 16]) -> Vec<u8> {
    let mut bytes = local_setup(cookie);
    if !little {
        bytes[0] = b'B';
        for i in [2, 4, 6, 8] {
            bytes.swap(i, i + 1);
        }
    }
    bytes
}

#[test]
fn display_parses_ipv4_ipv6_screens_and_local_sockets() {
    for (input, host, port, screen) in [
        ("127.0.0.1:0", "127.0.0.1", 6000, 0),
        ("host.example:12.3", "host.example", 6012, 3),
        ("[::1]:1.2", "::1", 6001, 2),
        ("tcp/localhost:2", "localhost", 6002, 0),
    ] {
        assert_eq!(
            Display::parse(input).unwrap(),
            Display {
                target: DisplayTarget::Tcp(host.into(), port),
                screen
            }
        );
    }
    let local = Display::parse(":7.1").unwrap();
    if cfg!(unix) {
        assert_eq!(
            local.target,
            DisplayTarget::Unix("/tmp/.X11-unix/X7".into())
        );
    } else {
        assert_eq!(local.target, DisplayTarget::Tcp("127.0.0.1".into(), 6007));
    }
    #[cfg(unix)]
    assert_eq!(
        Display::parse("/private/tmp/launch/org.xquartz:0")
            .unwrap()
            .target,
        DisplayTarget::Unix("/private/tmp/launch/org.xquartz:0".into())
    );
}

#[test]
fn display_rejects_overflow_malformed_and_xauth_command_injection() {
    for input in [
        "",
        "localhost",
        ":x",
        ":0.-1",
        "localhost:65535",
        "::1:0",
        "[::1:0",
        "foo/bar:0",
        ":1\ngenerate :0",
        "a b:0",
        ":0.1.2",
        ":0\0",
        "-1",
        ":+1",
    ] {
        assert!(Display::parse(input).is_err(), "accepted {input:?}");
    }
}

#[test]
fn cookie_parser_rejects_missing_malformed_and_unicode_without_leaking_data() {
    assert_eq!(
        parse_cookie(b"host/unix:0 MIT-MAGIC-COOKIE-1 0123456789abcdef0123456789abcdef\n").unwrap(),
        [1, 35, 69, 103, 137, 171, 205, 239, 1, 35, 69, 103, 137, 171, 205, 239]
    );
    for invalid in ["", "z".repeat(32).as_str(), "密".repeat(16).as_str(), "abc"] {
        assert!(decode_cookie(invalid).is_none());
    }
    let failure = parse_cookie(b"sensitive-cookie-in-malformed-output").unwrap_err();
    assert!(!failure.raw_message.contains("sensitive"));
}

#[test]
fn old_profiles_default_off_and_settings_round_trip() {
    let old: crate::connections::ConnectionAdvancedConfig = serde_json::from_str(
        r#"{"connect_timeout_ms":30000,"auth_timeout_ms":45000,"keepalive_interval_ms":20000}"#,
    )
    .unwrap();
    assert!(!old.x11_forwarding.enabled);
    assert!(!old.x11_forwarding.trusted);
    assert!(!serde_json::to_value(&old)
        .unwrap()
        .as_object()
        .unwrap()
        .contains_key("x11_forwarding"));
    let config = X11ForwardingConfig {
        enabled: true,
        trusted: true,
        display: Some(" 127.0.0.1:1.2 ".into()),
        xauth_path: Some(" C:/Program Files/VcXsrv/xauth.exe ".into()),
    };
    let normalized = validate_config(&config).unwrap();
    assert_eq!(normalized.display.as_deref(), Some("127.0.0.1:1.2"));
    assert_eq!(
        serde_json::from_str::<X11ForwardingConfig>(&serde_json::to_string(&normalized).unwrap())
            .unwrap(),
        normalized
    );
}

#[test]
fn fragmented_setup_rewrites_cookie_and_preserves_following_bytes_in_both_orders() {
    run(async {
        for little in [true, false] {
            let (mut client, mut remote) = duplex(16);
            let sender = tokio::spawn(async move {
                for byte in setup(little, &[0x11; 16]) {
                    client.write_all(&[byte]).await.unwrap();
                }
                client.write_all(b"following-packet").await.unwrap();
            });
            let bytes = read_setup(&mut remote, &[0x11; 16], &[0x22; 16])
                .await
                .unwrap();
            assert_eq!(bytes, setup(little, &[0x22; 16]));
            let mut tail = Vec::new();
            remote.read_to_end(&mut tail).await.unwrap();
            assert_eq!(tail, b"following-packet");
            sender.await.unwrap();
        }
    });
}

#[test]
fn invalid_setup_and_wrong_cookie_never_open_local_socket() {
    run(async {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let owner = forwarding(DisplayTarget::Tcp(
            "127.0.0.1".into(),
            listener.local_addr().unwrap().port(),
        ));
        let mut cases = vec![setup(true, &[0x33; 16])];
        for (index, byte) in [(0, b'?'), (2, 10), (6, 255), (8, 255), (12, b'Z')] {
            let mut invalid = setup(true, &[0x11; 16]);
            invalid[index] = byte;
            cases.push(invalid);
        }
        for bytes in cases {
            let (mut client, remote) = duplex(1024);
            client.write_all(&bytes).await.unwrap();
            assert!(owner.0.forward(remote).await.is_err());
        }
        assert!(timeout(Duration::from_millis(50), listener.accept())
            .await
            .is_err());
    });
}

#[test]
fn tcp_bridge_preserves_setup_reply_and_binary_streams_in_both_orders() {
    run(async {
        for little in [true, false] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let owner = forwarding(DisplayTarget::Tcp(
                "127.0.0.1".into(),
                listener.local_addr().unwrap().port(),
            ));
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut header = vec![0; 48];
                socket.read_exact(&mut header).await.unwrap();
                assert_eq!(header, setup(little, &[0x22; 16]));
                let reply = if little {
                    vec![1, 0, 11, 0, 0, 0, 1, 0, 9, 8, 7, 6]
                } else {
                    vec![1, 0, 0, 11, 0, 0, 0, 1, 9, 8, 7, 6]
                };
                socket.write_all(&reply).await.unwrap();
                let mut payload = [0; 4];
                socket.read_exact(&mut payload).await.unwrap();
                assert_eq!(payload, [0, 255, 128, 1]);
                socket.write_all(&[3, 0, 254, 2]).await.unwrap();
                socket.shutdown().await.unwrap();
                reply
            });
            let (mut client, remote) = duplex(1024);
            let forwarder = owner.0.clone();
            let bridge = tokio::spawn(async move { forwarder.forward(remote).await });
            client.write_all(&setup(little, &[0x11; 16])).await.unwrap();
            client.write_all(&[0, 255, 128, 1]).await.unwrap();
            client.shutdown().await.unwrap();
            let mut response = Vec::new();
            client.read_to_end(&mut response).await.unwrap();
            let mut expected = server.await.unwrap();
            expected.extend_from_slice(&[3, 0, 254, 2]);
            assert_eq!(response, expected);
            bridge.await.unwrap().unwrap();
            assert_eq!(owner.0.slots.available_permits(), MAX_CHANNELS);
        }
    });
}

#[test]
fn local_auth_rejection_is_relayed_and_reported() {
    run(async {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let owner = forwarding(DisplayTarget::Tcp(
            "127.0.0.1".into(),
            listener.local_addr().unwrap().port(),
        ));
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut setup = [0; 48];
            socket.read_exact(&mut setup).await.unwrap();
            socket
                .write_all(&[0, 4, 11, 0, 0, 0, 1, 0, b'n', b'o', b'p', b'e'])
                .await
                .unwrap();
        });
        let (mut client, remote) = duplex(1024);
        client.write_all(&setup(true, &[0x11; 16])).await.unwrap();
        let failure = owner.0.forward(remote).await.unwrap_err();
        assert_eq!(failure.code, "x11_local_auth_rejected");
        assert!(failure.raw_message.contains("nope"));
        let mut reply = Vec::new();
        client.read_to_end(&mut reply).await.unwrap();
        assert_eq!(reply[0], 0);
        server.await.unwrap();
    });
}

#[test]
fn close_cancels_stalled_handshake_and_refuses_new_channels() {
    run(async {
        let owner = forwarding(DisplayTarget::Tcp("127.0.0.1".into(), 1));
        let forwarder = owner.0.clone();
        let (mut client, remote) = duplex(16);
        let state = forwarder.clone();
        let bridge = tokio::spawn(async move { state.forward(remote).await });
        tokio::task::yield_now().await;
        drop(owner);
        bridge.await.unwrap().unwrap();
        assert_eq!(client.read(&mut [0]).await.unwrap(), 0);
        let (_, remote) = duplex(16);
        assert_eq!(
            forwarder.forward(remote).await.unwrap_err().code,
            "x11_not_active"
        );
    });
}

#[test]
fn expired_untrusted_and_excess_channels_are_rejected() {
    run(async {
        let mut owner = forwarding(DisplayTarget::Tcp("127.0.0.1".into(), 1));
        Arc::get_mut(&mut owner.0).unwrap().deadline =
            Some(Instant::now() - Duration::from_secs(1));
        let (_, remote) = duplex(16);
        assert_eq!(
            owner.0.forward(remote).await.unwrap_err().code,
            "x11_auth_expired"
        );
        let _all = owner
            .0
            .slots
            .acquire_many(MAX_CHANNELS as u32)
            .await
            .unwrap();
        let (_, remote) = duplex(16);
        assert_eq!(
            owner.0.forward(remote).await.unwrap_err().code,
            "x11_channel_limit"
        );
    });
}

#[test]
fn unavailable_local_x_server_reports_connect_error() {
    run(async {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target = DisplayTarget::Tcp("127.0.0.1".into(), listener.local_addr().unwrap().port());
        drop(listener);
        assert_eq!(
            probe_server(&target, &[1; 16]).await.unwrap_err().code,
            "x11_local_connect_failed"
        );
    });
}

#[test]
#[ignore = "requires a real local X Server and MXTERM_X11_TEST_XAUTH executable"]
fn installed_xauth_prepares_trusted_and_untrusted_without_wrapper() {
    let executable = std::env::var("MXTERM_X11_TEST_XAUTH").expect("set MXTERM_X11_TEST_XAUTH");
    let display = std::env::var("MXTERM_X11_TEST_DISPLAY").expect("set MXTERM_X11_TEST_DISPLAY");
    run(async {
        for trusted in [true, false] {
            let config = X11ForwardingConfig {
                enabled: true,
                trusted,
                display: Some(display.clone()),
                xauth_path: Some(executable.clone()),
            };
            let owner = X11Session::prepare(&config).await.unwrap().unwrap();
            assert_eq!(owner.0.deadline.is_some(), !trusted);
            // Confirm that the generated untrusted Cookie is accepted by the actual X Server.
            probe_server(&owner.0.display.target, &owner.0.local_cookie)
                .await
                .unwrap();
        }
    });
}

struct TestSshServer {
    accept: bool,
    channels: Vec<Channel<russh::server::Msg>>,
}

impl russh::server::Handler for TestSshServer {
    type Error = russh::Error;
    async fn auth_none(&mut self, _user: &str) -> Result<russh::server::Auth, Self::Error> {
        Ok(russh::server::Auth::Accept)
    }
    async fn channel_open_session(
        &mut self,
        channel: Channel<russh::server::Msg>,
        _session: &mut russh::server::Session,
    ) -> Result<bool, Self::Error> {
        self.channels.push(channel);
        Ok(true)
    }
    async fn x11_request(
        &mut self,
        channel: russh::ChannelId,
        single: bool,
        protocol: &str,
        cookie: &str,
        screen: u32,
        session: &mut russh::server::Session,
    ) -> Result<(), Self::Error> {
        assert!(!single);
        assert_eq!(protocol, "MIT-MAGIC-COOKIE-1");
        assert_eq!(decode_cookie(cookie), Some([0x11; 16]));
        assert_eq!(screen, 0);
        if self.accept {
            session.channel_success(channel)?;
        } else {
            session.channel_failure(channel)?;
        }
        Ok(())
    }
}

struct TestSshClient;
impl client::Handler for TestSshClient {
    type Error = russh::Error;
    async fn check_server_key(
        &mut self,
        _key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

#[test]
fn ssh_acknowledgement_controls_forwarding_activation() {
    run(async {
        for accept in [true, false] {
            let keypair = russh::keys::ssh_key::private::Ed25519Keypair::from_seed(&[42; 32]);
            let config = Arc::new(russh::server::Config {
                keys: vec![
                    russh::keys::ssh_key::PrivateKey::new(keypair.into(), "X11 test only").unwrap(),
                ],
                ..Default::default()
            });
            let (client_stream, server_stream) = duplex(65536);
            let server = tokio::spawn(async move {
                russh::server::run_stream(
                    config,
                    server_stream,
                    TestSshServer {
                        accept,
                        channels: Vec::new(),
                    },
                )
                .await
                .unwrap()
            });
            let mut client = client::connect_stream(
                Arc::new(client::Config::default()),
                client_stream,
                TestSshClient,
            )
            .await
            .unwrap();
            assert!(client.authenticate_none("test").await.unwrap().success());
            let mut channel = client.channel_open_session().await.unwrap();
            let owner = forwarding(DisplayTarget::Tcp("127.0.0.1".into(), 1));
            owner.0.active.store(false, Ordering::Release);
            let result = owner.0.request(&mut channel).await;
            if accept {
                result.unwrap();
            } else {
                assert_eq!(result.unwrap_err().code, "x11_request_denied");
            }
            assert_eq!(owner.0.active.load(Ordering::Acquire), accept);
            client
                .disconnect(russh::Disconnect::ByApplication, "", "en")
                .await
                .unwrap();
            let _ = server.await.unwrap().await;
        }
    });
}

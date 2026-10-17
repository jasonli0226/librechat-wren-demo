from gallery.ratelimit import RateLimiter


def test_per_client_limit_and_window_expiry():
    now = [0.0]
    rl = RateLimiter(per_client=2, total=100, window_s=60, clock=lambda: now[0])
    assert rl.allow("a") and rl.allow("a") and not rl.allow("a")
    assert rl.allow("b")
    now[0] = 60.1
    assert rl.allow("a")


def test_total_limit_across_clients():
    rl = RateLimiter(per_client=10, total=3, window_s=60, clock=lambda: 0.0)
    assert [rl.allow(c) for c in "abcd"] == [True, True, True, False]


def test_denied_calls_do_not_extend_the_window():
    now = [0.0]
    rl = RateLimiter(per_client=1, total=10, window_s=10, clock=lambda: now[0])
    rl.allow("a")
    now[0] = 5
    assert not rl.allow("a")
    now[0] = 10.1
    assert rl.allow("a")

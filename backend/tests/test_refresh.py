"""PeriodicRefresher and Backoff: delays, jitter, rate-limit waits, crash containment, stopping."""

import asyncio
import logging
import random

import pytest

from src.core.refresh import (
    AUTH_REMINDER_SECONDS,
    Backoff,
    CycleOutcome,
    CycleResult,
    PeriodicRefresher,
)

pytestmark = pytest.mark.anyio


class Stop(Exception):
    pass


class Script:
    """Cycle results in order; records every sleep and stops after `sleeps` of them."""

    def __init__(self, results, sleeps):
        self.results = list(results)
        self.calls = 0
        self.slept = []
        self.max_sleeps = sleeps

    async def cycle(self):
        self.calls += 1
        result = self.results.pop(0) if self.results else CycleResult(CycleOutcome.OK)
        if isinstance(result, Exception):
            raise result
        return result

    async def sleep(self, seconds):
        self.slept.append(seconds)
        if len(self.slept) >= self.max_sleeps:
            raise Stop


def refresher(script, interval=1800.0):
    rng = random.Random(7)  # noqa: S311 - seeded jitter
    return PeriodicRefresher(script.cycle, interval, name="test", sleep=script.sleep, rng=rng)


def test_backoff_doubles_from_5_minutes_to_a_2_hour_cap_with_10_percent_jitter():
    backoff = Backoff()
    rng = random.Random(1)  # noqa: S311 - seeded jitter
    expected = [300, 600, 1200, 2400, 4800, 7200, 7200]

    delays = [backoff.next_delay(rng) for _ in expected]

    for delay, base in zip(delays, expected, strict=True):
        assert base * 0.9 <= delay <= base * 1.1
    backoff.reset()
    assert 270 <= backoff.next_delay(rng) <= 330


async def test_ok_cycles_sleep_the_interval_with_jitter():
    script = Script([], sleeps=20)

    with pytest.raises(Stop):
        await refresher(script).run_forever()

    assert script.calls == 20
    assert all(1620 <= s <= 1980 for s in script.slept)
    assert len(set(script.slept)) > 1  # jittered


async def test_failures_back_off_and_success_resets():
    t = CycleResult(CycleOutcome.TRANSIENT)
    d = CycleResult(CycleOutcome.DRIFT)
    ok = CycleResult(CycleOutcome.OK)
    script = Script([t, d, t, ok, t], sleeps=5)

    with pytest.raises(Stop):
        await refresher(script).run_forever()

    bases = [300, 600, 1200, 1800, 300]
    for slept, base in zip(script.slept, bases, strict=True):
        assert base * 0.9 <= slept <= base * 1.1


@pytest.mark.parametrize(
    ("retry_after", "low", "high"),
    [(120.0, 120, 180), (5.0, 60, 120), (99999.0, 7200, 7260), (None, 1800, 1860)],
)
async def test_rate_limited_waits_for_the_reset_clamped(retry_after, low, high):
    script = Script([CycleResult(CycleOutcome.RATE_LIMITED, retry_after)], sleeps=1)

    with pytest.raises(Stop):
        await refresher(script).run_forever()

    assert low <= script.slept[0] <= high


async def test_a_crashing_cycle_is_logged_and_backed_off(caplog):
    script = Script([RuntimeError("boom"), CycleResult(CycleOutcome.OK)], sleeps=2)

    with pytest.raises(Stop):
        await refresher(script).run_forever()

    assert script.calls == 2
    assert 270 <= script.slept[0] <= 330
    assert any(
        r.levelno == logging.ERROR and getattr(r, "event", "") == "test.crash"
        for r in caplog.records
    )


async def test_auth_stops_calling_upstream_and_reminds_hourly(caplog):
    script = Script([CycleResult(CycleOutcome.AUTH)], sleeps=3)

    with pytest.raises(Stop):
        await refresher(script).run_forever()

    assert script.calls == 1
    assert script.slept == [AUTH_REMINDER_SECONDS] * 3
    reminders = [r for r in caplog.records if getattr(r, "event", "") == "test.stopped"]
    assert len(reminders) == 3


async def test_cancellation_is_prompt():
    started = asyncio.Event()

    async def cycle():
        started.set()
        await asyncio.Event().wait()

    task = asyncio.ensure_future(PeriodicRefresher(cycle, 1800, name="test").run_forever())
    await started.wait()
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task


async def test_cancellation_during_sleep_is_prompt():
    task = asyncio.ensure_future(PeriodicRefresher(_ok, 1800, name="test").run_forever())
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task


async def _ok():
    return CycleResult(CycleOutcome.OK)

import { describe, expect, test } from "@jest/globals";
import timers from "timers";
import EventLoop from "../../../Server/Utils/EventLoop";

/*
 * Common's jest environment is jsdom, which does not expose setImmediate -
 * and setImmediate is the entire subject of this file. A `@jest-environment
 * node` docblock is not an option (Common's shared jest.setup.ts touches
 * `window`), so lend jsdom the real one from Node, exactly as
 * MultipartFormData.test.ts does.
 *
 * This matters beyond the plumbing: the helper is server-only code, so jsdom
 * not having setImmediate is correct - but it does mean nothing under
 * Common's default environment can reach this function at all, which is
 * most of why it went untested.
 */
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * The whole value of this one-line helper is the DIFFERENCE between it and
 * `await Promise.resolve()`, and that difference is invisible in the source.
 *
 * The failure it exists to prevent: a telemetry ingest job transforms tens of
 * thousands of OTLP records in one synchronous run. While it does, the
 * single-threaded event loop never reaches its poll phase, so the HTTP handler
 * for /status/live never gets scheduled, the kubelet's liveness probe times
 * out, and Kubernetes restarts a pod that was working perfectly - mid-ingest.
 *
 * Awaiting a resolved promise does NOT fix that. It drains the microtask
 * queue and hands control straight back, so a loop that awaits one on every
 * iteration still starves the probe handler exactly as badly. Only a macrotask
 * - setImmediate, scheduled in the check phase, which runs after the poll
 * phase has had its turn - actually lets pending I/O and timers through.
 *
 * So the tests below are comparative on purpose. Asserting that
 * yieldToEventLoop resolves would pass equally well for the broken
 * implementation this file was written to rule out; asserting that a pending
 * timer runs across it, and does NOT run across a microtask drain, is what
 * distinguishes them.
 */

describe("yieldToEventLoop actually advances the event loop", () => {
  /*
   * Bounded rather than single-shot on purpose. Node does not order
   * setImmediate against a due-but-not-yet-elapsed setTimeout(0), so
   * asserting the timer runs after EXACTLY one yield would be a coin flip.
   * The honest claim - and the one that matters - is that yielding lets the
   * timer through promptly, which the microtask control case below shows it
   * never does.
   */
  test("lets a pending timer callback run", async () => {
    let timerFired: boolean = false;

    setTimeout((): void => {
      timerFired = true;
    }, 0);

    for (let i: number = 0; i < 10 && !timerFired; i++) {
      await EventLoop.yieldToEventLoop();
    }

    expect(timerFired).toBe(true);
  });

  /*
   * The control case, and the reason the helper is not just `await
   * Promise.resolve()`. Draining the microtask queue - however many times -
   * never reaches the phase where timers and I/O are serviced.
   */
  test("a microtask drain, by contrast, does not", async () => {
    let timerFired: boolean = false;

    setTimeout((): void => {
      timerFired = true;
    }, 0);

    for (let i: number = 0; i < 100000; i++) {
      await Promise.resolve();
    }

    expect(timerFired).toBe(false);

    // And the timer is genuinely still pending, not lost.
    for (let i: number = 0; i < 10 && !timerFired; i++) {
      await EventLoop.yieldToEventLoop();
    }
    expect(timerFired).toBe(true);
  });

  test("lets a pending immediate callback run", async () => {
    let immediateFired: boolean = false;

    setImmediate((): void => {
      immediateFired = true;
    });

    await EventLoop.yieldToEventLoop();

    expect(immediateFired).toBe(true);
  });

  /*
   * The real usage: a CPU-bound loop that yields every N items. Each yield
   * has to give the loop a turn, not just the first one.
   */
  test("gives the loop a turn on every iteration of a chunked loop", async () => {
    const ticks: Array<number> = [];
    let chunk: number = 0;

    const interval: NodeJS.Timeout = setInterval((): void => {
      ticks.push(chunk);
    }, 1);

    try {
      for (chunk = 0; chunk < 5; chunk++) {
        // Stand in for a chunk of synchronous transformation work.
        for (let i: number = 0; i < 10000; i++) {
          void i;
        }

        await EventLoop.yieldToEventLoop();
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 2);
        });
      }
    } finally {
      clearInterval(interval);
    }

    // The interval got scheduled repeatedly, across several different chunks.
    expect(ticks.length).toBeGreaterThan(1);
    expect(new Set(ticks).size).toBeGreaterThan(1);
  });
});

describe("the shape of the helper itself", () => {
  test("resolves with nothing", async () => {
    await expect(EventLoop.yieldToEventLoop()).resolves.toBeUndefined();
  });

  test("returns a promise rather than running synchronously", () => {
    let settled: boolean = false;

    const pending: Promise<void> = EventLoop.yieldToEventLoop().then(
      (): void => {
        settled = true;
      },
    );

    // Still pending on the very next line - it is not a synchronous no-op.
    expect(settled).toBe(false);

    return pending;
  });

  test("can be awaited many times in a row", async () => {
    for (let i: number = 0; i < 50; i++) {
      await EventLoop.yieldToEventLoop();
    }

    expect(true).toBe(true);
  });

  test("several concurrent yields all resolve", async () => {
    await expect(
      Promise.all([
        EventLoop.yieldToEventLoop(),
        EventLoop.yieldToEventLoop(),
        EventLoop.yieldToEventLoop(),
      ]),
    ).resolves.toEqual([undefined, undefined, undefined]);
  });
});

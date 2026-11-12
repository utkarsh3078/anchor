// Server status for the connection light. Pure, so it is unit-tested.
//
// The free Render server sleeps after 15 minutes without requests and takes about 50 s
// to wake; the first request wakes it. /api/health answers 200 when Typesense and
// MongoDB are reachable and 503 when the server is up but one of them is not.

export const CHECK_TIMEOUT_MS = 15_000; // one attempt; a waking server may not answer in time
export const RETRY_MS = 3_000;          // while connecting
export const RECHECK_MS = 120_000;      // once connected, while the tab is visible

// fetchResult: { status } when the server answered, null when it could not be reached
// (asleep, waking, offline, timed out, or blocked by CORS)
export function statusFrom(fetchResult) {
  if (!fetchResult) return 'connecting';
  if (fetchResult.status >= 200 && fetchResult.status < 300) return 'connected';
  return 'degraded';
}

export const STATUS_TEXT = {
  checking: 'Checking the server…',
  connecting: 'Connecting. Please wait',
  connected: 'Connected',
  degraded: 'Server issue',
};

export const STATUS_HINT = {
  checking: 'Checking whether the Anchor server is reachable.',
  connecting: 'The server sleeps when unused and takes up to about a minute to wake up.',
  connected: 'The Anchor server is awake and ready.',
  degraded: 'The server is up, but its search index or database is not reachable.',
};

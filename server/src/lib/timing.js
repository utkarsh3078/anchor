export const ms = (t0) => Math.round(performance.now() - t0);

export async function timed(fn) {
  const t0 = performance.now();
  const result = await fn();
  return { result, ms: ms(t0) };
}

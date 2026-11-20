const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;

/**
 * ULID-style identifier: 48-bit millisecond timestamp then 80 random bits, in Crockford base-32.
 * IDs sort by creation time, which keeps the run history in order without an extra column.
 */
export function newUlid(
  now: Date = new Date(),
  random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  let time = now.getTime();
  let timePart = '';
  for (let i = 0; i < TIME_CHARS; i++) {
    timePart = CROCKFORD.charAt(time % 32) + timePart;
    time = Math.floor(time / 32);
  }
  const randomPart = Array.from(random(RANDOM_CHARS), (byte) => CROCKFORD.charAt(byte % 32)).join(
    '',
  );
  return timePart + randomPart;
}

import { describe, expect, it } from 'vitest';
import { cosine, decodeVector, encodeVector } from '../../src/core/vectors.js';

describe('encodeVector / decodeVector', () => {
  it('round-trips at Float32 precision', () => {
    const original = [0, 1, -1, 0.5, 0.123456789, -0.987654321, 1e-6, 3.4e10];
    const decoded = decodeVector(encodeVector(original));
    expect(decoded).toHaveLength(original.length);
    for (const [i, value] of original.entries()) {
      expect(decoded[i]).toBeCloseTo(Math.fround(value), 6);
    }
  });

  it('round-trips an empty vector and a full 768-d vector', () => {
    expect(decodeVector(encodeVector([]))).toEqual([]);
    const full = Array.from({ length: 768 }, (_, i) => Math.sin(i));
    const decoded = decodeVector(encodeVector(full));
    expect(decoded).toHaveLength(768);
    expect(decoded[100]).toBeCloseTo(Math.sin(100), 6);
  });

  it('produces compact text (4 bytes per dimension, base64)', () => {
    expect(encodeVector(new Array(768).fill(0.25)).length).toBe(Math.ceil((768 * 4) / 3) * 4);
  });
});

describe('cosine', () => {
  it('is 1 for identical direction, 0 for orthogonal, -1 for opposite', () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([1, 2], [-1, -2])).toBeCloseTo(-1, 10);
  });

  it('is 0 when either vector is all zeros', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([1, 1], [0, 0])).toBe(0);
    expect(cosine([], [])).toBe(0);
  });

  it('is symmetric and scale-invariant', () => {
    const a = [0.2, 0.7, 0.1];
    const b = [0.9, 0.1, 0.4];
    expect(cosine(a, b)).toBeCloseTo(cosine(b, a), 12);
    expect(cosine(a, b)).toBeCloseTo(
      cosine(
        a.map((x) => x * 50),
        b,
      ),
      12,
    );
  });

  it('rejects vectors of different sizes', () => {
    expect(() => cosine([1, 2], [1, 2, 3])).toThrow('length mismatch');
  });
});

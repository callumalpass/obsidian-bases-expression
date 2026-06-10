import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { evaluateExpression, toPlain } from "../src/index.js";

describe("property based arithmetic", () => {
  it("matches JavaScript for finite addition and multiplication", () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true, min: -1_000_000, max: 1_000_000 }),
        fc.double({ noNaN: true, noDefaultInfinity: true, min: -1_000_000, max: 1_000_000 }),
        (a, b) => {
          const context = { note: { a, b } };
          expect(toPlain(evaluateExpression("a + b", context).value)).toBeCloseTo(a + b);
          expect(toPlain(evaluateExpression("a * b", context).value)).toBeCloseTo(a * b);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("keeps parse/eval total for generated list filters", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -20, max: 20 }), { maxLength: 30 }), (values) => {
        const context = { note: { values } };
        expect(toPlain(evaluateExpression("values.filter(value > 0)", context).value)).toEqual(values.filter((value) => value > 0));
      }),
      { numRuns: 300 },
    );
  });
});

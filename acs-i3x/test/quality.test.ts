import { deriveQuality, isStale } from "../src/quality.js";

describe("deriveQuality", () => {
    it("returns Good when online, has value, and not stale", () => {
        expect(deriveQuality({ online: true, hasValue: true, stale: false }))
            .toBe("Good");
    });

    it("returns GoodNoData when online but no value", () => {
        expect(deriveQuality({ online: true, hasValue: false, stale: false }))
            .toBe("GoodNoData");
    });

    it("returns Bad when offline with value", () => {
        expect(deriveQuality({ online: false, hasValue: true, stale: false }))
            .toBe("Bad");
    });

    it("returns Bad when offline without value", () => {
        expect(deriveQuality({ online: false, hasValue: false, stale: false }))
            .toBe("Bad");
    });

    it("returns Uncertain when online, has value, and stale", () => {
        expect(deriveQuality({ online: true, hasValue: true, stale: true }))
            .toBe("Uncertain");
    });

    it("returns GoodNoData when online, no value, and stale (stale irrelevant without value)", () => {
        expect(deriveQuality({ online: true, hasValue: false, stale: true }))
            .toBe("GoodNoData");
    });
});

describe("isStale", () => {
    it("returns true for an old timestamp", () => {
        expect(isStale("2020-01-01T00:00:00Z", 60_000)).toBe(true);
    });

    it("returns false for a recent timestamp", () => {
        expect(isStale(new Date(), 60_000)).toBe(false);
    });

    it("accepts a Date object input", () => {
        const old = new Date(Date.now() - 120_000);
        expect(isStale(old, 60_000)).toBe(true);
    });

    it("returns false when exactly at the threshold", () => {
        const atThreshold = new Date(Date.now() - 60_000);
        expect(isStale(atThreshold, 60_000)).toBe(false);
    });
});

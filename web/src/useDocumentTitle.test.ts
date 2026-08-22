import { describe, expect, it } from "vitest";
import { APP_NAME, documentTitle } from "./useDocumentTitle";

describe("documentTitle", () => {
  it("is the bare app name with no session attached", () => {
    expect(documentTitle(null)).toBe(APP_NAME);
  });

  it("names the session", () => {
    expect(documentTitle({ title: "Fix the sidebar" })).toBe("Fix the sidebar — Omniplex");
  });

  it("falls back for a session that has no title yet", () => {
    expect(documentTitle({ title: "   " })).toBe("Untitled session — Omniplex");
  });

  it("marks a session that is waiting on an answer", () => {
    expect(documentTitle({ title: "Fix the sidebar", needsAttention: true })).toBe(
      "● Fix the sidebar — Omniplex",
    );
  });
});

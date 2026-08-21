// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Transcript } from "~/components/Transcript";
import { emptyState } from "~/apply";
import type { PullRequest } from "~/protocol";
import { render, viewport } from "~/test/harness";

function transcript(pr: PullRequest | null, onFinish = () => {}) {
  return render(
    <Transcript
      state={emptyState("s1")}
      onRetryProvision={() => {}}
      onCleanup={() => {}}
      onForceDelete={() => {}}
      onContinue={() => {}}
      onOpenDiff={() => {}}
      pr={pr}
      onFinish={onFinish}
    />,
  );
}

const merged: PullRequest = {
  number: 75,
  state: "MERGED",
  merged: true,
  mergedAt: "2026-08-20T01:02:03Z",
};

describe("the merged-pull-request prompt", () => {
  it("offers to finish the session once the branch has landed", () => {
    transcript(merged);
    expect(screen.getByRole("button", { name: /finish with this session/i })).toBeTruthy();
    expect(screen.getByText("PR #75 merged")).toBeTruthy();
  });

  it("says nothing while the pull request is still open", () => {
    transcript({ number: 75, state: "OPEN", merged: false });
    expect(screen.queryByRole("button", { name: /finish with this session/i })).toBeNull();
  });

  it("says nothing when there is no pull request to speak of", () => {
    transcript(null);
    expect(screen.queryByRole("button", { name: /finish with this session/i })).toBeNull();
  });

  it("opens the confirmation rather than deleting anything itself", () => {
    const onFinish = vi.fn();
    transcript(merged, onFinish);
    fireEvent.click(screen.getByRole("button", { name: /finish with this session/i }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("still names the offer on a phone, where there is no hover to explain it", () => {
    viewport("phone");
    transcript(merged);
    // The tooltip does not render on a coarse pointer, so the accessible name
    // is the whole explanation and has to carry it alone.
    expect(screen.getByRole("button", { name: /finish with this session/i })).toBeTruthy();
  });
});

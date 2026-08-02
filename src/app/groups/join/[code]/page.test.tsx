// @vitest-environment jsdom
// ABOUTME: Tests for the invite-join page — signed-out sign-in with returnTo, the
// ABOUTME: code-only confirm screen (no pre-join group name), and the join result.
import { describe, it, expect, vi, afterEach } from "vitest";
import { Suspense } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { AuthProvider } from "@/components/auth-provider";
import JoinPage from "@/app/groups/join/[code]/page";

const ALICE = {
  userId: "u1",
  email: "alice@example.com",
  name: "Alice Chen",
  avatarUrl: null,
};
const CODE = "aB23cdEF";

function stubApi(options: { signedIn: boolean; join?: { status: number; body: unknown } }) {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === "/api/auth/me") {
        return options.signedIn
          ? new Response(JSON.stringify(ALICE), { status: 200 })
          : new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
      if (url === "/api/groups/join" && options.join) {
        return new Response(JSON.stringify(options.join.body), {
          status: options.join.status,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
  return calls;
}

// `use(params)` suspends on the first render, so the render is awaited inside
// act() — otherwise React logs an un-awaited-act warning and the tree never
// resolves past the Suspense fallback.
async function renderJoin(code = CODE) {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <AuthProvider>
          <JoinPage params={Promise.resolve({ code })} />
        </AuthProvider>
      </Suspense>
    );
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Join by invite page", () => {
  it("shows the code and a sign-in that returns here, when signed out", async () => {
    stubApi({ signedIn: false });
    await renderJoin();
    expect(await screen.findByText(CODE)).toBeDefined();
    const signIn = screen.getByRole("link", { name: /sign in/i });
    expect(signIn.getAttribute("href")).toBe(
      `/api/auth/google?returnTo=${encodeURIComponent(`/groups/join/${CODE}`)}`
    );
    expect(screen.queryByRole("button", { name: /join/i })).toBe(null);
  });

  it("never asks the server about the code before the user confirms", async () => {
    const calls = stubApi({ signedIn: true });
    await renderJoin();
    await screen.findByRole("button", { name: /join this group/i });
    expect(calls.filter((c) => c.url !== "/api/auth/me")).toHaveLength(0);
  });

  it("confirms with the code alone — the group name is not revealed pre-join", async () => {
    stubApi({
      signedIn: true,
      join: { status: 200, body: { id: "g1", name: "Sunday Nights" } },
    });
    await renderJoin();
    expect(await screen.findByText(CODE)).toBeDefined();
    expect(screen.queryByText("Sunday Nights")).toBe(null);
  });

  it("joins with the code verbatim and then names the group", async () => {
    const calls = stubApi({
      signedIn: true,
      join: { status: 200, body: { id: "g1", name: "Sunday Nights" } },
    });
    await renderJoin();
    fireEvent.click(await screen.findByRole("button", { name: /join this group/i }));

    await waitFor(() => expect(screen.getByText("Sunday Nights")).toBeDefined());
    expect(calls.find((c) => c.url === "/api/groups/join")?.body).toEqual({
      code: CODE,
    });
    expect(
      screen.getByRole("link", { name: /tonight/i }).getAttribute("href")
    ).toBe("/tonight");
  });

  it("moves focus to the confirmation heading after joining", async () => {
    stubApi({
      signedIn: true,
      join: { status: 200, body: { id: "g1", name: "Sunday Nights" } },
    });
    await renderJoin();
    fireEvent.click(await screen.findByRole("button", { name: /join this group/i }));
    // The button unmounts when the success screen replaces it; without this the
    // keyboard user lands on <body> and nothing announces the outcome.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { level: 1 })
      )
    );
  });

  it("shows the server's message when the code doesn't match, and allows a retry", async () => {
    stubApi({
      signedIn: true,
      join: { status: 404, body: { error: "That code didn't match a group" } },
    });
    await renderJoin();
    fireEvent.click(await screen.findByRole("button", { name: /join this group/i }));
    expect(await screen.findByText("That code didn't match a group")).toBeDefined();
    expect(screen.getByRole("button", { name: /join this group/i })).toBeDefined();
  });

  it("offers somewhere to go when the code will never work", async () => {
    stubApi({
      signedIn: true,
      join: { status: 404, body: { error: "That code didn't match a group" } },
    });
    await renderJoin();
    fireEvent.click(await screen.findByRole("button", { name: /join this group/i }));
    await screen.findByText("That code didn't match a group");

    // An invite that doesn't resolve is where the app's second-ever user lands.
    // Retrying the same code is the one thing that cannot help them.
    expect(screen.getByRole("link", { name: /groups/i }).getAttribute("href")).toBe("/groups");
  });

  it("surfaces the rate-limit message", async () => {
    stubApi({
      signedIn: true,
      join: {
        status: 429,
        body: { error: "Too many join attempts — try again later" },
      },
    });
    await renderJoin();
    fireEvent.click(await screen.findByRole("button", { name: /join this group/i }));
    expect(
      await screen.findByText("Too many join attempts — try again later")
    ).toBeDefined();
  });
});

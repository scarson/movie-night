// @vitest-environment jsdom
// ABOUTME: Tests for the top nav — signed-out sign-in link, signed-in user menu.
// ABOUTME: Auth state comes from AuthProvider with fetch stubbed at the network boundary.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AuthProvider } from "@/components/auth-provider";
import { Nav } from "@/components/nav";

function stubMe(response: { status: number; body: unknown }) {
  const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/auth/me") {
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${String(input)}`);
  });
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Nav", () => {
  it("shows a sign-in link when signed out", async () => {
    stubMe({ status: 401, body: { error: "Unauthorized" } });
    render(
      <AuthProvider>
        <Nav />
      </AuthProvider>
    );
    expect(await screen.findByText("Sign in")).toBeDefined();
  });

  it("shows the user's name when signed in", async () => {
    stubMe({
      status: 200,
      body: {
        userId: "u1",
        email: "alice@example.com",
        name: "Alice Chen",
        avatarUrl: null,
      },
    });
    render(
      <AuthProvider>
        <Nav />
      </AuthProvider>
    );
    expect(await screen.findByText("Alice Chen")).toBeDefined();
  });

  it("fetches /api/auth/me exactly once", async () => {
    const fetchStub = stubMe({ status: 401, body: { error: "Unauthorized" } });
    render(
      <AuthProvider>
        <Nav />
      </AuthProvider>
    );
    await screen.findByText("Sign in");
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("opens the user menu with Profile and Sign out entries", async () => {
    stubMe({
      status: 200,
      body: {
        userId: "u1",
        email: "alice@example.com",
        name: "Alice Chen",
        avatarUrl: null,
      },
    });
    render(
      <AuthProvider>
        <Nav />
      </AuthProvider>
    );
    fireEvent.click(await screen.findByRole("button", { name: /Alice Chen/ }));
    const profile = screen.getByRole("menuitem", { name: "Profile" });
    expect(profile.getAttribute("href")).toBe("/profile");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeDefined();
  });

  it("returns focus to the menu button when Escape closes the menu", async () => {
    stubMe({
      status: 200,
      body: {
        userId: "u1",
        email: "alice@example.com",
        name: "Alice Chen",
        avatarUrl: null,
      },
    });
    render(
      <AuthProvider>
        <Nav />
      </AuthProvider>
    );
    const button = await screen.findByRole("button", { name: /Alice Chen/ });
    fireEvent.click(button);
    const profile = screen.getByRole("menuitem", { name: "Profile" });
    profile.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("renders the wordmark linking home", async () => {
    stubMe({ status: 401, body: { error: "Unauthorized" } });
    render(
      <AuthProvider>
        <Nav />
      </AuthProvider>
    );
    const wordmark = await screen.findByRole("link", { name: "Movie Night" });
    expect(wordmark.getAttribute("href")).toBe("/");
  });
});

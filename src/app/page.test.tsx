// @vitest-environment jsdom
// ABOUTME: Tests for the landing page — signed-out CTA and signed-in redirect to /tonight.
// ABOUTME: Auth comes through AuthProvider with fetch stubbed; the router is a boundary stub.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider } from "@/components/auth-provider";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
}));

import Home from "@/app/page";

function stubMe(response: { status: number; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/me") {
        return new Response(JSON.stringify(response.body), {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  replace.mockClear();
});

describe("Home (landing)", () => {
  it("shows the Google sign-in CTA when signed out", async () => {
    stubMe({ status: 401, body: { error: "Unauthorized" } });
    render(
      <AuthProvider>
        <Home />
      </AuthProvider>
    );
    expect(
      await screen.findByRole("button", { name: "Sign in with Google" })
    ).toBeDefined();
    expect(replace).not.toHaveBeenCalled();
  });

  it("redirects to /tonight when signed in", async () => {
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
        <Home />
      </AuthProvider>
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/tonight"));
  });
});

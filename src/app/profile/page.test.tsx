// @vitest-environment jsdom
// ABOUTME: Tests for profile settings — the editor round trip, the reduce-animations
// ABOUTME: preference, and account deletion gated on typing the word and explaining itself.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { AuthProvider } from "@/components/auth-provider";
import { REDUCED_MOTION_KEY } from "@/lib/reduced-motion";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, prefetch: vi.fn() }),
}));

import ProfilePage from "@/app/profile/page";

const ALICE = { userId: "u1", email: "alice@example.com", name: "Alice Chen", avatarUrl: null };

const SAVED = {
  comfortTitles: [27205],
  watchlist: [],
  vibes: ["Cozy"],
  dealbreakers: ["Gore"],
  streamingServices: ["Netflix"],
};

interface StubOptions {
  profile?: { status: number; body: unknown };
  put?: { status: number; body: unknown };
  del?: { status: number; body: unknown };
}

function stubApi(options: StubOptions = {}) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });

      if (url === "/api/auth/me") return new Response(JSON.stringify(ALICE), { status: 200 });
      if (url === "/api/user/profile" && method === "GET") {
        const p = options.profile ?? { status: 200, body: { profile: SAVED } };
        return new Response(JSON.stringify(p.body), { status: p.status });
      }
      if (url === "/api/user/profile" && method === "PUT") {
        const p = options.put ?? { status: 200, body: { ok: true } };
        return new Response(JSON.stringify(p.body), { status: p.status });
      }
      if (url === "/api/user/account") {
        const d = options.del ?? { status: 200, body: { ok: true } };
        return new Response(JSON.stringify(d.body), { status: d.status });
      }
      if (url.startsWith("/api/titles/search")) {
        return new Response(
          JSON.stringify({
            results: [
              { tmdbId: 27205, title: "Inception", year: 2010, posterPath: "/i.jpg" },
            ],
          }),
          { status: 200 }
        );
      }
      if (url === "/api/auth/logout") return new Response(JSON.stringify({ ok: true }), { status: 200 });
      throw new Error(`unexpected fetch: ${method} ${url}`);
    })
  );
  return calls;
}

/** jsdom's own localStorage getter yields undefined here, so supply a real one. */
function installStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const store = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
  Object.defineProperty(window, "localStorage", { value: store, configurable: true });
  return map;
}

async function renderProfile() {
  await act(async () => {
    render(
      <AuthProvider>
        <ProfilePage />
      </AuthProvider>
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.removeAttribute("data-reduced-motion");
  installStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("profile settings", () => {
  it("fills the editor from the saved profile", async () => {
    stubApi();
    await renderProfile();

    expect(await screen.findByRole("heading", { name: /comfort films/i })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Netflix" }).getAttribute("aria-checked")).toBe(
      "true"
    );
    // The same tag vocabulary appears under both "I want" and "Dealbreakers",
    // so each has to be checked in its own section.
    const wants = screen.getByRole("group", { name: /i want/i });
    expect(within(wants).getByRole("checkbox", { name: "Cozy" }).getAttribute("aria-checked")).toBe(
      "true"
    );
    const dealbreakers = screen.getByRole("group", { name: /dealbreakers/i });
    expect(
      within(dealbreakers).getByRole("checkbox", { name: "Cozy" }).getAttribute("aria-checked")
    ).toBe("false");
    expect(
      within(dealbreakers).getByRole("checkbox", { name: "Gore" }).getAttribute("aria-checked")
    ).toBe("true");
  });

  it("saves edits back as tmdb ids and says so", async () => {
    const calls = stubApi();
    await renderProfile();

    await screen.findByRole("heading", { name: /comfort films/i });
    fireEvent.click(screen.getByRole("checkbox", { name: "MUBI" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
    });

    const put = calls.find((c) => c.method === "PUT");
    expect(put?.body).toEqual({
      comfortTitles: [27205],
      watchlist: [],
      vibes: ["Cozy"],
      dealbreakers: ["Gore"],
      streamingServices: ["Netflix", "MUBI"],
    });
    expect(screen.getByText(/saved/i)).toBeTruthy();
  });

  it("surfaces a failed save instead of implying it worked", async () => {
    stubApi({ put: { status: 500, body: { error: "Failed to save profile" } } });
    await renderProfile();

    await screen.findByRole("heading", { name: /comfort films/i });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
    });

    expect(screen.getByRole("alert").textContent).toContain("Failed to save profile");
  });

  it("refuses to show an empty editor over a failed load", async () => {
    stubApi({ profile: { status: 500, body: { error: "nope" } } });
    await renderProfile();

    expect(await screen.findByRole("alert")).toBeTruthy();
    // An empty editor plus Save would erase the real profile.
    expect(screen.queryByRole("heading", { name: /comfort films/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  it("marks the document and remembers the choice when animations are dialled down", async () => {
    const stored = installStorage();
    stubApi();
    await renderProfile();

    const toggle = await screen.findByRole("switch", { name: /reduce animations/i });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);
    expect(document.documentElement.getAttribute("data-reduced-motion")).toBe("true");
    expect(stored.get(REDUCED_MOTION_KEY)).toBe("true");
    expect(
      screen.getByRole("switch", { name: /reduce animations/i }).getAttribute("aria-checked")
    ).toBe("true");

    fireEvent.click(screen.getByRole("switch", { name: /reduce animations/i }));
    expect(document.documentElement.getAttribute("data-reduced-motion")).toBeNull();
    expect(stored.get(REDUCED_MOTION_KEY)).toBe("false");
  });

  it("shows the toggle already on when it was set in an earlier visit", async () => {
    installStorage({ [REDUCED_MOTION_KEY]: "true" });
    stubApi();
    await renderProfile();

    expect(
      (await screen.findByRole("switch", { name: /reduce animations/i })).getAttribute(
        "aria-checked"
      )
    ).toBe("true");
  });

  it("explains what deleting actually does before asking", async () => {
    stubApi();
    await renderProfile();

    fireEvent.click(await screen.findByRole("button", { name: /delete (my )?account/i }));
    const explanation = screen.getByTestId("delete-explanation").textContent ?? "";
    // The shared history survives, anonymized — that is the promise being made.
    expect(explanation).toMatch(/deleted user/i);
    expect(explanation).toMatch(/can't be undone|cannot be undone/i);
  });

  it("keeps deletion locked until the word is actually typed", async () => {
    const calls = stubApi();
    await renderProfile();

    fireEvent.click(await screen.findByRole("button", { name: /delete (my )?account/i }));
    const confirm = screen.getByTestId("confirm-delete");
    const field = screen.getByRole("textbox", { name: /type delete/i });

    expect(confirm.hasAttribute("disabled")).toBe(true);
    fireEvent.click(confirm);
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);

    fireEvent.change(field, { target: { value: "del" } });
    expect(confirm.hasAttribute("disabled")).toBe(true);

    fireEvent.change(field, { target: { value: "delete" } });
    expect(confirm.hasAttribute("disabled")).toBe(false);
  });

  it("forgives capitals and stray spaces, since phones add both", async () => {
    stubApi();
    await renderProfile();

    fireEvent.click(await screen.findByRole("button", { name: /delete (my )?account/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /type delete/i }), {
      target: { value: " DELETE " },
    });
    expect(screen.getByTestId("confirm-delete").hasAttribute("disabled")).toBe(false);
  });

  it("deletes the account and sends the visitor home", async () => {
    const calls = stubApi();
    await renderProfile();

    fireEvent.click(await screen.findByRole("button", { name: /delete (my )?account/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /type delete/i }), {
      target: { value: "delete" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-delete"));
    });

    expect(calls.filter((c) => c.url === "/api/user/account" && c.method === "DELETE")).toHaveLength(
      1
    );
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("stays put and explains itself when deletion fails", async () => {
    stubApi({ del: { status: 500, body: { error: "Failed to delete account" } } });
    await renderProfile();

    fireEvent.click(await screen.findByRole("button", { name: /delete (my )?account/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /type delete/i }), {
      target: { value: "delete" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-delete"));
    });

    expect(screen.getByRole("alert").textContent).toContain("Failed to delete account");
    expect(replace).not.toHaveBeenCalled();
  });

  it("can back out of deleting without a page reload", async () => {
    stubApi();
    await renderProfile();

    const open = await screen.findByRole("button", { name: /delete (my )?account/i });
    fireEvent.click(open);
    fireEvent.click(screen.getByRole("button", { name: /keep my account/i }));

    expect(screen.queryByTestId("confirm-delete")).toBeNull();
    // Focus goes back to the control that opened it, not onto <body>.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /delete (my )?account/i })
    );
  });

  it("sends a signed-out visitor home rather than showing an empty shell", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }))
    );
    await renderProfile();
    expect(replace).toHaveBeenCalledWith("/");
  });
});

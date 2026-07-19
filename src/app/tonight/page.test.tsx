// @vitest-environment jsdom
// ABOUTME: Tests for the tonight hub — first-name greeting, group loading and default
// ABOUTME: selection, the two entry CTAs carrying the chosen group, and the signed-out bounce.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AuthProvider } from "@/components/auth-provider";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
}));

import Tonight from "@/app/tonight/page";

const ALICE = {
  userId: "u1",
  email: "alice@example.com",
  name: "Alice Chen",
  avatarUrl: null,
};

const SUNDAY = {
  id: "g1",
  name: "Sunday Nights",
  inviteCode: "aB23cdEF",
  createdAt: "2026-01-01T00:00:00.000Z",
  members: [ALICE, { userId: "u2", name: "Bob Reyes", avatarUrl: null }],
};

const FILM_CLUB = { ...SUNDAY, id: "g2", name: "The Film Club" };

function stubApi({
  me,
  groups,
}: {
  me: { status: number; body: unknown };
  groups?: { status: number; body: unknown };
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/auth/me") {
        return new Response(JSON.stringify(me.body), { status: me.status });
      }
      if (url === "/api/groups" && groups) {
        return new Response(JSON.stringify(groups.body), {
          status: groups.status,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
}

function renderHub() {
  return render(
    <AuthProvider>
      <Tonight />
    </AuthProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  replace.mockClear();
});

describe("Tonight hub", () => {
  it("greets the signed-in user by first name", async () => {
    stubApi({
      me: { status: 200, body: ALICE },
      groups: { status: 200, body: { groups: [] } },
    });
    renderHub();
    expect(
      await screen.findByRole("heading", { name: /^Alice,/ })
    ).toBeDefined();
  });

  it("drops the greeting rather than showing a dangling comma when there is no name", async () => {
    // Google's `name` claim is optional; the callback stores "" when it's absent.
    stubApi({
      me: { status: 200, body: { ...ALICE, name: "" } },
      groups: { status: 200, body: { groups: [] } },
    });
    renderHub();
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Who's watching tonight?");
  });

  it("sends signed-out visitors back to the landing page", async () => {
    stubApi({ me: { status: 401, body: { error: "Unauthorized" } } });
    renderHub();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("starts on solo when the user has no groups", async () => {
    stubApi({
      me: { status: 200, body: ALICE },
      groups: { status: 200, body: { groups: [] } },
    });
    renderHub();
    const solo = await screen.findByRole("radio", { name: /just me tonight/i });
    expect((solo as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("link", { name: /quick match/i }).getAttribute("href")).toBe("/quick");
    expect(screen.getByRole("link", { name: /full ritual/i }).getAttribute("href")).toBe("/ritual");
  });

  it("auto-selects the only group and carries it into both CTAs", async () => {
    stubApi({
      me: { status: 200, body: ALICE },
      groups: { status: 200, body: { groups: [SUNDAY] } },
    });
    renderHub();
    const group = await screen.findByRole("radio", { name: /Sunday Nights/ });
    expect((group as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("link", { name: /quick match/i }).getAttribute("href")).toBe("/quick?group=g1");
    expect(screen.getByRole("link", { name: /full ritual/i }).getAttribute("href")).toBe("/ritual?group=g1");
  });

  it("updates the CTAs when a different group is picked", async () => {
    stubApi({
      me: { status: 200, body: ALICE },
      groups: { status: 200, body: { groups: [SUNDAY, FILM_CLUB] } },
    });
    renderHub();
    fireEvent.click(await screen.findByRole("radio", { name: /The Film Club/ }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /quick match/i }).getAttribute("href")).toBe("/quick?group=g2")
    );
  });

  it("links to group management", async () => {
    stubApi({
      me: { status: 200, body: ALICE },
      groups: { status: 200, body: { groups: [SUNDAY] } },
    });
    renderHub();
    expect(
      (await screen.findByRole("link", { name: /groups/i })).getAttribute("href")
    ).toBe("/groups");
  });

  it("stays usable when the groups request fails", async () => {
    stubApi({
      me: { status: 200, body: ALICE },
      groups: { status: 500, body: { error: "Failed to fetch groups" } },
    });
    renderHub();
    const solo = await screen.findByRole("radio", { name: /just me tonight/i });
    expect((solo as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/couldn't load your groups/i)).toBeDefined();
  });
});

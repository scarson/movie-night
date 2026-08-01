// @vitest-environment jsdom
// ABOUTME: Tests for the groups page — listing, invite-link copy, create, join-by-code,
// ABOUTME: and the two-step leave confirmation.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AuthProvider } from "@/components/auth-provider";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
}));

import Groups from "@/app/groups/page";

const ALICE = {
  userId: "u1",
  email: "alice@example.com",
  name: "Alice Chen",
  avatarUrl: null,
};
const BOB = { userId: "u2", name: "Bob Reyes", avatarUrl: null };

const FILM_CLUB = {
  id: "g2",
  name: "The Film Club",
  inviteCode: "Qm7xKp2R",
  createdAt: "2026-01-02T00:00:00.000Z",
  members: [ALICE, BOB],
};

const SUNDAY = {
  id: "g1",
  name: "Sunday Nights",
  inviteCode: "aB23cdEF",
  createdAt: "2026-01-01T00:00:00.000Z",
  members: [ALICE, BOB],
};

interface Route {
  status: number;
  body: unknown;
}

/** Stateful fetch stub: GET /api/groups returns whatever `groups` currently holds. */
function stubApi(options: {
  signedIn?: boolean;
  groups?: unknown[];
  post?: Record<string, Route>;
}) {
  const state = { groups: options.groups ?? [] };
  const calls: { url: string; body: unknown }[] = [];
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });

    if (url === "/api/auth/me") {
      return options.signedIn === false
        ? new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
        : new Response(JSON.stringify(ALICE), { status: 200 });
    }
    if (url === "/api/groups" && (!init || init.method === undefined)) {
      return new Response(JSON.stringify({ groups: state.groups }), { status: 200 });
    }
    const route = options.post?.[url];
    if (route) {
      return new Response(JSON.stringify(route.body), { status: route.status });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchStub);
  return { state, calls, fetchStub };
}

function renderGroups() {
  return render(
    <AuthProvider>
      <Groups />
    </AuthProvider>
  );
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  replace.mockClear();
});

describe("Groups page", () => {
  it("sends signed-out visitors back to the landing page", async () => {
    stubApi({ signedIn: false });
    renderGroups();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("teaches what a group is when the user has none", async () => {
    stubApi({ groups: [] });
    renderGroups();
    expect(await screen.findByText(/no groups yet/i)).toBeDefined();
  });

  it("lists each group with its members and invite link", async () => {
    stubApi({ groups: [SUNDAY] });
    renderGroups();
    expect(await screen.findByText("Sunday Nights")).toBeDefined();
    expect(screen.getByText("Alice Chen, Bob Reyes")).toBeDefined();
    expect(
      screen.getByText(`${window.location.origin}/groups/join/aB23cdEF`)
    ).toBeDefined();
  });

  it("renders the whole invite link, wrapped rather than clipped", async () => {
    // 1.4.10 Reflow. At 320px this element's box is 236px and the URL needs
    // 315px, so `truncate` costs ~25% of it — silently, with no scrollbar and
    // no title, which is invisible to a document-level `scrollWidth` check.
    // The link must wrap instead; `copyInvite`'s clipboard-failure fallback
    // depends on the whole link being readable and selectable by hand.
    //
    // jsdom has no layout engine: scrollWidth and clientWidth read 0 for every
    // element, so this assertion is structural and CANNOT prove the visual fix.
    // The geometric check — `scrollWidth <= clientWidth` on this element's own
    // box at 320x800 — lives in the browser runbook at
    // dev/reports/2026-08-01-authenticated-a11y-verification.md §Part 1.
    stubApi({ groups: [SUNDAY] });
    renderGroups();

    const link = await screen.findByText(
      `${window.location.origin}/groups/join/aB23cdEF`
    );
    const classes = link.className.split(/\s+/);
    expect(classes).not.toContain("truncate");
    expect(classes).toContain("break-all");
  });

  it("copies the invite link built from the current origin", async () => {
    stubApi({ groups: [SUNDAY] });
    renderGroups();
    fireEvent.click(await screen.findByRole("button", { name: /copy invite link/i }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/groups/join/aB23cdEF`
      )
    );
    expect(await screen.findByText(/^copied$/i)).toBeDefined();
  });

  it("announces the copied state on the control itself, not in reserved space", async () => {
    stubApi({ groups: [SUNDAY] });
    renderGroups();
    const copy = await screen.findByRole("button", { name: /copy invite link/i });
    fireEvent.click(copy);
    // The same control reports the outcome, so nothing shifts and the change is
    // announced: its accessible name flips rather than a placeholder row filling in.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /invite link for Sunday Nights copied/i })
      ).toBe(copy)
    );
  });

  it("creates a group and shows it in the list", async () => {
    const api = stubApi({
      groups: [],
      post: { "/api/groups": { status: 200, body: { group: SUNDAY } } },
    });
    renderGroups();
    await screen.findByText(/no groups yet/i);

    fireEvent.change(screen.getByLabelText(/group name/i), {
      target: { value: "  Sunday Nights  " },
    });
    api.state.groups = [SUNDAY];
    fireEvent.click(screen.getByRole("button", { name: /^create group$/i }));

    expect(await screen.findByText("Sunday Nights")).toBeDefined();
    const post = api.calls.find((c) => c.url === "/api/groups" && c.body);
    expect(post?.body).toEqual({ name: "Sunday Nights" });
  });

  it("surfaces a create failure without clearing what was typed", async () => {
    stubApi({
      groups: [],
      post: {
        "/api/groups": {
          status: 400,
          body: { error: "Group name must be 1-50 characters" },
        },
      },
    });
    renderGroups();
    const input = await screen.findByLabelText(/group name/i);
    fireEvent.change(input, { target: { value: "Sunday Nights" } });
    fireEvent.click(screen.getByRole("button", { name: /^create group$/i }));

    expect(
      await screen.findByText("Group name must be 1-50 characters")
    ).toBeDefined();
    expect((input as HTMLInputElement).value).toBe("Sunday Nights");
  });

  it("joins by code, preserving the code's letter case", async () => {
    const api = stubApi({
      groups: [],
      post: {
        "/api/groups/join": {
          status: 200,
          body: { id: "g1", name: "Sunday Nights" },
        },
      },
    });
    renderGroups();
    fireEvent.change(await screen.findByLabelText(/invite code/i), {
      target: { value: " aB23cdEF " },
    });
    api.state.groups = [SUNDAY];
    fireEvent.click(screen.getByRole("button", { name: /^join group$/i }));

    await waitFor(() =>
      expect(api.calls.find((c) => c.url === "/api/groups/join")?.body).toEqual({
        code: "aB23cdEF",
      })
    );
    expect(await screen.findByText("Sunday Nights")).toBeDefined();
  });

  it("accepts a pasted invite link, not just the bare code", async () => {
    // The card shows a full URL next to a Copy button, so pasting the whole
    // link into the code field is the likely first attempt.
    const api = stubApi({
      groups: [],
      post: {
        "/api/groups/join": { status: 200, body: { id: "g1", name: "Sunday Nights" } },
      },
    });
    renderGroups();
    fireEvent.change(await screen.findByLabelText(/invite code/i), {
      target: { value: "https://movienight.example/groups/join/aB23cdEF" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^join group$/i }));

    await waitFor(() =>
      expect(api.calls.find((c) => c.url === "/api/groups/join")?.body).toEqual({
        code: "aB23cdEF",
      })
    );
  });

  it("shows the API's message when a code doesn't match", async () => {
    stubApi({
      groups: [],
      post: {
        "/api/groups/join": {
          status: 404,
          body: { error: "That code didn't match a group" },
        },
      },
    });
    renderGroups();
    fireEvent.change(await screen.findByLabelText(/invite code/i), {
      target: { value: "aB23cdEF" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^join group$/i }));
    expect(
      await screen.findByText("That code didn't match a group")
    ).toBeDefined();
  });

  it("requires a second, explicit confirmation before leaving", async () => {
    const api = stubApi({
      groups: [SUNDAY],
      post: { "/api/groups/g1/leave": { status: 200, body: { ok: true } } },
    });
    renderGroups();
    fireEvent.click(await screen.findByRole("button", { name: /leave group/i }));

    expect(api.calls.some((c) => c.url.endsWith("/leave"))).toBe(false);
    expect(screen.getByText(/you'll need a new invite/i)).toBeDefined();

    api.state.groups = [];
    fireEvent.click(screen.getByRole("button", { name: /^yes, leave$/i }));

    await waitFor(() =>
      expect(api.calls.some((c) => c.url === "/api/groups/g1/leave")).toBe(true)
    );
    await waitFor(() => expect(screen.queryByText("Sunday Nights")).toBe(null));
  });

  it("moves focus to the confirm when the leave step opens", async () => {
    stubApi({ groups: [SUNDAY] });
    renderGroups();
    fireEvent.click(await screen.findByRole("button", { name: /leave group/i }));
    // The trigger unmounts when the confirm replaces it; without this the
    // keyboard user is dropped on <body> mid-flow.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: /^yes, leave$/i })
      )
    );
  });

  it("returns focus to the leave control when the user backs out", async () => {
    stubApi({ groups: [SUNDAY] });
    renderGroups();
    fireEvent.click(await screen.findByRole("button", { name: /leave group/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: /leave group/i })
      )
    );
  });

  it("lands focus on the visible page heading once a group is left", async () => {
    const api = stubApi({
      groups: [SUNDAY],
      post: { "/api/groups/g1/leave": { status: 200, body: { ok: true } } },
    });
    renderGroups();
    fireEvent.click(await screen.findByRole("button", { name: /leave group/i }));
    api.state.groups = [];
    fireEvent.click(screen.getByRole("button", { name: /^yes, leave$/i }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { level: 1, name: "Groups" })
      )
    );
  });

  it("surfaces a leave failure on the group it belongs to, and only there", async () => {
    const api = stubApi({
      groups: [SUNDAY, FILM_CLUB],
      post: {
        "/api/groups/g1/leave": { status: 500, body: { error: "Failed to leave group" } },
      },
    });
    renderGroups();
    fireEvent.click(
      await screen.findByRole("button", { name: /leave group Sunday Nights/i })
    );
    fireEvent.click(screen.getByRole("button", { name: /^yes, leave$/i }));

    // Exactly one card reports it — a page-wide error string would show twice.
    const alerts = await screen.findAllByText("Failed to leave group");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].closest("li")).toBe(
      screen.getByText("Sunday Nights").closest("li")
    );
    // Still a member, so the card stays.
    expect(screen.getByText("Sunday Nights")).toBeDefined();
    expect(api.calls.some((c) => c.url === "/api/groups/g1/leave")).toBe(true);
  });

  it("disables the create and join controls while another mutation is in flight", async () => {
    // A single `busy` semaphore guards every mutation, but each button only
    // disabled itself. With a leave in flight, Create stayed enabled yet its
    // guard returns against the truthy `busy` — a dead click with no feedback.
    let releaseLeave: () => void = () => {};
    const leaveGate = new Promise<void>((resolve) => {
      releaseLeave = resolve;
    });
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/auth/me") {
        return new Response(JSON.stringify(ALICE), { status: 200 });
      }
      if (url === "/api/groups" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ groups: [SUNDAY] }), { status: 200 });
      }
      if (url === "/api/groups/g1/leave") {
        await leaveGate;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchStub);
    renderGroups();

    fireEvent.click(await screen.findByRole("button", { name: /leave group/i }));
    fireEvent.click(screen.getByRole("button", { name: /^yes, leave$/i }));

    // The leave POST is now pending; the other mutation controls must lock.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^create group$/i }).hasAttribute("disabled")
      ).toBe(true)
    );
    expect(
      screen.getByRole("button", { name: /^join group$/i }).hasAttribute("disabled")
    ).toBe(true);

    releaseLeave();
    // They release once the mutation settles.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^create group$/i }).hasAttribute("disabled")
      ).toBe(false)
    );
  });

  it("lets the user back out of leaving", async () => {
    const api = stubApi({ groups: [SUNDAY] });
    renderGroups();
    fireEvent.click(await screen.findByRole("button", { name: /leave group/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(await screen.findByRole("button", { name: /leave group/i })).toBeDefined();
    expect(api.calls.some((c) => c.url.endsWith("/leave"))).toBe(false);
  });
});

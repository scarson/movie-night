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

  it("copies the invite link built from the current origin", async () => {
    stubApi({ groups: [SUNDAY] });
    renderGroups();
    fireEvent.click(await screen.findByRole("button", { name: /copy invite link/i }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/groups/join/aB23cdEF`
      )
    );
    expect(await screen.findByText(/copied/i)).toBeDefined();
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

  it("lets the user back out of leaving", async () => {
    const api = stubApi({ groups: [SUNDAY] });
    renderGroups();
    fireEvent.click(await screen.findByRole("button", { name: /leave group/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(await screen.findByRole("button", { name: /leave group/i })).toBeDefined();
    expect(api.calls.some((c) => c.url.endsWith("/leave"))).toBe(false);
  });
});

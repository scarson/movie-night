// @vitest-environment jsdom
// ABOUTME: Tests for TitleSearch — 250ms debounce (fake timers), stale-response
// ABOUTME: guarding, selected chips, quick picks, and the search error path.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TitleSearch, type TitleRef } from "@/components/title-search";

const ARRIVAL: TitleRef = {
  tmdbId: 329865,
  title: "Arrival",
  year: 2016,
  posterPath: "/arrival.jpg",
};
const KNIVES: TitleRef = {
  tmdbId: 546554,
  title: "Knives Out",
  year: 2019,
  posterPath: null,
};

function searchResponse(results: TitleRef[]) {
  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("TitleSearch", () => {
  it("debounces the search fetch by 250ms", async () => {
    const fetchStub = vi.fn(async () => searchResponse([ARRIVAL]));
    vi.stubGlobal("fetch", fetchStub);
    render(<TitleSearch selected={[]} onChange={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "arri" },
    });
    await advance(249);
    expect(fetchStub).not.toHaveBeenCalled();
    await advance(1);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledWith("/api/titles/search?q=arri");
  });

  it("restarts the debounce window on each keystroke", async () => {
    const fetchStub = vi.fn(async () => searchResponse([ARRIVAL]));
    vi.stubGlobal("fetch", fetchStub);
    render(<TitleSearch selected={[]} onChange={() => {}} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "ar" } });
    await advance(150);
    fireEvent.change(input, { target: { value: "arr" } });
    await advance(150);
    expect(fetchStub).not.toHaveBeenCalled();
    await advance(100);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledWith("/api/titles/search?q=arr");
  });

  it("does not fetch for queries under 2 characters", async () => {
    const fetchStub = vi.fn(async () => searchResponse([]));
    vi.stubGlobal("fetch", fetchStub);
    render(<TitleSearch selected={[]} onChange={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "a" } });
    await advance(500);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("renders results and adds a title on selection, clearing the search", async () => {
    const fetchStub = vi.fn(async () => searchResponse([ARRIVAL, KNIVES]));
    vi.stubGlobal("fetch", fetchStub);
    const onChange = vi.fn();
    render(<TitleSearch selected={[]} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "arri" } });
    await advance(250);
    fireEvent.click(screen.getByRole("button", { name: "Arrival (2016)" }));
    expect(onChange).toHaveBeenCalledWith([ARRIVAL]);
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Knives Out (2019)" })).toBeNull();
  });

  it("hides already-selected titles from the results list", async () => {
    const fetchStub = vi.fn(async () => searchResponse([ARRIVAL, KNIVES]));
    vi.stubGlobal("fetch", fetchStub);
    render(<TitleSearch selected={[ARRIVAL]} onChange={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "arri" },
    });
    await advance(250);
    expect(screen.queryByRole("button", { name: "Arrival (2016)" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Knives Out (2019)" })
    ).toBeDefined();
  });

  it("ignores a stale response that resolves after a newer one", async () => {
    let resolveFirst: (r: Response) => void = () => {};
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchStub = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(searchResponse([KNIVES]));
    vi.stubGlobal("fetch", fetchStub);
    render(<TitleSearch selected={[]} onChange={() => {}} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "arri" } });
    await advance(250);
    fireEvent.change(input, { target: { value: "kniv" } });
    await advance(250);
    expect(
      screen.getByRole("button", { name: "Knives Out (2019)" })
    ).toBeDefined();
    await act(async () => {
      resolveFirst(searchResponse([ARRIVAL]));
      await Promise.resolve();
    });
    expect(screen.queryByRole("button", { name: "Arrival (2016)" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Knives Out (2019)" })
    ).toBeDefined();
  });

  it("shows a quiet error message when the search fetch fails", async () => {
    const fetchStub = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchStub);
    render(<TitleSearch selected={[]} onChange={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "arri" },
    });
    await advance(250);
    expect(screen.getByText("Couldn't search right now.")).toBeDefined();
  });

  it("renders selected titles as removable chips", () => {
    const onChange = vi.fn();
    render(<TitleSearch selected={[ARRIVAL, KNIVES]} onChange={onChange} />);
    const chip = screen.getByRole("checkbox", { name: "Arrival" });
    expect(chip.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(chip);
    expect(onChange).toHaveBeenCalledWith([KNIVES]);
  });

  it("offers unselected quick picks and adds them on tap", () => {
    const onChange = vi.fn();
    render(
      <TitleSearch
        selected={[ARRIVAL]}
        onChange={onChange}
        quickPicks={[ARRIVAL, KNIVES]}
      />
    );
    const checkboxes = screen.getAllByRole("checkbox");
    expect(
      checkboxes.filter((c) => c.getAttribute("aria-label") === "Arrival")
    ).toHaveLength(1);
    const quickPick = screen.getByRole("checkbox", { name: "Knives Out" });
    expect(quickPick.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(quickPick);
    expect(onChange).toHaveBeenCalledWith([ARRIVAL, KNIVES]);
  });
});

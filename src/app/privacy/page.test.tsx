// @vitest-environment jsdom
// ABOUTME: Tests for the privacy policy page — required disclosures are present.
// ABOUTME: Static content; asserts the design-doc privacy principles appear in the page.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PrivacyPage from "@/app/privacy/page";

describe("PrivacyPage", () => {
  it("discloses Anthropic processing with the no-training note", () => {
    render(<PrivacyPage />);
    const disclosure = screen.getByText(/not used to train their models/i);
    expect(disclosure.textContent).toMatch(/Anthropic/);
  });

  it("covers deletion as anonymization of shared records", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/\[deleted user\]/)).toBeDefined();
  });

  it("lists the contact address", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/samuel\.carson@gmail\.com/)).toBeDefined();
  });
});

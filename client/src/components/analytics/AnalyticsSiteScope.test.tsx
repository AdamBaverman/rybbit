import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AnalyticsSiteScope } from "./AnalyticsSiteScope";

vi.mock("next-intl", () => ({
  useExtracted: () => (message: string, values?: { site: string }) => message.replace("{site}", values?.site ?? ""),
}));
vi.mock("@/lib/store", () => ({ useStore: () => 3 }));
vi.mock("@/api/admin/hooks/useSites", () => ({
  useGetSite: () => ({ data: { organizationId: "org" } }),
  useGetSitesFromOrg: () => ({
    data: {
      sites: [
        { siteId: 3, name: "Landing" },
        { siteId: 4, name: "PWA", saltUserIds: true },
        { siteId: 5, name: "Store" },
      ],
    },
  }),
}));

afterEach(cleanup);

it("keeps the current site and saves only explicitly added sites, including on edit", () => {
  const changed = vi.fn();
  function Editor() {
    const [ids, setIds] = useState<number[] | undefined>([3, 5]);
    return (
      <AnalyticsSiteScope
        siteIds={ids}
        onChange={next => {
          changed(next);
          setIds(next);
        }}
      />
    );
  }
  render(<Editor />);
  expect(screen.getByText("Current site: Landing")).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: "Landing" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "PWA" }));
  expect(changed).toHaveBeenLastCalledWith([3, 4, 5]);
  expect(screen.getByText(/rotates user identifiers/)).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "Store" }));
  expect(changed).toHaveBeenLastCalledWith([3, 4]);
  fireEvent.click(screen.getByRole("checkbox", { name: "PWA" }));
  expect(changed).toHaveBeenLastCalledWith(undefined);
  expect(screen.queryByText(/rotates user identifiers/)).toBeNull();
});

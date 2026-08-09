import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppShell } from "./AppShell";
import { Button, ConfirmDialog, DataTable, OperationalState } from "./ui";

afterEach(cleanup);

describe("AppShell", () => {
  test("marks the active destination and hides owner navigation from members", () => {
    render(
      <AppShell role="member" currentPath="/contacts/contact-1">
        <h1>Contacts</h1>
      </AppShell>,
    );
    expect(
      screen
        .getByRole("link", { name: "Contacts" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.queryByRole("link", { name: "Administration" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Audit" })).toBeNull();
  });

  test("exposes every frozen area to an owner", () => {
    render(
      <AppShell role="owner">
        <h1>Dashboard</h1>
      </AppShell>,
    );
    for (const label of [
      "Dashboard",
      "Companies",
      "Contacts",
      "Activities",
      "Deals",
      "Tasks",
      "Imports",
      "Audit",
      "Administration",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
  });

  test("routes without a document navigation when a router callback is supplied", () => {
    const navigate = vi.fn();
    render(
      <AppShell navigate={navigate}>
        <h1>Dashboard</h1>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Companies" }));
    expect(navigate).toHaveBeenCalledWith("/companies");
  });
});

test("confirmation explains consequences and only confirms explicitly", () => {
  const confirm = vi.fn();
  const close = vi.fn();
  render(
    <>
      <Button>Archive company</Button>
      <ConfirmDialog
        open
        title="Archive Acme?"
        consequences="Contacts and history remain, but Acme leaves active lists."
        danger
        confirmLabel="Archive company"
        onConfirm={confirm}
        onClose={close}
      />
    </>,
  );
  expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
  expect(screen.getByText(/Contacts and history remain/)).toBeTruthy();
  fireEvent.click(
    screen.getAllByRole("button", { name: "Archive company" })[1],
  );
  expect(confirm).toHaveBeenCalledOnce();
});

test("data and failure states have semantic labels", () => {
  const { rerender } = render(
    <DataTable caption="Companies" columns={["Name", "Status"]}>
      <tr>
        <td>Acme</td>
        <td>Customer</td>
      </tr>
    </DataTable>,
  );
  expect(
    screen.getByRole("region", { name: /Companies, scrollable/ }),
  ).toBeTruthy();
  rerender(<OperationalState kind="error" />);
  expect(screen.getByRole("alert").textContent).toContain(
    "Something went wrong",
  );
});

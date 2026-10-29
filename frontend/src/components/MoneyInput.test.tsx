import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import MoneyInput from "./MoneyInput";

interface HarnessProps {
  initial?: string;
  currency?: string;
  allowNegative?: boolean;
}

function Harness({ initial = "", ...props }: HarnessProps) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MoneyInput aria-label="Valor" value={value} onChange={setValue} {...props} />
      <output data-testid="value">{value}</output>
    </>
  );
}

const input = () => screen.getByRole("textbox", { name: "Valor" });
const stored = () => screen.getByTestId("value").textContent;

describe("MoneyInput", () => {
  it("shows the currency symbol in front", () => {
    const { container, rerender } = render(<Harness />);
    const prefix = () => container.querySelector(".money-prefix");
    expect(prefix()).toHaveAttribute("data-symbol", "R$");
    rerender(<Harness currency="USD" />);
    expect(prefix()).toHaveAttribute("data-symbol", "US$");
  });

  it("fills from the cents and always shows two decimals", async () => {
    render(<Harness />);
    await userEvent.type(input(), "1");
    expect(input()).toHaveValue("0,01");
    await userEvent.type(input(), "23456");
    expect(input()).toHaveValue("1.234,56");
    expect(stored()).toBe("1234.56");
  });

  it("formats an existing value with cents", () => {
    render(<Harness initial="80" />);
    expect(input()).toHaveValue("80,00");
  });

  it("removes digits with backspace and empties the field", async () => {
    render(<Harness initial="12.34" />);
    await userEvent.type(input(), "{backspace}");
    expect(input()).toHaveValue("1,23");
    await userEvent.type(input(), "{backspace}{backspace}{backspace}");
    expect(input()).toHaveValue("");
    expect(stored()).toBe("");
  });

  it("ignores letters and a minus sign unless negatives are allowed", async () => {
    const { unmount } = render(<Harness />);
    await userEvent.type(input(), "-5a0");
    expect(input()).toHaveValue("0,50");
    unmount();

    render(<Harness allowNegative />);
    await userEvent.type(input(), "-1000");
    expect(input()).toHaveValue("-10,00");
    expect(stored()).toBe("-10.00");
  });
});

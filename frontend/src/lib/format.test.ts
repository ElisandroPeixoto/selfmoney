import { formatCurrency, formatMonth, formatPercent } from "./format";

describe("format", () => {
  it("formats decimal strings as BRL", () => {
    expect(formatCurrency("1234.5")).toBe("R$ 1.234,50");
    expect(formatCurrency(-10)).toBe("-R$ 10,00");
  });

  it("formats ratios as percentages", () => {
    expect(formatPercent(0.256)).toBe("25,6%");
  });

  it("capitalizes the month label", () => {
    expect(formatMonth(2026, 10)).toBe("Outubro de 2026");
  });
});

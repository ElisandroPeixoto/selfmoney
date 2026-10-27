import type { Bank } from "../api/client";
import { BANKS } from "../lib/options";

interface Props {
  bank: Bank | null;
  fallbackLabel: string;
  size?: number;
}

export default function BankLogo({ bank, fallbackLabel, size = 32 }: Props) {
  const style = { width: size, height: size };
  if (bank) {
    return <img className="bank-logo" src={BANKS[bank].logo} alt={BANKS[bank].name} style={style} />;
  }
  // No bank selected: show the account's initial on a neutral tile.
  return (
    <span className="bank-logo bank-logo-fallback" style={style} aria-hidden="true">
      {fallbackLabel.charAt(0).toUpperCase()}
    </span>
  );
}

import { formatCurrency } from "../lib/format";

interface Props {
  planned: string;
  spent: string;
  available: string;
  currency: string;
  label: string;
}

/** Spent vs. planned meter; overspending is stated in text, not only by color. */
export default function BudgetProgress({ planned, spent, available, currency, label }: Props) {
  const plannedNum = Number(planned);
  const spentNum = Number(spent);
  const over = Number(available) < 0;
  const ratio = plannedNum > 0 ? spentNum / plannedNum : spentNum > 0 ? 1 : 0;

  return (
    <div className="budget-progress">
      <div
        className="meter"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={plannedNum}
        aria-valuenow={Math.min(spentNum, plannedNum)}
        aria-valuetext={`${formatCurrency(spent, currency)} de ${formatCurrency(planned, currency)}`}
      >
        <div
          className={over ? "meter-fill over" : "meter-fill"}
          style={{ width: `${Math.min(ratio, 1) * 100}%` }}
        />
      </div>
      <div className="budget-progress-text">
        <span className="muted">
          {formatCurrency(spent, currency)} de {formatCurrency(planned, currency)}
        </span>
        {over ? (
          <span className="negative">
            Excedido em {formatCurrency(Math.abs(Number(available)), currency)}
          </span>
        ) : (
          <span>Disponível: {formatCurrency(available, currency)}</span>
        )}
      </div>
    </div>
  );
}

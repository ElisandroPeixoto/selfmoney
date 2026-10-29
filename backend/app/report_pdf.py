"""Monthly report as a PDF (reportlab), from the data assembled in `services.monthly_report`."""

from datetime import UTC
from decimal import Decimal
from io import BytesIO
from typing import Any
from xml.sax.saxutils import escape

from reportlab.graphics.charts.barcharts import HorizontalBarChart, VerticalBarChart
from reportlab.graphics.charts.doughnut import Doughnut
from reportlab.graphics.shapes import Drawing, Line, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    CondPageBreak,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.models import Currency, MovementKind, TransactionType
from app.schemas import BudgetItemRead, CategorySpending
from app.services import MonthlyReport, ReportMonth

# Same values as the light theme tokens in frontend/src/styles.css.
TEXT = colors.HexColor("#0b0b0b")
TEXT_SECONDARY = colors.HexColor("#52514e")
TEXT_MUTED = colors.HexColor("#6f6e69")
BORDER = colors.HexColor("#e4e3df")
SURFACE = colors.HexColor("#f4f4f2")
ACCENT = colors.HexColor("#2a78d6")
POSITIVE = colors.HexColor("#1b7f3b")
NEGATIVE = colors.HexColor("#c62828")
WARNING = colors.HexColor("#fab219")
CRITICAL = colors.HexColor("#d03b3b")

# Matches NEAR_LIMIT in frontend/src/components/BudgetChart.tsx.
NEAR_LIMIT = Decimal("0.8")
MAX_DONUT_SLICES = 7

MONTHS = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
]
SYMBOLS = {Currency.BRL: "R$", Currency.USD: "US$", Currency.EUR: "€"}
MOVEMENT_LABELS = {
    MovementKind.TRANSFER: "Transferência",
    MovementKind.DEPOSIT: "Adição",
    MovementKind.WITHDRAWAL: "Retirada",
}

PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN = 18 * mm
CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN

BASE = ParagraphStyle("base", fontName="Helvetica", fontSize=9, leading=12, textColor=TEXT)
STYLES = {
    "title": ParagraphStyle("title", BASE, fontName="Helvetica-Bold", fontSize=20, leading=24),
    "subtitle": ParagraphStyle("subtitle", BASE, textColor=TEXT_MUTED, fontSize=9.5),
    "h2": ParagraphStyle(
        "h2",
        BASE,
        fontName="Helvetica-Bold",
        fontSize=12.5,
        leading=16,
        spaceBefore=14,
        spaceAfter=6,
    ),
    "body": BASE,
    "muted": ParagraphStyle("muted", BASE, textColor=TEXT_MUTED),
    "small": ParagraphStyle("small", BASE, fontSize=8, leading=10, textColor=TEXT_MUTED),
    "cell": ParagraphStyle("cell", BASE, fontSize=8.5, leading=10.5),
    "cell_right": ParagraphStyle(
        "cell_right", BASE, fontSize=8.5, leading=10.5, alignment=TA_RIGHT
    ),
    "kpi_label": ParagraphStyle("kpi_label", BASE, fontSize=8.5, textColor=TEXT_SECONDARY),
    "kpi_value": ParagraphStyle(
        "kpi_value", BASE, fontName="Helvetica-Bold", fontSize=13, leading=17
    ),
    "kpi_note": ParagraphStyle("kpi_note", BASE, fontSize=7.5, leading=9.5, textColor=TEXT_MUTED),
}


# --- Formatting (pt-BR, like frontend/src/lib/format.ts) ---


def money(value: Decimal | float, currency: Currency, cents: bool = True) -> str:
    amount = Decimal(str(value))
    text = f"{abs(amount):,.{2 if cents else 0}f}"
    text = text.replace(",", "_").replace(".", ",").replace("_", ".")
    sign = "-" if amount < 0 else ""
    return f"{sign}{SYMBOLS[currency]} {text}"


def percent(ratio: Decimal | float, signed: bool = False) -> str:
    value = round(float(ratio) * 100)
    return f"{'+' if signed and value > 0 else ''}{value}%"


def month_label(year: int, month: int) -> str:
    return f"{MONTHS[month - 1]} de {year}"


def short_month(month: ReportMonth) -> str:
    return f"{MONTHS[month.month - 1][:3]}/{str(month.year)[2:]}"


def day(value: Any) -> str:  # noqa: ANN401 - date or datetime
    return value.strftime("%d/%m/%Y")


def p(text: str, style: str = "body") -> Paragraph:
    return Paragraph(text, STYLES[style])


def safe(text: str) -> str:
    """User text goes inside Paragraph markup, so it must be escaped."""
    return escape(text)


# --- Building blocks ---


def section(title: str, *flowables: Any) -> list[Any]:  # noqa: ANN401
    # Keep a heading with the start of its content instead of orphaned at a page bottom.
    return [CondPageBreak(60 * mm), p(title, "h2"), *flowables]


def data_table(
    header: list[str],
    rows: list[list[Any]],
    widths: list[float],
    right_columns: tuple[int, ...] = (),
    total_rows: int = 0,
    width: float = CONTENT_WIDTH,
) -> Table:
    """A report table; `widths` are relative and scaled to fill `width`."""

    def cell(value: Any, column: int, bold: bool = False) -> Any:  # noqa: ANN401
        if not isinstance(value, str):
            return value
        style = "cell_right" if column in right_columns else "cell"
        return p(f"<b>{value}</b>" if bold else value, style)

    body = [[cell(h, i, bold=True) for i, h in enumerate(header)]]
    for index, row in enumerate(rows):
        is_total = index >= len(rows) - total_rows
        body.append([cell(v, i, bold=is_total) for i, v in enumerate(row)])
    scale = width / sum(widths)
    table = Table(body, colWidths=[w * scale for w in widths], repeatRows=1, hAlign="LEFT")
    commands: list[tuple[Any, ...]] = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, TEXT_SECONDARY),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]
    if total_rows:
        commands.append(("BACKGROUND", (0, -total_rows), (-1, -1), SURFACE))
    table.setStyle(TableStyle(commands))
    return table


def swatch(color: colors.Color, size: float = 7) -> Drawing:
    drawing = Drawing(size, size)
    drawing.add(Rect(0, 0, size, size, fillColor=color, strokeColor=None, rx=1.5, ry=1.5))
    return drawing


def legend(items: list[tuple[str, colors.Color]], label_width: float = 70) -> Table:
    cells: list[Any] = []
    for label, color in items:
        cells += [swatch(color), p(label, "small")]
    widths = [10, label_width] * len(items)
    table = Table([cells], colWidths=widths, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    return table


def change_note(current: Decimal, previous: Decimal, previous_label: str) -> str:
    if previous == 0:
        return f"Sem valor em {previous_label}"
    return f"{percent((current - previous) / previous, signed=True)} vs. {previous_label}"


# --- Sections ---


def kpis(report: MonthlyReport) -> Table:
    cur = report.currency
    prev = report.previous
    prev_label = MONTHS[prev.month - 1].lower()
    balance = report.income - report.expense
    prev_balance = prev.income - prev.expense
    savings = (
        percent(balance / report.income) if report.income > 0 else "—"
    )  # share of income left over

    def card(label: str, value: str, note: str, color: colors.Color = TEXT) -> list[Any]:
        value_style = ParagraphStyle("v", STYLES["kpi_value"], textColor=color)
        return [p(label, "kpi_label"), Paragraph(value, value_style), p(note, "kpi_note")]

    cards = [
        card(
            "Receitas",
            money(report.income, cur),
            change_note(report.income, prev.income, prev_label),
            POSITIVE,
        ),
        card(
            "Despesas",
            money(report.expense, cur),
            change_note(report.expense, prev.expense, prev_label),
            NEGATIVE,
        ),
        card(
            "Saldo do mês",
            money(balance, cur),
            f"{money(prev_balance, cur)} em {prev_label}",
            NEGATIVE if balance < 0 else TEXT,
        ),
        card("Taxa de economia", savings, "Parte da receita que sobrou"),
    ]
    table = Table([cards], colWidths=[CONTENT_WIDTH / 4] * 4)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), SURFACE),
                ("LINEAFTER", (0, 0), (-2, -1), 3, colors.white),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return table


def budget_status(item: BudgetItemRead) -> tuple[str, colors.Color]:
    if item.planned > 0:
        ratio = item.spent / item.planned
    else:
        ratio = Decimal("Infinity") if item.spent > 0 else Decimal("0")
    if ratio > 1:
        return "Limite excedido", CRITICAL
    if ratio >= NEAR_LIMIT:
        return "Perto do limite", WARNING
    return "Dentro do planejado", ACCENT


def highlights(report: MonthlyReport) -> list[str]:
    cur = report.currency
    notes: list[str] = []
    balance = report.income - report.expense
    if report.income or report.expense:
        verb = "sobraram" if balance >= 0 else "faltaram"
        notes.append(f"No mês, {verb} <b>{money(abs(balance), cur)}</b> entre receitas e despesas.")
    if report.previous.expense > 0 and report.expense > 0:
        change = (report.expense - report.previous.expense) / report.previous.expense
        direction = "a mais" if change > 0 else "a menos"
        notes.append(
            f"As despesas foram <b>{percent(abs(change))} {direction}</b> que em "
            f"{MONTHS[report.previous.month - 1].lower()}."
        )
    if report.spending and report.expense > 0:
        top = report.spending[0]
        notes.append(
            f"Maior categoria de gasto: <b>{safe(top.name)}</b>, com "
            f"{money(top.total, cur)} ({percent(top.total / report.expense)} das despesas)."
        )
    if report.budget and report.budget.items:
        over = [i for i in report.budget.items if budget_status(i)[0] == "Limite excedido"]
        total = len(report.budget.items)
        notes.append(
            f"Orçamento: <b>{total - len(over)} de {total}</b> categorias dentro do limite"
            + (f"; excedidas: {safe(', '.join(i.name for i in over))}." if over else ".")
        )
    return notes


def history_chart(report: MonthlyReport) -> Drawing:
    cur = report.currency
    width, height = CONTENT_WIDTH, 150
    drawing = Drawing(width, height)
    chart = VerticalBarChart()
    chart.x, chart.y = 58, 20
    chart.width, chart.height = width - 68, height - 30
    chart.data = [
        [float(m.income) for m in report.history],
        [float(m.expense) for m in report.history],
    ]
    chart.categoryAxis.categoryNames = [short_month(m) for m in report.history]
    chart.categoryAxis.labels.fontName = "Helvetica"
    chart.categoryAxis.labels.fontSize = 8
    chart.categoryAxis.labels.fillColor = TEXT_SECONDARY
    chart.categoryAxis.strokeColor = BORDER
    chart.valueAxis.valueMin = 0
    chart.valueAxis.labels.fontName = "Helvetica"
    chart.valueAxis.labels.fontSize = 7.5
    chart.valueAxis.labels.fillColor = TEXT_MUTED
    chart.valueAxis.labelTextFormat = lambda v: money(v, cur, cents=False)
    chart.valueAxis.strokeColor = None
    chart.valueAxis.visibleGrid = True
    chart.valueAxis.gridStrokeColor = BORDER
    chart.valueAxis.gridStrokeWidth = 0.5
    chart.bars[0].fillColor = POSITIVE
    chart.bars[1].fillColor = NEGATIVE
    chart.bars.strokeColor = None
    chart.groupSpacing = 10
    chart.barSpacing = 1
    drawing.add(chart)
    return drawing


def grouped_categories(items: list[CategorySpending]) -> list[CategorySpending]:
    """At most MAX_DONUT_SLICES slices; the smallest are merged into "Outras"."""
    if len(items) <= MAX_DONUT_SLICES:
        return items
    head, tail = items[: MAX_DONUT_SLICES - 1], items[MAX_DONUT_SLICES - 1 :]
    rest = sum((i.total for i in tail), Decimal("0"))
    return [
        *head,
        CategorySpending(category_id=None, name="Outras", color="#94a3b8", icon=None, total=rest),
    ]


def category_donut(items: list[CategorySpending], total: Decimal, currency: Currency) -> Drawing:
    size = 150
    drawing = Drawing(size, size)
    donut = Doughnut()
    donut.x, donut.y = 5, 5
    donut.width = donut.height = size - 10
    donut.data = [float(i.total) for i in items]
    donut.labels = None
    donut.innerRadiusFraction = 0.6
    donut.slices.strokeColor = colors.white
    donut.slices.strokeWidth = 1.5
    for index, item in enumerate(items):
        donut.slices[index].fillColor = colors.HexColor(item.color)
    drawing.add(donut)
    center = size / 2
    drawing.add(
        String(
            center,
            center + 3,
            "Total",
            fontName="Helvetica",
            fontSize=8,
            fillColor=TEXT_MUTED,
            textAnchor="middle",
        )
    )
    drawing.add(
        String(
            center,
            center - 9,
            money(total, currency),
            fontName="Helvetica-Bold",
            fontSize=9.5,
            fillColor=TEXT,
            textAnchor="middle",
        )
    )
    return drawing


def category_breakdown(
    items: list[CategorySpending], total: Decimal, currency: Currency
) -> list[Any]:
    rows = [
        [
            swatch(colors.HexColor(i.color)),
            safe(i.name),
            money(i.total, currency),
            percent(i.total / total) if total else "—",
        ]
        for i in items
    ]
    table = data_table(
        ["", "Categoria", "Valor", "%"], rows, [14, 170, 90, 45], (2, 3), width=CONTENT_WIDTH - 165
    )
    donut = category_donut(grouped_categories(items), total, currency)
    layout = Table([[donut, table]], colWidths=[165, CONTENT_WIDTH - 165])
    layout.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return [layout]


def budget_chart(items: list[BudgetItemRead]) -> Drawing:
    ratios = [
        float(i.spent / i.planned) if i.planned > 0 else (1.25 if i.spent > 0 else 0.0)
        for i in items
    ]
    domain_max = max(1.0, *ratios) * 1.15
    row_height = 18
    label_width = 120
    width, height = CONTENT_WIDTH, len(items) * row_height + 28
    drawing = Drawing(width, height)
    chart = HorizontalBarChart()
    chart.x, chart.y = label_width, 16
    chart.width, chart.height = width - label_width - 50, height - 26
    # The chart draws the first category at the bottom; reverse to read top-down.
    chart.data = [[min(r, domain_max) for r in reversed(ratios)]]
    chart.categoryAxis.categoryNames = [i.name[:24] for i in reversed(items)]
    chart.categoryAxis.labels.fontName = "Helvetica"
    chart.categoryAxis.labels.fontSize = 8
    chart.categoryAxis.labels.fillColor = TEXT_SECONDARY
    chart.categoryAxis.strokeColor = None
    chart.valueAxis.valueMin = 0
    chart.valueAxis.valueMax = domain_max
    chart.valueAxis.valueSteps = [v for v in (0, 0.25, 0.5, 0.75, 1.0) if v <= domain_max]
    chart.valueAxis.labelTextFormat = lambda v: percent(v)
    chart.valueAxis.labels.fontName = "Helvetica"
    chart.valueAxis.labels.fontSize = 7.5
    chart.valueAxis.labels.fillColor = TEXT_MUTED
    chart.valueAxis.strokeColor = BORDER
    chart.bars.strokeColor = None
    chart.barWidth = 9
    for index, item in enumerate(reversed(items)):
        chart.bars[(0, index)].fillColor = budget_status(item)[1]
    chart.barLabelFormat = lambda v: percent(v)
    chart.barLabels.fontName = "Helvetica"
    chart.barLabels.fontSize = 7.5
    chart.barLabels.fillColor = TEXT_SECONDARY
    chart.barLabels.boxAnchor = "w"
    chart.barLabels.dx = 4
    drawing.add(chart)
    # Dashed line at 100%: the limit.
    limit_x = chart.x + chart.width / domain_max
    drawing.add(
        Line(
            limit_x,
            chart.y,
            limit_x,
            chart.y + chart.height + 4,
            strokeColor=TEXT_SECONDARY,
            strokeWidth=0.8,
            strokeDashArray=[3, 2],
        )
    )
    drawing.add(
        String(
            limit_x,
            chart.y + chart.height + 6,
            "Limite",
            fontName="Helvetica",
            fontSize=7,
            fillColor=TEXT_MUTED,
            textAnchor="middle",
        )
    )
    return drawing


def budget_section(report: MonthlyReport) -> list[Any]:
    budget = report.budget
    cur = report.currency
    if budget is None:
        return [p("Não há orçamento cadastrado para este mês nesta moeda.", "muted")]
    if not budget.items:
        return [p("O orçamento deste mês ainda não tem categorias.", "muted")]
    summary = p(
        f"<b>{money(budget.spent, cur)}</b> gastos de {money(budget.planned, cur)} planejados "
        f"({percent(budget.spent / budget.planned) if budget.planned else '—'}). "
        f"Disponível: <b>{money(budget.available, cur)}</b>."
    )
    rows = []
    for item in budget.items:
        label, color = budget_status(item)
        rows.append(
            [
                safe(item.name),
                money(item.planned, cur),
                money(item.spent, cur),
                money(item.available, cur),
                Table(
                    [[swatch(color), p(label, "cell")]],
                    colWidths=[10, 95],
                    style=[
                        ("LEFTPADDING", (0, 0), (-1, -1), 0),
                        ("TOPPADDING", (0, 0), (-1, -1), 0),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                    ],
                ),
            ]
        )
    rows.append(
        [
            "Total",
            money(budget.planned, cur),
            money(budget.spent, cur),
            money(budget.available, cur),
            "",
        ]
    )
    table = data_table(
        ["Categoria", "Planejado", "Gasto", "Disponível", "Situação"],
        rows,
        [150, 80, 80, 80, 125],
        (1, 2, 3),
        total_rows=1,
    )
    chart_legend = legend(
        [
            ("Dentro do planejado", ACCENT),
            ("Perto do limite (80%+)", WARNING),
            ("Limite excedido", CRITICAL),
        ],
        label_width=105,
    )
    return [summary, Spacer(1, 6), budget_chart(budget.items), chart_legend, Spacer(1, 8), table]


def accounts_section(report: MonthlyReport) -> list[Any]:
    if not report.accounts:
        return [p("Nenhuma conta cadastrada.", "muted")]
    rows = [[safe(a.name), a.currency.value, money(a.balance, a.currency)] for a in report.accounts]
    for total in report.balances_by_currency:
        rows.append([f"Total em {total.currency.value}", "", money(total.total, total.currency)])
    table = data_table(
        ["Conta", "Moeda", "Saldo"],
        rows,
        [300, 70, 145],
        (2,),
        total_rows=len(report.balances_by_currency),
    )
    note = p(
        f"Saldos de todas as contas em {day(report.generated_at)} às "
        f"{report.generated_at:%H:%M}, incluindo todos os lançamentos e movimentações. "
        "Valores de moedas diferentes não são somados.",
        "small",
    )
    return [table, Spacer(1, 4), note]


def top_expenses(report: MonthlyReport) -> list[Any]:
    expenses = sorted(
        (t for t in report.transactions if t.type == TransactionType.EXPENSE),
        key=lambda t: t.amount,
        reverse=True,
    )[:5]
    if not expenses:
        return []
    rows = [
        [day(t.date), safe(t.description), safe(t.category), money(t.amount, report.currency)]
        for t in expenses
    ]
    return section(
        "Maiores despesas",
        data_table(["Data", "Descrição", "Categoria", "Valor"], rows, [60, 235, 120, 100], (3,)),
    )


def movements_section(report: MonthlyReport) -> list[Any]:
    if not report.movements:
        return []
    rows = []
    for m in report.movements:
        created = m.created_at if m.created_at.tzinfo else m.created_at.replace(tzinfo=UTC)
        created = created.astimezone(report.generated_at.tzinfo)
        rows.append(
            [
                day(created),
                MOVEMENT_LABELS[m.kind],
                safe(m.from_account_name or "—"),
                safe(m.to_account_name or "—"),
                money(m.amount, m.currency),
                safe(m.reason),
            ]
        )
    return section(
        "Movimentações no mês",
        p(
            "Transferências, adições e retiradas alteram saldos, mas não entram em receitas "
            "e despesas.",
            "small",
        ),
        Spacer(1, 4),
        data_table(
            ["Data", "Tipo", "De", "Para", "Valor", "Justificativa"],
            rows,
            [55, 70, 80, 80, 75, 155],
            (4,),
        ),
    )


def transactions_section(report: MonthlyReport) -> list[Any]:
    if not report.transactions:
        return section("Lançamentos do mês", p("Nenhum lançamento neste mês.", "muted"))
    rows = []
    for t in report.transactions:
        sign = "+ " if t.type == TransactionType.INCOME else "- "
        color = "#1b7f3b" if t.type == TransactionType.INCOME else "#c62828"
        rows.append(
            [
                day(t.date),
                safe(t.description),
                safe(t.category),
                safe(t.account),
                safe(t.budget_item or "—"),
                f'<font color="{color}">{sign}{money(t.amount, report.currency)}</font>',
            ]
        )
    return section(
        "Lançamentos do mês",
        data_table(
            ["Data", "Descrição", "Categoria", "Conta", "Orçamento", "Valor"],
            rows,
            [62, 130, 88, 75, 72, 88],
            (5,),
        ),
    )


# --- Document ---


def _page_canvas(title: str) -> type[Canvas]:
    class NumberedCanvas(Canvas):
        """Defers drawing the footer until the page count is known ("página X de Y")."""

        def __init__(self, *args: Any, **kwargs: Any) -> None:  # noqa: ANN401
            super().__init__(*args, **kwargs)
            self._pages: list[dict[str, Any]] = []

        def showPage(self) -> None:  # noqa: N802 - reportlab API
            self._pages.append(dict(self.__dict__))
            self._startPage()

        def save(self) -> None:
            total = len(self._pages)
            for state in self._pages:
                self.__dict__.update(state)
                self.setFont("Helvetica", 7.5)
                self.setFillColor(TEXT_MUTED)
                self.drawString(MARGIN, 10 * mm, f"SelfMoney · {title}")
                self.drawRightString(
                    PAGE_WIDTH - MARGIN, 10 * mm, f"Página {self._pageNumber} de {total}"
                )
                super().showPage()
            super().save()

    return NumberedCanvas


def render_monthly_report(report: MonthlyReport, compress: bool = True) -> bytes:
    cur = report.currency
    title = f"Relatório mensal · {month_label(report.year, report.month)}"
    generated = f"{day(report.generated_at)} às {report.generated_at:%H:%M}"

    story: list[Any] = [
        p(f"Relatório mensal — {month_label(report.year, report.month)}", "title"),
        Spacer(1, 2),
        p(f"Valores em {cur.value} · Gerado em {generated}", "subtitle"),
        Spacer(1, 12),
        kpis(report),
    ]

    notes = highlights(report)
    if notes:
        story += section("Destaques", *[p(f"•&nbsp;&nbsp;{n}") for n in notes])

    history_title = f"Receitas vs despesas — últimos {len(report.history)} meses"
    if any(m.income or m.expense for m in report.history):
        story += section(
            history_title,
            history_chart(report),
            legend([("Receitas", POSITIVE), ("Despesas", NEGATIVE)]),
        )
    else:
        story += section(history_title, p("Nenhum lançamento nesse período.", "muted"))

    if report.spending:
        story += section(
            "Despesas por categoria",
            *category_breakdown(report.spending, report.expense, cur),
        )
    else:
        story += section("Despesas por categoria", p("Nenhuma despesa neste mês.", "muted"))

    story += section("Orçamento do mês", *budget_section(report))

    if report.income_by_category:
        rows = [
            [
                swatch(colors.HexColor(i.color)),
                safe(i.name),
                money(i.total, cur),
                percent(i.total / report.income) if report.income else "—",
            ]
            for i in report.income_by_category
        ]
        story += section(
            "Receitas por categoria",
            data_table(["", "Categoria", "Valor", "%"], rows, [14, 300, 120, 81], (2, 3)),
        )

    story += section(f"Saldos das contas em {generated}", KeepTogether(accounts_section(report)))
    story += top_expenses(report)
    story += movements_section(report)
    story += transactions_section(report)

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN + 4 * mm,
        title=title,
        author="SelfMoney",
        pageCompression=1 if compress else 0,
        invariant=1,
    )
    doc.build(story, canvasmaker=_page_canvas(title))
    return buffer.getvalue()

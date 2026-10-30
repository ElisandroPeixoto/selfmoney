# SelfMoney — guia do projeto

Sistema de gestão financeira pessoal (uso individual, protegido por uma única senha). Monorepo com `backend/` (API REST)
e `frontend/` (SPA). O `README.md` traz as instruções de instalação para pessoas; este arquivo traz o
contexto e as regras para quem for alterar o código.

## Stack

- **Backend:** Python 3.11+ (dev usa 3.13), FastAPI, SQLAlchemy 2 (estilo `Mapped`), Pydantic v2,
  pydantic-settings, Alembic. SQLite em dev; PostgreSQL no **Supabase** em produção (driver `psycopg`).
- **Frontend:** React 18 + TypeScript (strict) + Vite 6, React Router 6, Recharts 2, Vitest +
  Testing Library. Fonte serifada Source Serif 4 via `@fontsource-variable/source-serif-4`.
- **Contrato:** REST com OpenAPI. Os tipos TS são gerados do schema (`frontend/src/api/schema.d.ts`).
- Ambiente de desenvolvimento do dono: **Windows**, Git Bash/PowerShell. Repositório:
  `github.com/ElisandroPeixoto/selfmoney`, branch `main`.

## Comandos

Backend (em `backend/`, com o venv `.venv`):

```bash
.venv/Scripts/python -m pytest            # testes
.venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .
.venv/Scripts/alembic upgrade head        # aplica migrações
.venv/Scripts/alembic revision --autogenerate -m "descricao" --rev-id 000N
.venv/Scripts/python -m app.seed          # dados de exemplo (só se o banco estiver vazio)
.venv/Scripts/python -m uvicorn app.main:app --reload   # API em :8000, Swagger em /docs
```

Frontend (em `frontend/`):

```bash
npm run dev        # :5173, faz proxy de /api para :8000
npm test           # vitest run
npm run lint       # eslint
npm run typecheck  # tsc -b
npm run build
npm run gen:api    # regenera src/api/schema.d.ts (backend precisa estar rodando)
```

Sem backend rodando, o schema pode ser gerado assim (a partir de `backend/`):

```bash
.venv/Scripts/python -c "import json; from app.main import app; print(json.dumps(app.openapi()))" > ../frontend/openapi.json
cd ../frontend && npx openapi-typescript openapi.json -o src/api/schema.d.ts && rm openapi.json
```

`.claude/launch.json` define os servidores `backend` (:8000) e `frontend` (:5173). O dono costuma
deixar os próprios servidores rodando nessas portas; não os derrube.

## Estrutura

```
backend/app/
  main.py          create_app(), CORS, registro dos routers sob /api
  config.py        Settings (.env em backend/); normaliza DATABASE_URL (ver "Banco")
  database.py      engine, SessionLocal, get_db, Base
  models.py        Account, Category, Transaction, Budget, BudgetItem, BudgetTemplate(Item), AccountMovement,
                   CreditCard, CardPurchase
  schemas.py       modelos Pydantic de entrada/saída (o contrato da API)
  services.py      regras de cálculo: saldos, dashboard, totais mensais, orçamentos, monthly_report,
                   parcelas/faturas/exportação de cartão
  report_pdf.py    desenho do relatório mensal em PDF (reportlab); só layout, dados vêm de services
  routers/         accounts, categories, transactions, dashboard, reports, budgets, movements, cards,
                   auth (status/login; `require_auth` protege todos os outros routers em main.py)
  auth.py          tokens de sessão (HMAC, expiram; chave = SECRET_KEY + APP_PASSWORD)
  seed.py          dados de exemplo
backend/alembic/versions/   0001…0007 (numeração sequencial manual via --rev-id)
backend/tests/              conftest (SQLite em memória + override de get_db), um arquivo por área

frontend/src/
  api/client.ts    fetch tipado; uma função por endpoint; tipos derivados de schema.d.ts
  api/schema.d.ts  GERADO — não editar à mão
  pages/           Dashboard, Transactions (Lançamentos), Budgets (Orçamentos), Movements, Accounts,
                   Categories, Reports (Relatórios), CreditCards (Cartão de Crédito)
  components/      Sidebar, ThemeToggle, AccountsCard, SpendingChart, IncomeExpenseChart, BudgetChart, BudgetDetail,
                   BudgetProgress, TransactionForm, MovementForm, MovementEditor, CardForm, CardPurchaseForm, CardBills, MoneyInput, IconPicker, BankLogo, CategoryLabel, icons
  lib/format.ts    formatação pt-BR: moeda, %, mês, data, datas ISO
  lib/budgets.ts   budgetFor: orçamento de um mês/moeda (formulário e lista de Lançamentos)
  lib/download.ts  saveFile: entrega um Blob como download
  lib/cards.ts     meses (shiftMonth, <input type="month">) e divisão das parcelas para a prévia
  lib/options.ts   bancos, moedas, paleta de categorias, ícones de categoria, rótulos de movimentação
  theme/           ThemeProvider + useTheme (claro/escuro, salvo em localStorage)
  auth/            AuthGate (login ou app), useAuth (authRequired, logout), session.ts (token no
                   localStorage + evento de 401). main.tsx consulta /api/auth/status antes de renderizar
  assets/banks/    logos SVG simplificados (nubank, banco_do_brasil, itau)
  assets/brand/    logo-light.png, logo-dark.png, favicon.png
  test/            setup.ts (jest-dom, ResizeObserver stub) e utils.tsx (mockApi, renderApp)
  styles.css       todo o CSS, com tokens em :root e :root[data-theme="dark"]
```

Rotas do frontend: `/` Dashboard, `/lancamentos`, `/orcamentos` e `/orcamentos/:budgetId`,
`/movimentacoes`, `/contas`, `/categorias`, `/relatorios`, `/cartoes` (`?cartao=id`).

## Domínio e regras de negócio

- **Dinheiro:** colunas `Numeric(14, 2)` e `Decimal` no Python. A API **serializa valores como string
  decimal** (`"1234.50"`); o frontend converte com `Number()` só para exibir/calcular.
- **Saldo da conta** = `initial_balance + receitas − despesas + entradas − saídas` (movimentações).
  Calculado em `services.account_balances`; nunca armazenado.
- **Moedas** (`BRL`, `USD`, `EUR`): valores de moedas diferentes **nunca são somados**. Dashboard mostra
  um total por moeda; gráficos e listas filtram por uma moeda. Mudar a moeda de uma conta não converte
  valores. Transferências só entre contas da mesma moeda.
- **Bancos** suportados: `nubank`, `banco_do_brasil`, `itau` (ou nenhum). Enums de banco, moeda e tipo
  de movimentação são gravados como **VARCHAR** (`native_enum=False`) para não exigir migração de tipo.
- **Transações** (`income`/`expense`) pertencem a um mês (têm `date`). Categoria é opcional
  ("Sem categoria"). Excluir conta apaga as transações dela; excluir categoria só desvincula.
- **Editar transação** (`PATCH /api/transactions/{id}`): parcial; o resultado é revalidado como uma
  criação. Se a mudança de tipo/data/conta invalida a categoria ou o vínculo de orçamento **não enviados**
  na requisição, eles são limpos; se foram enviados e são inválidos, 422. No frontend, `TransactionForm`
  serve para criar e editar (prop `transaction`); a página Lançamentos abre a edição pelo ícone de lápis.
- **Categorias** têm `kind` (`expense` ou `income`, mesmo enum de `TransactionType`). Uma transação só
  aceita categoria do mesmo tipo (422). Mudar o `kind` de uma categoria com lançamentos do outro tipo dá
  409. Nomes são únicos entre todas as categorias (não por tipo). A tela de Categorias tem abas
  Despesas/Receitas (`?tipo=receitas`); a cor de uma categoria existente salva após 400 ms sem mudanças.
- **Orçamentos:** no máximo **um por mês** (`year`, `month`), com moeda. Têm itens próprios
  (`BudgetItem`: nome + `planned`), independentes das categorias de gasto. Uma despesa conta no
  orçamento via `transactions.budget_item_id`, e só pode ser vinculada se for **despesa, do mesmo mês e
  da mesma moeda** do orçamento (`services.check_budget_link`). Excluir orçamento/item só desvincula.
  Estruturas podem ser salvas como **modelo** (`BudgetTemplate`) ou copiadas de outro orçamento.
  "Perto do limite" = a partir de 80% do planejado (`NEAR_LIMIT` em `BudgetChart.tsx`).
- **Movimentações** (`AccountMovement`: `transfer`, `deposit`, `withdrawal`): não pertencem a mês,
  não aparecem em Lançamentos nem em relatórios mensais, mas alteram saldos. **Justificativa obrigatória**
  (≥ 3 caracteres, aparada). Editar (`PATCH /api/movements/{id}`,
  `MovementEditor`) muda valor, justificativa e contas, revalidando como na criação (contas
  diferentes e da mesma moeda; depósito não tem origem, retirada não tem destino) e recopiando os
  nomes; tipo e `created_at` não mudam. Excluir (`DELETE`, com `window.confirm`) remove o registro e
  desfaz o efeito nos saldos. Os nomes das contas
  são copiados no registro para o log continuar legível se a conta for renomeada/excluída.
- **Cartão de crédito** (`CreditCard`, `CardPurchase`): a compra guarda o **valor total**, o número
  de parcelas (1–48) e a fatura (mês) da 1ª parcela; as demais seguem mês a mês. As parcelas **não são
  gravadas**: `services.installment_amounts` divide o total em partes iguais, com os centavos que sobram
  na 1ª (o frontend repete a conta em `lib/cards.ts` só para a prévia). A moeda do cartão é a da conta
  vinculada. Exportar cria uma despesa por parcela na conta vinculada, com a categoria da compra (se
  ainda for de despesa), datada no dia do vencimento (ou da compra) dentro do mês da fatura, e marca
  `transactions.card_purchase_id` + `card_installment` (únicos juntos): cada parcela é exportada uma
  vez; excluir a despesa a deixa pendente de novo. `auto_export` exporta todas as parcelas ao criar a
  compra e exige conta. Excluir compra/cartão mantém as despesas exportadas (só desvincula); excluir a
  conta desvincula o cartão e desliga `auto_export`. Categoria usada em compra não pode virar receita (409).
- **Datas/horas:** `created_at` das movimentações é gravado em UTC; o schema devolve com `+00:00`
  (SQLite perde o fuso). Filtros por dia usam o dia **local** do usuário: o frontend manda instantes
  com fuso (`created_from`/`created_before` no histórico) ou o deslocamento em minutos (`utc_offset`
  no relatório PDF), e o backend compara em UTC.
- **Relatório PDF** (`GET /api/reports/monthly-pdf`): um mês e uma moeda; saldos das contas são os
  atuais (todas as moedas, sem somar moedas diferentes). Fonte Helvetica padrão do PDF (WinAnsi):
  evite caracteres fora do Latin-1 como `−`, `≥`, emojis. Testes renderizam com `compress=False`
  para procurar texto no PDF. Datas `YYYY-MM-DD` são formatadas à mão no frontend para não deslocar o dia.

## Acesso (senha)

- Uma senha só, em `APP_PASSWORD`; sem ela (dev) não há login. `APP_ENV=production` exige
  `APP_PASSWORD` e `SECRET_KEY`, senão `Settings` falha e a API não inicia.
- `POST /api/auth/login` devolve um token assinado (30 dias, `SESSION_DAYS`); o frontend o envia como
  `Authorization: Bearer` em toda chamada (`api/client.ts`). Um 401 limpa o token e volta ao login.
- **Novo router protegido:** registrar em `protected` em `main.py`. Só `/api/health` e `/api/auth/*`
  ficam abertos.
- Falha de senha espera 1 s; a defesa real é uma senha longa.

## Banco de dados

- Dev: `DATABASE_URL=sqlite:///./selfmoney.db`. Caminhos SQLite relativos são ancorados em `backend/`
  (o arquivo é sempre `backend/selfmoney.db`, de qualquer diretório).
- Prod (Supabase): URLs `postgres://`/`postgresql://` viram `postgresql+psycopg://`; prepared statements
  ficam desligados (`prepare_threshold=None`) por causa do pooler. Instalar com `pip install -e ".[postgres]"`
  e usar `AUTO_CREATE_TABLES=false` + `alembic upgrade head`.
- **SQLite não aplica `ON DELETE CASCADE/SET NULL` por padrão**: todo delete que afeta filhos faz o
  `update`/`delete` dos dependentes **explicitamente** no router. Mantenha esse padrão.
- Toda mudança de modelo exige migração Alembic: gerar com autogenerate, revisar (nomear FKs/constraints —
  batch mode do SQLite exige nome; usar `sa.func.now()` em vez de texto específico do SQLite),
  rodar `ruff format alembic/versions`, testar `upgrade` → `downgrade -1` → `upgrade`.
- O banco de dev contém **dados reais do dono**. Não apague nem altere dados para testar: use uma cópia
  (`cp backend/selfmoney.db <scratch>/preview.db` + backend em outra porta com `DATABASE_URL` apontando para
  ela) e remova a cópia ao terminar.

## Convenções de código

- **Comentários em inglês**, só no essencial (o porquê, não o quê). **Textos da interface em português (pt-BR).**
- Python: type hints em tudo, ruff (`E,F,W,I,B,UP,N,SIM,ANN`, linha 100). Routers finos; regra de
  negócio em `services.py`; services não levantam `HTTPException` (usam exceções próprias, ex.
  `BudgetLinkError`, que o router converte em 422). Updates parciais com `model_dump(exclude_unset=True)`
  e rejeição explícita de `null` em campos obrigatórios. Conflito de nome → 409; referência inválida → 422.
- TypeScript: strict, ESLint (react-hooks, react-refresh — arquivos de componente só exportam componentes;
  constantes compartilhadas vão para `lib/`). Linhas até ~100 colunas. Sem biblioteca de estado ou CSS:
  `useState`/`useEffect` com `AbortController` e CSS puro em `styles.css`.
- Formatação de valores sempre por `lib/format.ts` (`formatCurrency(value, currency)`, `formatMonth`, …).
- **Campos de dinheiro usam `MoneyInput`**: símbolo da moeda na frente (desenhado por CSS), centavos
  sempre visíveis, digitação preenchendo a partir dos centavos; entrega string decimal com 2 casas.
- Ações irreversíveis pedem `window.confirm` (excluir conta/categoria/orçamento/lançamento/movimentação,
  registrar movimentação).
- Acessibilidade: controles com `aria-label` quando só têm ícone; status nunca só por cor (ícone + texto);
  gráficos com `role="img"` + `aria-label` e, quando útil, tabela `visually-hidden` (dentro de uma `div`
  com essa classe — tabela ignora altura de 1px).

## UI e design

- Tokens de cor em `styles.css` (`--bg`, `--surface`, `--border`, `--text*`, `--accent`, `--positive`,
  `--negative`, `--status-warning`, `--status-critical`), redefinidos em `:root[data-theme="dark"]`.
  O tema é aplicado antes da pintura por um script em `index.html`.
- Paleta de categorias (ordem fixa, amigável a daltonismo) em `lib/options.ts → CATEGORY_PALETTE`; novas
  categorias pegam a próxima cor não usada. Cores de status são reservadas para status.
- Sidebar: Dashboard no topo em destaque, separador, demais itens **ordenados alfabeticamente** pelo
  rótulo (`localeCompare` pt-BR) — basta adicionar ao array `NAV_ITEMS`. Recolhível (estado em
  localStorage). Logo muda com o tema.
- Dashboard (de cima para baixo, largura total): cards das contas + saldo total por moeda; gastos do mês
  por categoria (rosca + tabela, filtro de mês/ano/moeda); orçamento por categoria (barras horizontais,
  seletor de orçamento, modos % e R$).
- Logos dos bancos são versões simplificadas; para oficiais, substituir os arquivos mantendo os nomes.

## Testes

- Backend: cada teste usa SQLite em memória (`conftest.py`); `AUTO_CREATE_TABLES=false` evita tocar no
  banco de dev, e `APP_PASSWORD=""` deixa os testes sem login (o `.env` não interfere). Testes de
  acesso sobrescrevem `get_settings` (ver `test_auth.py`). Testar via `TestClient` contra a API.
- Frontend: `mockApi({"GET /api/rota": () => ({ body })})` intercepta `fetch` por método + caminho
  (requisição não mapeada lança erro — inclua `GET /api/budgets` ao renderizar o Dashboard);
  `renderApp(path, authStatus?)` monta o app com tema e router (padrão: sem senha; passe
  `{ auth_required: true, authenticated: false }` para testar o login). Recharts não desenha no jsdom (largura 0): teste o
  conteúdo pela tabela/legenda/aria, não pelo SVG. Formatação `Intl` usa espaço não separável após `R$`
  (`toHaveTextContent` normaliza; comparações de string cruas não).
- Antes de concluir qualquer mudança: `pytest` + `ruff check` + `ruff format --check` no backend;
  `npm test` + `npm run typecheck` + `npm run lint` + `npm run build` no frontend; e conferir a tela.

## Checklist para mudanças comuns

- **Novo campo/entidade no backend:** model → schema → service/router → migração Alembic → testes →
  regenerar `schema.d.ts` → ajustar `api/client.ts` e telas → README (seção de endpoints).
- **Nova página:** componente em `pages/`, rota em `App.tsx`, item em `NAV_ITEMS` (Sidebar, com ícone em
  `icons.tsx`), testes com `mockApi`.
- **Formatação:** não há Prettier no projeto; o código é formatado à mão em ~100 colunas. Se usar
  Prettier, use `--print-width 100` e só nos arquivos que você mudou.
- **Commits:** mensagens em inglês, no imperativo; não commitar `.env`, `*.db`, `.venv/`, `node_modules/`
  (já no `.gitignore`). Line endings fixados em LF (`.gitattributes`).

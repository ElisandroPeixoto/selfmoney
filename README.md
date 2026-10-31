# SelfMoney

Sistema de gestão financeira pessoal.

- **Backend:** Python 3.11+, FastAPI, SQLAlchemy 2, Alembic — SQLite em dev, PostgreSQL (Supabase) em produção
- **Frontend:** React 18 + TypeScript + Vite, Recharts
- **Comunicação:** REST documentado com OpenAPI (Swagger em `/docs`); os tipos TypeScript do cliente são gerados a partir do schema

## Funcionalidades (MVP)

- Barra lateral recolhível (só ícones), com Dashboard, Lançamentos, Orçamentos, Movimentações,
  Contas, Categorias, Relatórios e Cartão de Crédito
- Gráfico de gastos do mês por categoria (rosca + tabela com valores e %)
- Gráfico de barras de **receitas vs despesas**, mês a mês, dentro de um ano (com totais do ano)
- Saldo atual de cada conta e saldo total (um total por moeda)
- **Lançamentos:** registros de despesas e receitas por mês ou pelo ano inteiro, com totais do período
  e resumo mês a mês; adicionar despesa/receita escolhendo mês, ano, dia, categoria e conta; editar e
  excluir lançamentos; associar uma despesa a uma categoria do orçamento do mês (no formulário ou
  direto na lista)
- **Contas:** adicionar, renomear, excluir (junto com seus lançamentos), escolher a moeda (BRL, USD, EUR)
  e o banco (Nubank, Banco do Brasil, Itaú), com o logo do banco
- **Categorias:** separadas em **despesas** e **receitas**; adicionar, remover (os lançamentos ficam
  "Sem categoria"), mover entre as duas listas, e cor e ícone (emoji) editáveis. Um lançamento só aceita
  categorias do seu tipo
- **Orçamentos:** um orçamento por mês, com categorias próprias (ex.: Cartão de crédito, Assinaturas,
  Taxas) e um valor planejado para cada uma. As despesas do mês são associadas a essas categorias
  (na página do orçamento ou ao lançar a despesa), e o sistema mostra quanto foi gasto e quanto
  ainda está disponível. A estrutura pode ser salva como **modelo** e reutilizada em outros meses
  (ou copiada direto de outro orçamento)
- **Movimentações:** transferir dinheiro entre contas (da mesma moeda), adicionar ou retirar dinheiro
  de uma conta sem vincular a um mês. Toda movimentação exige uma **justificativa** e fica
  registrada num **histórico** (log) filtrável por conta, tipo e período (data inicial/final). Uma movimentação pode ser
  **editada** (valor, justificativa e contas; o tipo e a data/hora ficam) ou **excluída** (com
  confirmação, o que desfaz o efeito dela nos saldos). O
  histórico continua legível mesmo se a conta for excluída
- **Cartão de Crédito:** cartões vinculados a uma conta, compras à vista ou parceladas (até 48x,
  com categoria), faturas mês a mês (gráfico dos próximos 12 meses e detalhe de cada fatura) e
  exportação das parcelas para Lançamentos como despesas da conta vinculada, com a categoria da
  compra. A exportação é por fatura (botão) ou automática a cada compra nova; cada parcela é
  exportada uma vez só
- **Relatórios:** relatório mensal em **PDF** (por moeda) com receitas, despesas, saldo e taxa de
  economia comparados ao mês anterior, destaques, gráficos (receitas vs despesas dos últimos 6 meses,
  despesas por categoria, uso do orçamento), receitas por categoria, maiores despesas, saldo de cada
  conta no momento da geração, movimentações e lançamentos do mês
- **Acesso por senha** (opcional em desenvolvimento, obrigatório em produção): tela de login,
  sessão de 30 dias por aparelho e botão **Sair**. A senha fica na variável `APP_PASSWORD`
- Alternância entre modo claro e escuro (persistida no navegador)
- Fonte serifada (Source Serif 4, servida localmente via `@fontsource`)

## Estrutura

```
backend/
  app/
    main.py          # criação da app FastAPI, CORS e rotas
    config.py        # configurações lidas do .env
    database.py      # engine e sessão SQLAlchemy
    models.py        # Account, Category, Transaction, Budget, AccountMovement...
    schemas.py       # modelos Pydantic (contrato da API)
    services.py      # saldos, resumos, totais dos orçamentos e dados do relatório mensal
    report_pdf.py    # relatório mensal em PDF (reportlab)
    routers/         # endpoints REST
    seed.py          # dados de exemplo para desenvolvimento
  alembic/           # migrações do banco
  tests/             # pytest
frontend/
  src/
    api/             # cliente HTTP + tipos gerados do OpenAPI (schema.d.ts)
    assets/banks/    # logos dos bancos (SVG)
    components/      # Sidebar, SpendingChart, TransactionForm, IconPicker, BankLogo...
    pages/           # Dashboard, Lançamentos, Orçamentos, Movimentações, Contas, Categorias, Relatórios,
                     # Cartão de Crédito
    theme/           # contexto de tema claro/escuro
    lib/             # formatação (moeda, %, mês) e opções (bancos, moedas, paleta)
```

## Pré-requisitos

- Python 3.11 ou superior
- Node.js 20 ou superior

## Rodando o backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate   |   Linux/macOS: source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
alembic upgrade head        # cria o banco SQLite (selfmoney.db)
python -m app.seed          # opcional: dados de exemplo
uvicorn app.main:app --reload
```

API em http://localhost:8000 — documentação interativa em http://localhost:8000/docs.

### Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/health` | Health check |
| GET/POST | `/api/accounts` | Listar (com saldo atual) / criar contas |
| PATCH | `/api/accounts/{id}` | Editar nome, moeda (`BRL`/`USD`/`EUR`) e banco (`nubank`/`banco_do_brasil`/`itau`/`null`) |
| DELETE | `/api/accounts/{id}` | Excluir conta e seus lançamentos |
| GET/POST | `/api/categories?kind=` | Listar (opcionalmente só `expense` ou `income`) / criar categorias (`name`, `color`, `icon`, `kind`) |
| PATCH | `/api/categories/{id}` | Editar nome, cor, ícone ou tipo (`kind`; recusado com 409 se já houver lançamentos do outro tipo) |
| DELETE | `/api/categories/{id}` | Remover categoria (transações ficam sem categoria) |
| GET/POST | `/api/transactions?year=&month=&currency=` | Listar (filtrando por ano, mês e moeda) / criar transações (receita ou despesa) |
| PATCH | `/api/transactions/{id}` | Editar qualquer campo (descrição, valor, tipo, data, conta, categoria, item de orçamento); categoria ou vínculo de orçamento que deixem de valer pela mudança são removidos |
| DELETE | `/api/transactions/{id}` | Excluir transação |
| GET/POST | `/api/budgets` | Listar / criar orçamento do mês (`year`, `month`, `currency`; opcional `template_id` ou `source_budget_id`) |
| GET/PATCH/DELETE | `/api/budgets/{id}` | Ver (com planejado, gasto e disponível por item, receitas do mês e `extras`) / editar `saving` e `auto_extras` (cria/remove a categoria Extras calculada) / excluir orçamento |
| POST | `/api/budgets/{id}/items` | Adicionar categoria ao orçamento (`name`, `planned`) |
| PATCH/DELETE | `/api/budgets/{id}/items/{item_id}` | Editar / remover categoria do orçamento |
| GET/POST | `/api/balance-checks` | Listar / registrar um balanço financeiro (grava a data e hora atuais) |
| DELETE | `/api/balance-checks/{id}` | Excluir um registro de balanço |
| GET/POST | `/api/spending-collections` | Listar / criar coleção de gastos (`name`, `currency`), com o total somado |
| PATCH/DELETE | `/api/spending-collections/{id}` | Renomear / excluir coleção (e seus itens) |
| POST | `/api/spending-collections/{id}/items` | Adicionar item à coleção (`name`, `amount` > 0) |
| DELETE | `/api/spending-collections/{id}/items/{item_id}` | Remover item da coleção |
| POST | `/api/budgets/{id}/save-template` | Salvar a estrutura do orçamento como modelo (`name`) |
| GET | `/api/budget-templates` | Listar modelos |
| DELETE | `/api/budget-templates/{id}` | Excluir modelo |
| GET | `/api/movements?account_id=&kind=&created_from=&created_before=` | Histórico de movimentações (mais recentes primeiro); datas com fuso, `created_before` exclusivo |
| POST | `/api/movements/transfer` | Transferir entre contas (`from_account_id`, `to_account_id`, `amount`, `reason`) |
| POST | `/api/movements/deposit` | Adicionar dinheiro a uma conta (`account_id`, `amount`, `reason`) |
| POST | `/api/movements/withdrawal` | Retirar dinheiro de uma conta (`account_id`, `amount`, `reason`) |
| PATCH | `/api/movements/{id}` | Editar valor, justificativa e contas (`from_account_id`/`to_account_id`, conforme o tipo) |
| DELETE | `/api/movements/{id}` | Excluir uma movimentação (os saldos voltam a ficar como sem ela) |
| GET/POST | `/api/cards` | Listar (com o total ainda não exportado) / criar cartões (`name`, `account_id`, `currency`, `due_day`) |
| PATCH/DELETE | `/api/cards/{id}` | Editar / excluir cartão e suas compras (despesas já exportadas ficam em Lançamentos) |
| GET/POST | `/api/cards/{id}/purchases` | Listar / adicionar compra (`description`, `amount` total, `installments`, `date`, `category_id`; opcional `first_year`/`first_month`, padrão: mês seguinte à compra) |
| PATCH/DELETE | `/api/cards/{id}/purchases/{purchase_id}` | Editar (parcial; com parcelas já lançadas só descrição e categoria mudam) / excluir compra |
| POST | `/api/cards/{id}/purchases/export` | Lança como despesas todas as parcelas pendentes das compras indicadas (`purchase_ids`; 409 sem conta) |
| GET | `/api/cards/{id}/bills?year=&month=&months=` | Faturas de `months` meses seguidos a partir de `year`/`month`, com as parcelas de cada uma |
| POST | `/api/cards/{id}/bills/{year}/{month}/export` | Lança as parcelas pendentes da fatura como despesas da conta vinculada (409 sem conta) |
| GET | `/api/reports/monthly?year=&currency=` | Receitas e despesas de cada um dos 12 meses do ano |
| GET | `/api/auth/status` | Se o servidor exige senha e se o token enviado é válido |
| POST | `/api/auth/login` | Troca a senha (`password`) por um token de sessão (`token`, `expires_at`) |
| GET | `/api/reports/monthly-pdf?year=&month=&currency=&utc_offset=` | Relatório do mês em PDF (download); `utc_offset` em minutos (ex.: `-180`) |
| GET | `/api/dashboard/summary?year=&month=&currency=` | Saldos por moeda e gastos do mês por categoria na moeda escolhida (padrão: mês atual, BRL) |

Valores monetários trafegam como strings decimais (ex.: `"1234.50"`) para evitar erros de arredondamento.
O saldo de uma conta é `saldo inicial + receitas − despesas + entradas − saídas` (as movimentações).
Movimentações não aparecem nos lançamentos nem nos relatórios mensais, pois não pertencem a um mês. Valores de moedas diferentes nunca são somados:
o dashboard mostra um total por moeda e o gráfico de gastos considera só as contas da moeda selecionada.
Mudar a moeda de uma conta não converte os valores já lançados.

Uma despesa só pode ser associada a um orçamento do **mesmo mês** e da **mesma moeda** da conta.
Excluir um orçamento (ou uma categoria dele) não apaga despesas: elas apenas deixam de estar associadas.

## Rodando o frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Acesse http://localhost:5173. Em dev, o Vite redireciona `/api` para o backend em `localhost:8000`.

## Testes e qualidade

```bash
# backend
cd backend
pytest
ruff check . && ruff format --check .

# frontend
cd frontend
npm test
npm run lint
npm run typecheck
```

## Atualizando os tipos da API

Com o backend rodando, regenere os tipos TypeScript sempre que mudar os schemas:

```bash
cd frontend
npm run gen:api
```

## Logos dos bancos

Os logos em `frontend/src/assets/banks/` (`nubank.svg`, `banco_do_brasil.svg`, `itau.svg`) são versões
simplificadas nas cores de cada banco. Para usar os logos oficiais, substitua esses arquivos mantendo os mesmos nomes.

## Banco de dados

### Desenvolvimento (SQLite)

`DATABASE_URL=sqlite:///./selfmoney.db` (padrão do `.env.example`). O arquivo é ignorado pelo git.

### Produção (Supabase / PostgreSQL)

Para publicar o app (API e site no Render, banco no Supabase), siga o passo a passo em
[DEPLOY.md](DEPLOY.md). Resumo da configuração do banco:

1. No Supabase, copie a connection string em **Project Settings → Database → Connection string (URI)**.
2. Instale o driver: `pip install -e ".[postgres]"`.
3. No `.env` de produção (nunca commitado):
   ```
   APP_ENV=production
   DATABASE_URL=postgresql://postgres.<ref>:<senha>@aws-0-<regiao>.pooler.supabase.com:6543/postgres
   CORS_ORIGINS=https://seu-frontend.com
   AUTO_CREATE_TABLES=false
   APP_PASSWORD=<senha longa para entrar no app>
   SECRET_KEY=<valor aleatório longo>
   ```
   Com `APP_ENV=production`, a API não inicia sem `APP_PASSWORD` e `SECRET_KEY`.
   URLs `postgres://`/`postgresql://` são convertidas automaticamente para o driver `psycopg`, e prepared statements são desativados para funcionar com o pooler do Supabase.
4. Aplique as migrações: `alembic upgrade head`.

Para alterar o modelo de dados: edite `app/models.py` e gere uma migração com
`alembic revision --autogenerate -m "descrição"`.

No frontend de produção, defina `VITE_API_BASE_URL` com a URL pública da API (ex.: `https://api.seu-dominio.com/api`) antes do `npm run build`.

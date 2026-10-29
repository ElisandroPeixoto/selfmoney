# Deploy no Render com banco no Supabase

Passo a passo para colocar o SelfMoney no ar. São três peças:

```
navegador ──► Render Static Site (frontend/)  ── chama ──►  Render Web Service (backend/)  ──►  Supabase (PostgreSQL)
              https://selfmoney.onrender.com                https://selfmoney-api.onrender.com
```

Tempo estimado: 30–45 minutos. Tudo funciona nos planos gratuitos.

---

## 0. Antes de começar

**Acesso por senha.** Em produção o SelfMoney pede uma senha (variável `APP_PASSWORD`) antes de
mostrar qualquer dado, e a API recusa qualquer chamada sem uma sessão válida. A sessão dura 30 dias
por aparelho, e trocar a senha encerra todas as sessões abertas. Se `APP_ENV=production` estiver
sem senha, a API **nem inicia**, então não dá para publicar o app aberto por esquecimento.

**Limites dos planos gratuitos:**

- **Render Free:** a API "dorme" após 15 minutos sem acesso. O primeiro acesso depois disso
  demora cerca de 1 minuto; os seguintes ficam normais. O site estático não dorme.
- **Supabase Free:** o projeto é pausado após 7 dias sem nenhum acesso. Para reativar, abra o
  projeto no painel do Supabase e clique em **Restore**.

**Você vai precisar de:**

- Uma **senha forte e longa** para entrar no app (16+ caracteres; um gerenciador de senhas
  ajuda). É a única proteção dos seus dados na internet.

- O código atualizado no GitHub (`github.com/ElisandroPeixoto/selfmoney`, branch `main`).
- Uma conta no [Supabase](https://supabase.com) e uma no [Render](https://render.com) (dá para
  entrar nas duas com a conta do GitHub).

---

## 1. Enviar o código para o GitHub

O Render faz o deploy a partir do GitHub, então o `main` precisa estar atualizado:

```bash
git push origin main
```

---

## 2. Criar o banco no Supabase

1. No painel do Supabase, clique em **New project**.
2. Preencha:
   - **Name:** `selfmoney`
   - **Database Password:** clique em **Generate a password** e **guarde a senha**. Se criar a
     sua, use só letras e números: caracteres como `@`, `#`, `/` ou `:` quebram a URL de conexão.
   - **Region:** **East US (North Virginia)**. O Render não tem servidores na América do Sul, e o
     banco precisa ficar perto da API. Cada tela faz várias consultas, e com o banco no Brasil
     cada consulta iria e voltaria dos EUA.
3. Clique em **Create new project** e espere 1–2 minutos.
4. Clique no botão **Connect** no topo da página do projeto.
5. Em **Connection String**, escolha o modo **Session pooler** e copie a URI. Ela tem este formato:

   ```
   postgresql://postgres.<ref-do-projeto>:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres
   ```

6. Troque `[YOUR-PASSWORD]` pela senha do passo 2 (sem os colchetes). Esta é a sua
   **`DATABASE_URL`**. Trate-a como uma senha: não commite nem compartilhe.

> **Por que o "Session pooler" e não a "Direct connection"?** A conexão direta do Supabase só
> funciona por IPv6, e o Render só tem IPv4. O pooler funciona por IPv4. O "Transaction pooler"
> (porta 6543) também funciona com o SelfMoney, mas para um servidor sempre ligado o "Session"
> é o recomendado.

---

## 3. Criar as tabelas (e testar a conexão) pelo seu computador

O Render também cria as tabelas sozinho a cada deploy (passo 5). Mesmo assim, rodar uma vez
localmente confirma que a `DATABASE_URL` está certa antes de envolver o Render.

No PowerShell, dentro de `backend/`:

```powershell
.venv\Scripts\pip install -e ".[postgres]"
$env:DATABASE_URL = "postgresql://postgres.<ref>:<senha>@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
.venv\Scripts\alembic upgrade head
Remove-Item Env:DATABASE_URL
```

A última linha volta o terminal para o banco local. Sem ela, os próximos comandos nesse
terminal continuariam usando o Supabase.

Se terminar sem erro, abra **Table Editor** no Supabase: as tabelas `accounts`, `categories`,
`transactions`, `budgets` etc. já estão lá, vazias.

> **Seus dados atuais não vão junto.** O banco de produção começa vazio. O projeto ainda não
> tem uma ferramenta para copiar os dados do SQLite (`backend/selfmoney.db`) para o Supabase.
> Para levar os dados reais, será preciso criar esse script antes (e proteger o acesso, ver
> passo 0).

---

## 4. Fechar o acesso direto às tabelas no Supabase

O Supabase publica automaticamente uma API REST (a "Data API") para as tabelas do schema
`public`. O SelfMoney não usa essa API: ele conecta direto no PostgreSQL. Por segurança, tire o
acesso dos papéis públicos (`anon` e `authenticated`).

No Supabase, abra **SQL Editor**, cole e clique em **Run**:

```sql
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
```

As duas últimas linhas valem também para tabelas criadas por migrações futuras. A API do
SelfMoney usa o usuário `postgres` e não é afetada.

O **Security Advisor** do Supabase pode continuar avisando "RLS disabled" nessas tabelas. Com os
comandos acima, os papéis públicos não têm acesso a elas, então o aviso pode ser ignorado.
**Não ative o RLS nelas:** isso pode bloquear a própria API do SelfMoney.

---

## 5. Publicar a API no Render (Web Service)

1. No Render, clique em **New → Web Service**.
2. Conecte o GitHub (se pedir) e escolha o repositório **selfmoney**.
3. Preencha:

   | Campo | Valor |
   | --- | --- |
   | **Name** | `selfmoney-api` (vira o endereço `https://selfmoney-api.onrender.com`) |
   | **Region** | **Virginia (US East)**, a mesma região do banco |
   | **Branch** | `main` |
   | **Root Directory** | `backend` |
   | **Runtime / Language** | `Python 3` |
   | **Build Command** | `pip install ".[postgres]"` |
   | **Start Command** | `alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
   | **Instance Type** | `Free` |

   O Start Command aplica as migrações pendentes antes de subir a API, a cada deploy. Rodar de
   novo sem migrações novas não faz nada.

4. Em **Environment Variables**, adicione:

   | Key | Value |
   | --- | --- |
   | `PYTHON_VERSION` | `3.13.0` |
   | `APP_ENV` | `production` |
   | `DATABASE_URL` | a URI do passo 2 |
   | `AUTO_CREATE_TABLES` | `false` |
   | `CORS_ORIGINS` | `https://selfmoney.onrender.com` (ajuste no passo 7 se o nome for outro) |
   | `APP_PASSWORD` | a senha para entrar no app |
   | `SECRET_KEY` | clique em **Generate** para o Render criar um valor aleatório |

   `SECRET_KEY` assina as sessões. Você não precisa saber o valor, só não pode deixá-lo vazio.
   Trocar `APP_PASSWORD` (ou `SECRET_KEY`) desconecta todos os aparelhos.

5. Em **Advanced → Health Check Path**, coloque `/api/health`.
6. Clique em **Deploy Web Service** e acompanhe os logs. No final deve aparecer
   `Application startup complete` e o status **Live**.
7. Teste no navegador:
   - `https://selfmoney-api.onrender.com/api/health` deve mostrar `{"status":"ok"}`
   - `https://selfmoney-api.onrender.com/docs` deve abrir o Swagger

Se o Render acrescentar um sufixo ao nome (por exemplo `selfmoney-api-x1y2.onrender.com`,
quando o nome já existe), use o endereço que ele mostrar no topo da página do serviço.

---

## 6. Publicar o frontend no Render (Static Site)

1. Clique em **New → Static Site** e escolha o mesmo repositório.
2. Preencha:

   | Campo | Valor |
   | --- | --- |
   | **Name** | `selfmoney` (vira `https://selfmoney.onrender.com`) |
   | **Branch** | `main` |
   | **Root Directory** | `frontend` |
   | **Build Command** | `npm ci && npm run build` |
   | **Publish Directory** | `dist` |

3. Em **Environment Variables**, adicione:

   | Key | Value |
   | --- | --- |
   | `NODE_VERSION` | `22` |
   | `VITE_API_BASE_URL` | `https://selfmoney-api.onrender.com/api` (o endereço da API, terminando em `/api`) |

   O endereço da API entra no código durante o build. Se ele mudar, faça um novo deploy do
   site (**Manual Deploy → Deploy latest commit**).

4. Clique em **Deploy Static Site**.
5. Depois do deploy, abra a aba **Redirects/Rewrites** do site e adicione esta regra:

   | Source | Destination | Action |
   | --- | --- | --- |
   | `/*` | `/index.html` | `Rewrite` |

   Sem ela, recarregar a página em `/lancamentos` (ou qualquer rota além de `/`) dá erro 404.

---

## 7. Liberar o site na API (CORS)

A API só aceita chamadas dos endereços listados em `CORS_ORIGINS`.

1. Copie o endereço do site, no topo da página do Static Site (ex.: `https://selfmoney.onrender.com`).
2. No Web Service **selfmoney-api**, vá em **Environment** e confira se `CORS_ORIGINS` é
   **exatamente** esse endereço: com `https://` e **sem** `/` no final. Para mais de um endereço
   (por exemplo, um domínio próprio depois), separe por vírgula.
3. Salve. O Render reinicia a API sozinho.

---

## 8. Conferir

Abra o site e verifique:

- [ ] Aparece a tela de senha. Uma senha errada mostra "Senha incorreta."; a certa abre o
      Dashboard (o primeiro acesso pode levar ~1 minuto se a API estava dormindo).
- [ ] `https://selfmoney-api.onrender.com/api/accounts` aberto direto no navegador responde
      `{"detail":"Not authenticated"}`: sem sessão, a API não entrega dados.
- [ ] O Dashboard carrega sem a mensagem "Não foi possível carregar os dados".
- [ ] Criar uma conta em **Contas** funciona, e ela aparece no Dashboard.
- [ ] Recarregar a página (F5) em **Lançamentos** continua na mesma página.
- [ ] Em **Relatórios**, **Gerar PDF** baixa o arquivo `selfmoney-relatorio-AAAA-MM-BRL.pdf`.
- [ ] No Supabase, **Table Editor → accounts** mostra a conta criada.
- [ ] O botão **Sair** (no rodapé da barra lateral) volta para a tela de senha.

---

## Atualizações futuras

- Cada `git push origin main` faz o deploy automático da API e do site.
- Mudanças no banco (novas migrações Alembic) são aplicadas pelo Start Command no próximo deploy.
- Para ver erros da API: **selfmoney-api → Logs** no Render.

---

## Problemas comuns

| Sintoma | Causa provável | Solução |
| --- | --- | --- |
| API não inicia; log com `APP_PASSWORD and SECRET_KEY must be set` | Faltou uma das duas variáveis | Passo 5, item 4 |
| Senha certa não entra / "Sua sessão terminou" toda hora | `SECRET_KEY` ou `APP_PASSWORD` mudou, ou relógio do aparelho muito errado | Entre de novo; se repetir, confira se as variáveis não estão sendo trocadas |
| Deploy da API falha com `Network is unreachable` ou erro de IPv6 | URL da **Direct connection** | Use a URI do **Session pooler** (passo 2) |
| `password authentication failed` | Senha errada, com caracteres especiais, ou usuário sem o `.<ref>` | Confira a URI; o usuário é `postgres.<ref-do-projeto>`. Se preciso, redefina a senha em **Project Settings → Database** usando só letras e números |
| Site abre, mas os dados não carregam; o console do navegador (F12) mostra erro de **CORS** | `CORS_ORIGINS` diferente do endereço do site | Passo 7: mesmo endereço, com `https://` e sem `/` no final |
| Os dados não carregam e o console mostra chamadas para `/api/...` no próprio site | `VITE_API_BASE_URL` ausente ou errado no build | Corrija no Static Site e faça **Manual Deploy** |
| 404 ao recarregar uma página | Falta a regra de rewrite | Passo 6, item 5 |
| Primeiro acesso muito lento | API dormindo (plano Free) | Normal; os acessos seguintes ficam rápidos |
| Erro de conexão depois de dias sem uso | Projeto pausado no Supabase | Abra o projeto no Supabase e clique em **Restore** |
| Build do site falha em `tsc` ou `vite` | Versão do Node | Confira `NODE_VERSION=22` |

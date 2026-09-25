# 🚀 Kommo CRM + WABA: Triagem Inteligente com IA & Transcrição de Áudio

Backend próprio em Node.js para processar respostas fora do script e **mensagens de áudio** de leads no WhatsApp (WABA), analisá-las com Inteligência Artificial (OpenAI Whisper + GPT-4o-mini) e **mover o lead automaticamente de etapa no funil do Kommo**.

---

## 🛠️ Tecnologias Utilizadas
* **Node.js + Express**: Servidor rápido e assíncrono.
* **OpenAI Whisper (`whisper-1`)**: Transcrição nativa de áudios em formato Opus/OGG do WhatsApp.
* **OpenAI GPT-4o-mini**: Classificação rápida e econômica de sentimento/intenção comercial em formato JSON estruturado.
* **Kommo REST API v4**: Atualização de etapas (`PATCH /api/v4/leads/{id}`) e inserção de notas de auditoria (`POST /api/v4/leads/{id}/notes`).
* **Debounce Buffer Manager**: Agrupador inteligente que espera 25 segundos para consolidar múltiplos áudios/textos consecutivos do mesmo lead antes de acionar a IA.

---

## 📁 Estrutura do Projeto

```text
├── scripts/
│   └── list-stages.js          # Script CLI que lista todos os seus Funis e IDs de Etapas
├── src/
│   ├── controllers/
│   │   └── webhook.controller.js # Recebe o Webhook, devolve 200 OK e envia para o buffer
│   ├── routes/
│   │   └── webhook.routes.js     # Rotas HTTP (/webhook/kommo e /health)
│   ├── services/
│   │   ├── ai.service.js         # Download do áudio, transcrição Whisper e classificação LLM
│   │   ├── buffer.service.js     # Debounce inteligente (25s) e orquestração do funil
│   │   └── kommo.service.js      # Integração com a API v4 do Kommo CRM
│   ├── app.js                    # Configurações do Express
│   └── server.js                 # Ponto de entrada da aplicação
├── .env.example                  # Modelo de variáveis de ambiente
├── .gitignore
├── package.json
└── README.md
```

---

## ⚙️ Passo a Passo para Configuração

### 1. Instalar as Dependências
Abra o terminal nesta pasta e execute:
```bash
npm install
```

---

### 2. Obter as Chaves no Kommo CRM
1. Acesse o seu Kommo (ex: `https://suaempresa.kommo.com`).
2. Vá em **Configurações (ícone de engrenagem) > Integrações**.
3. Clique em **Criar Integração** (ou Integração Privada):
   * Conceda permissões de leitura e gravação para **Leads**, **Contatos** e **Mensagens**.
   * Copie o **Token de Acesso de Longa Duração** (Access Token).

---

### 3. Configurar o Arquivo `.env`
Abra o arquivo `.env` gerado na raiz do projeto e preencha:
```env
PORT=3000
KOMMO_SUBDOMAIN=suaempresa
KOMMO_ACCESS_TOKEN=seu_access_token_aqui
OPENAI_API_KEY=sk-proj-...
```

---

### 4. Descobrir os IDs das Etapas com 1 Comando
Para não ter que caçar os números das etapas no navegador, execute o script utilitário incluído:
```bash
npm run list-stages
```
Ele exibirá no terminal todos os seus funis e o ID numérico de cada etapa:
```text
============================================================
📌 FUNIL: "Funil de Vendas WhatsApp" (Pipeline ID: 123456)
============================================================
Etapas disponíveis:
  • [ID: 87654321] -> Etapa: "Interessado / Fechamento"
  • [ID: 87654322] -> Etapa: "Sem Interesse / Perdido"
  • [ID: 87654323] -> Etapa: "Atendimento Humano"
```

Copie os IDs correspondentes e preencha no `.env`:
```env
STAGE_POSITIVO_ID=87654321
STAGE_NEGATIVO_ID=87654322
STAGE_HUMANO_ID=87654323
```

---

### 5. Configurar no Salesbot do Kommo
1. Acesse seu Funil no Kommo e abra o **Salesbot**.
2. Na etapa onde você faz uma pergunta ao lead com botões rápidos:
   * No ramo **"Qualquer outra resposta"** (fallback para quando o lead digita um texto fora do script ou envia um **áudio**):
   * Clique em **+ Adicionar etapa** e selecione **"Enviar um webhook"**.
   * URL do Webhook:
     ```text
     https://seu-servidor.com/webhook/kommo?lead_id={{lead.id}}
     ```
   * Logo abaixo da etapa do webhook, adicione a ação de **Parar o bot** (para evitar que o bot fique insistindo com mensagens automáticas enquanto a IA e o vendedor assumem).

---

### 6. Executar o Servidor

#### Modo Desenvolvimento:
```bash
npm run dev
```

#### Modo Produção:
```bash
npm start
```

---

## 🧠 Como Funciona a Lógica de Controle na Prática

1. **Lead envia 2 áudios seguidos no WhatsApp:**
   * Áudio 1 chega ➡️ Salesbot aciona o Webhook ➡️ Servidor inicia contador de 25s.
   * Áudio 2 chega 10s depois ➡️ Servidor detecta o mesmo lead e reinicia o contador para mais 25s.
2. **Período de silêncio:**
   * Passados os 25s sem novas mensagens, o servidor baixa os áudios do WhatsApp (`.ogg`), envia para o Whisper e transcreve tudo.
3. **Classificação com IA:**
   * O GPT-4o-mini analisa o contexto completo e classifica em:
     * `POSITIVO` ➡️ Move para `STAGE_POSITIVO_ID`.
     * `NEGATIVO` ➡️ Move para `STAGE_NEGATIVO_ID`.
     * `DUVIDA` ➡️ Move para `STAGE_HUMANO_ID` e notifica o time.
4. **Auditoria no CRM:**
   * O servidor insere uma Nota Interna na timeline do lead com a transcrição completa e a justificativa da IA para que seu time de vendas tenha total visibilidade.

---

## ☁️ Como Fazer o Deploy no Render (Passo a Passo)

O projeto já contém o arquivo [`render.yaml`](./render.yaml) configurado para deploy automático com suporte a Blueprint no **Render**.

### Opção 1: Via Blueprint Automático (Recomendado)
1. Suba esta pasta para um repositório no seu GitHub ou GitLab.
2. No painel do [Render](https://dashboard.render.com), clique em **New +** > **Blueprint**.
3. Conecte o repositório. O Render detectará automaticamente o arquivo `render.yaml` com todos os comandos e parâmetros prontos.
4. Preencha as variáveis de ambiente solicitadas no painel.

### Opção 2: Via Novo Web Service Manual
1. No painel do Render, clique em **New +** > **Web Service**.
2. Conecte seu repositório.
3. Configure os seguintes campos:
   * **Runtime:** `Node`
   * **Build Command:** `npm install`
   * **Start Command:** `npm start`
4. Na aba **Environment Variables**, adicione as mesmas variáveis do seu `.env` (`KOMMO_SUBDOMAIN`, `KOMMO_ACCESS_TOKEN`, `OPENAI_API_KEY`, etc.).

---

### ⚠️ Dica de Ouro para o Plano Gratuito do Render:
> No plano gratuito do Render, o servidor entra em hibernação após 15 minutos sem requisições. 
> Se um lead mandar mensagem no WhatsApp enquanto o servidor estiver dormindo, o Render levará ~40 segundos para acordar, o que fará o Webhook do Kommo dar timeout (limite de 5 segundos).
> 
> **Como resolver isso de graça:**
> Crie uma conta gratuita no [UptimeRobot](https://uptimerobot.com) ou [cron-job.org](https://cron-job.org) e cadastre uma verificação HTTP (ping) a cada **5 ou 10 minutos** apontando para:
> `https://seu-app.onrender.com/health`
> Isso manterá seu servidor **100% acordado 24 horas por dia**, respondendo instantaneamente a qualquer áudio ou mensagem do WhatsApp!


const querystring = require('querystring');
const { enqueueMessage } = require('../services/buffer.service');
const { log } = require('../services/logger.service');
const { getLeadLatestMessage } = require('../services/kommo.service');

/**
 * Decodifica valores URL-encoded de forma resiliente
 * Trata codificação única, dupla (comum em webhooks e query strings) e substituição de '+' por espaços.
 * @param {any} val 
 * @returns {string}
 */
function decodeUrlValue(val) {
  if (val === null || val === undefined) return '';
  if (typeof val !== 'string') return String(val).trim();
  
  let decoded = val.trim();
  if (decoded === '') return '';

  // Substitui '+' por espaço caso seja padrão application/x-www-form-urlencoded
  if (decoded.includes('+')) {
    decoded = decoded.replace(/\+/g, ' ');
  }

  // Decodifica até 2 vezes para suportar urlencode duplo gerado por Salesbot / proxies
  for (let i = 0; i < 2; i++) {
    if (decoded.includes('%')) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch (e) {
        break; // Interrompe se for sequência malformada de percentual
      }
    }
  }

  return decoded.trim();
}

/**
 * Validador de ID numérico real (descarta tags não substituídas como {{lead.id}} e valores vazios)
 * @param {any} val
 * @returns {boolean}
 */
function isValidLeadId(val) {
  if (!val) return false;
  const decoded = decodeUrlValue(val);
  return decoded !== '' && !decoded.includes('{') && !decoded.includes('}') && /^\d+$/.test(decoded);
}

/**
 * Etapa de Ingestão 2: Sincronização do Subdomínio do Kommo
 */
function syncAccountSubdomain(payload, query) {
  const accountSubdomain = decodeUrlValue(payload.account?.subdomain || query.subdomain);
  if (accountSubdomain && (!process.env.KOMMO_SUBDOMAIN || process.env.KOMMO_SUBDOMAIN === 'suaempresa')) {
    process.env.KOMMO_SUBDOMAIN = accountSubdomain;
    log('info', `📌 Subdomínio do Kommo detectado automaticamente: "${accountSubdomain}"`);
  }
}

/**
 * Etapa de Ingestão 3: Extração resiliente do ID do Lead
 */
function extractLeadId(payload, query) {
  const candidates = [
    query.lead_id,
    query.id,
    payload.lead_id,
    payload.id,
    payload.leads?.add?.[0]?.id,
    payload.leads?.status?.[0]?.id,
    payload.leads?.update?.[0]?.id,
    payload.lead?.id,
    payload.data?.lead_id,
    payload.message?.lead_id,
    payload['leads[add][0][id]'],
    payload['leads[status][0][id]'],
    payload['leads[update][0][id]'],
  ];

  for (const candidate of candidates) {
    if (isValidLeadId(candidate)) {
      return decodeUrlValue(candidate);
    }
  }

  return null;
}

/**
 * Etapa de Ingestão 4: Extração e Decodificação URL do Tipo e Conteúdo da Mensagem/Áudio
 * Varre todos os possíveis parâmetros e formatos onde o Salesbot e a API do Kommo podem enviar a resposta.
 */
function extractMessageData(payload, query) {
  let type = 'text';
  let rawCandidate = '';

  // Lista exaustiva de possíveis campos onde o texto ou áudio pode ser enviado
  const candidates = [
    // 1. Query parameters do webhook (Salesbot GET ou parâmetros de URL)
    query.message,
    query.text,
    query.last_message,
    query.client_message,
    query.msg,
    query.body,
    query.content,
    query.response,
    query.answer,
    query.speech,
    query.voice,
    query.audio,
    query.media,
    query.url,
    query.data,

    // 2. Payload da Chats API / Salesbot POST
    payload.message?.media,
    payload.message?.text,
    payload.message?.content,
    payload.message?.body,
    typeof payload.message === 'string' ? payload.message : '',
    payload.text,
    payload.last_message,
    payload.client_message,
    payload.msg,
    payload.body,
    payload.content,
    payload.response,
    payload.answer,
    payload.speech,
    payload.voice,
    payload.audio,
    payload.media,
    payload.url,
    payload.data?.message,
    payload.data?.text,
    payload.data?.last_message,
    payload.data?.client_message,

    // 3. Leads do Kommo (quando enviado via gatilho de funil)
    payload.leads?.add?.[0]?.message,
    payload.leads?.add?.[0]?.last_message,
    payload.leads?.add?.[0]?.text,
    payload.leads?.status?.[0]?.message,
    payload.leads?.status?.[0]?.last_message,
    payload.leads?.status?.[0]?.text,
    payload.leads?.update?.[0]?.message,
    payload.leads?.update?.[0]?.last_message,
    payload.leads?.update?.[0]?.text,
    payload.lead?.message,
    payload.lead?.last_message,
    payload.lead?.text,

    // 4. Notas vinculadas
    payload.notes?.add?.[0]?.text,
    payload.notes?.add?.[0]?.params?.text,
    payload.notes?.add?.[0]?.params?.link,

    // 5. Chaves planas (form-urlencoded padrão)
    payload['message'],
    payload['text'],
    payload['last_message'],
    payload['client_message'],
    payload['leads[add][0][message]'],
    payload['leads[add][0][last_message]'],
    payload['leads[add][0][text]'],
    payload['leads[status][0][message]'],
    payload['leads[status][0][last_message]'],
    payload['leads[status][0][text]'],
  ];

  // Localiza o primeiro candidato válido (que não seja tag vazia como {{last_message}})
  for (const item of candidates) {
    if (item !== null && item !== undefined) {
      const str = String(item).trim();
      // Descarta tags não substituídas do Salesbot
      if (str !== '' && !str.includes('{{') && !str.includes('}}')) {
        rawCandidate = str;
        break;
      }
    }
  }

  // Decodifica URL Decode caso tenha vindo codificado (%20, +, %C3%A1, etc.)
  const content = decodeUrlValue(rawCandidate);

  // Identificação do tipo (áudio/voz ou texto)
  if (payload.type === 'voice' || payload.type === 'audio' || query.type === 'voice' || query.type === 'audio') {
    type = 'voice';
  } else if (payload.message?.type === 'voice' || payload.message?.type === 'audio') {
    type = 'voice';
  } else if (typeof content === 'string' && (content.startsWith('http://') || content.startsWith('https://'))) {
    if (content.includes('.ogg') || content.includes('.mp3') || content.includes('.opus') || content.includes('.wav') || content.includes('.m4a') || content.includes('audio') || content.includes('voice')) {
      type = 'voice';
    }
  }

  return {
    type,
    content,
    wasDecoded: rawCandidate !== content,
    rawCandidate,
  };
}

/**
 * Etapa de Ingestão 5: Resolução de conteúdo ausente via CRM Timeline caso não venha no webhook
 */
async function resolveInitialMessage(leadId, messageData) {
  let { type, content, wasDecoded } = messageData;

  const isMissing = !content || content.includes('{{') || content.trim() === '';
  if (isMissing) {
    log('info', `🔍 [Lead ${leadId}] Webhook sem texto direto no payload/query. Buscando na linha do tempo do Kommo CRM...`);
    const fetched = await getLeadLatestMessage(leadId);
    if (fetched) {
      type = fetched.type;
      content = decodeUrlValue(fetched.content);
      log('success', `📥 [Lead ${leadId}] Mensagem localizada no CRM: [${type.toUpperCase()}] "${content.slice(0, 100)}..."`);
    } else {
      log('warn', `⚠️ [Lead ${leadId}] Nenhuma mensagem recente encontrada na linha do tempo ou contatos do CRM.`);
      content = '(Mensagem não localizada)';
    }
  } else {
    const decodeNote = wasDecoded ? ' (Decodificado com sucesso de URL-encoded)' : '';
    log('success', `📥 [Lead ${leadId}] Mensagem recebida diretamente no Webhook${decodeNote}: [${type.toUpperCase()}] "${content.slice(0, 100)}..."`);
  }

  return { type, content };
}

/**
 * Controller responsável por receber webhooks do Salesbot ou da Chats API do Kommo
 * Organizado em etapas sequenciais de ingestão.
 */
async function handleKommoWebhook(req, res) {
  // ETAPA 1: Retorno imediato 200 OK (Regra de ouro do Kommo para evitar timeouts e retries)
  res.status(200).json({ status: 'ok', received_at: new Date().toISOString() });

  try {
    let payload = req.body || {};
    let query = req.query || {};

    // Se o corpo chegou como texto puro URL-encoded (ex: Content-Type text/plain ou raw form)
    if (typeof payload === 'string' && (payload.includes('=') || payload.includes('&'))) {
      try {
        const parsed = querystring.parse(payload);
        payload = { ...parsed, _raw: payload };
      } catch (e) {}
    }

    // Se a URL original tiver query parameters que o Express não colocou no req.query
    if (req.originalUrl && req.originalUrl.includes('?')) {
      try {
        const queryString = req.originalUrl.split('?')[1];
        const parsedQuery = querystring.parse(queryString);
        query = { ...parsedQuery, ...query };
      } catch (e) {}
    }

    log('info', `📬 Webhook recebido do Kommo!`, { 
      query, 
      payload: Object.keys(payload).length > 0 ? payload : '(Vazio)' 
    });

    // ETAPA 2: Sincronização do subdomínio
    syncAccountSubdomain(payload, query);

    // ETAPA 3: Extração e validação do Lead ID
    const leadId = extractLeadId(payload, query);
    if (!leadId) {
      log('warn', `⚠️ Webhook recebido sem lead_id numérico válido.`, { query, payload });
      return;
    }

    // ETAPA 4: Extração e decodificação URL do conteúdo e tipo da mensagem
    const rawMessageData = extractMessageData(payload, query);

    // ETAPA 5: Resolução antecipada caso não venha corpo direto no webhook
    const resolvedMessage = await resolveInitialMessage(leadId, rawMessageData);

    // ETAPA 6: Enfileiramento no buffer de debounce
    enqueueMessage({
      leadId,
      type: resolvedMessage.type,
      content: resolvedMessage.content,
    });

  } catch (error) {
    log('error', `❌ Erro crítico no processamento do webhook: ${error.message}`, error.stack);
  }
}

/**
 * Endpoint de Health Check
 */
function handleHealthCheck(req, res) {
  res.status(200).json({
    status: 'online',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
}

module.exports = {
  handleKommoWebhook,
  handleHealthCheck,
  decodeUrlValue,
  isValidLeadId,
  extractLeadId,
  extractMessageData,
};

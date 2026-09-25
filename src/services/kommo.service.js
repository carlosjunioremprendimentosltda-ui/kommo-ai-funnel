const axios = require('axios');

/**
 * Instância do Axios configurada para a API v4 do Kommo
 */
function getKommoClient() {
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  const token = process.env.KOMMO_ACCESS_TOKEN;

  if (!subdomain || !token) {
    throw new Error('KOMMO_SUBDOMAIN ou KOMMO_ACCESS_TOKEN não estão configurados no .env');
  }

  return axios.create({
    baseURL: `https://${subdomain}.kommo.com/api/v4`,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'KommoAIFunnel/1.0',
    },
    timeout: 10000,
  });
}

/**
 * Atualiza o status/etapa de um Lead
 * @param {number|string} leadId - ID do lead no Kommo
 * @param {number|string} statusId - ID do status/etapa de destino
 * @param {number|string} [pipelineId] - ID do funil (opcional)
 */
async function updateLeadStage(leadId, statusId, pipelineId = null) {
  try {
    const client = getKommoClient();
    const payload = {
      status_id: Number(statusId),
    };

    if (pipelineId) {
      payload.pipeline_id = Number(pipelineId);
    }

    const response = await client.patch(`/leads/${leadId}`, payload);
    console.log(`[KommoService] Lead ${leadId} movido para a etapa ${statusId}`);
    return response.data;
  } catch (error) {
    const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error(`[KommoService] Erro ao mover lead ${leadId}:`, errorDetails);
    throw new Error(`Falha ao atualizar etapa do lead: ${errorDetails}`);
  }
}

/**
 * Adiciona uma nota interna na linha do tempo do lead
 * @param {number|string} leadId - ID do lead
 * @param {string} text - Conteúdo da nota
 */
async function addLeadNote(leadId, text) {
  try {
    const client = getKommoClient();
    const payload = [
      {
        note_type: 'common',
        params: {
          text: text,
        },
      },
    ];

    const response = await client.post(`/leads/${leadId}/notes`, payload);
    console.log(`[KommoService] Nota interna adicionada ao lead ${leadId}`);
    return response.data;
  } catch (error) {
    const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error(`[KommoService] Erro ao adicionar nota no lead ${leadId}:`, errorDetails);
    // Não interrompe o fluxo principal se a nota falhar
    return null;
  }
}

/**
 * Busca detalhes do lead incluindo contatos vinculados
 * @param {number|string} leadId 
 */
async function getLeadDetails(leadId) {
  try {
    const client = getKommoClient();
    const response = await client.get(`/leads/${leadId}?with=contacts`);
    return response.data;
  } catch (error) {
    const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error(`[KommoService] Erro ao buscar lead ${leadId}:`, errorDetails);
    return null;
  }
}

/**
 * Lista todos os funis e suas respectivas etapas
 */
async function getPipelines() {
  const client = getKommoClient();
  const response = await client.get('/leads/pipelines');
  return response.data._embedded.pipelines;
}

/**
 * Busca as últimas notas e eventos do lead e dos contatos vinculados para extrair a mensagem/áudio
 * @param {number|string} leadId 
 */
async function getLeadLatestMessage(leadId) {
  try {
    const client = getKommoClient();

    // 1. Tenta buscar nas notas do Lead
    const leadNotesRes = await client.get(`/leads/${leadId}/notes?order[created_at]=desc&limit=10`).catch(() => null);
    const leadNotes = leadNotesRes?.data?._embedded?.notes || [];
    const extractedFromLead = extractMessageFromNotes(leadNotes);
    if (extractedFromLead) return extractedFromLead;

    // 2. Se não achou nas notas do Lead, busca contatos vinculados (onde chats de WhatsApp ficam)
    const leadRes = await client.get(`/leads/${leadId}?with=contacts`).catch(() => null);
    const contacts = leadRes?.data?._embedded?.contacts || [];

    for (const contact of contacts) {
      const contactNotesRes = await client.get(`/contacts/${contact.id}/notes?order[created_at]=desc&limit=10`).catch(() => null);
      const contactNotes = contactNotesRes?.data?._embedded?.notes || [];
      const extractedFromContact = extractMessageFromNotes(contactNotes);
      if (extractedFromContact) return extractedFromContact;
    }

    // 3. Tenta buscar nos Eventos recentes do Lead e Contatos (mensagens de chat/WhatsApp do Kommo)
    const leadEventsRes = await client.get(`/events?filter[entity]=lead&filter[entity_id]=${leadId}&order[created_at]=desc&limit=10`).catch(() => null);
    const leadEvents = leadEventsRes?.data?._embedded?.events || [];
    const extractedFromLeadEvents = extractMessageFromEvents(leadEvents);
    if (extractedFromLeadEvents) return extractedFromLeadEvents;

    for (const contact of contacts) {
      const contactEventsRes = await client.get(`/events?filter[entity]=contact&filter[entity_id]=${contact.id}&order[created_at]=desc&limit=10`).catch(() => null);
      const contactEvents = contactEventsRes?.data?._embedded?.events || [];
      const extractedFromContactEvents = extractMessageFromEvents(contactEvents);
      if (extractedFromContactEvents) return extractedFromContactEvents;
    }

    return null;
  } catch (error) {
    const msg = error.response ? JSON.stringify(error.response.data) : error.message;
    console.warn(`[KommoService] Não foi possível obter histórico do lead ${leadId}:`, msg);
    return null;
  }
}

function extractMessageFromNotes(notes) {
  if (!Array.isArray(notes)) return null;

  for (const note of notes) {
    const p = note.params || {};

    // Ignora notas da nossa própria IA
    const fullText = (p.text || note.text || p.message || p.body || '').toString();
    if (fullText.includes('TRIAGEM AUTOMÁTICA') || fullText.includes('🤖')) {
      continue;
    }

    // Procura por link de áudio / arquivo em qualquer propriedade conhecida
    const candidateLinks = [
      p.link,
      p.url,
      p.file_url,
      p.attachment?.link,
      p.attachment?.url,
      p.file?.link,
      p.file?.url,
      p.source,
      note.file_url,
    ].filter(Boolean);

    for (const link of candidateLinks) {
      if (typeof link === 'string' && (link.includes('.ogg') || link.includes('.mp3') || link.includes('.opus') || link.includes('.wav') || link.includes('.m4a') || link.includes('media') || link.includes('audio') || link.includes('voice'))) {
        return { type: 'voice', content: link };
      }
    }

    // Se o próprio texto for uma URL de áudio
    if (fullText.startsWith('http') && (fullText.includes('.ogg') || fullText.includes('.mp3') || fullText.includes('.opus') || fullText.includes('.wav') || fullText.includes('.m4a'))) {
      return { type: 'voice', content: fullText.trim() };
    }

    // Se for texto normal não-vazio
    if (fullText.trim()) {
      return { type: 'text', content: fullText.trim() };
    }
  }
  return null;
}

function extractMessageFromEvents(events) {
  if (!Array.isArray(events)) return null;

  for (const event of events) {
    const val = Array.isArray(event.value_after) ? event.value_after[0] : (event.value_after || {});
    const msg = val.message || val.note || val || {};

    const text = (typeof msg.text === 'string' ? msg.text : (typeof val.text === 'string' ? val.text : '')).trim();
    const media = msg.media || msg.url || msg.link || val.media || val.url || '';

    if (text.includes('TRIAGEM AUTOMÁTICA') || text.includes('🤖')) {
      continue;
    }

    if (media && (media.includes('.ogg') || media.includes('.mp3') || media.includes('.opus') || media.includes('.wav') || media.includes('.m4a') || media.includes('audio') || media.includes('voice'))) {
      return { type: 'voice', content: media };
    }

    if (text) {
      if (text.startsWith('http') && (text.includes('.ogg') || text.includes('.mp3') || text.includes('.opus') || text.includes('.wav') || text.includes('.m4a'))) {
        return { type: 'voice', content: text };
      }
      return { type: 'text', content: text };
    }
  }
  return null;
}

module.exports = {
  updateLeadStage,
  addLeadNote,
  getLeadDetails,
  getPipelines,
  getLeadLatestMessage,
};

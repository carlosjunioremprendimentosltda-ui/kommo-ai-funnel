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
 * Extrai texto ou áudio de campos customizados do Lead ou Contato (onde Salesbots costumam salvar respostas)
 */
function extractMessageFromCustomFields(customFields) {
  if (!Array.isArray(customFields)) return null;

  for (const cf of customFields) {
    const name = (cf.field_name || cf.field_code || '').toLowerCase();
    const isMessageField = name.includes('mensagem') || 
      name.includes('resposta') || 
      name.includes('audio') || 
      name.includes('message') || 
      name.includes('texto') || 
      name.includes('chat') || 
      name.includes('waba') ||
      name.includes('last');

    if (Array.isArray(cf.values) && cf.values.length > 0) {
      const rawVal = cf.values[0]?.value;
      if (rawVal) {
        const decoded = decodeUrlValue(String(rawVal));
        if (decoded && !decoded.includes('{{') && decoded.trim() !== '') {
          if (decoded.startsWith('http') && (decoded.includes('.ogg') || decoded.includes('.mp3') || decoded.includes('.opus') || decoded.includes('.wav') || decoded.includes('.m4a') || decoded.includes('audio') || decoded.includes('voice'))) {
            return { type: 'voice', content: decoded };
          }
          if (isMessageField) {
            return { type: 'text', content: decoded };
          }
        }
      }
    }
  }
  return null;
}

/**
 * Busca as últimas conversas, mensagens e áudios do lead nos múltiplos pontos de armazenamento da API v4 do Kommo
 * @param {number|string} leadId 
 */
async function getLeadLatestMessage(leadId) {
  try {
    const client = getKommoClient();

    // 1. Busca dados cadastrais do Lead e Contatos vinculados
    let leadData = null;
    let contacts = [];
    try {
      const leadRes = await client.get(`/leads/${leadId}?with=contacts`);
      leadData = leadRes.data;
      contacts = leadData?._embedded?.contacts || [];
    } catch (leadErr) {
      console.warn(`[KommoService] Aviso ao consultar Lead ${leadId}:`, leadErr.response?.data?.detail || leadErr.message);
    }

    // 1.1 Se o Salesbot gravou a resposta em um campo customizado do Lead
    if (leadData?.custom_fields_values) {
      const fromLeadFields = extractMessageFromCustomFields(leadData.custom_fields_values);
      if (fromLeadFields) {
        console.log(`[KommoService] ✅ Mensagem localizada nos campos customizados do Lead ${leadId}`);
        return fromLeadFields;
      }
    }

    // 2. Busca notas na linha do tempo do LEAD (sem order inválido na query; ordena em memória)
    try {
      const leadNotesRes = await client.get(`/leads/${leadId}/notes?limit=50`);
      const leadNotes = leadNotesRes.data?._embedded?.notes || [];
      leadNotes.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      const extractedFromLead = extractMessageFromNotes(leadNotes);
      if (extractedFromLead) {
        console.log(`[KommoService] ✅ Mensagem localizada nas notas do Lead ${leadId}`);
        return extractedFromLead;
      }
    } catch (notesErr) {
      console.warn(`[KommoService] Aviso ao consultar notas do Lead ${leadId}:`, notesErr.response?.data?.detail || notesErr.message);
    }

    // 3. Busca nas conversas dos CONTATOS vinculados (onde WhatsApp/WABA registra chats)
    for (const contact of contacts) {
      // 3.1 Notas do contato (conversas e áudios de chat)
      try {
        const contactNotesRes = await client.get(`/contacts/${contact.id}/notes?limit=50`);
        const contactNotes = contactNotesRes.data?._embedded?.notes || [];
        contactNotes.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        const extractedFromContact = extractMessageFromNotes(contactNotes);
        if (extractedFromContact) {
          console.log(`[KommoService] ✅ Mensagem localizada nas conversas do Contato ${contact.id}`);
          return extractedFromContact;
        }
      } catch (cNotesErr) {
        console.warn(`[KommoService] Aviso ao consultar notas do Contato ${contact.id}:`, cNotesErr.response?.data?.detail || cNotesErr.message);
      }

      // 3.2 Campos customizados do contato
      try {
        const contactDetailRes = await client.get(`/contacts/${contact.id}`);
        const cFields = contactDetailRes.data?.custom_fields_values || [];
        const fromContactFields = extractMessageFromCustomFields(cFields);
        if (fromContactFields) {
          console.log(`[KommoService] ✅ Mensagem localizada nos campos customizados do Contato ${contact.id}`);
          return fromContactFields;
        }
      } catch (cDetailErr) {}
    }

    // 4. Busca nos Eventos recentes do LEAD (/events)
    try {
      const leadEventsRes = await client.get(`/events?filter[entity]=lead&filter[entity_id]=${leadId}&limit=50`);
      const leadEvents = leadEventsRes.data?._embedded?.events || [];
      leadEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      const extractedFromLeadEvents = extractMessageFromEvents(leadEvents);
      if (extractedFromLeadEvents) {
        console.log(`[KommoService] ✅ Mensagem localizada nos eventos do Lead ${leadId}`);
        return extractedFromLeadEvents;
      }
    } catch (leadEventsErr) {
      console.warn(`[KommoService] Aviso ao consultar eventos do Lead ${leadId}:`, leadEventsErr.response?.data?.detail || leadEventsErr.message);
    }

    // 5. Busca nos Eventos recentes dos CONTATOS (/events)
    for (const contact of contacts) {
      try {
        const contactEventsRes = await client.get(`/events?filter[entity]=contact&filter[entity_id]=${contact.id}&limit=50`);
        const contactEvents = contactEventsRes.data?._embedded?.events || [];
        contactEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        const extractedFromContactEvents = extractMessageFromEvents(contactEvents);
        if (extractedFromContactEvents) {
          console.log(`[KommoService] ✅ Mensagem localizada nos eventos do Contato ${contact.id}`);
          return extractedFromContactEvents;
        }
      } catch (cEventsErr) {
        console.warn(`[KommoService] Aviso ao consultar eventos do Contato ${contact.id}:`, cEventsErr.response?.data?.detail || cEventsErr.message);
      }
    }

    // 6. Conversas do Chats API / Talks
    try {
      const talksRes = await client.get(`/talks?filter[entity_id]=${leadId}&limit=10`);
      const talks = talksRes.data?._embedded?.talks || [];
      for (const talk of talks) {
        const rawContent = talk.last_message || talk.message || talk.text;
        if (rawContent) {
          const txt = decodeUrlValue(rawContent);
          if (txt && !txt.includes('{{')) {
            console.log(`[KommoService] ✅ Mensagem localizada em Talks do Lead ${leadId}`);
            return { type: 'text', content: txt };
          }
        }
      }
    } catch (talksErr) {}

    console.warn(`[KommoService] Nenhuma mensagem ou áudio ativo localizado no Lead ${leadId} ou em seus contatos.`);
    return null;
  } catch (error) {
    const msg = error.response ? JSON.stringify(error.response.data) : error.message;
    console.warn(`[KommoService] Erro ao obter histórico do lead ${leadId}:`, msg);
    return null;
  }
}

function decodeUrlValue(val) {
  if (val === null || val === undefined) return '';
  if (typeof val !== 'string') return String(val).trim();
  
  let decoded = val.trim();
  if (decoded === '') return '';

  if (decoded.includes('+')) {
    decoded = decoded.replace(/\+/g, ' ');
  }

  for (let i = 0; i < 2; i++) {
    if (decoded.includes('%')) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch (e) {
        break;
      }
    }
  }

  return decoded.trim();
}

function extractMessageFromNotes(notes) {
  if (!Array.isArray(notes)) return null;

  for (const note of notes) {
    const p = note.params || {};

    // Ignora notas da nossa própria IA
    const fullText = (p.text || note.text || p.message || p.body || p.content || '').toString();
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

    for (const rawLink of candidateLinks) {
      const link = decodeUrlValue(rawLink);
      if (typeof link === 'string' && (link.includes('.ogg') || link.includes('.mp3') || link.includes('.opus') || link.includes('.wav') || link.includes('.m4a') || link.includes('media') || link.includes('audio') || link.includes('voice'))) {
        return { type: 'voice', content: link };
      }
    }

    const decodedText = decodeUrlValue(fullText);

    // Se o próprio texto for uma URL de áudio
    if (decodedText.startsWith('http') && (decodedText.includes('.ogg') || decodedText.includes('.mp3') || decodedText.includes('.opus') || decodedText.includes('.wav') || decodedText.includes('.m4a'))) {
      return { type: 'voice', content: decodedText };
    }

    // Se for texto normal não-vazio
    if (decodedText) {
      return { type: 'text', content: decodedText };
    }
  }
  return null;
}

function extractMessageFromEvents(events) {
  if (!Array.isArray(events)) return null;

  for (const event of events) {
    const val = Array.isArray(event.value_after) ? event.value_after[0] : (event.value_after || {});
    const msg = val.message || val.note || val || {};

    const rawText = (typeof msg.text === 'string' ? msg.text : (typeof val.text === 'string' ? val.text : '')).trim();
    const rawMedia = msg.media || msg.url || msg.link || val.media || val.url || '';

    if (rawText.includes('TRIAGEM AUTOMÁTICA') || rawText.includes('🤖')) {
      continue;
    }

    const text = decodeUrlValue(rawText);
    const media = decodeUrlValue(rawMedia);

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

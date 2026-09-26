require('dotenv').config();
const axios = require('axios');
const { getLeadLatestMessage } = require('../src/services/kommo.service');

const leadId = process.argv[2] || '1644826';
const subdomain = process.env.KOMMO_SUBDOMAIN || 'numero02';
const token = process.env.KOMMO_ACCESS_TOKEN;

async function run() {
  console.log(`\n======================================================`);
  console.log(`🔍 INVESTIGAÇÃO DE CONVERSA DO LEAD: ${leadId}`);
  console.log(`📌 Subdomínio: ${subdomain}`);
  console.log(`======================================================\n`);

  if (!token || token === 'seu_access_token_do_kommo_aqui' || token.trim() === '') {
    console.error(`❌ ERRO: KOMMO_ACCESS_TOKEN não está configurado no seu arquivo .env local!`);
    console.log(`\n👉 Cole seu Access Token do Kommo no arquivo .env na linha:`);
    console.log(`KOMMO_ACCESS_TOKEN=seu_token_aqui\n`);
    process.exit(1);
  }

  const client = axios.create({
    baseURL: `https://${subdomain}.kommo.com/api/v4`,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'KommoAIFunnel/1.0',
    },
    timeout: 10000,
  });

  try {
    // 1. Detalhes do Lead
    console.log(`1️⃣ Buscando dados cadastrais do Lead ${leadId}...`);
    const leadRes = await client.get(`/leads/${leadId}?with=contacts`);
    const lead = leadRes.data;
    console.log(`   ✅ Nome do Lead: "${lead.name || 'Sem nome'}"`);
    console.log(`   📍 Pipeline ID: ${lead.pipeline_id} | Etapa atual (Status ID): ${lead.status_id}`);
    
    const contacts = lead._embedded?.contacts || [];
    console.log(`   👥 Contatos vinculados encontrados: ${contacts.length}`);
    contacts.forEach((c, idx) => {
      console.log(`      [Contato ${idx + 1}] ID: ${c.id}`);
    });

    // 2. Notas do Lead
    console.log(`\n2️⃣ Buscando Notas na linha do tempo do LEAD (${leadId})...`);
    try {
      const leadNotesRes = await client.get(`/leads/${leadId}/notes?limit=50`);
      const notes = leadNotesRes.data?._embedded?.notes || [];
      notes.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      console.log(`   📝 Total de notas no Lead: ${notes.length}`);
      notes.forEach((n, idx) => {
        const text = n.params?.text || n.params?.message || n.params?.body || '';
        const link = n.params?.link || n.params?.file?.link || '';
        console.log(`      [Nota ${idx + 1}] Tipo: ${n.note_type} | Data: ${new Date(n.created_at * 1000).toLocaleString('pt-BR')}`);
        if (text) console.log(`         Texto: "${text.slice(0, 120)}"`);
        if (link) console.log(`         Link/Áudio: ${link}`);
      });
    } catch (err) {
      console.warn(`   ⚠️ Erro ao buscar notas do lead: ${err.message}`);
    }

    // 3. Notas dos Contatos (Onde WhatsApp e WABA gravam as conversas)
    console.log(`\n3️⃣ Buscando Notas e Conversas do CONTATO vinculado...`);
    for (const contact of contacts) {
      try {
        const contactNotesRes = await client.get(`/contacts/${contact.id}/notes?limit=50`);
        const cNotes = contactNotesRes.data?._embedded?.notes || [];
        cNotes.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        console.log(`   📱 Contato ${contact.id}: ${cNotes.length} notas encontradas`);
        cNotes.forEach((n, idx) => {
          const text = n.params?.text || n.params?.message || n.params?.body || '';
          const link = n.params?.link || n.params?.file?.link || '';
          console.log(`      [Nota ${idx + 1}] Tipo: ${n.note_type} | Data: ${new Date(n.created_at * 1000).toLocaleString('pt-BR')}`);
          if (text) console.log(`         Texto: "${text.slice(0, 120)}"`);
          if (link) console.log(`         Link/Áudio: ${link}`);
        });
      } catch (err) {
        console.warn(`   ⚠️ Erro ao buscar notas do contato ${contact.id}: ${err.message}`);
      }
    }

    // 4. Eventos do Kommo (Incoming chat message / Talks)
    console.log(`\n4️⃣ Buscando Eventos de Chat/Mensagens (/events)...`);
    try {
      const eventsRes = await client.get(`/events?filter[entity]=lead&filter[entity_id]=${leadId}&order[created_at]=desc&limit=10`);
      const events = eventsRes.data?._embedded?.events || [];
      console.log(`   ⚡ Total de eventos do lead: ${events.length}`);
      events.forEach((ev, idx) => {
        console.log(`      [Evento ${idx + 1}] Tipo: ${ev.type} | Data: ${new Date(ev.created_at * 1000).toLocaleString('pt-BR')}`);
      });
    } catch (err) {
      console.warn(`   ⚠️ Erro ao buscar eventos: ${err.message}`);
    }

    // 5. Teste da nossa função getLeadLatestMessage
    console.log(`\n5️⃣ Executando extração automática (getLeadLatestMessage)...`);
    const latest = await getLeadLatestMessage(leadId);
    if (latest) {
      console.log(`\n🎉 SUCESSO! Mensagem identificada pelo sistema:`);
      console.log(`   Tipo: [${latest.type.toUpperCase()}]`);
      console.log(`   Conteúdo: "${latest.content}"`);
    } else {
      console.log(`\n⚠️ Nenhuma mensagem ou áudio ativo foi localizado para este lead.`);
    }

    console.log(`\n======================================================\n`);

  } catch (error) {
    if (error.response) {
      console.error(`\n❌ Erro da API do Kommo (${error.response.status}):`, JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(`\n❌ Erro de conexão:`, error.message);
    }
  }
}

run();

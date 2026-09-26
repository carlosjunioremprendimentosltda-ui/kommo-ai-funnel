const { transcribeAudioFromUrl, classifyCustomerIntent } = require('./ai.service');
const { updateLeadStage, addLeadNote, getLeadLatestMessage } = require('./kommo.service');
const { resolveTargetStage, formatAuditNote } = require('./stage.service');
const { log, logStep } = require('./logger.service');
const db = require('./db.service');

const TOTAL_STEPS = 6;

/**
 * Etapa 1: Resolução de Mensagens e Histórico
 * Garante que mensagens que vieram sem corpo no webhook sejam localizadas no CRM após o silêncio.
 */
async function step1_resolveMessages(leadId, items) {
  logStep(leadId, 1, TOTAL_STEPS, 'Resolução de Mensagens', `Verificando integridade de ${items.length} item(ns)...`);

  const resolvedItems = [];

  for (let i = 0; i < items.length; i++) {
    const item = { ...items[i] };
    const isMissingContent = !item.content || 
      item.content === '(Mensagem não localizada)' || 
      item.content === '(Mensagem recebida sem corpo no webhook)';

    if (isMissingContent) {
      logStep(leadId, 1, TOTAL_STEPS, 'Resolução de Mensagens', `Buscando histórico atualizado do Lead no Kommo...`);
      const freshMessage = await getLeadLatestMessage(leadId);
      if (freshMessage) {
        item.type = freshMessage.type;
        item.content = freshMessage.content;
        logStep(leadId, 1, TOTAL_STEPS, 'Resolução de Mensagens', `Mensagem localizada no CRM: [${item.type.toUpperCase()}] "${item.content.slice(0, 80)}..."`, null, 'success');
      }
    }

    resolvedItems.push(item);
  }

  return resolvedItems;
}

/**
 * Etapa 2: Transcrição de Áudios e Consolidação de Conteúdo
 * Transcreve áudios com IA e une múltiplos textos/áudios em um único texto cronológico.
 */
async function step2_transcribeAndConsolidate(leadId, items) {
  logStep(leadId, 2, TOTAL_STEPS, 'Transcrição & Consolidação', `Iniciando transcrição e agrupamento de conteúdo...`);

  const parts = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const isVoice = item.type === 'voice' || item.type === 'audio';

    if (isVoice) {
      logStep(leadId, 2, TOTAL_STEPS, 'Transcrição de Áudio', `Transcrevendo áudio [${i + 1}/${items.length}]...`);
      try {
        const audioText = await transcribeAudioFromUrl(item.content);
        parts.push(`[Áudio ${i + 1}]: "${audioText}"`);
        logStep(leadId, 2, TOTAL_STEPS, 'Transcrição de Áudio', `Áudio transcrito com sucesso: "${audioText.slice(0, 80)}..."`, null, 'success');
      } catch (err) {
        parts.push(`[Áudio ${i + 1}]: (Falha ao transcrever: ${err.message})`);
        logStep(leadId, 2, TOTAL_STEPS, 'Transcrição de Áudio', `Falha na transcrição: ${err.message}`, null, 'error');
      }
    } else {
      parts.push(`[Texto ${i + 1}]: "${item.content}"`);
    }
  }

  const fullTranscript = parts.join('\n');
  const hasValidContent = parts.some(p => 
    !p.includes('(Mensagem não localizada)') && 
    !p.includes('(Mensagem recebida sem corpo') &&
    !p.includes('(Falha ao transcrever')
  );

  logStep(leadId, 2, TOTAL_STEPS, 'Transcrição & Consolidação', `Conteúdo consolidado (${parts.length} fragmento(s)).`);
  return { fullTranscript, hasValidContent };
}

/**
 * Etapa 3: Classificação com Inteligência Artificial
 * Envia o texto completo para análise de sentimento e intenção comercial.
 */
async function step3_classifyIntent(leadId, fullTranscript, hasValidContent) {
  logStep(leadId, 3, TOTAL_STEPS, 'Classificação com IA', `Submetendo à IA para identificação de sentimento/intenção...`);

  if (!hasValidContent) {
    logStep(leadId, 3, TOTAL_STEPS, 'Classificação com IA', `Sem mensagens válidas. Classificado como INCONCLUSIVO.`, null, 'warn');
    return {
      classificacao: 'INCONCLUSIVO',
      motivo: 'Nenhuma mensagem ou áudio foi encontrado no CRM após aguardar o envio.',
      transcricao_resumida: '(Nenhuma mensagem localizada no CRM)',
    };
  }

  const analysis = await classifyCustomerIntent(fullTranscript);
  logStep(
    leadId, 
    3, 
    TOTAL_STEPS, 
    'Classificação com IA', 
    `Resultado: [${analysis.classificacao}] - ${analysis.motivo}`, 
    analysis, 
    'ai'
  );
  return analysis;
}

/**
 * Etapa 4: Mapeamento da Etapa de Destino no Funil
 * Mapeia a decisão da IA para o ID de etapa configurado no CRM.
 */
function step4_resolveStage(leadId, analysis) {
  const targetStage = resolveTargetStage(analysis.classificacao);

  if (targetStage.isConfigured) {
    logStep(
      leadId, 
      4, 
      TOTAL_STEPS, 
      'Mapeamento de Etapas', 
      `Direcionado para a etapa: ${targetStage.stageName} (ID: ${targetStage.stageId})`
    );
  } else {
    logStep(
      leadId, 
      4, 
      TOTAL_STEPS, 
      'Mapeamento de Etapas', 
      `⚠️ Etapa para [${analysis.classificacao}] não possui ID configurado no .env (${targetStage.envVar}).`, 
      null, 
      'warn'
    );
  }

  return targetStage;
}

/**
 * Etapa 5: Execução no Kommo CRM (Mudança de Etapa e Auditoria)
 * Efetiva a alteração de etapa no CRM e insere a nota explicativa na linha do tempo.
 */
async function step5_executeCRMUpdates(leadId, targetStage, analysis, fullTranscript) {
  logStep(leadId, 5, TOTAL_STEPS, 'Execução no Kommo CRM', `Iniciando atualizações no CRM...`);

  // 1. Mudança de Etapa no Funil
  if (targetStage.isConfigured) {
    logStep(leadId, 5, TOTAL_STEPS, 'Movimentação no Funil', `Movendo lead para "${targetStage.stageName}" (ID: ${targetStage.stageId})...`);
    await updateLeadStage(leadId, targetStage.stageId);
    logStep(leadId, 5, TOTAL_STEPS, 'Movimentação no Funil', `✅ Etapa atualizada com sucesso no Kommo!`, null, 'success');
  } else {
    logStep(leadId, 5, TOTAL_STEPS, 'Movimentação no Funil', `ℹ️ Nenhuma etapa alterada (ID não configurado). O lead permanece na etapa atual.`);
  }

  // 2. Inserção de Nota de Auditoria
  logStep(leadId, 5, TOTAL_STEPS, 'Nota de Auditoria', `Gravando relatório de triagem na linha do tempo do lead...`);
  const noteText = formatAuditNote({ leadId, analysis, fullTranscript, targetStage });
  await addLeadNote(leadId, noteText);
  logStep(leadId, 5, TOTAL_STEPS, 'Nota de Auditoria', `📝 Nota de auditoria salva com sucesso no Kommo!`, null, 'success');
}

/**
 * Etapa 6: Persistência e Auditoria Local
 * Salva no banco de dados local para visualização no dashboard e finaliza o ciclo.
 */
function step6_persistAndNotify(leadId, fullTranscript, analysis, targetStage, success = true, error = null) {
  logStep(leadId, 6, TOTAL_STEPS, 'Registro & Conclusão', `Registrando triagem no banco de dados local...`);

  db.recordLeadEvent({
    leadId,
    message: fullTranscript || (error ? `Erro: ${error.message}` : '(Sem conteúdo)'),
    classification: analysis?.classificacao || (error ? 'ERRO' : 'INCONCLUSIVO'),
    reason: analysis?.motivo || error?.message || 'Sem motivo registrado',
    targetStageId: targetStage?.stageId || '',
    stageName: targetStage?.stageName || (error ? 'Erro' : 'Não alterada'),
    success,
  });

  if (success) {
    log('success', `🎉 [Lead ${leadId}] Pipeline de triagem concluído com sucesso! Classificação: [${analysis.classificacao}] -> ${targetStage.stageName}`);
  } else {
    log('error', `❌ [Lead ${leadId}] Pipeline finalizado com falhas: ${error?.message}`);
  }
}

/**
 * Orquestrador Geral: Executa o Pipeline do Lead de ponta a ponta
 * @param {string|number} leadId 
 * @param {Array<Object>} rawItems 
 */
async function executeLeadPipeline(leadId, rawItems) {
  log('info', `🚀 [Lead ${leadId}] Iniciando Pipeline de Triagem organizado em ${TOTAL_STEPS} etapas...`);

  let fullTranscript = '';
  let analysis = null;
  let targetStage = null;

  try {
    // Etapa 1: Resolução de Mensagens e Histórico
    const resolvedItems = await step1_resolveMessages(leadId, rawItems);

    // Etapa 2: Transcrição e Consolidação
    const consolidation = await step2_transcribeAndConsolidate(leadId, resolvedItems);
    fullTranscript = consolidation.fullTranscript;

    // Etapa 3: Classificação com IA
    analysis = await step3_classifyIntent(leadId, fullTranscript, consolidation.hasValidContent);

    // Etapa 4: Mapeamento de Etapas do Funil
    targetStage = step4_resolveStage(leadId, analysis);

    // Etapa 5: Execução no Kommo CRM
    await step5_executeCRMUpdates(leadId, targetStage, analysis, fullTranscript);

    // Etapa 6: Persistência e Conclusão
    step6_persistAndNotify(leadId, fullTranscript, analysis, targetStage, true);

  } catch (err) {
    log('error', `❌ [Lead ${leadId}] Erro crítico durante o processamento do pipeline: ${err.message}`, err.stack);
    step6_persistAndNotify(leadId, fullTranscript, analysis, targetStage, false, err);
  }
}

module.exports = {
  TOTAL_STEPS,
  executeLeadPipeline,
  step1_resolveMessages,
  step2_transcribeAndConsolidate,
  step3_classifyIntent,
  step4_resolveStage,
  step5_executeCRMUpdates,
  step6_persistAndNotify,
};

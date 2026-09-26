/**
 * Serviço de Gerenciamento das Etapas do Funil (Kommo CRM)
 * Centraliza a inteligência de mapeamento entre a decisão da IA e as etapas do CRM.
 */

// Mapeamento e metadados das decisões e etapas do funil
const STAGE_DEFINITIONS = {
  POSITIVO: {
    key: 'POSITIVO',
    name: 'POSITIVO (Interessado / Fechamento)',
    envVar: 'STAGE_POSITIVO_ID',
    description: 'Lead demonstrou interesse claro, quer comprar, agendar ou pediu pagamento.',
    icon: '🟢',
  },
  NEGATIVO: {
    key: 'NEGATIVO',
    name: 'NEGATIVO (Descarte / Sem Interesse)',
    envVar: 'STAGE_NEGATIVO_ID',
    description: 'Lead não tem interesse, pediu remoção ou recusou expressamente.',
    icon: '🔴',
  },
  DUVIDA: {
    key: 'DUVIDA',
    name: 'DÚVIDA (Atendimento Humano)',
    envVar: 'STAGE_HUMANO_ID',
    description: 'Lead possui dúvidas comerciais, objeções ou solicitou contato humano.',
    icon: '🟡',
  },
  INCONCLUSIVO: {
    key: 'INCONCLUSIVO',
    name: 'INCONCLUSIVO (Revisão Manual)',
    envVar: 'STAGE_HUMANO_ID', // Fallback padrão para fila humana
    description: 'Mensagem sem clareza, áudio inaudível ou não localizado no CRM.',
    icon: '⚪',
  },
};

/**
 * Valida se um ID de etapa do Kommo é numérico e válido (não é zero nem vazio)
 * @param {string|number} stageId
 * @returns {boolean}
 */
function isValidStageId(stageId) {
  if (!stageId) return false;
  const str = String(stageId).trim();
  return str !== '' && str !== '00000000' && /^\d+$/.test(str);
}

/**
 * Resolve para qual etapa do Kommo o lead deve ser movido com base na classificação da IA
 * @param {string} classification - 'POSITIVO' | 'NEGATIVO' | 'DUVIDA' | 'INCONCLUSIVO'
 * @returns {Object} Informações consolidadas da etapa de destino
 */
function resolveTargetStage(classification) {
  const normClassification = (classification || 'INCONCLUSIVO').toUpperCase().trim();
  const definition = STAGE_DEFINITIONS[normClassification] || STAGE_DEFINITIONS.INCONCLUSIVO;

  let rawStageId = process.env[definition.envVar];

  // Caso específico para INCONCLUSIVO: se houver variável dedicada, usa ela; senão usa STAGE_HUMANO_ID
  if (normClassification === 'INCONCLUSIVO' && process.env.STAGE_INCONCLUSIVO_ID) {
    rawStageId = process.env.STAGE_INCONCLUSIVO_ID;
  }

  const isConfigured = isValidStageId(rawStageId);
  const targetStageId = isConfigured ? String(rawStageId).trim() : null;

  return {
    classification: normClassification,
    stageId: targetStageId,
    stageName: definition.name,
    description: definition.description,
    icon: definition.icon,
    envVar: definition.envVar,
    isConfigured,
  };
}

/**
 * Formata a nota de auditoria padronizada para salvar na linha do tempo do Kommo
 * @param {Object} params
 * @param {string|number} params.leadId
 * @param {Object} params.analysis - Objeto retornado pela IA ({ classificacao, motivo, transcricao_resumida })
 * @param {string} params.fullTranscript - Texto consolidado analisado
 * @param {Object} params.targetStage - Objeto de etapa retornado por resolveTargetStage
 * @returns {string} Nota formatada para a linha do tempo do CRM
 */
function formatAuditNote({ leadId, analysis, fullTranscript, targetStage }) {
  const stageStatus = targetStage.isConfigured 
    ? `${targetStage.stageName} (ID: ${targetStage.stageId})` 
    : `${targetStage.stageName} (⚠️ ID não configurado no .env)`;

  return `🤖 TRIAGEM AUTOMÁTICA DE RESPOSTA/ÁUDIO
━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Classificação: ${analysis.classificacao} ${targetStage.icon || ''}
🎯 Etapa de Destino: ${stageStatus}
💡 Motivo da IA: ${analysis.motivo || 'Sem justificativa'}
📝 Resumo: ${analysis.transcricao_resumida || 'N/A'}

💬 Mensagens/Áudios Analisados:
${fullTranscript || '(Nenhum texto)'}
━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

module.exports = {
  STAGE_DEFINITIONS,
  isValidStageId,
  resolveTargetStage,
  formatAuditNote,
};

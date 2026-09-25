// Estado global da aplicação
let currentConfig = {};
let loadedPipelines = [];

document.addEventListener('DOMContentLoaded', () => {
  initHealthCheck();
  initWebhookUrl();
  initFormControls();
  loadCurrentConfig();
});

/**
 * Verifica o status do servidor
 */
async function initHealthCheck() {
  const dot = document.getElementById('server-status-dot');
  const text = document.getElementById('server-status-text');

  try {
    const res = await fetch('/health');
    if (res.ok) {
      dot.classList.add('online');
      text.textContent = 'Servidor Online';
    } else {
      text.textContent = 'Erro no Servidor';
    }
  } catch (err) {
    text.textContent = 'Desconectado';
  }
}

/**
 * Preenche a URL do Webhook dinamicamente com base no host atual
 */
function initWebhookUrl() {
  const host = window.location.origin;
  const webhookInput = document.getElementById('webhook-url-display');
  webhookInput.value = `${host}/webhook/kommo?lead_id={{lead.id}}`;
}

/**
 * Configura os controles interativos da interface
 */
function initFormControls() {
  // Toggle Password Visibility
  setupPasswordToggle('toggle-token-btn', 'token');
  setupPasswordToggle('toggle-gemini-btn', 'gemini-key');
  setupPasswordToggle('toggle-openai-btn', 'openai-key');

  // Debounce Slider
  const slider = document.getElementById('debounce-slider');
  const sliderText = document.getElementById('debounce-value-text');
  const hiddenTimeout = document.getElementById('buffer-timeout-ms');

  slider.addEventListener('input', (e) => {
    const seconds = e.target.value;
    sliderText.textContent = seconds;
    hiddenTimeout.value = seconds * 1000;
  });

  // Copiar URL do Webhook
  const btnCopy = document.getElementById('btn-copy-webhook');
  btnCopy.addEventListener('click', () => {
    const webhookInput = document.getElementById('webhook-url-display');
    navigator.clipboard.writeText(webhookInput.value).then(() => {
      const copyText = document.getElementById('copy-btn-text');
      const original = copyText.textContent;
      copyText.textContent = 'Copiado! ✓';
      setTimeout(() => { copyText.textContent = original; }, 2000);
      showToast('URL copiada para a área de transferência!', 'success');
    });
  });

  // Botão Testar Conexão & Carregar Funis
  const btnFetch = document.getElementById('btn-fetch-pipelines');
  btnFetch.addEventListener('click', handleFetchPipelines);

  // Seletor de Funil
  const pipelineSelect = document.getElementById('pipeline-select');
  pipelineSelect.addEventListener('change', (e) => {
    populateStageSelects(e.target.value);
  });

  // Listener das etapas para atualizar pré-visualização de ID
  setupStagePreview('stage-positivo', 'preview-positivo-id');
  setupStagePreview('stage-negativo', 'preview-negativo-id');
  setupStagePreview('stage-humano', 'preview-humano-id');

  // Botão Salvar
  const btnSave = document.getElementById('btn-save');
  btnSave.addEventListener('click', handleSaveConfig);
}

function setupPasswordToggle(btnId, inputId) {
  const btn = document.getElementById(btnId);
  const input = document.getElementById(inputId);
  if (!btn || !input) return;

  btn.addEventListener('click', () => {
    input.type = input.type === 'password' ? 'text' : 'password';
  });
}

function setupStagePreview(selectId, previewId) {
  const select = document.getElementById(selectId);
  const preview = document.getElementById(previewId);
  if (!select || !preview) return;

  select.addEventListener('change', () => {
    const val = select.value;
    preview.textContent = val ? `ID: ${val}` : 'ID: Não selecionado';
  });
}

/**
 * Carrega a configuração salva atual (.env)
 */
async function loadCurrentConfig() {
  try {
    const res = await fetch('/api/config');
    const json = await res.json();
    if (!json.success) return;

    currentConfig = json.data;

    document.getElementById('subdomain').value = currentConfig.KOMMO_SUBDOMAIN || '';
    document.getElementById('token').value = currentConfig.KOMMO_ACCESS_TOKEN || '';
    document.getElementById('gemini-key').value = currentConfig.GEMINI_API_KEY || '';
    document.getElementById('openai-key').value = currentConfig.OPENAI_API_KEY || '';

    // Slider de Debounce
    const timeoutMs = parseInt(currentConfig.BUFFER_TIMEOUT_MS, 10) || 25000;
    const seconds = Math.round(timeoutMs / 1000);
    document.getElementById('debounce-slider').value = seconds;
    document.getElementById('debounce-value-text').textContent = seconds;
    document.getElementById('buffer-timeout-ms').value = timeoutMs;

    // Se já houver credenciais salvas, tenta buscar os funis automaticamente
    if (currentConfig.KOMMO_SUBDOMAIN && currentConfig.KOMMO_ACCESS_TOKEN) {
      await handleFetchPipelines(false);
    }
  } catch (err) {
    console.error('Erro ao carregar configurações:', err);
  }
}

/**
 * Testa a conexão e busca os funis do Kommo
 */
async function handleFetchPipelines(manualClick = true) {
  const btn = document.getElementById('btn-fetch-pipelines');
  const feedback = document.getElementById('connection-feedback');
  const subdomain = document.getElementById('subdomain').value.trim();
  const token = document.getElementById('token').value.trim();

  if (!subdomain || !token) {
    if (manualClick) {
      showToast('Preencha o subdomínio e o Access Token do Kommo.', 'error');
    }
    return;
  }

  btn.classList.add('loading');
  feedback.className = 'feedback-badge hidden';

  try {
    const res = await fetch('/api/kommo/pipelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subdomain, token }),
    });

    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Falha ao buscar funis.');
    }

    loadedPipelines = data.pipelines;

    // Popula o seletor de funis
    const pipelineSelect = document.getElementById('pipeline-select');
    pipelineSelect.innerHTML = '<option value="">-- Selecione o Funil --</option>';

    loadedPipelines.forEach((pipeline, index) => {
      const opt = document.createElement('option');
      opt.value = pipeline.id;
      opt.textContent = `${pipeline.name} (${pipeline.statuses.length} etapas)`;
      pipelineSelect.appendChild(opt);
    });

    // Seleciona o primeiro funil por padrão ou o funil que contenha as etapas atuais
    let selectedPipelineId = loadedPipelines[0]?.id;

    if (currentConfig.STAGE_POSITIVO_ID) {
      const foundPipeline = loadedPipelines.find((p) =>
        p.statuses.some((s) => String(s.id) === String(currentConfig.STAGE_POSITIVO_ID))
      );
      if (foundPipeline) {
        selectedPipelineId = foundPipeline.id;
      }
    }

    if (selectedPipelineId) {
      pipelineSelect.value = selectedPipelineId;
      populateStageSelects(selectedPipelineId);
    }

    feedback.textContent = `✓ Conectado! ${loadedPipelines.length} funis encontrados.`;
    feedback.className = 'feedback-badge success';

    if (manualClick) {
      showToast('Conexão realizada com sucesso! Funis carregados.', 'success');
    }
  } catch (err) {
    feedback.textContent = `✗ ${err.message}`;
    feedback.className = 'feedback-badge error';
    if (manualClick) {
      showToast(err.message, 'error');
    }
  } finally {
    btn.classList.remove('loading');
  }
}

/**
 * Preenche os selects das 3 etapas de acordo com o funil escolhido
 */
function populateStageSelects(pipelineId) {
  const stagePositivo = document.getElementById('stage-positivo');
  const stageNegativo = document.getElementById('stage-negativo');
  const stageHumano = document.getElementById('stage-humano');

  const pipeline = loadedPipelines.find((p) => String(p.id) === String(pipelineId));

  if (!pipeline) {
    const emptyOption = '<option value="">-- Selecione um funil primeiro --</option>';
    stagePositivo.innerHTML = emptyOption;
    stageNegativo.innerHTML = emptyOption;
    stageHumano.innerHTML = emptyOption;
    return;
  }

  function createOptions(currentSelectedId) {
    let html = '<option value="">-- Selecione uma etapa --</option>';
    pipeline.statuses.forEach((status) => {
      const isSelected = String(status.id) === String(currentSelectedId) ? 'selected' : '';
      html += `<option value="${status.id}" ${isSelected}>${status.name}</option>`;
    });
    return html;
  }

  stagePositivo.innerHTML = createOptions(currentConfig.STAGE_POSITIVO_ID);
  stageNegativo.innerHTML = createOptions(currentConfig.STAGE_NEGATIVO_ID);
  stageHumano.innerHTML = createOptions(currentConfig.STAGE_HUMANO_ID);

  // Atualiza os previews
  updatePreview('preview-positivo-id', stagePositivo.value);
  updatePreview('preview-negativo-id', stageNegativo.value);
  updatePreview('preview-humano-id', stageHumano.value);
}

function updatePreview(elementId, value) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = value ? `ID: ${value}` : 'ID: Não selecionado';
  }
}

/**
 * Salva as configurações de volta para o .env via API
 */
async function handleSaveConfig() {
  const btn = document.getElementById('btn-save');
  btn.classList.add('loading');

  const payload = {
    KOMMO_SUBDOMAIN: document.getElementById('subdomain').value.trim(),
    KOMMO_ACCESS_TOKEN: document.getElementById('token').value.trim(),
    GEMINI_API_KEY: document.getElementById('gemini-key').value.trim(),
    OPENAI_API_KEY: document.getElementById('openai-key').value.trim(),
    STAGE_POSITIVO_ID: document.getElementById('stage-positivo').value,
    STAGE_NEGATIVO_ID: document.getElementById('stage-negativo').value,
    STAGE_HUMANO_ID: document.getElementById('stage-humano').value,
    BUFFER_TIMEOUT_MS: document.getElementById('buffer-timeout-ms').value,
  };

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Falha ao salvar configurações.');
    }

    currentConfig = { ...currentConfig, ...payload };
    showToast('Configurações salvas e aplicadas com sucesso!', 'success');

    const statusIndicator = document.getElementById('save-status-indicator');
    statusIndicator.textContent = 'Todas as alterações foram salvas!';
    setTimeout(() => {
      statusIndicator.textContent = '';
    }, 4000);

  } catch (err) {
    showToast(`Erro ao salvar: ${err.message}`, 'error');
  } finally {
    btn.classList.remove('loading');
  }
}

/**
 * Exibe notificação flutuante (Toast)
 */
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;

  setTimeout(() => {
    toast.className = 'toast';
  }, 4000);
}

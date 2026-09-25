require('dotenv').config();
const { getPipelines } = require('../src/services/kommo.service');

async function main() {
  console.log('\n🔍 Conectando à API do Kommo para listar seus Funis e Etapas...\n');

  try {
    const pipelines = await getPipelines();

    pipelines.forEach((pipeline) => {
      console.log(`============================================================`);
      console.log(`📌 FUNIL: "${pipeline.name}" (Pipeline ID: ${pipeline.id})`);
      console.log(`============================================================`);

      const statuses = pipeline._embedded ? pipeline._embedded.statuses : [];
      
      console.log(`\nEtapas disponíveis para preencher no seu .env:`);
      statuses.forEach((status) => {
        console.log(`  • [ID: ${status.id}] -> Etapa: "${status.name}"`);
      });
      console.log('\n');
    });

    console.log(`Copie os IDs correspondentes e cole no seu arquivo .env:`);
    console.log(`STAGE_POSITIVO_ID=...`);
    console.log(`STAGE_NEGATIVO_ID=...`);
    console.log(`STAGE_HUMANO_ID=...\n`);

  } catch (err) {
    console.error('❌ Erro ao consultar funis do Kommo:');
    if (err.response) {
      console.error('Status HTTP:', err.response.status);
      console.error('Detalhes:', err.response.data);
    } else {
      console.error(err.message);
    }
    console.log('\nVerifique se o KOMMO_SUBDOMAIN e KOMMO_ACCESS_TOKEN estão corretos no arquivo .env.');
  }
}

main();

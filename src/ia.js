import * as ImageManipulator from 'expo-image-manipulator';

const SERVIDOR = 'https://edith.lpanissa.workers.dev/chat';

const INSTRUCAO =
  'Esta imagem é uma foto ou print de um fatiador de impressão 3D (Bambu Studio, Bambu Handy, OrcaSlicer, Cura, PrusaSlicer, Creality Print, Anycubic etc.) ou da tela de uma impressora 3D. ' +
  'Encontre o TEMPO TOTAL estimado de impressão e o PESO TOTAL de filamento em gramas. ' +
  'Se houver várias placas ou várias cores, some tudo. Se o filamento aparecer só em metros, converta considerando filamento 1,75 mm de PLA (cerca de 2,98 g por metro). ' +
  'Se aparecer a quantidade de cópias/peças, o total já deve incluir todas. ' +
  'Responda SOMENTE com JSON, sem nenhum outro texto: ' +
  '{"nome":"nome curto da peça ou do arquivo, se aparecer, senão vazio","minutos":numero inteiro de minutos ou null,"gramas":numero total ou null,' +
  '"filamentos":[{"tipo":"PLA, PETG, ABS, TPU etc. como aparecer na tela, ou vazio","cor":"cor do filamento em português (pela amostra de cor ou pelo nome), ou vazio","rolo":"id do rolo do estoque que combina, ou vazio","gramas":numero}],"certeza":"alta" ou "media" ou "baixa"}. ' +
  'Em "filamentos" ponha um item para cada tipo/cor de filamento que aparecer com o peso dele; se não houver detalhe por filamento, ponha um item só com o total.';

// lista de rolos do estoque para a IA escolher pelo tipo e pela cor
const textoRolos = (rolos) =>
  rolos && rolos.length
    ? ' Estoque de rolos do usuário (escolha o mais parecido em tipo e cor para cada filamento e ponha o id em "rolo"; se nenhum combinar, deixe "rolo" vazio): ' +
      JSON.stringify(rolos)
    : '';

export async function lerFoto(uri, senha, rolos = []) {
  const img = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1400 } }], {
    compress: 0.8,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  const headers = { 'content-type': 'application/json' };
  if (senha) headers['x-edith-token'] = senha;
  const r = await fetch(SERVIDOR, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      system: 'Você lê telas de fatiadores de impressão 3D e devolve só JSON com o tempo e os gramas. Nunca invente números.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img.base64 } },
            { type: 'text', text: INSTRUCAO + textoRolos(rolos) },
          ],
        },
      ],
    }),
  });
  if (r.status === 401) throw new Error('senha');
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.text) throw new Error('servidor');
  const t = d.text;
  const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  const ok = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const minutos = ok(j.minutos) ? Math.round(Number(j.minutos)) : null;
  const gramas = ok(j.gramas) ? Number(j.gramas) : null;
  const filamentos = (Array.isArray(j.filamentos) ? j.filamentos : [])
    .filter((f) => f && ok(f.gramas))
    .map((f) => ({
      tipo: String(f.tipo || '').trim().slice(0, 20),
      cor: String(f.cor || '').trim().slice(0, 30),
      rolo: rolos.some((r) => r.id === f.rolo) ? f.rolo : null,
      gramas: Number(f.gramas),
    }));
  if (minutos === null && gramas === null && !filamentos.length) throw new Error('nada');
  return { nome: String(j.nome || '').slice(0, 40), minutos, gramas, filamentos, certeza: j.certeza || 'media' };
}

export const mensagemErro = (e) => {
  const m = e && e.message;
  if (m === 'senha') return 'Senha da EDITH errada. Confira em Ajustes.';
  if (m === 'nada') return 'Não achei tempo nem gramas nessa foto.';
  if (m === 'servidor') return 'O servidor não respondeu. Toque para tentar de novo.';
  return 'Não consegui ler. Toque para tentar de novo.';
};

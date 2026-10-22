import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { LOGO64 } from './logo64';
import { reais, tempoTexto, gramasTexto, dataTexto } from './formato';

const esc = (s) =>
  String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function miniatura(uri) {
  if (!uri) return '';
  try {
    const r = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 240 } }], {
      compress: 0.7,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });
    return 'data:image/jpeg;base64,' + r.base64;
  } catch (e) {
    return '';
  }
}

// "PLA 50 g" (um tipo) ou uma linha por tipo quando a peça usa mais de um
const filamentoHtml = (it) => {
  const fil = it.fil && it.fil.length ? it.fil : [{ nome: '', g: it.g }];
  return fil.map((f) => `${f.nome ? `<span class="tipo">${esc(f.nome)}</span> ` : ''}${gramasTexto(f.g)}`).join('<br/>');
};

export async function enviarOrcamentoPdf(orc, modoHora, impressora = 'Bambu Lab A1 Combo AMS') {
  const fotos = await Promise.all(orc.itens.map((it) => miniatura(it.foto)));
  const linhas = orc.itens
    .map(
      (it, i) => `
      <tr>
        <td class="foto">${fotos[i] ? `<img src="${fotos[i]}"/>` : '<div class="semfoto"></div>'}</td>
        <td><div class="nome">${(it.qtd || 1) > 1 ? `<span class="qtd">${it.qtd}×</span> ` : ''}${esc(it.nome)}</div>${it.ext && it.ext.length ? `<div class="cada">+ ${esc(it.ext.map((e) => `${e.qtd > 1 ? e.qtd + ' ' : ''}${e.nome}`).join(', '))}${(it.qtd || 1) > 1 ? ' (cada)' : ''}</div>` : ''}</td>
        <td class="num">${filamentoHtml(it)}</td>
        <td class="num">${tempoTexto(it.min, modoHora)}</td>
        <td class="num valor">${reais(it.preco)}${(it.qtd || 1) > 1 ? `<div class="cada">${reais(it.unidade)} cada${it.desconto ? ` · desc. ${esc(it.desconto.replace(/^-/, '').replace(' cada', ''))}` : ''}</div>` : it.desconto ? `<div class="cada">desc. ${esc(it.desconto.replace(/^-/, ''))}</div>` : ''}</td>
      </tr>`
    )
    .join('');
  const taxa = orc.taxa
    ? `<tr class="taxa"><td></td><td colspan="3">Taxa do pedido</td><td class="num valor">${reais(orc.taxa)}</td></tr>`
    : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@600;700&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Barlow', Arial, sans-serif; color: #10202f; background: #fff; }
  .topo { background: #fff; padding: 34px 36px 22px; display: flex; align-items: center; gap: 16px; border-bottom: 1px solid #edf1f5; }
  .topo img { width: 62px; height: auto; }
  .marca { font-family: 'Chakra Petch', Arial, sans-serif; font-weight: 700; font-size: 30px; letter-spacing: 1px; line-height: 1; }
  .marca { background: linear-gradient(90deg, #3fd4e6, #f08a3c); -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent; -webkit-text-stroke: 0.7px rgba(7, 11, 18, 0.55); paint-order: stroke fill; display: inline-block; }
  .slogan { color: #3b4b60; font-size: 13px; font-weight: 600; margin-top: 6px; letter-spacing: 2.5px; text-transform: uppercase; }
  .tipo { color: #5b6d85; font-size: 12px; }
  .qtd { color: #5b6d85; font-weight: 700; }
  .cada { color: #5b6d85; font-size: 11px; font-weight: 500; margin-top: 2px; }
  .cab { display: flex; justify-content: space-between; align-items: baseline; }
  .numero { font-family: 'Chakra Petch', Arial, sans-serif; font-size: 18px; font-weight: 700; color: #5b6d85; }
  .condicoes { margin-top: 16px; color: #5b6d85; font-size: 13px; line-height: 1.6; }
  .condicoes b { color: #10202f; }
  .corpo { padding: 28px 36px 40px; }
  h1 { font-family: 'Chakra Petch', Arial, sans-serif; font-size: 24px; margin: 0 0 4px; color: #070b12; }
  .info { color: #5b6d85; font-size: 14px; margin-bottom: 22px; }
  .info b { color: #10202f; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #5b6d85; padding: 8px 6px; border-bottom: 2px solid #dfe7ef; }
  td { padding: 10px 6px; border-bottom: 1px solid #edf1f5; font-size: 14px; vertical-align: middle; }
  td.foto { width: 64px; }
  td.foto img, .semfoto { width: 56px; height: 56px; object-fit: cover; border-radius: 8px; background: #edf1f5; display: block; }
  .nome { font-weight: 600; }
  .num { text-align: right; white-space: nowrap; }
  th.num { text-align: right; }
  .valor { font-weight: 700; }
  tr.taxa td { color: #5b6d85; }
  .total { margin-top: 18px; border-top: 2px solid #dfe7ef; padding: 16px 6px 0; display: flex; justify-content: space-between; align-items: center; }
  .total .r { font-size: 13px; letter-spacing: 2px; text-transform: uppercase; color: #5b6d85; font-weight: 600; }
  .total .v { font-family: 'Chakra Petch', Arial, sans-serif; font-size: 30px; font-weight: 700; color: #070b12; }
  .rodape { margin-top: 26px; color: #93a6bd; font-size: 12px; text-align: center; }
</style></head><body>
  <div class="topo">
    <img src="data:image/png;base64,${LOGO64}"/>
    <div><div class="marca">MATERIALIZZA</div><div class="slogan">Layer by Layer</div></div>
  </div>
  <div class="corpo">
    <div class="cab"><h1>Orçamento</h1>${orc.numero ? `<span class="numero">#${String(orc.numero).padStart(3, '0')}</span>` : ''}</div>
    <div class="info">${orc.cliente ? `Cliente: <b>${esc(orc.cliente)}</b> &nbsp;·&nbsp; ` : ''}Data: <b>${dataTexto(orc.data)}</b>${impressora && impressora.trim() ? `<br/>Impressora: <b>${esc(impressora.trim())}</b>` : ''}</div>
    <table>
      <thead><tr><th></th><th>Peça</th><th class="num">Filamento</th><th class="num">Tempo</th><th class="num">Valor</th></tr></thead>
      <tbody>${linhas}${taxa}</tbody>
    </table>
    <div class="total"><span class="r">Total</span><span class="v">${reais(orc.total)}</span></div>
    ${orc.validade || orc.prazo ? `<div class="condicoes">${orc.prazo ? `Prazo de entrega: <b>${esc(orc.prazo)}</b><br/>` : ''}${orc.validade ? `Orçamento válido por <b>${orc.validade} ${orc.validade === 1 ? 'dia' : 'dias'}</b> (até ${dataTexto(orc.data + orc.validade * 86400000)})` : ''}</div>` : ''}
    <div class="rodape">Materializza · Impressão 3D</div>
  </div>
</body></html>`;

  const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 });
  const nome = ('Orcamento-Materializza' + (orc.cliente ? '-' + orc.cliente : ''))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .slice(0, 60);
  const destino = FileSystem.cacheDirectory + nome + '.pdf';
  try {
    await FileSystem.deleteAsync(destino, { idempotent: true });
    await FileSystem.moveAsync({ from: uri, to: destino });
  } catch (e) {
    return Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Enviar orçamento' });
  }
  return Sharing.shareAsync(destino, { mimeType: 'application/pdf', dialogTitle: 'Enviar orçamento' });
}

// Campos com vírgula automática: o app guarda só os dígitos digitados
// e mostra já formatado (como maquininha de cartão).

export const soDigitos = (t) => String(t || '').replace(/\D/g, '').replace(/^0+/, '').slice(0, 9);

const milhar = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// "2690" -> "26,90"
export function mostrarDecimal(d) {
  if (!d) return '';
  const n = parseInt(d, 10);
  const int = Math.floor(n / 100);
  const dec = String(n % 100).padStart(2, '0');
  return `${milhar(String(int))},${dec}`;
}
export const valorDecimal = (d) => (d ? parseInt(d, 10) / 100 : 0);

// tempo em horas normais: "230" -> "2:30"
export function mostrarHoraNormal(d) {
  if (!d) return '';
  const n = parseInt(d, 10);
  return `${Math.floor(n / 100)}:${String(n % 100).padStart(2, '0')}`;
}

// minutos a partir dos dígitos do tempo, conforme o modo escolhido
export function minutosDe(d, modo) {
  if (!d) return 0;
  const n = parseInt(d, 10);
  if (modo === 'fracionada') return (n / 100) * 60;
  return Math.floor(n / 100) * 60 + (n % 100);
}
// dígitos do tempo a partir de minutos
export function digitosTempo(min, modo) {
  if (min === null || min === undefined || !Number.isFinite(min)) return '';
  const m = Math.round(min);
  if (modo === 'fracionada') return soDigitos(String(Math.round((m / 60) * 100)));
  return soDigitos(String(Math.floor(m / 60) * 100 + (m % 60)));
}
export const digitosDecimal = (v) =>
  v === null || v === undefined || !Number.isFinite(v) ? '' : soDigitos(String(Math.round(v * 100)));

export const mostrarTempoCampo = (d, modo) => (modo === 'fracionada' ? mostrarDecimal(d) : mostrarHoraNormal(d));

// textos para leitura
export const reais = (v) => {
  const c = Math.round((v || 0) * 100);
  return 'R$ ' + milhar(String(Math.floor(c / 100))) + ',' + String(c % 100).padStart(2, '0');
};
export function tempoTexto(min, modo) {
  const m = Math.round(min || 0);
  if (modo === 'fracionada') return `${String((m / 60).toFixed(2)).replace('.', ',')} h`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}min`;
  return r ? `${h}h ${String(r).padStart(2, '0')}min` : `${h}h`;
}
// gramas sempre inteiros: o app guarda em centésimos (compatível com o que já existe) mas mostra e recebe só o número inteiro
export const mostrarGramas = (d) => (d ? String(Math.round(parseInt(d, 10) / 100)) : '');
export const gramasParaDigitos = (d) => {
  const n = soDigitos(d).slice(0, 6);
  return n ? n + '00' : '';
};
export const digitosGramas = (g) => (g === null || g === undefined || !Number.isFinite(g) ? '' : soDigitos(String(Math.round(g) * 100)));

export const gramasTexto = (g) => `${milhar(String(Math.round(g || 0)))} g`;
export const dataTexto = (ts) => {
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

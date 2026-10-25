import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  AppState,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureRef } from 'react-native-view-shot';
import { requireOptionalNativeModule } from 'expo-modules-core';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { useFonts, ChakraPetch_600SemiBold, ChakraPetch_700Bold } from '@expo-google-fonts/chakra-petch';
import { Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold } from '@expo-google-fonts/barlow';

import { C, F } from './src/tema';
import Criar3D from './src/criar3d';
import {
  soDigitos,
  mostrarDecimal,
  valorDecimal,
  mostrarTempoCampo,
  minutosDe,
  digitosTempo,
  digitosDecimal,
  mostrarGramas,
  gramasParaDigitos,
  digitosGramas,
  reais,
  tempoTexto,
  gramasTexto,
  dataTexto,
  novoId,
} from './src/formato';
import { lerFoto, mensagemErro } from './src/ia';
import { enviarOrcamentoPdf } from './src/pdf';

import build from './build.json';

const LOGO = require('./assets/logo.png');
const ATUALIZADOR = requireOptionalNativeModule('PrecoUpdate');

// segura a tela de abertura do Android (fundo escuro com o logo) até a abertura animada assumir
SplashScreen.preventAutoHideAsync().catch(() => {});

// ---------------------------------------------------------------------------
// Dados guardados
// ---------------------------------------------------------------------------
const K_CONFIG = 'preco3d-config-v2';
const K_ITENS = 'preco3d-itens-v2';
const K_PECAS = 'preco3d-pecas';
const K_ORCS = 'preco3d-orcamentos';
const PASTA_FOTOS = FileSystem.documentDirectory + 'fotos/';

// tipos de filamento, cada um com seu preço por grama (R$ 0,26 = '26')
const FIL_PADRAO = [{ id: 'pla', nome: 'PLA', precoD: '26' }];

const CONFIG_PADRAO = {
  filamentos: FIL_PADRAO,
  precoHora: '400', // R$ 4,00
  taxaFixa: '', // R$ 0,00
  falhaD: '', // margem de falha em % ('1000' = 10%)
  faixas: [], // desconto por quantidade: { id, min: '10', tipo: '%' | 'R$', valorD }
  validadeDias: '7', // validade do orçamento no PDF ('' = não mostra)
  proximoNumero: 1, // número do próximo orçamento
  impressora: 'Bambu Lab A1 Combo AMS', // aparece no PDF ('' = não mostra)
  arredD: '50', // arredonda o preço de cada peça para cima até o próximo R$ 0,50 ('' = não arredonda)
  outros: [], // outros materiais cobrados por unidade: { id, nome, precoD }
  modoHora: 'normal', // 'normal' (2:30) ou 'fracionada' (2,50 h)
  senha: '',
};

const tiposDe = (cfg) => (cfg.filamentos && cfg.filamentos.length ? cfg.filamentos : FIL_PADRAO);
const tipoPorId = (cfg, id) => tiposDe(cfg).find((t) => t.id === id) || tiposDe(cfg)[0];
const tipoPorNome = (cfg, nome) => {
  const n = String(nome || '').trim().toLowerCase();
  return (n && tiposDe(cfg).find((t) => t.nome.trim().toLowerCase() === n)) || tiposDe(cfg)[0];
};
const novoFil = (tipo, gD = '', rolo = null) => ({ id: novoId(), tipo, gD, rolo });
// estoque de filamento: cada rolo com tipo, cor, preço pago e peso (o preço por grama sai daí)
const rolosDe = (cfg) => cfg.rolos || [];
const roloPorId = (cfg, id) => (id ? rolosDe(cfg).find((r) => r.id === id) || null : null);
const precoGramaRolo = (r) => {
  const peso = parseInt(r.peso || '1000', 10) || 1000;
  return valorDecimal(r.precoD) / peso;
};
// preço do grama com 3 casas (R$ 0,0999 vira R$ 0,100), para não esconder a diferença entre rolos
const reaisGrama = (v) => 'R$ ' + (v || 0).toFixed(3).replace('.', ',');
// preço do grama de um filamento da peça: do rolo escolhido, ou o padrão do tipo
const precoGramaFil = (f, cfg) => {
  const r = roloPorId(cfg, f.rolo);
  if (r && valorDecimal(r.precoD) > 0) return precoGramaRolo(r);
  return valorDecimal(tipoPorId(cfg, f.tipo).precoD);
};
const nomeFil = (f, cfg) => {
  const r = roloPorId(cfg, f.rolo);
  const t = tipoPorId(cfg, r ? r.tipo : f.tipo).nome || 'Filamento';
  return r && r.cor ? `${t} ${r.cor}` : t;
};
// lista do seletor: cada tipo (preço padrão) seguido dos rolos dele no estoque
const opcoesFilamento = (cfg) =>
  tiposDe(cfg).flatMap((t) => [
    { id: 'T:' + t.id, nome: `${t.nome} (padrão)`, precoTexto: `${reais(valorDecimal(t.precoD))}/g` },
    ...rolosDe(cfg)
      .filter((r) => r.tipo === t.id)
      .map((r) => ({ id: 'R:' + r.id, nome: `${t.nome} ${r.cor || ''}`.trim(), precoTexto: `${reaisGrama(precoGramaRolo(r))}/g`, rolo: true })),
  ]);
const roloPorNome = (cfg, nome) => {
  const n = String(nome || '').trim().toLowerCase();
  return rolosDe(cfg).find((r) => `${tipoPorId(cfg, r.tipo).nome} ${r.cor}`.trim().toLowerCase() === n) || null;
};
// cada peça tem uma lista de filamentos (tipo + gramas)
const filDoItem = (it) => (it.fil && it.fil.length ? it.fil : [{ id: 'f0', tipo: null, gD: it.gD || '' }]);
const gramasDoItem = (it) => filDoItem(it).reduce((a, f) => a + valorDecimal(f.gD), 0);
const qtdDe = (it) => Math.max(1, parseInt(it.qtd || '1', 10) || 1);
const pctTexto = (d) => mostrarDecimal(d).replace(/,00$/, '') + '%';
// a melhor faixa de desconto que a quantidade alcança
const faixaPara = (cfg, qtd) =>
  (cfg.faixas || [])
    .filter((f) => parseInt(f.min || '0', 10) > 0 && parseInt(f.min, 10) <= qtd && valorDecimal(f.valorD) > 0)
    .sort((a, b) => parseInt(b.min, 10) - parseInt(a.min, 10))[0] || null;
// acessórios (argola, ímã, tinta...) cobrados por unidade
const outrosDe = (cfg) => cfg.outros || [];
const matPorId = (cfg, id) => outrosDe(cfg).find((m) => m.id === id) || null;
const matPorNome = (cfg, nome) => {
  const n = String(nome || '').trim().toLowerCase();
  return outrosDe(cfg).find((m) => m.nome.trim().toLowerCase() === n) || null;
};
const extDoItem = (it) => (it.ext || []).filter((e) => e && e.mat);
const custoExtras = (it, cfg) =>
  extDoItem(it).reduce((a, e) => {
    const m = matPorId(cfg, e.mat);
    return a + (m ? valorDecimal(m.precoD) * Math.max(1, parseInt(e.qtd || '1', 10) || 1) : 0);
  }, 0);
// sempre arredonda para cima até o próximo degrau (ex.: R$ 0,50)
const arredondar = (v, cfg) => {
  const passo = parseInt(cfg.arredD || '0', 10);
  if (!passo || v <= 0) return v;
  return (Math.ceil(Math.round(v * 100) / passo - 1e-9) * passo) / 100;
};
// conta de uma peça: (filamento + horas) + margem de falha + materiais + mão de obra,
// desconto por quantidade, arredonda para cima, vezes a quantidade
function contaDoItem(it, cfg) {
  const min = minutosDe(it.tD, cfg.modoHora);
  const filCusto = filDoItem(it).reduce((a, f) => a + valorDecimal(f.gD) * precoGramaFil(f, cfg), 0);
  const base = (filCusto + (min / 60) * valorDecimal(cfg.precoHora)) * (1 + valorDecimal(cfg.falhaD) / 100);
  const cheia = base + custoExtras(it, cfg) + valorDecimal(it.maoD);
  const qtd = qtdDe(it);
  const faixa = faixaPara(cfg, qtd);
  let unidade = cheia;
  let desconto = '';
  if (faixa && faixa.tipo === 'R$') {
    unidade = Math.max(0, cheia - valorDecimal(faixa.valorD));
    desconto = `-${reais(valorDecimal(faixa.valorD))} cada`;
  } else if (faixa) {
    unidade = cheia * (1 - valorDecimal(faixa.valorD) / 100);
    desconto = `-${pctTexto(faixa.valorD)}`;
  }
  unidade = arredondar(unidade, cfg);
  return { min, g: gramasDoItem(it), qtd, unidade, cheia, total: unidade * qtd, desconto };
}
const precoDoItem = (it, cfg) => contaDoItem(it, cfg).total;
const numeroTexto = (n) => '#' + String(n || 0).padStart(3, '0');
// peça salva/orçamento -> filamentos editáveis de novo
const filDeSnapshot = (p, cfg) =>
  (p.fil && p.fil.length ? p.fil : [{ nome: '', g: p.g }]).map((f) => {
    const r = roloPorNome(cfg, f.nome);
    return r ? novoFil(r.tipo, digitosGramas(f.g), r.id) : novoFil(tipoPorNome(cfg, f.nome).id, digitosGramas(f.g));
  });
const extDeSnapshot = (p, cfg) =>
  (p.ext || []).map((e) => ({ id: novoId(), mat: (matPorNome(cfg, e.nome) || {}).id || null, qtd: String(e.qtd || 1) })).filter((e) => e.mat);
const extTexto = (ext) => (ext || []).map((e) => `${e.qtd > 1 ? e.qtd + ' ' : ''}${e.nome}`).join(', ');
const nomesDosTipos = (fil) => [...new Set((fil || []).map((f) => f.nome).filter(Boolean))].join(' + ');

// quando o teclado abre, rola a tela para o campo não ficar escondido atrás dele
function useRolarParaCampo(ativo) {
  const ref = useRef(null);
  const y = useRef(0);
  useEffect(() => {
    if (!ativo) return;
    const sub = Keyboard.addListener('keyboardDidShow', (e) => {
      const campo = TextInput.State.currentlyFocusedInput ? TextInput.State.currentlyFocusedInput() : null;
      if (!campo || !ref.current) return;
      setTimeout(() => {
        try {
          campo.measureInWindow((x, topo, w, h) => {
            const limite = e.endCoordinates.screenY - 24;
            const sobra = topo + h - limite;
            if (sobra > 0 && ref.current) ref.current.scrollTo({ y: y.current + sobra, animated: true });
          });
        } catch (er) {}
      }, 80);
    });
    return () => sub.remove();
  }, [ativo]);
  const onScroll = (ev) => {
    y.current = ev.nativeEvent.contentOffset.y;
  };
  return { ref, onScroll };
}

// foto em tamanho bom e guardada no app (a do celular pode ser apagada depois)
async function guardarFoto(uri) {
  try {
    await FileSystem.makeDirectoryAsync(PASTA_FOTOS, { intermediates: true }).catch(() => {});
    const r = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1200 } }], {
      compress: 0.85,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    const destino = PASTA_FOTOS + novoId() + '.jpg';
    await FileSystem.copyAsync({ from: r.uri, to: destino });
    return destino;
  } catch (e) {
    return uri;
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  const [fontes] = useFonts({
    ChakraPetch_600SemiBold,
    ChakraPetch_700Bold,
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    Barlow_700Bold,
  });

  const [cfg, setCfg] = useState(CONFIG_PADRAO);
  const [itens, setItens] = useState([]);
  const [pecas, setPecas] = useState([]);
  const [orcs, setOrcs] = useState([]);
  const [carregado, setCarregado] = useState(false);

  const [aba, setAba] = useState('calcular');
  const [subAba, setSubAba] = useState('pecas');
  const [ajustes, setAjustes] = useState(false);
  const [cartao, setCartao] = useState(null); // peça a compartilhar como imagem
  const [salvarOrc, setSalvarOrc] = useState(false);
  const [novoOrc, setNovoOrc] = useState(false);
  const [alvoFoto, setAlvoFoto] = useState(null); // { tipo: 'item' | 'peca', id, modo: 'ver' | 'escolher' }
  const [escolhaTipo, setEscolhaTipo] = useState(null); // { itemId, filId }
  const limparDepoisDeSalvar = useRef(false);
  const [aviso, setAviso] = useState('');
  const [novaVersao, setNovaVersao] = useState(false);
  const [atualizando, setAtualizando] = useState('');
  const avisoTimer = useRef(null);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  // ---------------- carregar / guardar ----------------
  useEffect(() => {
    (async () => {
      try {
        const [a, b, c, d] = await Promise.all([
          AsyncStorage.getItem(K_CONFIG),
          AsyncStorage.getItem(K_ITENS),
          AsyncStorage.getItem(K_PECAS),
          AsyncStorage.getItem(K_ORCS),
        ]);
        let conf = CONFIG_PADRAO;
        if (a) conf = { ...CONFIG_PADRAO, ...JSON.parse(a) };
        else {
          // trazer a senha e os preços da primeira versão do app
          const velho = await AsyncStorage.getItem('preco3d-config');
          if (velho) {
            const v = JSON.parse(velho);
            const dig = (x) => digitosDecimal(parseFloat(String(x || '0').replace(',', '.')) || 0);
            conf = { ...CONFIG_PADRAO, senha: v.senha || '', precoGrama: dig(v.precoGrama), precoHora: dig(v.precoHora), taxaFixa: dig(v.taxaFixa) };
          }
        }
        // versões antigas tinham um preço por grama só: vira o preço do PLA
        if (!conf.filamentos || !conf.filamentos.length || conf.precoGrama) {
          conf = { ...conf, filamentos: conf.filamentos && conf.filamentos.length && !conf.precoGrama ? conf.filamentos : [{ ...FIL_PADRAO[0], precoD: conf.precoGrama || '26' }] };
          delete conf.precoGrama;
        }
        setCfg(conf);
        if (b)
          setItens(
            JSON.parse(b).map((it0) => {
              const it = it0.fil ? it0 : { ...it0, fil: [novoFil(conf.filamentos[0].id, it0.gD || '')] };
              return it.estado === 'lendo' ? { ...it, estado: 'erro', erro: 'Leitura interrompida. Toque para tentar de novo.' } : it;
            })
          );
        if (c) setPecas(JSON.parse(c));
        if (d) setOrcs(JSON.parse(d));
      } catch (e) {}
      setCarregado(true);
    })();
  }, []);

  useEffect(() => {
    if (carregado) AsyncStorage.setItem(K_CONFIG, JSON.stringify(cfg)).catch(() => {});
  }, [cfg, carregado]);
  useEffect(() => {
    if (carregado) AsyncStorage.setItem(K_ITENS, JSON.stringify(itens)).catch(() => {});
  }, [itens, carregado]);
  useEffect(() => {
    if (carregado) AsyncStorage.setItem(K_PECAS, JSON.stringify(pecas)).catch(() => {});
  }, [pecas, carregado]);
  useEffect(() => {
    if (carregado) AsyncStorage.setItem(K_ORCS, JSON.stringify(orcs)).catch(() => {});
  }, [orcs, carregado]);

  // apaga fotos que não são mais usadas em lugar nenhum
  useEffect(() => {
    if (!carregado) return;
    (async () => {
      try {
        const usadas = new Set();
        itens.forEach((i) => i.foto && usadas.add(i.foto));
        pecas.forEach((p) => p.foto && usadas.add(p.foto));
        orcs.forEach((o) => o.itens.forEach((i) => i.foto && usadas.add(i.foto)));
        const arquivos = await FileSystem.readDirectoryAsync(PASTA_FOTOS);
        for (const f of arquivos) {
          if (!usadas.has(PASTA_FOTOS + f)) FileSystem.deleteAsync(PASTA_FOTOS + f, { idempotent: true }).catch(() => {});
        }
      } catch (e) {}
    })();
    // só ao abrir o app
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregado]);

  // procura versão nova ao abrir e sempre que o app volta para a tela
  useEffect(() => {
    const ver = () => {
      if (!ATUALIZADOR) return;
      ATUALIZADOR.verificar(build.sha || 'dev').then((r) => setNovaVersao(!!r)).catch(() => {});
    };
    ver();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && ver());
    return () => sub.remove();
  }, []);

  const atualizar = async () => {
    if (!ATUALIZADOR || atualizando === 'baixando') return;
    setAtualizando('baixando');
    try {
      const r = await ATUALIZADOR.instalar();
      if (r === 'ok') setAtualizando('instalar');
      else if (r === 'permissao') setAtualizando('permissao');
      else setAtualizando('erro');
    } catch (e) {
      setAtualizando('erro');
    }
  };

  const mostrarAviso = (t) => {
    setAviso(t);
    clearTimeout(avisoTimer.current);
    avisoTimer.current = setTimeout(() => setAviso(''), 2400);
  };

  // ---------------- itens do cálculo ----------------
  const mudarItem = (id, campos) => setItens((l) => l.map((it) => (it.id === id ? { ...it, ...campos } : it)));
  const removerItem = (id) => setItens((l) => l.filter((it) => it.id !== id));

  const pronto = (it) => it.estado !== 'lendo' && it.estado !== 'erro';
  const fotoDe = (it, c = cfg) => {
    const min = minutosDe(it.tD, c.modoHora);
    const fil = filDoItem(it).map((f) => ({ nome: nomeFil(f, c), g: valorDecimal(f.gD) }));
    const ext = extDoItem(it)
      .map((e) => ({ nome: (matPorId(c, e.mat) || {}).nome, qtd: Math.max(1, parseInt(e.qtd || '1', 10) || 1) }))
      .filter((e) => e.nome);
    const k = contaDoItem(it, c);
    return {
      id: novoId(), nome: it.nome || 'Peça', foto: it.foto || null, min, g: k.g, fil, ext,
      qtd: k.qtd, unidade: k.unidade, desconto: k.desconto, mao: valorDecimal(it.maoD), preco: k.total, data: Date.now(),
    };
  };

  const total = useMemo(() => {
    let preco = 0, min = 0, g = 0, n = 0;
    for (const it of itens) {
      if (!pronto(it)) continue;
      const k = contaDoItem(it, cfg);
      preco += k.total;
      min += k.min * k.qtd;
      g += k.g * k.qtd;
      n += k.qtd;
    }
    const taxa = n ? valorDecimal(cfg.taxaFixa) : 0;
    return { preco: preco + taxa, taxa, min, g, n };
  }, [itens, cfg]);

  const lendo = itens.some((it) => it.estado === 'lendo');

  // ---------------- fotos ----------------
  const processar = async (novos) => {
    const fila = [...novos];
    const trabalhador = async () => {
      while (fila.length) {
        const it = fila.shift();
        try {
          const c = cfgRef.current;
          const r = await lerFoto(it.foto, c.senha, rolosDe(c).map((ro) => ({ id: ro.id, tipo: tipoPorId(c, ro.tipo).nome, cor: ro.cor })));
          const fil = r.filamentos.length
            ? r.filamentos.map((f) => {
                const ro = roloPorId(c, f.rolo);
                return ro ? novoFil(ro.tipo, digitosGramas(f.gramas), ro.id) : novoFil(tipoPorNome(c, f.tipo).id, digitosGramas(f.gramas));
              })
            : [novoFil(tiposDe(c)[0].id, digitosGramas(r.gramas))];
          mudarItem(it.id, {
            estado: 'ok',
            nome: r.nome || it.nome,
            tD: digitosTempo(r.minutos, c.modoHora),
            fil,
            certeza: r.certeza,
            erro: '',
          });
        } catch (e) {
          mudarItem(it.id, { estado: 'erro', erro: mensagemErro(e) });
        }
      }
    };
    await Promise.all([trabalhador(), trabalhador(), trabalhador()]);
  };

  const adicionarFotos = async (assets) => {
    if (!assets || !assets.length) return;
    const base = itens.length;
    const novos = assets.map((a, i) => ({
      id: novoId(),
      nome: `Peça ${base + i + 1}`,
      tD: '',
      fil: [novoFil(tiposDe(cfg)[0].id)],
      foto: a.uri,
      estado: 'lendo',
      erro: '',
    }));
    setItens((l) => [...l, ...novos]);
    // guarda as fotos no app e depois manda ler
    const guardados = await Promise.all(novos.map(async (n) => ({ ...n, foto: await guardarFoto(n.foto) })));
    guardados.forEach((g) => mudarItem(g.id, { foto: g.foto }));
    processar(guardados);
  };

  const precisaSenha = () => {
    if (cfg.senha) return false;
    mostrarAviso('Coloque a senha da EDITH em Ajustes para ler fotos.');
    setAjustes(true);
    return true;
  };

  const escolherFotos = async () => {
    if (precisaSenha()) return;
    const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!p.granted) return mostrarAviso('Sem permissão para abrir as fotos.');
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 20, quality: 1 });
    if (!r.canceled) adicionarFotos(r.assets);
  };

  const tirarFoto = async () => {
    if (precisaSenha()) return;
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) return mostrarAviso('Sem permissão para usar a câmera.');
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (!r.canceled) adicionarFotos(r.assets);
  };

  const adicionarManual = () =>
    setItens((l) => [...l, { id: novoId(), nome: `Peça ${l.length + 1}`, tD: '', fil: [novoFil(tiposDe(cfg)[0].id)], foto: null, estado: 'ok', erro: '' }]);

  // toque na foto: com foto abre ampliada; sem foto abre a escolha galeria/câmera
  // trocar a foto nunca lê os números de novo
  const tocarFoto = (tipo, obj) => setAlvoFoto({ tipo, id: obj.id, modo: obj.foto ? 'ver' : 'escolher' });
  const objDoAlvo = alvoFoto ? (alvoFoto.tipo === 'item' ? itens : pecas).find((x) => x.id === alvoFoto.id) || null : null;
  const fotoNoVisor = alvoFoto && alvoFoto.modo === 'ver' ? objDoAlvo : null;
  const mudarFotoDoVisor = (foto) => {
    if (!alvoFoto) return;
    if (alvoFoto.tipo === 'item') mudarItem(alvoFoto.id, { foto });
    else setPecas((l) => l.map((x) => (x.id === alvoFoto.id ? { ...x, foto } : x)));
  };
  const trocarFoto = async (fonte) => {
    const p = fonte === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!p.granted) return mostrarAviso(fonte === 'camera' ? 'Sem permissão para usar a câmera.' : 'Sem permissão para abrir as fotos.');
    const r =
      fonte === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (r.canceled) return;
    mudarFotoDoVisor(await guardarFoto(r.assets[0].uri));
    if (alvoFoto && alvoFoto.modo === 'escolher') setAlvoFoto(null);
  };

  const tentarDeNovo = (it) => {
    if (!it.foto) return;
    mudarItem(it.id, { estado: 'lendo', erro: '' });
    processar([{ ...it }]);
  };

  // ---------------- salvar / compartilhar ----------------
  // marcador: vazio = não salva; cheio = já está nos Salvos. Tocar de novo tira dos Salvos.
  const pecaSalvaDe = (it) => (it.salvoId ? pecas.find((p) => p.id === it.salvoId) : null);
  const salvarPeca = (it) => {
    if (pecaSalvaDe(it)) {
      setPecas((l) => l.filter((p) => p.id !== it.salvoId));
      mudarItem(it.id, { salvoId: null });
      mostrarAviso('Peça tirada dos salvos');
      return;
    }
    const nova = fotoDe(it);
    setPecas((l) => [nova, ...l]);
    mudarItem(it.id, { salvoId: nova.id });
    mostrarAviso('Peça salva');
  };
  const compartilharItem = (it) => setCartao(fotoDe(it));

  const usarPeca = (p) => {
    setItens((l) => [
      ...l,
      { id: novoId(), nome: p.nome, foto: p.foto, tD: digitosTempo(p.min, cfg.modoHora), fil: filDeSnapshot(p, cfg), ext: extDeSnapshot(p, cfg), qtd: String(p.qtd || 1), maoD: digitosDecimal(p.mao || 0), estado: 'ok', erro: '' },
    ]);
    setAba('calcular');
    mostrarAviso('Peça adicionada ao cálculo');
  };

  const guardarOrcamento = async (cliente, enviar, prazo) => {
    const lista = itens.filter(pronto).map((it) => fotoDe(it));
    const numero = cfg.proximoNumero || orcs.reduce((m, o) => Math.max(m, o.numero || 0), 0) + 1;
    const orc = {
      id: novoId(), numero, status: 'aberto', cliente: cliente.trim(), prazo: (prazo || '').trim(),
      validade: parseInt(cfg.validadeDias || '0', 10) || 0, data: Date.now(), itens: lista, taxa: total.taxa, total: total.preco,
    };
    setCfg((c) => ({ ...c, proximoNumero: numero + 1 }));
    setOrcs((l) => [orc, ...l]);
    setSalvarOrc(false);
    if (limparDepoisDeSalvar.current) {
      limparDepoisDeSalvar.current = false;
      setItens([]);
    }
    if (enviar) await enviarPdf(orc);
    else mostrarAviso('Orçamento salvo');
  };

  const enviarPdf = async (orc) => {
    try {
      mostrarAviso('Gerando PDF...');
      await enviarOrcamentoPdf(orc, cfg.modoHora, cfg.impressora);
    } catch (e) {
      mostrarAviso('Não consegui gerar o PDF.');
    }
  };

  const abrirOrcamento = (o) => {
    setItens(
      o.itens.map((p) => ({ id: novoId(), nome: p.nome, foto: p.foto, tD: digitosTempo(p.min, cfg.modoHora), fil: filDeSnapshot(p, cfg), ext: extDeSnapshot(p, cfg), qtd: String(p.qtd || 1), maoD: digitosDecimal(p.mao || 0), estado: 'ok', erro: '' }))
    );
    setAba('calcular');
    mostrarAviso('Orçamento aberto no cálculo');
  };

  // botão + : começa um orçamento do zero
  const tocarNovo = () => {
    setAba('calcular');
    if (!itens.length) return mostrarAviso('Pronto para um orçamento novo');
    setNovoOrc(true);
  };
  const comecarNovo = (salvarAntes) => {
    setNovoOrc(false);
    if (salvarAntes) {
      limparDepoisDeSalvar.current = true;
      setSalvarOrc(true);
    } else {
      setItens([]);
      mostrarAviso('Orçamento novo');
    }
  };

  const escolherTipo = (tipoId) => {
    if (!escolhaTipo) return;
    const it = itens.find((x) => x.id === escolhaTipo.itemId);
    if (it && escolhaTipo.extId) mudarItem(it.id, { ext: extDoItem(it).map((e) => (e.id === escolhaTipo.extId ? { ...e, mat: tipoId } : e)) });
    else if (it) {
      const ro = String(tipoId).startsWith('R:') ? roloPorId(cfg, tipoId.slice(2)) : null;
      const novo = ro ? { tipo: ro.tipo, rolo: ro.id } : { tipo: String(tipoId).slice(2), rolo: null };
      mudarItem(it.id, { fil: filDoItem(it).map((f) => (f.id === escolhaTipo.filId ? { ...f, ...novo } : f)) });
    }
    setEscolhaTipo(null);
  };
  const adicionarMaterial = (it) => {
    if (!outrosDe(cfg).length) {
      mostrarAviso('Cadastre seus acessórios na aba Materiais');
      setAba('materiais');
      return;
    }
    mudarItem(it.id, { ext: [...extDoItem(it), { id: novoId(), mat: outrosDe(cfg)[0].id, qtd: '1' }] });
  };

  const copiar = async () => {
    await Clipboard.setStringAsync(reais(total.preco));
    mostrarAviso('Valor copiado');
  };

  // trocar entre horas normais e fracionadas converte o que já foi digitado
  const salvarAjustes = (novo) => {
    if (novo.modoHora !== cfg.modoHora) {
      setItens((l) => l.map((it) => ({ ...it, tD: digitosTempo(minutosDe(it.tD, cfg.modoHora), novo.modoHora) })));
    }
    setCfg(novo);
  };

  const algumModal = ajustes || salvarOrc || !!alvoFoto || !!cartao || novoOrc || !!escolhaTipo;
  const rolagem = useRolarParaCampo(!algumModal);

  const pronto0 = carregado && !!fontes;

  return (
    <View style={s.tela} onLayout={() => SplashScreen.hideAsync().catch(() => {})}>
      {pronto0 ? (
      <>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {/* topo */}
        <View style={s.topo}>
          <View style={s.marca}>
            <Image source={LOGO} style={s.logo} />
            <View>
              <Marca tamanho={20} />
              <Text style={s.subMarca}>Preço de impressão 3D</Text>
            </View>
          </View>
          <Pressable onPress={() => setAjustes(true)} hitSlop={12} style={s.botaoIcone}>
            <Ionicons name="settings-sharp" size={21} color={C.suave} />
          </Pressable>
        </View>

        {novaVersao ? (
          <Pressable onPress={atualizar} style={({ pressed }) => [s.atualizacao, pressed && { opacity: 0.8 }]}>
            <Ionicons name="cloud-download" size={20} color={C.fundo} />
            <View style={{ flex: 1 }}>
              <Text style={s.atualizacaoTitulo}>
                {atualizando === 'baixando'
                  ? 'Baixando a versão nova...'
                  : atualizando === 'instalar'
                  ? 'Toque em Atualizar na tela do Android'
                  : atualizando === 'permissao'
                  ? 'Permita instalar apps e toque aqui de novo'
                  : atualizando === 'erro'
                  ? 'Não deu para baixar. Toque para tentar de novo'
                  : 'Versão nova disponível'}
              </Text>
              {!atualizando ? <Text style={s.atualizacaoSub}>Toque para baixar e atualizar</Text> : null}
            </View>
            {atualizando === 'baixando' ? <ActivityIndicator color={C.fundo} /> : <Ionicons name="chevron-forward" size={18} color={C.fundo} />}
          </Pressable>
        ) : null}

        {/* abas */}
        <View style={s.abas}>
          <Aba texto="Calcular" ativa={aba === 'calcular'} onPress={() => setAba('calcular')} />
          <Aba texto={`Salvos${pecas.length + orcs.length ? ` (${pecas.length + orcs.length})` : ''}`} ativa={aba === 'salvos'} onPress={() => setAba('salvos')} />
          <Aba texto="Materiais" ativa={aba === 'materiais'} onPress={() => setAba('materiais')} />
          <Aba texto="Criar 3D" ativa={aba === 'criar3d'} onPress={() => setAba('criar3d')} />
        </View>

        <ScrollView
          ref={rolagem.ref}
          onScroll={rolagem.onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={s.conteudo}
          keyboardShouldPersistTaps="handled"
        >
          {aba === 'criar3d' ? (
            <Criar3D senha={cfg.senha} aviso={mostrarAviso} />
          ) : aba === 'materiais' ? (
            <Materiais cfg={cfg} setCfg={setCfg} />
          ) : aba === 'calcular' ? (
            <>
              {/* total */}
              <View style={s.total}>
                <Faixa estilo={s.faixa} />
                <Text style={s.rotulo}>TOTAL</Text>
                <Text style={s.totalValor}>{reais(total.preco)}</Text>
                <View style={s.linhaResumo}>
                  <Resumo icone="layers" texto={`${total.n} ${total.n === 1 ? 'peça' : 'peças'}`} />
                  <Resumo icone="time" texto={tempoTexto(total.min, cfg.modoHora)} />
                  <Resumo icone="scale" texto={gramasTexto(total.g)} />
                </View>
                {lendo ? (
                  <View style={s.lendoLinha}>
                    <ActivityIndicator size="small" color={C.ciano} />
                    <Text style={s.lendoTexto}>Lendo fotos... o total atualiza sozinho</Text>
                  </View>
                ) : null}
                <View style={s.linhaBotoes}>
                  <Botao icone="document-text" texto="Orçamento PDF" cor={C.laranja} fundo={C.laranjaEscuro} desligado={!total.n} onPress={() => setSalvarOrc(true)} />
                  <Botao icone="copy" texto="Copiar valor" cor={C.ciano} fundo={C.cianoEscuro} desligado={!total.n} onPress={copiar} />
                </View>
              </View>

              {/* ações */}
              <View style={s.acoes}>
                <Acao icone="images" texto="Fotos" onPress={escolherFotos} principal />
                <Acao icone="camera" texto="Câmera" onPress={tirarFoto} />
                <Acao icone="create" texto="Digitar" onPress={adicionarManual} />
              </View>

              {itens.length === 0 ? (
                <Vazio
                  icone="cube-outline"
                  titulo="Nenhuma peça ainda"
                  texto="Escolha uma ou várias fotos da tela do fatiador e o app lê o tempo e os gramas de cada uma e soma tudo. Ou toque em Digitar para colocar os números à mão."
                />
              ) : (
                itens.map((it) => (
                  <Item
                    key={it.id}
                    it={it}
                    cfg={cfg}
                    onChange={(c) => mudarItem(it.id, c)}
                    onRemove={() => removerItem(it.id)}
                    onRetry={() => tentarDeNovo(it)}
                    onSalvar={() => salvarPeca(it)}
                    salvo={!!pecaSalvaDe(it)}
                    onCompartilhar={() => compartilharItem(it)}
                    onFoto={() => tocarFoto('item', it)}
                    onEscolherTipo={(filId) => setEscolhaTipo({ itemId: it.id, filId })}
                    onEscolherMaterial={(extId) => setEscolhaTipo({ itemId: it.id, extId })}
                    onAdicionarMaterial={() => adicionarMaterial(it)}
                  />
                ))
              )}

              {itens.length > 0 ? (
                <ConfirmarApagar texto="Limpar cálculo" onConfirmar={() => setItens([])} estilo={s.limpar} />
              ) : null}
            </>
          ) : (
            <>
              <View style={s.segmento}>
                <Segmento texto={`Peças (${pecas.length})`} ativo={subAba === 'pecas'} onPress={() => setSubAba('pecas')} />
                <Segmento texto={`Orçamentos (${orcs.length})`} ativo={subAba === 'orcamentos'} onPress={() => setSubAba('orcamentos')} />
              </View>

              {subAba === 'pecas' ? (
                pecas.length === 0 ? (
                  <Vazio icone="bookmark-outline" titulo="Nenhuma peça salva" texto="No cálculo, toque no marcador de uma peça para guardar ela aqui." />
                ) : (
                  pecas.map((p) => (
                    <PecaSalva
                      key={p.id}
                      p={p}
                      modo={cfg.modoHora}
                      onCompartilhar={() => setCartao(p)}
                      onFoto={() => tocarFoto('peca', p)}
                      onUsar={() => usarPeca(p)}
                      onApagar={() => setPecas((l) => l.filter((x) => x.id !== p.id))}
                    />
                  ))
                )
              ) : orcs.length === 0 ? (
                <Vazio icone="document-text-outline" titulo="Nenhum orçamento salvo" texto="No cálculo, toque em Orçamento PDF para salvar e enviar para o cliente." />
              ) : (
                [<ResumoMes key="resumo" orcs={orcs} />].concat(orcs.map((o) => (
                  <OrcamentoSalvo
                    key={o.id}
                    o={o}
                    onPdf={() => enviarPdf(o)}
                    onAbrir={() => abrirOrcamento(o)}
                    onApagar={() => setOrcs((l) => l.filter((x) => x.id !== o.id))}
                    onStatus={(st) => setOrcs((l) => l.map((x) => (x.id === o.id ? { ...x, status: st } : x)))}
                  />
                )))
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Pressable onPress={tocarNovo} style={({ pressed }) => [s.fab, pressed && { transform: [{ scale: 0.94 }] }]}>
        <View style={s.fabFundo}>
          <Ionicons name="add" size={32} color={C.fundo} />
        </View>
      </Pressable>

      {aviso ? (
        <View style={s.aviso} pointerEvents="none">
          <Text style={s.avisoTexto}>{aviso}</Text>
        </View>
      ) : null}

      <Ajustes visivel={ajustes} cfg={cfg} onFechar={() => setAjustes(false)} onSalvar={salvarAjustes} />
      <CompartilharImagem peca={cartao} modo={cfg.modoHora} onFechar={() => setCartao(null)} onErro={() => mostrarAviso('Não consegui gerar a imagem.')} />
      <SalvarOrcamento
        visivel={salvarOrc}
        total={total}
        onFechar={() => {
          limparDepoisDeSalvar.current = false;
          setSalvarOrc(false);
        }}
        onGuardar={guardarOrcamento}
      />
      <VisorFoto
        peca={fotoNoVisor}
        onFechar={() => setAlvoFoto(null)}
        onTrocar={trocarFoto}
        onRemover={() => {
          mudarFotoDoVisor(null);
          setAlvoFoto(null);
        }}
      />
      <EscolherFoto visivel={!!alvoFoto && alvoFoto.modo === 'escolher'} onFechar={() => setAlvoFoto(null)} onEscolher={trocarFoto} />
      <EscolherTipo
        visivel={!!escolhaTipo}
        titulo={escolhaTipo && escolhaTipo.extId ? 'Acessório' : 'Tipo de filamento'}
        sufixo={escolhaTipo && escolhaTipo.extId ? '/un.' : '/g'}
        tipos={escolhaTipo && escolhaTipo.extId ? outrosDe(cfg) : opcoesFilamento(cfg)}
        atual={
          escolhaTipo
            ? escolhaTipo.extId
              ? (extDoItem(itens.find((x) => x.id === escolhaTipo.itemId) || {}).find((e) => e.id === escolhaTipo.extId) || {}).mat
              : (() => {
                  const f = filDoItem(itens.find((x) => x.id === escolhaTipo.itemId) || {}).find((x) => x.id === escolhaTipo.filId) || {};
                  return f.rolo && roloPorId(cfg, f.rolo) ? 'R:' + f.rolo : 'T:' + f.tipo;
                })()
            : null
        }
        onEscolher={escolherTipo}
        onFechar={() => setEscolhaTipo(null)}
      />
      <NovoOrcamento visivel={novoOrc} n={itens.length} onFechar={() => setNovoOrc(false)} onEscolher={comecarNovo} />
      </>
      ) : null}
      <Abertura pronto={pronto0} fontes={!!fontes} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Abertura: o bico imprime o cubo camada por camada (vai e volta enquanto o cubo cresce
// de baixo para cima), para no lugar dele no logo, e o nome em degradê sobe
// ---------------------------------------------------------------------------
const AB = 176; // tamanho do logo na abertura
const AB_ESC = AB / 512; // as medidas abaixo são na imagem de 512 px
const AB_BASE = 490; // fundo do cubo
const AB_TOPO = 60; // topo do cubo
const AB_PONTA = 172; // ponta do bico na posição final
function Abertura({ pronto, fontes }) {
  const imp = useRef(new Animated.Value(0)).current; // 0 = nada impresso, 1 = cubo pronto
  const vai = useRef(new Animated.Value(0)).current; // vai e volta do bico (-1 a 1)
  const nome = useRef(new Animated.Value(0)).current;
  const sair = useRef(new Animated.Value(1)).current;
  const [animou, setAnimou] = useState(false);
  const [fim, setFim] = useState(false);

  useEffect(() => {
    const passo = (v) => Animated.timing(vai, { toValue: v, duration: 190, easing: Easing.inOut(Easing.quad), useNativeDriver: true });
    Animated.sequence([
      Animated.parallel([
        Animated.timing(imp, { toValue: 1, duration: 1700, easing: Easing.linear, useNativeDriver: false }),
        Animated.sequence([Animated.loop(Animated.sequence([passo(1), passo(-1)]), { iterations: 4 }), passo(0)]),
      ]),
      Animated.timing(nome, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start(() => setAnimou(true));
  }, []);

  useEffect(() => {
    if (!animou || !pronto) return;
    Animated.timing(sair, { toValue: 0, duration: 350, delay: 150, useNativeDriver: true }).start(() => setFim(true));
  }, [animou, pronto]);

  if (fim) return null;
  const ondeFica = (AB_BASE - AB_PONTA) / (AB_BASE - AB_TOPO); // momento em que o bico chega na posição final
  return (
    <Animated.View pointerEvents={pronto && animou ? 'none' : 'auto'} style={[StyleSheet.absoluteFill, s.abertura, { opacity: sair }]}>
      <View style={{ width: AB, height: AB, marginBottom: 18 }}>
        {/* cubo aparecendo de baixo para cima */}
        <Animated.View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            overflow: 'hidden',
            height: imp.interpolate({ inputRange: [0, 1], outputRange: [(512 - AB_BASE) * AB_ESC, AB] }),
          }}
        >
          <Image source={require('./assets/abertura-cubo.png')} style={{ position: 'absolute', bottom: 0, width: AB, height: AB }} />
        </Animated.View>
        {/* bico em cima da camada que está sendo impressa */}
        <Animated.Image
          source={require('./assets/abertura-bico.png')}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: AB,
            height: AB,
            transform: [
              { translateX: vai.interpolate({ inputRange: [-1, 1], outputRange: [-AB * 0.24, AB * 0.24] }) },
              { translateY: imp.interpolate({ inputRange: [0, ondeFica, 1], outputRange: [(AB_BASE - AB_PONTA) * AB_ESC, 0, 0] }) },
            ],
          }}
        />
      </View>
      <Animated.View style={{ alignItems: 'center', opacity: nome, transform: [{ translateY: nome.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
        {fontes ? <Marca tamanho={32} /> : <Text style={[s.aberturaNome]}>MATERIALIZZA</Text>}
        <Text style={s.aberturaSlogan}>LAYER BY LAYER</Text>
      </Animated.View>
      <View style={s.aberturaTrilho}>
        <Animated.View style={{ height: 3, width: imp.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }), overflow: 'hidden' }}>
          <LinearGradient colors={[C.ciano, C.laranja]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: 180, height: 3 }} />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Peças pequenas
// ---------------------------------------------------------------------------
// nome da loja em degradê contínuo do ciano para o laranja (igual ao site)
function Marca({ tamanho }) {
  const estilo = { fontFamily: F.titulo, fontSize: tamanho, letterSpacing: 1, lineHeight: tamanho * 1.15 };
  return (
    <MaskedView maskElement={<Text style={estilo}>MATERIALIZZA</Text>}>
      <LinearGradient colors={[C.ciano, C.laranja]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
        <Text style={[estilo, { opacity: 0 }]}>MATERIALIZZA</Text>
      </LinearGradient>
    </MaskedView>
  );
}

function Faixa({ estilo }) {
  return <LinearGradient colors={[C.ciano, C.laranja]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={estilo} />;
}

function Aba({ texto, ativa, onPress }) {
  return (
    <Pressable onPress={onPress} style={[s.aba, ativa && s.abaAtiva]}>
      <Text style={[s.abaTexto, ativa && { color: C.texto }]}>{texto}</Text>
    </Pressable>
  );
}

function Segmento({ texto, ativo, onPress }) {
  return (
    <Pressable onPress={onPress} style={[s.segItem, ativo && s.segAtivo]}>
      <Text style={[s.segTexto, ativo && { color: C.fundo }]}>{texto}</Text>
    </Pressable>
  );
}

function Resumo({ icone, texto }) {
  return (
    <View style={s.resumo}>
      <Ionicons name={icone} size={13} color={C.ciano} />
      <Text style={s.resumoTexto}>{texto}</Text>
    </View>
  );
}

function Botao({ icone, texto, cor, fundo, onPress, desligado }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={desligado}
      style={({ pressed }) => [s.botao, { backgroundColor: fundo }, desligado && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={icone} size={16} color={cor} />
      <Text style={[s.botaoTexto, { color: cor }]}>{texto}</Text>
    </Pressable>
  );
}

function Acao({ icone, texto, onPress, principal }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.acao, principal && s.acaoPrincipal, pressed && { opacity: 0.75 }]}>
      <Ionicons name={icone} size={20} color={principal ? C.fundo : C.texto} />
      <Text style={[s.acaoTexto, principal && { color: C.fundo }]}>{texto}</Text>
    </Pressable>
  );
}

function IconeBotao({ nome, cor = C.suave, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => [s.iconeBotao, pressed && { opacity: 0.6 }]}>
      <Ionicons name={nome} size={18} color={cor} />
    </Pressable>
  );
}

// apagar com dois toques: o primeiro pergunta, o segundo apaga
function ConfirmarApagar({ texto, onConfirmar, estilo, soIcone, compacto }) {
  const [armado, setArmado] = useState(false);
  useEffect(() => {
    if (!armado) return;
    const t = setTimeout(() => setArmado(false), 3000);
    return () => clearTimeout(t);
  }, [armado]);
  const tocar = () => (armado ? onConfirmar() : setArmado(true));
  if (soIcone) {
    return (
      <Pressable onPress={tocar} hitSlop={8} style={[s.iconeBotao, compacto && { paddingHorizontal: 2 }, armado && s.apagarArmado]}>
        {armado ? <Text style={s.apagarTexto}>Apagar?</Text> : <Ionicons name="trash" size={18} color={C.fraco} />}
      </Pressable>
    );
  }
  return (
    <Pressable onPress={tocar} style={estilo} hitSlop={8}>
      <Ionicons name="trash" size={15} color={armado ? C.erro : C.fraco} />
      <Text style={[s.limparTexto, armado && { color: C.erro }]}>{armado ? 'Toque de novo para apagar' : texto}</Text>
    </Pressable>
  );
}

function Vazio({ icone, titulo, texto }) {
  return (
    <View style={s.vazio}>
      <Ionicons name={icone} size={40} color={C.fraco} />
      <Text style={s.vazioTitulo}>{titulo}</Text>
      <Text style={s.vazioTexto}>{texto}</Text>
    </View>
  );
}

function Campo({ rotulo, digitos, onDigitos, mostrar, placeholder, sufixo, prefixo, flex = 1, largura }) {
  return (
    <View style={largura ? { width: largura } : { flex }}>
      {rotulo ? <Text style={s.campoRotulo}>{rotulo}</Text> : null}
      <View style={s.campoCaixa}>
        {prefixo ? <Text style={[s.campoSufixo, { marginLeft: 0, marginRight: 6 }]}>{prefixo}</Text> : null}
        <TextInput
          value={mostrar(digitos)}
          onChangeText={(t) => onDigitos(soDigitos(t))}
          keyboardType="number-pad"
          selectTextOnFocus
          placeholder={placeholder}
          placeholderTextColor={C.fraco}
          style={s.campoInput}
        />
        {sufixo ? <Text style={s.campoSufixo}>{sufixo}</Text> : null}
      </View>
    </View>
  );
}

// miniatura da foto: com foto, toque abre ampliada; sem foto, mostra o logo apagadinho e o toque abre galeria/câmera
function Miniatura({ foto, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
      {foto ? (
        <Image source={{ uri: foto }} style={s.miniatura} />
      ) : (
        <View style={[s.miniatura, s.centro, s.miniaturaVazia]}>
          <Image source={LOGO} style={s.miniaturaLogo} />
        </View>
      )}
    </Pressable>
  );
}

function VisorFoto({ peca, onFechar, onTrocar, onRemover }) {
  return (
    <Modal visible={!!peca} animationType="fade" transparent={false} onRequestClose={onFechar}>
      <View style={s.visor}>
        <View style={s.visorTopo}>
          <Text style={s.visorNome} numberOfLines={1}>{peca ? peca.nome : ''}</Text>
          <Pressable onPress={onFechar} hitSlop={12} style={s.visorFechar}>
            <Ionicons name="close" size={24} color={C.texto} />
          </Pressable>
        </View>
        <Pressable style={{ flex: 1 }} onPress={onFechar}>
          {peca && peca.foto ? (
            <Image source={{ uri: peca.foto }} style={{ flex: 1 }} resizeMode="contain" />
          ) : (
            <View style={[{ flex: 1 }, s.centro]}>
              <Image source={LOGO} style={{ width: 120, height: 128, opacity: 0.3 }} />
              <Text style={[s.vazioTexto, { marginTop: 10 }]}>Essa peça ainda não tem foto.</Text>
            </View>
          )}
        </Pressable>
        <View style={s.visorBotoes}>
          <Pressable onPress={() => onTrocar('galeria')} style={({ pressed }) => [s.visorBotao, pressed && { opacity: 0.7 }]}>
            <Ionicons name="images" size={20} color={C.ciano} />
            <Text style={s.visorBotaoTexto}>Galeria</Text>
          </Pressable>
          <Pressable onPress={() => onTrocar('camera')} style={({ pressed }) => [s.visorBotao, pressed && { opacity: 0.7 }]}>
            <Ionicons name="camera" size={20} color={C.ciano} />
            <Text style={s.visorBotaoTexto}>Câmera</Text>
          </Pressable>
          {peca && peca.foto ? (
            <Pressable onPress={onRemover} style={({ pressed }) => [s.visorBotao, pressed && { opacity: 0.7 }]}>
              <Ionicons name="trash" size={20} color={C.erro} />
              <Text style={[s.visorBotaoTexto, { color: C.erro }]}>Apagar</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

// quantidade com - e +; dá para digitar também
function Quantidade({ valor, onMudar }) {
  return (
    <View style={[s.campoCaixa, { paddingHorizontal: 4 }]}>
      <Pressable onPress={() => onMudar(Math.max(1, valor - 1))} hitSlop={6} style={s.qtdBotao}>
        <Ionicons name="remove" size={18} color={valor > 1 ? C.texto : C.fraco} />
      </Pressable>
      <TextInput
        value={String(valor)}
        onChangeText={(t) => onMudar(Math.max(1, parseInt(soDigitos(t) || '1', 10)))}
        keyboardType="number-pad"
        selectTextOnFocus
        style={[s.campoInput, { textAlign: 'center' }]}
      />
      <Pressable onPress={() => onMudar(valor + 1)} hitSlop={6} style={s.qtdBotao}>
        <Ionicons name="add" size={18} color={C.texto} />
      </Pressable>
    </View>
  );
}

function EscolherFoto({ visivel, onFechar, onEscolher }) {
  return (
    <Modal visible={visivel} animationType="slide" transparent onRequestClose={onFechar}>
      <View style={s.modalFundo}>
        <Pressable style={{ flex: 1 }} onPress={onFechar} />
        <View style={s.modal}>
          <View style={s.modalAlca} />
          <Text style={s.modalTitulo}>Foto da peça</Text>
          <View style={[s.visorBotoes, { paddingHorizontal: 0, paddingBottom: 4 }]}>
            <Pressable onPress={() => onEscolher('galeria')} style={({ pressed }) => [s.visorBotao, pressed && { opacity: 0.7 }]}>
              <Ionicons name="images" size={22} color={C.ciano} />
              <Text style={s.visorBotaoTexto}>Galeria</Text>
            </Pressable>
            <Pressable onPress={() => onEscolher('camera')} style={({ pressed }) => [s.visorBotao, pressed && { opacity: 0.7 }]}>
              <Ionicons name="camera" size={22} color={C.ciano} />
              <Text style={s.visorBotaoTexto}>Câmera</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function EscolherTipo({ visivel, titulo, sufixo, tipos, atual, onEscolher, onFechar }) {
  return (
    <Modal visible={visivel} animationType="slide" transparent onRequestClose={onFechar}>
      <View style={s.modalFundo}>
        <Pressable style={{ flex: 1 }} onPress={onFechar} />
        <View style={s.modal}>
          <View style={s.modalAlca} />
          <Text style={s.modalTitulo}>{titulo}</Text>
          <Text style={s.modalSub}>Os nomes e preços ficam na aba Materiais.</Text>
          <ScrollView style={{ marginTop: 12, maxHeight: 420 }}>
            {tipos.map((t) => {
              const sel = t.id === atual || (!atual && t.id === tipos[0].id);
              return (
                <Pressable key={t.id} onPress={() => onEscolher(t.id)} style={({ pressed }) => [s.tipoOpcao, sel && s.tipoOpcaoSel, pressed && { opacity: 0.7 }]}>
                  {t.rolo ? <Ionicons name="ellipse" size={8} color={C.suave} style={{ marginLeft: 8 }} /> : null}
                  <Text style={[s.tipoOpcaoNome, sel && { color: C.ciano }]}>{t.nome || 'Sem nome'}</Text>
                  <Text style={s.tipoOpcaoPreco}>{t.precoTexto || `${reais(valorDecimal(t.precoD))}${sufixo}`}</Text>
                  {sel ? <Ionicons name="checkmark-circle" size={20} color={C.ciano} /> : <View style={{ width: 20 }} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Peça no cálculo
// ---------------------------------------------------------------------------
function Item({ it, cfg, onChange, onRemove, onRetry, onSalvar, salvo, onCompartilhar, onFoto, onEscolherTipo, onEscolherMaterial, onAdicionarMaterial }) {
  const k = contaDoItem(it, cfg);
  const preco = k.total;
  const fil = filDoItem(it);
  const mudarFil = (id, campos) => onChange({ fil: fil.map((f) => (f.id === id ? { ...f, ...campos } : f)), estado: 'ok' });
  const fracionada = cfg.modoHora === 'fracionada';
  const ok = it.estado !== 'lendo' && it.estado !== 'erro';

  return (
    <View style={s.item}>
      <View style={s.itemTopo}>
        <Miniatura foto={it.foto} onPress={it.estado === 'lendo' ? undefined : onFoto} />
        <View style={{ flex: 1 }}>
          <TextInput value={it.nome} onChangeText={(t) => onChange({ nome: t })} style={s.itemNome} placeholder="Nome da peça" placeholderTextColor={C.fraco} />
          {it.estado === 'lendo' ? (
            <View style={s.itemStatus}>
              <ActivityIndicator size="small" color={C.ciano} />
              <Text style={s.itemStatusTexto}>Lendo a foto...</Text>
            </View>
          ) : it.estado === 'erro' ? (
            <Pressable onPress={onRetry} style={s.itemStatus}>
              <Ionicons name="alert-circle" size={15} color={C.erro} />
              <Text style={[s.itemStatusTexto, { color: C.erro, flex: 1 }]}>{it.erro}</Text>
            </Pressable>
          ) : (
            <View>
              <Text style={s.itemPreco}>
                {reais(preco)}
                {it.certeza === 'baixa' ? <Text style={s.itemConfira}>  confira os números</Text> : null}
              </Text>
              {k.qtd > 1 || k.desconto ? (
                <Text style={s.itemDetalhe}>
                  {k.qtd > 1 ? `${k.qtd} × ${reais(k.unidade)}` : ''}
                  {k.desconto ? <Text style={s.itemDesconto}>{`${k.qtd > 1 ? '  ' : ''}${k.desconto}`}</Text> : null}
                </Text>
              ) : null}
            </View>
          )}
        </View>
      </View>

      {it.estado !== 'lendo' ? (
        <>
          {/* tempo à esquerda, filamento(s) à direita */}
          <View style={[s.campos, { alignItems: 'flex-start' }]}>
            <View style={{ flex: 1 }}>
              <Campo
                rotulo={fracionada ? 'Tempo (horas)' : 'Tempo (h:min)'}
                digitos={it.tD}
                onDigitos={(d) => onChange({ tD: d, estado: 'ok' })}
                mostrar={(d) => mostrarTempoCampo(d, cfg.modoHora)}
                placeholder={fracionada ? '0,00' : '0:00'}
                sufixo="h"
              />
            </View>
            <View style={{ flex: 1.45 }}>
              <Text style={s.campoRotulo}>Filamento</Text>
              {fil.map((f, i) => (
                <View key={f.id} style={[s.filLinha, i === fil.length - 1 && { marginBottom: 0 }]}>
                  <Pressable onPress={() => onEscolherTipo(f.id)} style={({ pressed }) => [s.tipoBotao, s.tipoBotaoCurto, pressed && { opacity: 0.7 }]}>
                    <Text style={[s.tipoBotaoTexto, f.rolo && { fontSize: 12 }]} numberOfLines={1}>{nomeFil(f, cfg)}</Text>
                    <Ionicons name="chevron-down" size={13} color={C.suave} />
                  </Pressable>
                  <Campo digitos={f.gD} onDigitos={(d) => mudarFil(f.id, { gD: gramasParaDigitos(d) })} mostrar={mostrarGramas} placeholder="0" sufixo="g" />
                  {fil.length > 1 ? (
                    <Pressable onPress={() => onChange({ fil: fil.filter((x) => x.id !== f.id) })} hitSlop={8} style={s.filTirarCurto}>
                      <Ionicons name="close" size={16} color={C.fraco} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
          {extDoItem(it).length ? <Text style={[s.campoRotulo, { marginTop: 10 }]}>Acessórios</Text> : null}
          {extDoItem(it).map((e) => {
            const m = matPorId(cfg, e.mat);
            const q = Math.max(1, parseInt(e.qtd || '1', 10) || 1);
            const mudarExt = (campos) => onChange({ ext: extDoItem(it).map((x) => (x.id === e.id ? { ...x, ...campos } : x)) });
            return (
              <View key={e.id} style={s.filLinha}>
                <Pressable onPress={() => onEscolherMaterial(e.id)} style={({ pressed }) => [s.tipoBotao, { flex: 1, width: undefined }, pressed && { opacity: 0.7 }]}>
                  <Text style={s.tipoBotaoTexto} numberOfLines={1}>{m ? m.nome : 'Acessório'}</Text>
                  <Ionicons name="chevron-down" size={13} color={C.suave} />
                </Pressable>
                <View style={{ width: 118 }}>
                  <Quantidade valor={q} onMudar={(v) => mudarExt({ qtd: String(v) })} />
                </View>
                <Pressable onPress={() => onChange({ ext: extDoItem(it).filter((x) => x.id !== e.id) })} hitSlop={8} style={s.filTirarCurto}>
                  <Ionicons name="close" size={16} color={C.fraco} />
                </Pressable>
              </View>
            );
          })}
          <View style={s.maisLinha}>
            <Pressable onPress={() => onChange({ fil: [...fil, novoFil(tiposDe(cfg)[0].id)] })} style={s.filMais} hitSlop={6}>
              <Ionicons name="add-circle" size={16} color={C.ciano} />
              <Text style={s.filMaisTexto}>Outro filamento</Text>
            </Pressable>
            <Pressable onPress={onAdicionarMaterial} style={s.filMais} hitSlop={6}>
              <Ionicons name="add-circle" size={16} color={C.ciano} />
              <Text style={s.filMaisTexto}>Acessório</Text>
            </Pressable>
          </View>
          <View style={[s.campos, { marginTop: 10 }]}>
            <View style={{ flex: 1 }}>
              <Text style={s.campoRotulo}>Quantidade</Text>
              <Quantidade valor={k.qtd} onMudar={(q) => onChange({ qtd: String(q) })} />
            </View>
            <Campo rotulo="Mão de obra (cada)" digitos={it.maoD || ''} onDigitos={(d) => onChange({ maoD: d })} mostrar={mostrarDecimal} placeholder="0,00" prefixo="R$" />
          </View>
        </>
      ) : null}

      <View style={s.itemRodape}>
        <IconeBotao nome="share-social" cor={ok ? C.ciano : C.fraco} onPress={ok ? onCompartilhar : undefined} />
        <IconeBotao nome={salvo ? 'bookmark' : 'bookmark-outline'} cor={ok ? C.laranja : C.fraco} onPress={ok ? onSalvar : undefined} />
        <View style={{ flex: 1 }} />
        <ConfirmarApagar soIcone onConfirmar={onRemove} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Salvos
// ---------------------------------------------------------------------------
function PecaSalva({ p, modo, onCompartilhar, onFoto, onUsar, onApagar }) {
  return (
    <View style={s.item}>
      <View style={s.itemTopo}>
        <Miniatura foto={p.foto} onPress={onFoto} />
        <View style={{ flex: 1 }}>
          <Text style={s.itemNome} numberOfLines={1}>{p.nome}</Text>
          <Text style={s.itemPreco}>
            {reais(p.preco)}
            {(p.qtd || 1) > 1 ? <Text style={s.itemConfira}>{`  ${p.qtd} × ${reais(p.unidade)}`}</Text> : null}
          </Text>
          <Text style={s.itemDetalhe}>
            {gramasTexto(p.g)}{nomesDosTipos(p.fil) ? ` ${nomesDosTipos(p.fil)}` : ''} · {tempoTexto(p.min, modo)} · {dataTexto(p.data)}
          </Text>
        </View>
      </View>
      <View style={s.itemRodape}>
        <IconeBotao nome="share-social" cor={C.ciano} onPress={onCompartilhar} />
        <IconeBotao nome="add-circle" cor={C.laranja} onPress={onUsar} />
        <View style={{ flex: 1 }} />
        <ConfirmarApagar soIcone onConfirmar={onApagar} />
      </View>
    </View>
  );
}

// resumo do mês: quanto foi orçado e quanto virou venda
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function ResumoMes({ orcs }) {
  const hoje = new Date();
  const [ref, setRef] = useState({ a: hoje.getFullYear(), m: hoje.getMonth() });
  const doMes = orcs.filter((o) => {
    const d = new Date(o.data);
    return d.getFullYear() === ref.a && d.getMonth() === ref.m;
  });
  const soma = (l) => l.reduce((t, o) => t + (o.total || 0), 0);
  const aprovados = doMes.filter((o) => o.status === 'aprovado');
  const recusados = doMes.filter((o) => o.status === 'recusado');
  const mudar = (d) => setRef((r) => {
    const m = r.m + d;
    return { a: r.a + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
  });
  return (
    <View style={[s.total, { marginBottom: 2 }]}>
      <View style={s.resumoMesTopo}>
        <Pressable onPress={() => mudar(-1)} hitSlop={10}><Ionicons name="chevron-back" size={20} color={C.suave} /></Pressable>
        <Text style={s.resumoMesTitulo}>{MESES[ref.m]} {ref.a}</Text>
        <Pressable onPress={() => mudar(1)} hitSlop={10}><Ionicons name="chevron-forward" size={20} color={C.suave} /></Pressable>
      </View>
      <View style={s.resumoMesLinha}>
        <View style={{ flex: 1 }}>
          <Text style={s.rotulo}>ORÇADO</Text>
          <Text style={s.resumoMesValor}>{reais(soma(doMes))}</Text>
          <Text style={s.itemDetalhe}>{doMes.length} {doMes.length === 1 ? 'orçamento' : 'orçamentos'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.rotulo, { color: C.bom }]}>APROVADO</Text>
          <Text style={[s.resumoMesValor, { color: C.bom }]}>{reais(soma(aprovados))}</Text>
          <Text style={s.itemDetalhe}>{aprovados.length} aprovados · {recusados.length} recusados</Text>
        </View>
      </View>
    </View>
  );
}

const STATUS = [
  { id: 'aberto', nome: 'Aberto', cor: C.ciano },
  { id: 'aprovado', nome: 'Aprovado', cor: C.bom },
  { id: 'recusado', nome: 'Recusado', cor: C.erro },
];

function OrcamentoSalvo({ o, onPdf, onAbrir, onApagar, onStatus }) {
  return (
    <View style={s.item}>
      <View style={s.itemTopo}>
        <View style={[s.miniatura, s.centro, { backgroundColor: C.laranjaEscuro }]}>
          <Ionicons name="document-text" size={22} color={C.laranja} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.itemNome} numberOfLines={1}>
            {o.numero ? <Text style={{ color: C.suave }}>{numeroTexto(o.numero)}  </Text> : null}
            {o.cliente || 'Sem nome do cliente'}
          </Text>
          <Text style={s.itemPreco}>{reais(o.total)}</Text>
          <Text style={s.itemDetalhe}>
            {o.itens.length} {o.itens.length === 1 ? 'peça' : 'peças'} · {dataTexto(o.data)}
          </Text>
        </View>
      </View>
      <View style={s.itemRodape}>
        <IconeBotao nome="share-social" cor={C.ciano} onPress={onPdf} />
        <IconeBotao nome="open" cor={C.laranja} onPress={onAbrir} />
        <View style={s.statusLinha}>
          {STATUS.map((st) => {
            const sel = (o.status || 'aberto') === st.id;
            return (
              <Pressable key={st.id} onPress={() => onStatus(st.id)} hitSlop={4} style={[s.statusChip, sel && { backgroundColor: st.cor + '22', borderColor: st.cor }]}>
                <Text style={[s.statusTexto, sel && { color: st.cor }]}>{st.nome}</Text>
              </Pressable>
            );
          })}
        </View>
        <ConfirmarApagar soIcone onConfirmar={onApagar} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Imagem para compartilhar
// ---------------------------------------------------------------------------
function CompartilharImagem({ peca, modo, onFechar, onErro }) {
  const ref = useRef(null);
  const [ocupado, setOcupado] = useState(false);

  const enviar = async () => {
    setOcupado(true);
    try {
      const uri = await captureRef(ref, { format: 'png', quality: 1, result: 'tmpfile' });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Enviar imagem da peça' });
    } catch (e) {
      onErro();
    }
    setOcupado(false);
  };

  return (
    <Modal visible={!!peca} animationType="fade" transparent onRequestClose={onFechar}>
      <View style={s.modalCentro}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onFechar} />
        {peca ? (
          <View style={{ width: '100%', maxWidth: 420 }}>
            <View ref={ref} collapsable={false} style={s.cartao}>
              <View style={s.cartaoTopo}>
                <Image source={LOGO} style={s.cartaoLogo} />
                <View>
                  <Marca tamanho={18} />
                  <Text style={s.cartaoSlogan}>LAYER BY LAYER</Text>
                </View>
              </View>
              <Faixa estilo={s.faixaLinha} />
              {peca.foto ? <Image source={{ uri: peca.foto }} style={s.cartaoFoto} /> : null}
              <View style={s.cartaoCorpo}>
                <Text style={s.cartaoNome}>{peca.nome}</Text>
                {peca.ext && peca.ext.length ? <Text style={s.cartaoCada}>+ {extTexto(peca.ext)}</Text> : null}
                <View style={s.cartaoLinha}>
                  <View style={s.cartaoDado}>
                    <Ionicons name="scale" size={16} color={C.ciano} />
                    <View>
                      <Text style={s.cartaoRotulo}>FILAMENTO</Text>
                      <Text style={s.cartaoValor}>{gramasTexto(peca.g)}</Text>
                      {nomesDosTipos(peca.fil) ? <Text style={s.cartaoTipos}>{nomesDosTipos(peca.fil)}</Text> : null}
                    </View>
                  </View>
                  <View style={s.cartaoDado}>
                    <Ionicons name="time" size={16} color={C.ciano} />
                    <View>
                      <Text style={s.cartaoRotulo}>TEMPO</Text>
                      <Text style={s.cartaoValor}>{tempoTexto(peca.min, modo)}</Text>
                    </View>
                  </View>
                </View>
                <View style={s.cartaoTotal}>
                  <Text style={s.cartaoRotulo}>{(peca.qtd || 1) > 1 ? `PREÇO TOTAL · ${peca.qtd} UNIDADES` : 'PREÇO TOTAL'}</Text>
                  <Text style={s.cartaoPreco}>{reais(peca.preco)}</Text>
                  {(peca.qtd || 1) > 1 ? (
                    <Text style={s.cartaoCada}>
                      {reais(peca.unidade)} cada{peca.desconto ? `  ·  desconto ${peca.desconto.replace(/^-/, '')}` : ''}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>

            <View style={[s.linhaBotoes, { marginTop: 14 }]}>
              <Pressable onPress={onFechar} style={({ pressed }) => [s.botaoGrande, s.botaoGrandeSec, pressed && { opacity: 0.7 }]}>
                <Text style={[s.botaoGrandeTexto, { color: C.texto }]}>Fechar</Text>
              </Pressable>
              <Pressable onPress={enviar} disabled={ocupado} style={({ pressed }) => [s.botaoGrande, pressed && { opacity: 0.8 }]}>
                {ocupado ? <ActivityIndicator color={C.fundo} /> : <Ionicons name="share-social" size={18} color={C.fundo} />}
                <Text style={s.botaoGrandeTexto}>Compartilhar</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Salvar orçamento
// ---------------------------------------------------------------------------
function SalvarOrcamento({ visivel, total, onFechar, onGuardar }) {
  const [cliente, setCliente] = useState('');
  const [prazo, setPrazo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    if (visivel) {
      setCliente('');
      setPrazo('');
      setOcupado(false);
    }
  }, [visivel]);

  const ir = async (enviar) => {
    setOcupado(true);
    await onGuardar(cliente, enviar, prazo);
    setOcupado(false);
  };

  return (
    <Modal visible={visivel} animationType="slide" transparent onRequestClose={onFechar}>
      <KeyboardAvoidingView style={s.modalFundo} behavior="padding">
        <Pressable style={{ flex: 1 }} onPress={onFechar} />
        <View style={s.modal}>
          <View style={s.modalAlca} />
          <Text style={s.modalTitulo}>Orçamento</Text>
          <Text style={s.modalSub}>
            {total.n} {total.n === 1 ? 'peça' : 'peças'} · {reais(total.preco)}
          </Text>
          <Text style={[s.campoRotulo, { marginTop: 18 }]}>Nome do cliente (opcional)</Text>
          <View style={s.campoCaixa}>
            <Ionicons name="person" size={16} color={C.suave} style={{ marginRight: 8 }} />
            <TextInput
              value={cliente}
              onChangeText={setCliente}
              placeholder="Ex.: João"
              placeholderTextColor={C.fraco}
              style={[s.campoInput, { textAlign: 'left' }]}
            />
          </View>
          <Text style={[s.campoRotulo, { marginTop: 12 }]}>Prazo de entrega (opcional)</Text>
          <View style={s.campoCaixa}>
            <Ionicons name="calendar" size={16} color={C.suave} style={{ marginRight: 8 }} />
            <TextInput
              value={prazo}
              onChangeText={setPrazo}
              placeholder="Ex.: 5 dias úteis"
              placeholderTextColor={C.fraco}
              style={[s.campoInput, { textAlign: 'left' }]}
            />
          </View>
          <View style={[s.linhaBotoes, { marginTop: 22 }]}>
            <Pressable onPress={() => ir(false)} disabled={ocupado} style={({ pressed }) => [s.botaoGrande, s.botaoGrandeSec, pressed && { opacity: 0.7 }]}>
              <Text style={[s.botaoGrandeTexto, { color: C.texto }]}>Só salvar</Text>
            </Pressable>
            <Pressable onPress={() => ir(true)} disabled={ocupado} style={({ pressed }) => [s.botaoGrande, pressed && { opacity: 0.8 }]}>
              {ocupado ? <ActivityIndicator color={C.fundo} /> : <Ionicons name="document-text" size={18} color={C.fundo} />}
              <Text style={s.botaoGrandeTexto}>Salvar e enviar PDF</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Começar orçamento novo quando já tem peças no cálculo
// ---------------------------------------------------------------------------
function NovoOrcamento({ visivel, n, onFechar, onEscolher }) {
  return (
    <Modal visible={visivel} animationType="slide" transparent onRequestClose={onFechar}>
      <View style={s.modalFundo}>
        <Pressable style={{ flex: 1 }} onPress={onFechar} />
        <View style={s.modal}>
          <View style={s.modalAlca} />
          <Text style={s.modalTitulo}>Novo orçamento</Text>
          <Text style={s.modalSub}>
            O cálculo atual tem {n} {n === 1 ? 'peça' : 'peças'}. O que fazer com ele?
          </Text>
          <Pressable onPress={() => onEscolher(true)} style={({ pressed }) => [s.botaoGrande, { marginTop: 20, flex: 0 }, pressed && { opacity: 0.8 }]}>
            <Ionicons name="bookmark" size={18} color={C.fundo} />
            <Text style={s.botaoGrandeTexto}>Salvar e começar novo</Text>
          </Pressable>
          <Pressable onPress={() => onEscolher(false)} style={({ pressed }) => [s.botaoGrande, s.botaoGrandeSec, { marginTop: 10, flex: 0 }, pressed && { opacity: 0.7 }]}>
            <Ionicons name="trash" size={18} color={C.erro} />
            <Text style={[s.botaoGrandeTexto, { color: C.erro }]}>Descartar e começar novo</Text>
          </Pressable>
          <Pressable onPress={onFechar} style={{ alignSelf: 'center', padding: 12, marginTop: 4 }}>
            <Text style={[s.limparTexto, { fontSize: 14 }]}>Cancelar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Materiais: filamentos (por grama) e outros materiais (por unidade)
// ---------------------------------------------------------------------------
function Materiais({ cfg, setCfg }) {
  const fil = tiposDe(cfg);
  const outros = outrosDe(cfg);
  const rolos = rolosDe(cfg);
  const [escolher, setEscolher] = useState(null); // rolo que está escolhendo o tipo
  // blocos fechados ficam guardados (continuam fechados quando abrir o app de novo)
  const fechados = cfg.blocosFechados || {};
  const alternar = (b) => setCfg((c) => ({ ...c, blocosFechados: { ...(c.blocosFechados || {}), [b]: !(c.blocosFechados || {})[b] } }));
  const Titulo = ({ id, texto, resumo }) => (
    <Pressable onPress={() => alternar(id)} style={s.blocoTopo} hitSlop={6}>
      <View style={{ flex: 1 }}>
        <Text style={s.modalTitulo}>{texto}</Text>
        {fechados[id] ? <Text style={s.itemDetalhe}>{resumo}</Text> : null}
      </View>
      <Ionicons name={fechados[id] ? 'chevron-down' : 'chevron-up'} size={22} color={C.suave} />
    </Pressable>
  );
  const mudarRolo = (id, campos) => setCfg((c) => ({ ...c, rolos: rolosDe(c).map((r) => (r.id === id ? { ...r, ...campos } : r)) }));
  const mudar = (lista, id, campos) =>
    setCfg((c) => ({ ...c, [lista]: (lista === 'filamentos' ? tiposDe(c) : outrosDe(c)).map((t) => (t.id === id ? { ...t, ...campos } : t)) }));
  const tirar = (lista, id) =>
    setCfg((c) => ({ ...c, [lista]: (lista === 'filamentos' ? tiposDe(c) : outrosDe(c)).filter((t) => t.id !== id) }));
  const somar = (lista) =>
    setCfg((c) => ({ ...c, [lista]: [...(lista === 'filamentos' ? tiposDe(c) : outrosDe(c)), { id: novoId(), nome: '', precoD: '' }] }));

  const linha = (lista, t, podeTirar, sufixo, exemplo) => (
    <View key={t.id} style={[s.filLinha, { marginTop: 8, gap: 6 }]}>
      <View style={[s.campoCaixa, { flex: 1 }]}>
        <TextInput
          value={t.nome}
          onChangeText={(v) => mudar(lista, t.id, { nome: v })}
          placeholder={exemplo}
          placeholderTextColor={C.fraco}
          autoCapitalize={lista === 'filamentos' ? 'characters' : 'sentences'}
          style={[s.campoInput, { textAlign: 'left', fontSize: 16 }]}
        />
      </View>
      <Campo largura={sufixo === '/g' ? 124 : 134} digitos={t.precoD} onDigitos={(d) => mudar(lista, t.id, { precoD: d })} mostrar={mostrarDecimal} placeholder="0,00" prefixo="R$" sufixo={sufixo} />
      {podeTirar ? (
        <ConfirmarApagar soIcone compacto onConfirmar={() => tirar(lista, t.id)} />
      ) : (
        <View style={{ width: 22 }} />
      )}
    </View>
  );

  return (
    <>
      <View style={s.item}>
        <Titulo id="filamentos" texto="Filamentos" resumo={fil.map((t) => t.nome).filter(Boolean).join(', ')} />
        {fechados.filamentos ? <View style={{ height: 8 }} /> : (
          <>
            <Text style={s.modalSub}>Preço padrão por grama de cada tipo (usado quando a peça não tem rolo do estoque).</Text>
            {fil.map((t) => linha('filamentos', t, fil.length > 1, '/g', 'PLA, PETG...'))}
            <Pressable onPress={() => somar('filamentos')} style={[s.filMais, { marginBottom: 8 }]} hitSlop={6}>
              <Ionicons name="add-circle" size={16} color={C.ciano} />
              <Text style={s.filMaisTexto}>Adicionar filamento</Text>
            </Pressable>
          </>
        )}
      </View>

      <View style={s.item}>
        <Titulo id="estoque" texto="Estoque de filamento" resumo={`${rolos.length} ${rolos.length === 1 ? 'rolo' : 'rolos'}`} />
        {fechados.estoque ? <View style={{ height: 8 }} /> : (
        <>
        <Text style={s.modalSub}>Cada rolo com a cor e o preço que você pagou. Na leitura da foto o app escolhe o rolo pela cor e usa o preço dele.</Text>
        {rolos.length === 0 ? <Text style={[s.itemDetalhe, { marginTop: 10 }]}>Nenhum rolo ainda.</Text> : null}
        {rolos.map((r) => (
          <View key={r.id} style={s.rolo}>
            <View style={[s.filLinha, { gap: 6 }]}>
              <Pressable onPress={() => setEscolher(r.id)} style={({ pressed }) => [s.tipoBotao, { width: 84 }, pressed && { opacity: 0.7 }]}>
                <Text style={s.tipoBotaoTexto} numberOfLines={1}>{tipoPorId(cfg, r.tipo).nome || 'Tipo'}</Text>
                <Ionicons name="chevron-down" size={13} color={C.suave} />
              </Pressable>
              <View style={[s.campoCaixa, { flex: 1 }]}>
                <TextInput
                  value={r.cor}
                  onChangeText={(v) => mudarRolo(r.id, { cor: v })}
                  placeholder="Cor (ex.: Preto)"
                  placeholderTextColor={C.fraco}
                  style={[s.campoInput, { textAlign: 'left', fontSize: 16 }]}
                />
              </View>
              <ConfirmarApagar soIcone compacto onConfirmar={() => setCfg((c) => ({ ...c, rolos: rolosDe(c).filter((x) => x.id !== r.id) }))} />
            </View>
            <View style={[s.filLinha, { gap: 6, marginBottom: 0 }]}>
              <Campo rotulo="Preço pago no rolo" digitos={r.precoD} onDigitos={(d) => mudarRolo(r.id, { precoD: gramasParaDigitos(d) })} mostrar={mostrarGramas} placeholder="130" prefixo="R$" />
              <Campo rotulo="Peso do rolo" digitos={r.peso || ''} onDigitos={(d) => mudarRolo(r.id, { peso: d.slice(0, 5) })} mostrar={(d) => d} placeholder="1000" sufixo="g" />
              <View style={{ width: 70, alignItems: 'flex-end', justifyContent: 'flex-end', alignSelf: 'stretch', paddingBottom: 12 }}>
                <Text style={s.roloGrama}>{valorDecimal(r.precoD) > 0 ? `${reaisGrama(precoGramaRolo(r))}/g` : '—'}</Text>
              </View>
            </View>
          </View>
        ))}
        <Pressable
          onPress={() => setCfg((c) => ({ ...c, rolos: [...rolosDe(c), { id: novoId(), tipo: tiposDe(c)[0].id, cor: '', precoD: '', peso: '1000' }] }))}
          style={[s.filMais, { marginBottom: 8, marginTop: 6 }]}
          hitSlop={6}
        >
          <Ionicons name="add-circle" size={16} color={C.ciano} />
          <Text style={s.filMaisTexto}>Adicionar rolo</Text>
        </Pressable>
        </>
        )}
      </View>

      <EscolherTipo
        visivel={!!escolher}
        titulo="Tipo do rolo"
        sufixo="/g"
        tipos={fil}
        atual={escolher ? (rolos.find((x) => x.id === escolher) || {}).tipo : null}
        onEscolher={(id) => {
          mudarRolo(escolher, { tipo: id });
          setEscolher(null);
        }}
        onFechar={() => setEscolher(null)}
      />

      <View style={s.item}>
        <Titulo id="acessorios" texto="Acessórios" resumo={`${outros.length} ${outros.length === 1 ? 'acessório' : 'acessórios'}`} />
        {fechados.acessorios ? <View style={{ height: 8 }} /> : (
          <>
            <Text style={s.modalSub}>Preço por unidade. No orçamento é só escolher o acessório e a quantidade.</Text>
            {outros.length === 0 ? <Text style={[s.itemDetalhe, { marginTop: 10 }]}>Nenhum acessório ainda.</Text> : null}
            {outros.map((t) => linha('outros', t, true, '/un.', 'Argola de chaveiro'))}
            <Pressable onPress={() => somar('outros')} style={[s.filMais, { marginBottom: 8 }]} hitSlop={6}>
              <Ionicons name="add-circle" size={16} color={C.ciano} />
              <Text style={s.filMaisTexto}>Adicionar acessório</Text>
            </Pressable>
          </>
        )}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------
function Ajustes({ visivel, cfg, onFechar, onSalvar }) {
  const [r, setR] = useState(cfg);
  const [verSenha, setVerSenha] = useState(false);
  const rolagem = useRolarParaCampo(visivel);
  useEffect(() => {
    if (visivel) setR({ ...cfg, filamentos: tiposDe(cfg) });
  }, [visivel]);

  const faixas = r.faixas || [];
  const mudarFaixa = (id, campos) => setR({ ...r, faixas: faixas.map((f) => (f.id === id ? { ...f, ...campos } : f)) });

  const salvar = () => {
    const filamentos = tiposDe(cfg);
    const faixasOk = (r.faixas || []).filter((f) => parseInt(f.min || '0', 10) > 0 && valorDecimal(f.valorD) > 0);
    onSalvar({ ...r, filamentos: filamentos.length ? filamentos : FIL_PADRAO, faixas: faixasOk, senha: String(r.senha || '').trim() });
    onFechar();
  };

  return (
    <Modal visible={visivel} animationType="slide" transparent onRequestClose={onFechar}>
      <KeyboardAvoidingView style={s.modalFundo} behavior="padding">
        <Pressable style={{ flex: 1 }} onPress={onFechar} />
        <View style={s.modal}>
          <View style={s.modalAlca} />
          <ScrollView ref={rolagem.ref} onScroll={rolagem.onScroll} scrollEventThrottle={16} keyboardShouldPersistTaps="handled">
            <Text style={s.modalTitulo}>Seus preços</Text>
            <View style={s.campos}>
              <Campo rotulo="Por hora" digitos={r.precoHora} onDigitos={(d) => setR({ ...r, precoHora: d })} mostrar={mostrarDecimal} placeholder="0,00" prefixo="R$" />
              <Campo rotulo="Taxa por pedido" digitos={r.taxaFixa} onDigitos={(d) => setR({ ...r, taxaFixa: d })} mostrar={mostrarDecimal} placeholder="0,00" prefixo="R$" />
            </View>

            <Text style={[s.modalTitulo, { fontSize: 17, marginTop: 22 }]}>Arredondar preço</Text>
            <Text style={s.modalSub}>O preço de cada peça sobe sempre para o próximo valor redondo.</Text>
            <View style={[s.segmento, { marginTop: 10 }]}>
              {[['', 'Não'], ['10', 'R$ 0,10'], ['50', 'R$ 0,50'], ['100', 'R$ 1,00']].map(([v, t]) => (
                <Segmento key={t} texto={t} ativo={(r.arredD || '') === v} onPress={() => setR({ ...r, arredD: v })} />
              ))}
            </View>

            <Text style={[s.modalTitulo, { fontSize: 17, marginTop: 22 }]}>Margem de falha</Text>
            <Text style={s.modalSub}>Soma uma porcentagem no filamento e nas horas, para cobrir impressão que dá errado. Deixe 0 se não quiser.</Text>
            <View style={[s.campos, { marginTop: 8 }]}>
              <Campo digitos={r.falhaD || ''} onDigitos={(d) => setR({ ...r, falhaD: d })} mostrar={mostrarDecimal} placeholder="0,00" sufixo="%" />
              <View style={{ flex: 1 }} />
            </View>

            <Text style={[s.modalTitulo, { fontSize: 17, marginTop: 22 }]}>Desconto por quantidade</Text>
            <Text style={s.modalSub}>Vale para cada peça: a partir de quantas unidades, quanto de desconto em cada uma.</Text>
            {faixas.map((f) => (
              <View key={f.id} style={[s.filLinha, { marginTop: 8 }]}>
                <Campo digitos={f.min || ''} onDigitos={(d) => mudarFaixa(f.id, { min: d })} mostrar={(d) => d} placeholder="10" prefixo="a partir de" sufixo="un." />
                <Campo digitos={f.valorD || ''} onDigitos={(d) => mudarFaixa(f.id, { valorD: d })} mostrar={mostrarDecimal} placeholder="0,00" prefixo={f.tipo === 'R$' ? 'R$' : undefined} sufixo={f.tipo === 'R$' ? undefined : '%'} />
                <Pressable onPress={() => mudarFaixa(f.id, { tipo: f.tipo === 'R$' ? '%' : 'R$' })} style={s.faixaTipo}>
                  <Text style={s.faixaTipoTexto}>{f.tipo === 'R$' ? 'R$' : '%'}</Text>
                </Pressable>
                <Pressable onPress={() => setR({ ...r, faixas: faixas.filter((x) => x.id !== f.id) })} hitSlop={8} style={s.filTirar}>
                  <Ionicons name="trash" size={17} color={C.fraco} />
                </Pressable>
              </View>
            ))}
            <Pressable onPress={() => setR({ ...r, faixas: [...faixas, { id: novoId(), min: '', tipo: '%', valorD: '' }] })} style={s.filMais} hitSlop={6}>
              <Ionicons name="add-circle" size={16} color={C.ciano} />
              <Text style={s.filMaisTexto}>Adicionar faixa</Text>
            </Pressable>

            <Text style={[s.modalTitulo, { fontSize: 17, marginTop: 22 }]}>Orçamentos</Text>
            <View style={[s.campos, { marginTop: 8 }]}>
              <Campo rotulo="Validade (vazio = não mostra)" digitos={r.validadeDias || ''} onDigitos={(d) => setR({ ...r, validadeDias: d })} mostrar={(d) => d} placeholder="0" sufixo="dias" />
              <Campo rotulo="Próximo número" digitos={String(r.proximoNumero || 1)} onDigitos={(d) => setR({ ...r, proximoNumero: parseInt(d || '1', 10) || 1 })} mostrar={(d) => d} placeholder="1" />
            </View>
            <Text style={[s.campoRotulo, { marginTop: 10 }]}>Impressora (sai no PDF, vazio = não mostra)</Text>
            <View style={s.campoCaixa}>
              <Ionicons name="print" size={16} color={C.suave} style={{ marginRight: 8 }} />
              <TextInput
                value={r.impressora === undefined ? CONFIG_PADRAO.impressora : r.impressora}
                onChangeText={(t) => setR({ ...r, impressora: t })}
                placeholder="Ex.: Bambu Lab A1 Combo AMS"
                placeholderTextColor={C.fraco}
                style={[s.campoInput, { textAlign: 'left', fontSize: 16 }]}
              />
            </View>

            <Text style={[s.modalTitulo, { fontSize: 17, marginTop: 22 }]}>Formato do tempo</Text>
            <View style={[s.segmento, { marginTop: 10 }]}>
              <Segmento texto="Normais  2:30" ativo={r.modoHora !== 'fracionada'} onPress={() => setR({ ...r, modoHora: 'normal' })} />
              <Segmento texto="Fracionadas  2,50" ativo={r.modoHora === 'fracionada'} onPress={() => setR({ ...r, modoHora: 'fracionada' })} />
            </View>
            <Text style={s.modalSub}>
              {r.modoHora === 'fracionada' ? '2,50 h quer dizer duas horas e meia.' : '2:30 quer dizer duas horas e trinta minutos.'}
            </Text>

            <Text style={[s.modalTitulo, { fontSize: 17, marginTop: 22 }]}>Leitura das fotos</Text>
            <Text style={s.modalSub}>Cole aqui a mesma senha que está no app da EDITH.</Text>
            <View style={[s.campoCaixa, { marginTop: 8 }]}>
              <Ionicons name="key" size={16} color={C.suave} style={{ marginRight: 8 }} />
              <TextInput
                value={r.senha}
                onChangeText={(t) => setR({ ...r, senha: t })}
                secureTextEntry={!verSenha}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Senha da EDITH"
                placeholderTextColor={C.fraco}
                style={[s.campoInput, { textAlign: 'left' }]}
              />
              <Pressable onPress={() => setVerSenha(!verSenha)} hitSlop={10}>
                <Ionicons name={verSenha ? 'eye-off' : 'eye'} size={18} color={C.suave} />
              </Pressable>
            </View>

            <Pressable onPress={salvar} style={({ pressed }) => [s.botaoGrande, { marginTop: 24, flex: 0 }, pressed && { opacity: 0.8 }]}>
              <Text style={s.botaoGrandeTexto}>Salvar</Text>
            </Pressable>
            <Text style={s.versao}>Versão {String(build.sha || 'dev').slice(0, 7)}</Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------
const s = StyleSheet.create({
  tela: { flex: 1, backgroundColor: C.fundo },
  abertura: { backgroundColor: C.fundo, alignItems: 'center', justifyContent: 'center' },
  aberturaLogo: { width: 168, height: 168, marginBottom: 18 },
  aberturaNome: { color: C.ciano, fontSize: 30, fontWeight: '800', letterSpacing: 1 },
  aberturaSlogan: { color: C.suave, fontSize: 12, letterSpacing: 4, marginTop: 8, fontWeight: '600' },
  aberturaTrilho: { width: 180, height: 3, borderRadius: 2, backgroundColor: C.cartao2, marginTop: 28, overflow: 'hidden' },
  centro: { alignItems: 'center', justifyContent: 'center' },
  conteudo: { padding: 16, paddingTop: 6, paddingBottom: 110 },
  fab: { position: 'absolute', right: 20, bottom: 28, width: 60, height: 60, borderRadius: 30, elevation: 8 },
  fabFundo: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: C.laranja },

  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 50, paddingBottom: 12 },
  marca: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 40, height: 42, borderRadius: 8 },
  subMarca: { fontFamily: F.textoMedio, color: C.suave, fontSize: 12, letterSpacing: 0.5 },
  botaoIcone: { padding: 6 },

  atualizacao: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 10, backgroundColor: C.laranja, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11 },
  atualizacaoTitulo: { fontFamily: F.textoNegrito, color: C.fundo, fontSize: 14 },
  atualizacaoSub: { fontFamily: F.textoMedio, color: '#3a2414', fontSize: 12 },
  versao: { fontFamily: F.texto, color: C.fraco, fontSize: 12, textAlign: 'center', marginTop: 14 },
  abas: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: C.linha },
  aba: { paddingVertical: 10, marginRight: 18, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  abaAtiva: { borderBottomColor: C.ciano },
  abaTexto: { fontFamily: F.tituloMedio, color: C.fraco, fontSize: 15, letterSpacing: 0.5 },

  segmento: { flexDirection: 'row', backgroundColor: C.cartao, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: C.linha, marginBottom: 6 },
  segItem: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  segAtivo: { backgroundColor: C.ciano },
  segTexto: { fontFamily: F.textoForte, color: C.suave, fontSize: 14 },

  total: { backgroundColor: C.cartao, borderRadius: 18, padding: 20, paddingTop: 22, borderWidth: 1, borderColor: C.linha, overflow: 'hidden' },
  faixa: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  faixaLinha: { height: 3 },
  rotulo: { fontFamily: F.textoNegrito, color: C.suave, fontSize: 12, letterSpacing: 2 },
  totalValor: { fontFamily: F.titulo, color: C.texto, fontSize: 42, marginTop: 2, letterSpacing: -0.5 },
  linhaResumo: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  resumo: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.cartao2, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  resumoTexto: { fontFamily: F.textoForte, color: C.suave, fontSize: 13 },
  lendoLinha: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  lendoTexto: { fontFamily: F.texto, color: C.suave, fontSize: 13 },
  linhaBotoes: { flexDirection: 'row', gap: 10, marginTop: 16 },
  botao: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 12 },
  botaoTexto: { fontFamily: F.textoNegrito, fontSize: 14 },

  acoes: { flexDirection: 'row', gap: 10, marginTop: 14, marginBottom: 4 },
  acao: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 16, backgroundColor: C.cartao, borderWidth: 1, borderColor: C.linha },
  acaoPrincipal: { backgroundColor: C.ciano, borderColor: C.ciano },
  acaoTexto: { fontFamily: F.textoNegrito, color: C.texto, fontSize: 13 },

  vazio: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 },
  vazioTitulo: { fontFamily: F.tituloMedio, color: C.texto, fontSize: 16, marginTop: 12 },
  vazioTexto: { fontFamily: F.texto, color: C.suave, fontSize: 14, textAlign: 'center', marginTop: 6, lineHeight: 20 },

  item: { backgroundColor: C.cartao, borderRadius: 16, padding: 14, paddingBottom: 6, marginTop: 10, borderWidth: 1, borderColor: C.linha },
  itemTopo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  miniatura: { width: 54, height: 54, borderRadius: 10, backgroundColor: C.cartao2 },
  miniaturaLogo: { width: 34, height: 36, opacity: 0.32 },
  miniaturaVazia: { borderWidth: 1, borderColor: C.linha, borderStyle: 'dashed' },
  visor: { flex: 1, backgroundColor: '#000' },
  visorTopo: { flexDirection: 'row', alignItems: 'center', paddingTop: 48, paddingHorizontal: 16, paddingBottom: 10 },
  visorNome: { flex: 1, fontFamily: F.titulo, color: C.texto, fontSize: 18 },
  visorFechar: { padding: 6 },
  visorBotoes: { flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 32 },
  visorBotao: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 14, backgroundColor: C.cartao, borderWidth: 1, borderColor: C.linha },
  visorBotaoTexto: { fontFamily: F.textoNegrito, color: C.texto, fontSize: 12 },
  itemNome: { fontFamily: F.textoNegrito, color: C.texto, fontSize: 16, padding: 0 },
  itemPreco: { fontFamily: F.titulo, color: C.laranja, fontSize: 17, marginTop: 2 },
  itemDetalhe: { fontFamily: F.texto, color: C.suave, fontSize: 13, marginTop: 1 },
  itemConfira: { fontFamily: F.textoMedio, color: C.suave, fontSize: 12 },
  itemStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  itemStatusTexto: { fontFamily: F.texto, color: C.suave, fontSize: 13 },
  itemRodape: { flexDirection: 'row', alignItems: 'center', marginTop: 8, borderTopWidth: 1, borderTopColor: C.linha, paddingTop: 4, marginHorizontal: -4 },
  iconeBotao: { padding: 8, borderRadius: 10, minHeight: 36, justifyContent: 'center' },
  apagarArmado: { backgroundColor: '#3a1a18', paddingHorizontal: 10 },
  apagarTexto: { fontFamily: F.textoNegrito, color: C.erro, fontSize: 13 },

  campos: { flexDirection: 'row', gap: 10, marginTop: 12 },
  qtdBotao: { padding: 8 },
  itemDesconto: { fontFamily: F.textoNegrito, color: C.bom, fontSize: 12 },
  faixaTipo: { backgroundColor: C.cianoEscuro, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  faixaTipoTexto: { fontFamily: F.textoNegrito, color: C.ciano, fontSize: 14 },
  statusLinha: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 4, marginRight: 4 },
  statusChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: C.linha },
  statusTexto: { fontFamily: F.textoForte, color: C.fraco, fontSize: 11 },
  resumoMesTopo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  resumoMesTitulo: { fontFamily: F.tituloMedio, color: C.texto, fontSize: 16, textTransform: 'capitalize' },
  resumoMesLinha: { flexDirection: 'row', gap: 12 },
  resumoMesValor: { fontFamily: F.titulo, color: C.texto, fontSize: 22, marginTop: 2 },
  cartaoCada: { fontFamily: F.textoForte, color: C.suave, fontSize: 12, marginTop: 2 },
  filLinha: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  tipoBotao: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, width: 96, backgroundColor: C.cartao2, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, borderWidth: 1, borderColor: C.linha },
  tipoBotaoTexto: { fontFamily: F.textoNegrito, color: C.texto, fontSize: 14, flexShrink: 1 },
  filTirar: { padding: 6 },
  rolo: { borderTopWidth: 1, borderTopColor: C.linha, paddingTop: 10, marginTop: 10 },
  blocoTopo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  roloGrama: { fontFamily: F.textoNegrito, color: C.ciano, fontSize: 13 },
  maisLinha: { flexDirection: 'row', gap: 18, flexWrap: 'wrap' },
  tipoBotaoCurto: { width: 84, paddingHorizontal: 9 },
  filTirarCurto: { paddingVertical: 6, paddingHorizontal: 0 },
  filMais: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 4 },
  filMaisTexto: { fontFamily: F.textoNegrito, color: C.ciano, fontSize: 13 },
  tipoOpcao: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: C.linha, marginBottom: 8, backgroundColor: C.cartao2 },
  tipoOpcaoSel: { borderColor: C.ciano },
  tipoOpcaoNome: { flex: 1, fontFamily: F.textoNegrito, color: C.texto, fontSize: 15 },
  tipoOpcaoPreco: { fontFamily: F.textoMedio, color: C.suave, fontSize: 13 },
  campoRotulo: { fontFamily: F.textoForte, color: C.suave, fontSize: 12, marginBottom: 5 },
  campoCaixa: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.cartao2, borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: C.linha },
  campoInput: { flex: 1, fontFamily: F.titulo, color: C.texto, fontSize: 18, paddingVertical: 9, textAlign: 'right' },
  campoSufixo: { fontFamily: F.textoForte, color: C.fraco, fontSize: 13, marginLeft: 6 },

  limpar: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginTop: 18, padding: 6 },
  limparTexto: { fontFamily: F.textoForte, color: C.fraco, fontSize: 13 },

  aviso: { position: 'absolute', bottom: 36, left: 16, right: 92, backgroundColor: C.cartao2, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.linha },
  avisoTexto: { fontFamily: F.textoForte, color: C.texto, textAlign: 'center', fontSize: 14 },

  modalFundo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)' },
  modalCentro: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal: { backgroundColor: C.cartao, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 30, borderWidth: 1, borderColor: C.linha, maxHeight: '88%' },
  modalAlca: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.linha, alignSelf: 'center', marginBottom: 16 },
  modalTitulo: { fontFamily: F.titulo, color: C.texto, fontSize: 21 },
  modalSub: { fontFamily: F.texto, color: C.suave, fontSize: 13, marginTop: 6, lineHeight: 18 },
  botaoGrande: { flex: 1, flexDirection: 'row', gap: 8, backgroundColor: C.ciano, borderRadius: 14, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  botaoGrandeSec: { backgroundColor: C.cartao2, borderWidth: 1, borderColor: C.linha, flex: 0.6 },
  botaoGrandeTexto: { fontFamily: F.textoNegrito, color: C.fundo, fontSize: 15 },

  cartao: { backgroundColor: C.fundo, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: C.linha },
  cartaoTopo: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, backgroundColor: C.cartao },
  cartaoLogo: { width: 38, height: 40, borderRadius: 8 },
  cartaoSlogan: { fontFamily: F.textoForte, color: C.suave, fontSize: 10, letterSpacing: 2.5, marginTop: 1 },
  cartaoFoto: { width: '100%', aspectRatio: 1, backgroundColor: C.cartao2 },
  cartaoCorpo: { padding: 18 },
  cartaoNome: { fontFamily: F.titulo, color: C.texto, fontSize: 22 },
  cartaoLinha: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cartaoDado: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.cartao, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.linha },
  cartaoRotulo: { fontFamily: F.textoNegrito, color: C.suave, fontSize: 10, letterSpacing: 1.5 },
  cartaoValor: { fontFamily: F.titulo, color: C.texto, fontSize: 18, marginTop: 1 },
  cartaoTipos: { fontFamily: F.textoForte, color: C.suave, fontSize: 11, marginTop: 1 },
  cartaoTotal: { marginTop: 10, backgroundColor: C.laranjaEscuro, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#5a3418' },
  cartaoPreco: { fontFamily: F.titulo, color: C.laranja, fontSize: 34, marginTop: 2 },
});

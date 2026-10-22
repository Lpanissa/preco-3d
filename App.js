import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import {
  soDigitos,
  mostrarDecimal,
  valorDecimal,
  mostrarTempoCampo,
  minutosDe,
  digitosTempo,
  digitosDecimal,
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
  modoHora: 'normal', // 'normal' (2:30) ou 'fracionada' (2,50 h)
  senha: '',
};

const tiposDe = (cfg) => (cfg.filamentos && cfg.filamentos.length ? cfg.filamentos : FIL_PADRAO);
const tipoPorId = (cfg, id) => tiposDe(cfg).find((t) => t.id === id) || tiposDe(cfg)[0];
const tipoPorNome = (cfg, nome) => {
  const n = String(nome || '').trim().toLowerCase();
  return (n && tiposDe(cfg).find((t) => t.nome.trim().toLowerCase() === n)) || tiposDe(cfg)[0];
};
const novoFil = (tipo, gD = '') => ({ id: novoId(), tipo, gD });
// cada peça tem uma lista de filamentos (tipo + gramas)
const filDoItem = (it) => (it.fil && it.fil.length ? it.fil : [{ id: 'f0', tipo: null, gD: it.gD || '' }]);
const gramasDoItem = (it) => filDoItem(it).reduce((a, f) => a + valorDecimal(f.gD), 0);
const precoDoItem = (it, cfg) =>
  filDoItem(it).reduce((a, f) => a + valorDecimal(f.gD) * valorDecimal(tipoPorId(cfg, f.tipo).precoD), 0) +
  (minutosDe(it.tD, cfg.modoHora) / 60) * valorDecimal(cfg.precoHora);
// peça salva/orçamento -> filamentos editáveis de novo
const filDeSnapshot = (p, cfg) =>
  (p.fil && p.fil.length ? p.fil : [{ nome: '', g: p.g }]).map((f) => novoFil(tipoPorNome(cfg, f.nome).id, digitosDecimal(f.g)));
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
    const fil = filDoItem(it).map((f) => ({ nome: tipoPorId(c, f.tipo).nome, g: valorDecimal(f.gD) }));
    return { id: novoId(), nome: it.nome || 'Peça', foto: it.foto || null, min, g: gramasDoItem(it), fil, preco: precoDoItem(it, c), data: Date.now() };
  };

  const total = useMemo(() => {
    let preco = 0, min = 0, g = 0, n = 0;
    for (const it of itens) {
      if (!pronto(it)) continue;
      preco += precoDoItem(it, cfg);
      min += minutosDe(it.tD, cfg.modoHora);
      g += gramasDoItem(it);
      n++;
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
          const r = await lerFoto(it.foto, c.senha);
          const fil = r.filamentos.length
            ? r.filamentos.map((f) => novoFil(tipoPorNome(c, f.tipo).id, digitosDecimal(f.gramas)))
            : [novoFil(tiposDe(c)[0].id, digitosDecimal(r.gramas))];
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
  const salvarPeca = (it) => {
    setPecas((l) => [fotoDe(it), ...l]);
    mostrarAviso('Peça salva');
  };
  const compartilharItem = (it) => setCartao(fotoDe(it));

  const usarPeca = (p) => {
    setItens((l) => [
      ...l,
      { id: novoId(), nome: p.nome, foto: p.foto, tD: digitosTempo(p.min, cfg.modoHora), fil: filDeSnapshot(p, cfg), estado: 'ok', erro: '' },
    ]);
    setAba('calcular');
    mostrarAviso('Peça adicionada ao cálculo');
  };

  const guardarOrcamento = async (cliente, enviar) => {
    const lista = itens.filter(pronto).map((it) => fotoDe(it));
    const orc = { id: novoId(), cliente: cliente.trim(), data: Date.now(), itens: lista, taxa: total.taxa, total: total.preco };
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
      await enviarOrcamentoPdf(orc, cfg.modoHora);
    } catch (e) {
      mostrarAviso('Não consegui gerar o PDF.');
    }
  };

  const abrirOrcamento = (o) => {
    setItens(
      o.itens.map((p) => ({ id: novoId(), nome: p.nome, foto: p.foto, tD: digitosTempo(p.min, cfg.modoHora), fil: filDeSnapshot(p, cfg), estado: 'ok', erro: '' }))
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
    if (it) mudarItem(it.id, { fil: filDoItem(it).map((f) => (f.id === escolhaTipo.filId ? { ...f, tipo: tipoId } : f)) });
    setEscolhaTipo(null);
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

  if (!carregado || !fontes) {
    return (
      <View style={[s.tela, s.centro]}>
        <ActivityIndicator color={C.ciano} />
      </View>
    );
  }

  return (
    <View style={s.tela}>
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
        </View>

        <ScrollView
          ref={rolagem.ref}
          onScroll={rolagem.onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={s.conteudo}
          keyboardShouldPersistTaps="handled"
        >
          {aba === 'calcular' ? (
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
                    onCompartilhar={() => compartilharItem(it)}
                    onFoto={() => tocarFoto('item', it)}
                    onEscolherTipo={(filId) => setEscolhaTipo({ itemId: it.id, filId })}
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
                orcs.map((o) => (
                  <OrcamentoSalvo
                    key={o.id}
                    o={o}
                    onPdf={() => enviarPdf(o)}
                    onAbrir={() => abrirOrcamento(o)}
                    onApagar={() => setOrcs((l) => l.filter((x) => x.id !== o.id))}
                  />
                ))
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
        tipos={tiposDe(cfg)}
        atual={escolhaTipo ? (filDoItem(itens.find((x) => x.id === escolhaTipo.itemId) || {}).find((f) => f.id === escolhaTipo.filId) || {}).tipo : null}
        onEscolher={escolherTipo}
        onFechar={() => setEscolhaTipo(null)}
      />
      <NovoOrcamento visivel={novoOrc} n={itens.length} onFechar={() => setNovoOrc(false)} onEscolher={comecarNovo} />
    </View>
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
function ConfirmarApagar({ texto, onConfirmar, estilo, soIcone }) {
  const [armado, setArmado] = useState(false);
  useEffect(() => {
    if (!armado) return;
    const t = setTimeout(() => setArmado(false), 3000);
    return () => clearTimeout(t);
  }, [armado]);
  const tocar = () => (armado ? onConfirmar() : setArmado(true));
  if (soIcone) {
    return (
      <Pressable onPress={tocar} hitSlop={8} style={[s.iconeBotao, armado && s.apagarArmado]}>
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

function Campo({ rotulo, digitos, onDigitos, mostrar, placeholder, sufixo, prefixo, flex = 1 }) {
  return (
    <View style={{ flex }}>
      {rotulo ? <Text style={s.campoRotulo}>{rotulo}</Text> : null}
      <View style={s.campoCaixa}>
        {prefixo ? <Text style={[s.campoSufixo, { marginLeft: 0, marginRight: 6 }]}>{prefixo}</Text> : null}
        <TextInput
          value={mostrar(digitos)}
          onChangeText={(t) => onDigitos(soDigitos(t))}
          keyboardType="number-pad"
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

function EscolherTipo({ visivel, tipos, atual, onEscolher, onFechar }) {
  return (
    <Modal visible={visivel} animationType="slide" transparent onRequestClose={onFechar}>
      <View style={s.modalFundo}>
        <Pressable style={{ flex: 1 }} onPress={onFechar} />
        <View style={s.modal}>
          <View style={s.modalAlca} />
          <Text style={s.modalTitulo}>Tipo de filamento</Text>
          <Text style={s.modalSub}>Os tipos e preços ficam nos Ajustes.</Text>
          <View style={{ marginTop: 12 }}>
            {tipos.map((t) => {
              const sel = t.id === atual || (!atual && t.id === tipos[0].id);
              return (
                <Pressable key={t.id} onPress={() => onEscolher(t.id)} style={({ pressed }) => [s.tipoOpcao, sel && s.tipoOpcaoSel, pressed && { opacity: 0.7 }]}>
                  <Text style={[s.tipoOpcaoNome, sel && { color: C.ciano }]}>{t.nome || 'Sem nome'}</Text>
                  <Text style={s.tipoOpcaoPreco}>{reais(valorDecimal(t.precoD))}/g</Text>
                  {sel ? <Ionicons name="checkmark-circle" size={20} color={C.ciano} /> : <View style={{ width: 20 }} />}
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Peça no cálculo
// ---------------------------------------------------------------------------
function Item({ it, cfg, onChange, onRemove, onRetry, onSalvar, onCompartilhar, onFoto, onEscolherTipo }) {
  const preco = precoDoItem(it, cfg);
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
            <Text style={s.itemPreco}>
              {reais(preco)}
              {it.certeza === 'baixa' ? <Text style={s.itemConfira}>  confira os números</Text> : null}
            </Text>
          )}
        </View>
      </View>

      {it.estado !== 'lendo' ? (
        <>
          <View style={s.campos}>
            <Campo
              rotulo={fracionada ? 'Tempo (horas)' : 'Tempo (h:min)'}
              digitos={it.tD}
              onDigitos={(d) => onChange({ tD: d, estado: 'ok' })}
              mostrar={(d) => mostrarTempoCampo(d, cfg.modoHora)}
              placeholder={fracionada ? '0,00' : '0:00'}
              sufixo="h"
            />
          </View>
          <Text style={[s.campoRotulo, { marginTop: 12 }]}>Filamento</Text>
          {fil.map((f) => (
            <View key={f.id} style={s.filLinha}>
              <Pressable onPress={() => onEscolherTipo(f.id)} style={({ pressed }) => [s.tipoBotao, pressed && { opacity: 0.7 }]}>
                <Text style={s.tipoBotaoTexto} numberOfLines={1}>{tipoPorId(cfg, f.tipo).nome || 'Tipo'}</Text>
                <Ionicons name="chevron-down" size={14} color={C.suave} />
              </Pressable>
              <Campo digitos={f.gD} onDigitos={(d) => mudarFil(f.id, { gD: d })} mostrar={mostrarDecimal} placeholder="0,00" sufixo="g" />
              {fil.length > 1 ? (
                <Pressable onPress={() => onChange({ fil: fil.filter((x) => x.id !== f.id) })} hitSlop={8} style={s.filTirar}>
                  <Ionicons name="close" size={18} color={C.fraco} />
                </Pressable>
              ) : null}
            </View>
          ))}
          <Pressable onPress={() => onChange({ fil: [...fil, novoFil(tiposDe(cfg)[0].id)] })} style={s.filMais} hitSlop={6}>
            <Ionicons name="add-circle" size={16} color={C.ciano} />
            <Text style={s.filMaisTexto}>Outro filamento</Text>
          </Pressable>
        </>
      ) : null}

      <View style={s.itemRodape}>
        <IconeBotao nome="share-social" cor={ok ? C.ciano : C.fraco} onPress={ok ? onCompartilhar : undefined} />
        <IconeBotao nome="bookmark" cor={ok ? C.laranja : C.fraco} onPress={ok ? onSalvar : undefined} />
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
          <Text style={s.itemPreco}>{reais(p.preco)}</Text>
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

function OrcamentoSalvo({ o, onPdf, onAbrir, onApagar }) {
  return (
    <View style={s.item}>
      <View style={s.itemTopo}>
        <View style={[s.miniatura, s.centro, { backgroundColor: C.laranjaEscuro }]}>
          <Ionicons name="document-text" size={22} color={C.laranja} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.itemNome} numberOfLines={1}>{o.cliente || 'Sem nome do cliente'}</Text>
          <Text style={s.itemPreco}>{reais(o.total)}</Text>
          <Text style={s.itemDetalhe}>
            {o.itens.length} {o.itens.length === 1 ? 'peça' : 'peças'} · {dataTexto(o.data)}
          </Text>
        </View>
      </View>
      <View style={s.itemRodape}>
        <IconeBotao nome="share-social" cor={C.ciano} onPress={onPdf} />
        <IconeBotao nome="open" cor={C.laranja} onPress={onAbrir} />
        <View style={{ flex: 1 }} />
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
                  <Text style={s.cartaoRotulo}>PREÇO TOTAL</Text>
                  <Text style={s.cartaoPreco}>{reais(peca.preco)}</Text>
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
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    if (visivel) {
      setCliente('');
      setOcupado(false);
    }
  }, [visivel]);

  const ir = async (enviar) => {
    setOcupado(true);
    await onGuardar(cliente, enviar);
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
// Ajustes
// ---------------------------------------------------------------------------
function Ajustes({ visivel, cfg, onFechar, onSalvar }) {
  const [r, setR] = useState(cfg);
  const [verSenha, setVerSenha] = useState(false);
  const rolagem = useRolarParaCampo(visivel);
  useEffect(() => {
    if (visivel) setR({ ...cfg, filamentos: tiposDe(cfg) });
  }, [visivel]);

  const mudarTipo = (id, campos) => setR({ ...r, filamentos: r.filamentos.map((t) => (t.id === id ? { ...t, ...campos } : t)) });

  const salvar = () => {
    const filamentos = r.filamentos
      .filter((t) => t.nome.trim() || t.precoD)
      .map((t) => ({ ...t, nome: t.nome.trim() || 'Filamento' }));
    onSalvar({ ...r, filamentos: filamentos.length ? filamentos : FIL_PADRAO, senha: String(r.senha || '').trim() });
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

            <Text style={[s.modalTitulo, { fontSize: 17, marginTop: 22 }]}>Filamentos</Text>
            <Text style={s.modalSub}>Cada tipo com o seu preço por grama.</Text>
            {(r.filamentos || []).map((t) => (
              <View key={t.id} style={[s.filLinha, { marginTop: 8 }]}>
                <View style={[s.campoCaixa, { flex: 1 }]}>
                  <TextInput
                    value={t.nome}
                    onChangeText={(v) => mudarTipo(t.id, { nome: v })}
                    placeholder="PLA, PETG..."
                    placeholderTextColor={C.fraco}
                    autoCapitalize="characters"
                    style={[s.campoInput, { textAlign: 'left', fontSize: 16 }]}
                  />
                </View>
                <Campo digitos={t.precoD} onDigitos={(d) => mudarTipo(t.id, { precoD: d })} mostrar={mostrarDecimal} placeholder="0,00" prefixo="R$" sufixo="/g" />
                {r.filamentos.length > 1 ? (
                  <Pressable onPress={() => setR({ ...r, filamentos: r.filamentos.filter((x) => x.id !== t.id) })} hitSlop={8} style={s.filTirar}>
                    <Ionicons name="trash" size={17} color={C.fraco} />
                  </Pressable>
                ) : null}
              </View>
            ))}
            <Pressable onPress={() => setR({ ...r, filamentos: [...r.filamentos, { id: novoId(), nome: '', precoD: '' }] })} style={s.filMais} hitSlop={6}>
              <Ionicons name="add-circle" size={16} color={C.ciano} />
              <Text style={s.filMaisTexto}>Adicionar filamento</Text>
            </Pressable>

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
  aba: { paddingVertical: 10, marginRight: 22, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
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
  filLinha: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  tipoBotao: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, width: 96, backgroundColor: C.cartao2, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, borderWidth: 1, borderColor: C.linha },
  tipoBotaoTexto: { fontFamily: F.textoNegrito, color: C.texto, fontSize: 14, flexShrink: 1 },
  filTirar: { padding: 6 },
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

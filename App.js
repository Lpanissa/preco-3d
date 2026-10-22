import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------
const SERVIDOR = 'https://edith.lpanissa.workers.dev/chat';
const K_CONFIG = 'preco3d-config';
const K_ITENS = 'preco3d-itens';

const CONFIG_PADRAO = {
  precoGrama: '0,26', // R$ por grama de filamento
  precoHora: '4,00', // R$ por hora de impressão
  taxaFixa: '0,00', // R$ somado uma vez no total
  senha: '', // senha da EDITH (servidor que lê as fotos)
};

const C = {
  fundo: '#0B0B0C',
  cartao: '#151517',
  cartao2: '#1C1C1F',
  borda: '#2A2A2E',
  texto: '#F2F2F3',
  suave: '#9A9AA2',
  fraco: '#5F5F66',
  destaque: '#FF8A1F',
  destaqueEscuro: '#3A2410',
  erro: '#FF5A5A',
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const reais = (v) =>
  'R$ ' +
  (Math.round(v * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const tempoTexto = (min) => {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h}h ${r}min` : `${h}h`;
};
const gramasTexto = (g) => `${String(Math.round(g * 10) / 10).replace('.', ',')} g`;
const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const minutosDoItem = (it) => num(it.horas) * 60 + num(it.minutos);
const precoDoItem = (it, cfg) =>
  num(it.gramas) * num(cfg.precoGrama) + (minutosDoItem(it) / 60) * num(cfg.precoHora);

// ---------------------------------------------------------------------------
// Leitura da foto pela IA
// ---------------------------------------------------------------------------
const INSTRUCAO =
  'Esta imagem é uma foto ou print de um fatiador de impressão 3D (Bambu Studio, OrcaSlicer, Cura, PrusaSlicer, Creality Print, Anycubic etc.) ou da tela de uma impressora 3D. ' +
  'Encontre o TEMPO TOTAL estimado de impressão e o PESO TOTAL de filamento em gramas. ' +
  'Se houver várias placas ou várias cores, some tudo. Se o filamento aparecer só em metros, converta considerando filamento 1,75 mm de PLA (cerca de 2,98 g por metro). ' +
  'Se aparecer a quantidade de cópias/peças, o total já deve incluir todas. ' +
  'Responda SOMENTE com JSON, sem nenhum outro texto: ' +
  '{"nome":"nome curto da peça ou do arquivo, se aparecer, senão vazio","minutos":numero inteiro de minutos ou null,"gramas":numero ou null,"certeza":"alta" ou "media" ou "baixa"}';

async function lerFoto(uri, senha) {
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
      system:
        'Você lê telas de fatiadores de impressão 3D e devolve só JSON com o tempo e os gramas. Nunca invente números.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img.base64 } },
            { type: 'text', text: INSTRUCAO },
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
  const minutos = Number.isFinite(Number(j.minutos)) && j.minutos !== null ? Math.round(Number(j.minutos)) : null;
  const gramas = Number.isFinite(Number(j.gramas)) && j.gramas !== null ? Number(j.gramas) : null;
  if (minutos === null && gramas === null) throw new Error('nada');
  return { nome: String(j.nome || '').slice(0, 40), minutos, gramas, certeza: j.certeza || 'media' };
}

const mensagemErro = (e) => {
  const m = e && e.message;
  if (m === 'senha') return 'Senha da EDITH errada. Confira em Ajustes.';
  if (m === 'nada') return 'Não achei tempo nem gramas nessa foto.';
  if (m === 'servidor') return 'O servidor não respondeu. Tente de novo.';
  return 'Não consegui ler. Verifique a internet e tente de novo.';
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  const [cfg, setCfg] = useState(CONFIG_PADRAO);
  const [itens, setItens] = useState([]);
  const [carregado, setCarregado] = useState(false);
  const [ajustes, setAjustes] = useState(false);
  const [aviso, setAviso] = useState('');
  const avisoTimer = useRef(null);

  // carregar dados salvos
  useEffect(() => {
    (async () => {
      try {
        const [a, b] = await Promise.all([AsyncStorage.getItem(K_CONFIG), AsyncStorage.getItem(K_ITENS)]);
        if (a) setCfg({ ...CONFIG_PADRAO, ...JSON.parse(a) });
        if (b) {
          const lista = JSON.parse(b).map((it) => (it.estado === 'lendo' ? { ...it, estado: 'erro', erro: 'Leitura interrompida. Toque para tentar de novo.' } : it));
          setItens(lista);
        }
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

  const mostrarAviso = (t) => {
    setAviso(t);
    clearTimeout(avisoTimer.current);
    avisoTimer.current = setTimeout(() => setAviso(''), 2600);
  };

  const mudarItem = (id, campos) =>
    setItens((l) => l.map((it) => (it.id === id ? { ...it, ...campos } : it)));
  const removerItem = (id) => setItens((l) => l.filter((it) => it.id !== id));

  const total = useMemo(() => {
    let preco = 0;
    let min = 0;
    let g = 0;
    let prontos = 0;
    for (const it of itens) {
      if (it.estado === 'lendo' || it.estado === 'erro') continue;
      preco += precoDoItem(it, cfg);
      min += minutosDoItem(it);
      g += num(it.gramas);
      prontos++;
    }
    if (prontos) preco += num(cfg.taxaFixa);
    return { preco, min, g, prontos };
  }, [itens, cfg]);

  const lendo = itens.some((it) => it.estado === 'lendo');

  // ---------------- fotos ----------------
  const processar = async (novos) => {
    // lê no máximo 3 fotos ao mesmo tempo
    const fila = [...novos];
    const trabalhador = async () => {
      while (fila.length) {
        const it = fila.shift();
        try {
          const r = await lerFoto(it.foto, cfg.senha);
          const h = r.minutos !== null ? Math.floor(r.minutos / 60) : '';
          const m = r.minutos !== null ? r.minutos % 60 : '';
          mudarItem(it.id, {
            estado: 'ok',
            nome: r.nome || it.nome,
            horas: String(h),
            minutos: String(m),
            gramas: r.gramas !== null ? String(Math.round(r.gramas * 10) / 10).replace('.', ',') : '',
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

  const adicionarFotos = (assets) => {
    if (!assets || !assets.length) return;
    const base = itens.length;
    const novos = assets.map((a, i) => ({
      id: novoId(),
      nome: `Peça ${base + i + 1}`,
      horas: '',
      minutos: '',
      gramas: '',
      foto: a.uri,
      estado: 'lendo',
      erro: '',
    }));
    setItens((l) => [...l, ...novos]);
    processar(novos);
  };

  const escolherFotos = async () => {
    if (!cfg.senha) {
      mostrarAviso('Coloque a senha da EDITH em Ajustes para ler fotos.');
      setAjustes(true);
      return;
    }
    const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!p.granted) return mostrarAviso('Sem permissão para abrir as fotos.');
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 20,
      quality: 1,
    });
    if (!r.canceled) adicionarFotos(r.assets);
  };

  const tirarFoto = async () => {
    if (!cfg.senha) {
      mostrarAviso('Coloque a senha da EDITH em Ajustes para ler fotos.');
      setAjustes(true);
      return;
    }
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) return mostrarAviso('Sem permissão para usar a câmera.');
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (!r.canceled) adicionarFotos(r.assets);
  };

  const adicionarManual = () =>
    setItens((l) => [
      ...l,
      { id: novoId(), nome: `Peça ${l.length + 1}`, horas: '', minutos: '', gramas: '', foto: null, estado: 'ok', erro: '' },
    ]);

  const tentarDeNovo = (it) => {
    if (!it.foto) return;
    mudarItem(it.id, { estado: 'lendo', erro: '' });
    processar([{ ...it }]);
  };

  const copiar = async () => {
    await Clipboard.setStringAsync(reais(total.preco));
    mostrarAviso('Valor copiado');
  };

  if (!carregado) {
    return (
      <View style={[s.tela, s.centro]}>
        <ActivityIndicator color={C.destaque} />
      </View>
    );
  }

  return (
    <View style={s.tela}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
          {/* topo */}
          <View style={s.topo}>
            <View style={s.marca}>
              <View style={s.logo}>
                <Ionicons name="cube" size={18} color={C.fundo} />
              </View>
              <Text style={s.titulo}>Preço 3D</Text>
            </View>
            <Pressable onPress={() => setAjustes(true)} hitSlop={12} style={s.botaoIcone}>
              <Ionicons name="settings-sharp" size={20} color={C.suave} />
            </Pressable>
          </View>

          {/* total */}
          <View style={s.total}>
            <Text style={s.totalRotulo}>TOTAL</Text>
            <Text style={s.totalValor}>{reais(total.preco)}</Text>
            <View style={s.linhaResumo}>
              <Resumo icone="layers" texto={`${total.prontos} ${total.prontos === 1 ? 'peça' : 'peças'}`} />
              <Resumo icone="time" texto={tempoTexto(total.min)} />
              <Resumo icone="scale" texto={gramasTexto(total.g)} />
            </View>
            {lendo ? (
              <View style={s.lendoLinha}>
                <ActivityIndicator size="small" color={C.destaque} />
                <Text style={s.lendoTexto}>Lendo fotos... o total atualiza sozinho</Text>
              </View>
            ) : null}
            <Pressable
              onPress={copiar}
              disabled={!total.prontos}
              style={({ pressed }) => [s.copiar, !total.prontos && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="copy" size={16} color={C.destaque} />
              <Text style={s.copiarTexto}>Copiar valor</Text>
            </Pressable>
          </View>

          {/* ações */}
          <View style={s.acoes}>
            <Acao icone="images" texto="Fotos" onPress={escolherFotos} principal />
            <Acao icone="camera" texto="Câmera" onPress={tirarFoto} />
            <Acao icone="create" texto="Digitar" onPress={adicionarManual} />
          </View>

          {/* itens */}
          {itens.length === 0 ? (
            <View style={s.vazio}>
              <Ionicons name="cube-outline" size={40} color={C.fraco} />
              <Text style={s.vazioTitulo}>Nenhuma peça ainda</Text>
              <Text style={s.vazioTexto}>
                Escolha uma ou várias fotos da tela do fatiador e o app lê o tempo e os gramas de cada uma e soma tudo. Ou toque em Digitar para colocar os números à mão.
              </Text>
            </View>
          ) : (
            itens.map((it, i) => (
              <Item
                key={it.id}
                it={it}
                cfg={cfg}
                onChange={(c) => mudarItem(it.id, c)}
                onRemove={() => removerItem(it.id)}
                onRetry={() => tentarDeNovo(it)}
              />
            ))
          )}

          {itens.length > 0 ? (
            <Pressable onPress={() => setItens([])} style={s.limpar} hitSlop={8}>
              <Ionicons name="trash" size={15} color={C.fraco} />
              <Text style={s.limparTexto}>Limpar tudo</Text>
            </Pressable>
          ) : null}

          <Text style={s.rodape}>
            {`${reais(num(cfg.precoGrama))} por grama · ${reais(num(cfg.precoHora))} por hora`}
            {num(cfg.taxaFixa) ? ` · taxa ${reais(num(cfg.taxaFixa))}` : ''}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {aviso ? (
        <View style={s.aviso} pointerEvents="none">
          <Text style={s.avisoTexto}>{aviso}</Text>
        </View>
      ) : null}

      <Ajustes visivel={ajustes} cfg={cfg} onFechar={() => setAjustes(false)} onSalvar={(c) => setCfg(c)} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Componentes
// ---------------------------------------------------------------------------
function Resumo({ icone, texto }) {
  return (
    <View style={s.resumo}>
      <Ionicons name={icone} size={13} color={C.suave} />
      <Text style={s.resumoTexto}>{texto}</Text>
    </View>
  );
}

function Acao({ icone, texto, onPress, principal }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.acao, principal && s.acaoPrincipal, pressed && { opacity: 0.75 }]}
    >
      <Ionicons name={icone} size={20} color={principal ? C.fundo : C.texto} />
      <Text style={[s.acaoTexto, principal && { color: C.fundo }]}>{texto}</Text>
    </Pressable>
  );
}

function Campo({ rotulo, valor, onChange, sufixo, largura }) {
  return (
    <View style={[s.campo, largura && { flex: largura }]}>
      <Text style={s.campoRotulo}>{rotulo}</Text>
      <View style={s.campoCaixa}>
        <TextInput
          value={valor}
          onChangeText={(t) => onChange(t.replace(/[^0-9.,]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={C.fraco}
          style={s.campoInput}
          selectTextOnFocus
        />
        {sufixo ? <Text style={s.campoSufixo}>{sufixo}</Text> : null}
      </View>
    </View>
  );
}

function Item({ it, cfg, onChange, onRemove, onRetry }) {
  const preco = precoDoItem(it, cfg);
  return (
    <View style={s.item}>
      <View style={s.itemTopo}>
        {it.foto ? (
          <Image source={{ uri: it.foto }} style={s.miniatura} />
        ) : (
          <View style={[s.miniatura, s.centro]}>
            <Ionicons name="create" size={18} color={C.fraco} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <TextInput
            value={it.nome}
            onChangeText={(t) => onChange({ nome: t })}
            style={s.itemNome}
            placeholder="Nome da peça"
            placeholderTextColor={C.fraco}
          />
          {it.estado === 'lendo' ? (
            <View style={s.itemStatus}>
              <ActivityIndicator size="small" color={C.destaque} />
              <Text style={s.itemStatusTexto}>Lendo a foto...</Text>
            </View>
          ) : it.estado === 'erro' ? (
            <Pressable onPress={onRetry} style={s.itemStatus}>
              <Ionicons name="alert-circle" size={15} color={C.erro} />
              <Text style={[s.itemStatusTexto, { color: C.erro, flex: 1 }]}>{it.erro}</Text>
              {it.foto ? <Ionicons name="refresh" size={16} color={C.suave} /> : null}
            </Pressable>
          ) : (
            <Text style={s.itemPreco}>
              {reais(preco)}
              {it.certeza === 'baixa' ? <Text style={s.itemConfira}>  confira os números</Text> : null}
            </Text>
          )}
        </View>
        <Pressable onPress={onRemove} hitSlop={10} style={s.botaoIcone}>
          <Ionicons name="trash" size={18} color={C.fraco} />
        </Pressable>
      </View>

      {it.estado !== 'lendo' ? (
        <View style={s.campos}>
          <Campo rotulo="Horas" valor={it.horas} onChange={(v) => onChange({ horas: v, estado: 'ok' })} sufixo="h" largura={1} />
          <Campo rotulo="Minutos" valor={it.minutos} onChange={(v) => onChange({ minutos: v, estado: 'ok' })} sufixo="min" largura={1} />
          <Campo rotulo="Filamento" valor={it.gramas} onChange={(v) => onChange({ gramas: v, estado: 'ok' })} sufixo="g" largura={1.2} />
        </View>
      ) : null}
    </View>
  );
}

function Ajustes({ visivel, cfg, onFechar, onSalvar }) {
  const [rasc, setRasc] = useState(cfg);
  const [verSenha, setVerSenha] = useState(false);
  useEffect(() => {
    if (visivel) setRasc(cfg);
  }, [visivel]);

  const salvar = () => {
    onSalvar({ ...rasc, senha: String(rasc.senha || '').trim() });
    onFechar();
  };

  return (
    <Modal visible={visivel} animationType="slide" transparent onRequestClose={onFechar}>
      <KeyboardAvoidingView style={s.modalFundo} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={{ flex: 1 }} onPress={onFechar} />
        <View style={s.modal}>
          <View style={s.modalAlca} />
          <Text style={s.modalTitulo}>Seus preços</Text>
          <Text style={s.modalSub}>O app calcula: gramas × preço do grama + horas × preço da hora.</Text>

          <View style={s.campos}>
            <Campo rotulo="Por grama" valor={rasc.precoGrama} onChange={(v) => setRasc({ ...rasc, precoGrama: v })} sufixo="R$" largura={1} />
            <Campo rotulo="Por hora" valor={rasc.precoHora} onChange={(v) => setRasc({ ...rasc, precoHora: v })} sufixo="R$" largura={1} />
          </View>
          <View style={[s.campos, { marginTop: 10 }]}>
            <Campo rotulo="Taxa fixa por pedido (opcional)" valor={rasc.taxaFixa} onChange={(v) => setRasc({ ...rasc, taxaFixa: v })} sufixo="R$" largura={1} />
          </View>

          <Text style={[s.modalTitulo, { fontSize: 16, marginTop: 22 }]}>Leitura das fotos</Text>
          <Text style={s.modalSub}>Usa o mesmo servidor da EDITH. Cole aqui a mesma senha que está no app da EDITH.</Text>
          <View style={[s.campoCaixa, { marginTop: 8 }]}>
            <Ionicons name="key" size={16} color={C.suave} style={{ marginRight: 8 }} />
            <TextInput
              value={rasc.senha}
              onChangeText={(t) => setRasc({ ...rasc, senha: t })}
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

          <Pressable onPress={salvar} style={({ pressed }) => [s.salvar, pressed && { opacity: 0.8 }]}>
            <Text style={s.salvarTexto}>Salvar</Text>
          </Pressable>
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
  conteudo: { padding: 16, paddingTop: 52, paddingBottom: 40 },

  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  marca: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 30, height: 30, borderRadius: 9, backgroundColor: C.destaque, alignItems: 'center', justifyContent: 'center' },
  titulo: { color: C.texto, fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  botaoIcone: { padding: 6 },

  total: { backgroundColor: C.cartao, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: C.borda },
  totalRotulo: { color: C.suave, fontSize: 12, fontWeight: '700', letterSpacing: 1.5 },
  totalValor: { color: C.texto, fontSize: 42, fontWeight: '800', marginTop: 4, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  linhaResumo: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  resumo: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.cartao2, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  resumoTexto: { color: C.suave, fontSize: 13, fontWeight: '600' },
  lendoLinha: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  lendoTexto: { color: C.suave, fontSize: 13 },
  copiar: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 16, backgroundColor: C.destaqueEscuro, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12 },
  copiarTexto: { color: C.destaque, fontWeight: '700', fontSize: 14 },

  acoes: { flexDirection: 'row', gap: 10, marginTop: 14, marginBottom: 6 },
  acao: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 16, backgroundColor: C.cartao, borderWidth: 1, borderColor: C.borda },
  acaoPrincipal: { backgroundColor: C.destaque, borderColor: C.destaque },
  acaoTexto: { color: C.texto, fontWeight: '700', fontSize: 13 },

  vazio: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 },
  vazioTitulo: { color: C.texto, fontSize: 16, fontWeight: '700', marginTop: 12 },
  vazioTexto: { color: C.suave, fontSize: 14, textAlign: 'center', marginTop: 6, lineHeight: 20 },

  item: { backgroundColor: C.cartao, borderRadius: 16, padding: 14, marginTop: 10, borderWidth: 1, borderColor: C.borda },
  itemTopo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  miniatura: { width: 48, height: 48, borderRadius: 10, backgroundColor: C.cartao2 },
  itemNome: { color: C.texto, fontSize: 15, fontWeight: '700', padding: 0 },
  itemPreco: { color: C.destaque, fontSize: 15, fontWeight: '800', marginTop: 3, fontVariant: ['tabular-nums'] },
  itemConfira: { color: C.suave, fontSize: 12, fontWeight: '600' },
  itemStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  itemStatusTexto: { color: C.suave, fontSize: 13 },

  campos: { flexDirection: 'row', gap: 8, marginTop: 12 },
  campo: { flex: 1 },
  campoRotulo: { color: C.suave, fontSize: 12, marginBottom: 5, fontWeight: '600' },
  campoCaixa: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.cartao2, borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: C.borda },
  campoInput: { flex: 1, color: C.texto, fontSize: 17, fontWeight: '700', paddingVertical: 10, textAlign: 'right', fontVariant: ['tabular-nums'] },
  campoSufixo: { color: C.fraco, fontSize: 13, marginLeft: 6, fontWeight: '600' },

  limpar: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginTop: 18, padding: 6 },
  limparTexto: { color: C.fraco, fontSize: 13, fontWeight: '600' },
  rodape: { color: C.fraco, fontSize: 12, textAlign: 'center', marginTop: 14 },

  aviso: { position: 'absolute', bottom: 40, left: 16, right: 16, backgroundColor: C.cartao2, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.borda },
  avisoTexto: { color: C.texto, textAlign: 'center', fontSize: 14, fontWeight: '600' },

  modalFundo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  modal: { backgroundColor: C.cartao, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34, borderWidth: 1, borderColor: C.borda },
  modalAlca: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.borda, alignSelf: 'center', marginBottom: 16 },
  modalTitulo: { color: C.texto, fontSize: 20, fontWeight: '800' },
  modalSub: { color: C.suave, fontSize: 13, marginTop: 4, lineHeight: 18 },
  salvar: { backgroundColor: C.destaque, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 24 },
  salvarTexto: { color: C.fundo, fontWeight: '800', fontSize: 16 },
});

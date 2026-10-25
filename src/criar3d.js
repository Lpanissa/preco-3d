// Aba "Criar 3D": foto (+ detalhe escrito) -> foto limpa com fundo branco -> modelo 3D -> girar e conferir -> STL/3MF.
// Tudo anda no servidor (Supabase + Tripo): pode fechar o app que o modelo continua sendo criado.
// A chave do Tripo fica no servidor; o app só manda a senha da EDITH.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { C, F } from './tema';

const SERVIDOR = 'https://xtakdthbgrgmdibyizsc.supabase.co/functions/v1/tripo';
const K_LISTA = 'preco3d-trabalhos3d';
const ATIVAS = ['limpando', 'criando', 'convertendo'];

async function chamar(senha, corpo) {
  const r = await fetch(SERVIDOR, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-senha': senha || '' },
    body: JSON.stringify(corpo),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro || 'servidor');
  return d;
}

const ERROS = {
  senha: 'Senha da EDITH errada. Confira em Ajustes.',
  sem_chave: 'Falta colar a chave do Tripo no Supabase.',
  chave: 'A chave do Tripo não foi aceita. Crie outra e cole no Supabase.',
  creditos: 'Acabaram os créditos do Tripo.',
  limite: 'O Tripo está ocupado. Espere um minuto e tente de novo.',
  falhou: 'O Tripo não conseguiu criar desta vez. Toque em Refazer ou troque a foto.',
  sumiu: 'Esse modelo não existe mais.',
};
const textoErro = (e) => ERROS[typeof e === 'string' ? e : e && e.message] || 'Não deu certo. Confira a internet e tente de novo.';

const ETAPAS = [
  ['limpando', 'Limpando a foto (fundo branco)'],
  ['criando', 'Criando o modelo 3D'],
];
const rotuloEtapa = (t) =>
  ({
    limpando: 'Limpando a foto',
    criando: 'Criando o 3D',
    pronto: 'Pronto para conferir',
    convertendo: `Preparando ${t.formato || 'arquivo'}`,
    arquivo_pronto: `${t.formato} pronto`,
    erro: 'Não deu certo',
  }[t.etapa] || '');

// visualizador 3D: gira com o dedo, aproxima com pinça
const paginaVisor = (link) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<script type="module" src="https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js"></script>
<style>html,body{margin:0;height:100%;background:${C.cartao2}}model-viewer{width:100%;height:100%;--poster-color:transparent}
#c{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:${C.suave};font:14px sans-serif}</style></head>
<body><div id="c">Carregando o 3D...</div><model-viewer src="${link}" camera-controls auto-rotate auto-rotate-delay="1500" rotation-per-second="20deg"
touch-action="pan-y" shadow-intensity="1" exposure="1.05" interaction-prompt="none" onload="document.getElementById('c').remove()"></model-viewer></body></html>`;

export default function Criar3D({ senha, aviso }) {
  const [foto, setFoto] = useState(null);
  const [detalhe, setDetalhe] = useState('');
  const [detalhado, setDetalhado] = useState(false);
  const [formato, setFormato] = useState('STL');
  const [trabalhos, setTrabalhos] = useState([]);
  const [atualId, setAtualId] = useState(null);
  const [ocupado, setOcupado] = useState(''); // enviando | refazendo | convertendo | baixando
  const [erro, setErro] = useState('');
  const [apagar, setApagar] = useState(null);
  const vivo = useRef(true);

  const atual = trabalhos.find((t) => t.id === atualId) || null;
  const andando = trabalhos.some((t) => ATIVAS.includes(t.etapa));

  const atualizar = useCallback(async () => {
    if (!senha) return;
    try {
      const { trabalhos: lista } = await chamar(senha, { acao: 'lista' });
      if (!vivo.current) return;
      setTrabalhos(lista || []);
      AsyncStorage.setItem(K_LISTA, JSON.stringify(lista || [])).catch(() => {});
    } catch (e) {
      if (vivo.current && e.message === 'senha') setErro(textoErro(e));
    }
  }, [senha]);

  // abre com a última lista guardada e confere o servidor
  useEffect(() => {
    vivo.current = true;
    AsyncStorage.getItem(K_LISTA)
      .then((t) => t && vivo.current && setTrabalhos(JSON.parse(t)))
      .catch(() => {});
    atualizar();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && atualizar());
    return () => {
      vivo.current = false;
      sub.remove();
    };
  }, [atualizar]);

  // enquanto algo está sendo criado, confere a cada 5 segundos
  useEffect(() => {
    if (!andando) return;
    const id = setInterval(atualizar, 5000);
    return () => clearInterval(id);
  }, [andando, atualizar]);

  const escolher = async (camera) => {
    const op = { mediaTypes: ['images'], quality: 1 };
    if (camera) {
      const p = await ImagePicker.requestCameraPermissionsAsync();
      if (!p.granted) return aviso('Permita a câmera para tirar a foto.');
    }
    const r = camera ? await ImagePicker.launchCameraAsync(op) : await ImagePicker.launchImageLibraryAsync(op);
    if (!r.canceled && r.assets && r.assets[0]) {
      setFoto(r.assets[0].uri);
      setErro('');
    }
  };

  const criar = async () => {
    if (!senha) return aviso('Coloque a senha da EDITH em Ajustes para criar modelos.');
    if (!foto) return;
    setErro('');
    setOcupado('enviando');
    try {
      const img = await ImageManipulator.manipulateAsync(foto, [{ resize: { width: 1600 } }], {
        compress: 0.9,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      });
      const { id } = await chamar(senha, { acao: 'criar', imagem: img.base64, detalhe: detalhe.trim(), detalhado });
      setAtualId(id);
      setFoto(null);
      setDetalhe('');
      await atualizar();
    } catch (e) {
      setErro(textoErro(e));
    } finally {
      if (vivo.current) setOcupado('');
    }
  };

  const acao = async (tipo, corpo, depois) => {
    setErro('');
    setOcupado(tipo);
    try {
      const r = await chamar(senha, corpo);
      if (depois) depois(r);
      await atualizar();
    } catch (e) {
      setErro(textoErro(e));
    } finally {
      if (vivo.current) setOcupado('');
    }
  };

  const refazer = () => acao('refazendo', { acao: 'refazer', id: atual.id }, (r) => setAtualId(r.id));
  const converter = () => acao('convertendo', { acao: 'converter', id: atual.id, formato });

  const enviar = async (t) => {
    if (!t.arquivo) return;
    setOcupado('baixando');
    try {
      const ext = (t.formato || 'STL').toLowerCase();
      const destino = FileSystem.cacheDirectory + `modelo-${String(t.criado).slice(0, 10)}-${t.id.slice(0, 6)}.${ext}`;
      const r = await FileSystem.downloadAsync(t.arquivo, destino);
      await Sharing.shareAsync(r.uri, { mimeType: ext === '3mf' ? 'model/3mf' : 'model/stl', dialogTitle: 'Enviar modelo 3D' });
    } catch (e) {
      aviso('Não consegui baixar o arquivo. Tente de novo.');
    } finally {
      if (vivo.current) setOcupado('');
    }
  };

  const confirmarApagar = async (t) => {
    if (apagar !== t.id) return setApagar(t.id);
    setApagar(null);
    setTrabalhos((l) => l.filter((x) => x.id !== t.id));
    if (atualId === t.id) setAtualId(null);
    chamar(senha, { acao: 'apagar', id: t.id }).catch(() => {}).finally(atualizar);
  };

  const pronto = atual && (atual.etapa === 'pronto' || atual.etapa === 'arquivo_pronto' || (atual.etapa === 'convertendo' && atual.glb));

  return (
    <View style={{ gap: 14 }}>
      {atual ? (
        <View style={[s.cartao, pronto && { borderColor: C.ciano }]}>
          <View style={s.cabeca}>
            <Text style={s.titulo}>{pronto ? 'Confira o modelo' : atual.etapa === 'erro' ? 'Não deu certo' : 'Criando seu modelo'}</Text>
            <Pressable hitSlop={10} onPress={() => setAtualId(null)}>
              <Ionicons name="close" size={20} color={C.suave} />
            </Pressable>
          </View>

          {pronto && atual.glb ? (
            <>
              <View style={s.visor}>
                <WebView
                  key={atual.glb}
                  originWhitelist={['*']}
                  source={{ html: paginaVisor(atual.glb), baseUrl: 'https://localhost/' }}
                  style={{ backgroundColor: C.cartao2 }}
                  scrollEnabled={false}
                  nestedScrollEnabled
                />
              </View>
              <Text style={s.dica}>Arraste para girar · pinça para aproximar</Text>
            </>
          ) : null}

          {atual.foto ? (
            <View style={s.fotosLinha}>
              <Image source={{ uri: atual.foto }} style={s.fotoMini} />
              <Ionicons name="arrow-forward" size={16} color={C.fraco} />
              {atual.foto_limpa ? (
                <Image source={{ uri: atual.foto_limpa }} style={[s.fotoMini, { backgroundColor: '#fff' }]} resizeMode="contain" />
              ) : (
                <View style={[s.fotoMini, s.fotoEspera]}>
                  <ActivityIndicator size="small" color={C.ciano} />
                </View>
              )}
              <Text style={s.fotosTexto} numberOfLines={3}>
                {atual.detalhe ? `Foto limpa pela IA: “${atual.detalhe}”` : 'Foto limpa pela IA, com fundo branco'}
              </Text>
            </View>
          ) : null}

          {atual.etapa === 'limpando' || atual.etapa === 'criando' ? (
            <View style={s.andamento}>
              {ETAPAS.map(([k, t], i) => {
                const pos = ETAPAS.findIndex(([e]) => e === atual.etapa);
                return (
                  <View key={k} style={s.etapa}>
                    {i < pos ? (
                      <Ionicons name="checkmark-circle" size={18} color={C.bom} />
                    ) : i === pos ? (
                      <ActivityIndicator size="small" color={C.ciano} />
                    ) : (
                      <Ionicons name="ellipse-outline" size={18} color={C.fraco} />
                    )}
                    <Text style={[s.etapaTexto, i === pos && { color: C.texto }]}>{i === 0 && atual.detalhe ? 'Limpando a foto e seguindo o seu texto' : t}</Text>
                    {i === pos && atual.progresso > 0 ? <Text style={s.pct}>{atual.progresso}%</Text> : null}
                  </View>
                );
              })}
              <View style={s.aviso}>
                <Ionicons name="phone-portrait-outline" size={16} color={C.ciano} />
                <Text style={s.avisoTexto}>Pode fechar o app. O modelo continua sendo criado e aparece aqui quando você voltar.</Text>
              </View>
            </View>
          ) : null}

          {atual.etapa === 'erro' ? <Text style={s.erro}>{textoErro(atual.erro)}</Text> : null}

          {pronto ? (
            <>
              <Text style={s.rotulo}>ARQUIVO PARA IMPRIMIR</Text>
              <View style={s.seg}>
                {['STL', '3MF'].map((f) => (
                  <Pressable key={f} disabled={!!ocupado || atual.etapa === 'convertendo'} onPress={() => setFormato(f)} style={[s.segItem, formato === f && s.segAtivo]}>
                    <Text style={[s.segTexto, formato === f && { color: C.fundo }]}>{f}</Text>
                  </Pressable>
                ))}
              </View>
              {atual.etapa === 'convertendo' ? (
                <View style={[s.criar, { opacity: 0.6 }]}>
                  <ActivityIndicator color={C.fundo} />
                  <Text style={s.criarTexto}>Preparando o {atual.formato}...</Text>
                </View>
              ) : atual.etapa === 'arquivo_pronto' && atual.formato === formato ? (
                <Pressable disabled={!!ocupado} onPress={() => enviar(atual)} style={({ pressed }) => [s.criar, pressed && { opacity: 0.8 }]}>
                  {ocupado === 'baixando' ? <ActivityIndicator color={C.fundo} /> : <Ionicons name="share-social" size={18} color={C.fundo} />}
                  <Text style={s.criarTexto}>Enviar {formato}</Text>
                </Pressable>
              ) : (
                <Pressable disabled={!!ocupado} onPress={converter} style={({ pressed }) => [s.criar, pressed && { opacity: 0.8 }]}>
                  {ocupado === 'convertendo' ? <ActivityIndicator color={C.fundo} /> : <Ionicons name="checkmark" size={18} color={C.fundo} />}
                  <Text style={s.criarTexto}>Ficou bom: gerar {formato}</Text>
                </Pressable>
              )}
            </>
          ) : null}

          {pronto || atual.etapa === 'erro' ? (
            <>
              <View style={s.duplo}>
                {atual.origem ? (
                  <Pressable disabled={!!ocupado} onPress={refazer} style={({ pressed }) => [s.secundario, pressed && { opacity: 0.7 }]}>
                    {ocupado === 'refazendo' ? <ActivityIndicator size="small" color={C.texto} /> : <Ionicons name="refresh" size={16} color={C.texto} />}
                    <Text style={s.secundarioTexto}>Refazer</Text>
                  </Pressable>
                ) : null}
                <Pressable disabled={!!ocupado} onPress={() => setAtualId(null)} style={({ pressed }) => [s.secundario, pressed && { opacity: 0.7 }]}>
                  <Ionicons name="create" size={16} color={C.texto} />
                  <Text style={s.secundarioTexto}>Mudar foto ou texto</Text>
                </Pressable>
              </View>
              {atual.origem ? <Text style={s.nota}>Refazer cria outra versão com a mesma foto limpa e gasta créditos do Tripo.</Text> : null}
            </>
          ) : null}
          {erro ? <Text style={s.erro}>{erro}</Text> : null}
        </View>
      ) : (
        <View style={s.cartao}>
          <Text style={s.titulo}>Foto vira peça 3D</Text>
          <Text style={s.sub}>Pode ser foto da câmera: o app limpa a imagem e deixa o fundo branco antes de criar o 3D.</Text>

          {foto ? (
            <Pressable onPress={() => !ocupado && escolher(false)} style={s.fotoCaixa}>
              <Image source={{ uri: foto }} style={s.foto} resizeMode="contain" />
              <View style={s.trocar}>
                <Ionicons name="swap-horizontal" size={14} color={C.texto} />
                <Text style={s.trocarTexto}>Trocar</Text>
              </View>
            </Pressable>
          ) : (
            <View style={s.escolha}>
              <Pressable style={({ pressed }) => [s.escolhaBotao, pressed && { opacity: 0.7 }]} onPress={() => escolher(true)}>
                <Ionicons name="camera" size={26} color={C.ciano} />
                <Text style={s.escolhaTexto}>Tirar foto</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [s.escolhaBotao, pressed && { opacity: 0.7 }]} onPress={() => escolher(false)}>
                <Ionicons name="images" size={26} color={C.ciano} />
                <Text style={s.escolhaTexto}>Da galeria</Text>
              </Pressable>
            </View>
          )}

          <Text style={s.rotulo}>DETALHES PARA A IA (OPCIONAL)</Text>
          <TextInput
            value={detalhe}
            onChangeText={setDetalhe}
            editable={!ocupado}
            multiline
            maxLength={600}
            placeholder="Ex.: só a moça sentada no banquinho, sem a caneca e sem a planta"
            placeholderTextColor={C.fraco}
            style={s.texto}
          />

          <Text style={s.rotulo}>DETALHE DO 3D</Text>
          <View style={s.seg}>
            {[
              [false, 'Normal'],
              [true, 'Detalhado'],
            ].map(([v, t]) => (
              <Pressable key={t} disabled={!!ocupado} onPress={() => setDetalhado(v)} style={[s.segItem, detalhado === v && s.segAtivo]}>
                <Text style={[s.segTexto, detalhado === v && { color: C.fundo }]}>{t}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable disabled={!foto || !!ocupado} onPress={criar} style={({ pressed }) => [s.criar, (!foto || ocupado) && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}>
            {ocupado === 'enviando' ? <ActivityIndicator color={C.fundo} /> : <Ionicons name="cube" size={18} color={C.fundo} />}
            <Text style={s.criarTexto}>{ocupado === 'enviando' ? 'Enviando a foto...' : 'Criar modelo 3D'}</Text>
          </Pressable>
          {foto ? <Text style={s.nota}>Cada modelo gasta créditos da sua conta do Tripo.</Text> : null}
          {erro ? <Text style={s.erro}>{erro}</Text> : null}
        </View>
      )}

      {trabalhos.length ? <Text style={s.rotuloLista}>MODELOS CRIADOS</Text> : null}
      {trabalhos.map((t) => (
        <Pressable
          key={t.id}
          onPress={() => {
            setErro('');
            setApagar(null);
            setAtualId(t.id);
          }}
          style={({ pressed }) => [s.linha, atualId === t.id && { borderColor: C.ciano }, pressed && { opacity: 0.8 }]}
        >
          <Image source={{ uri: t.previa || t.foto_limpa || t.foto }} style={s.mini} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.linhaNome} numberOfLines={1}>
              {t.detalhe || 'Modelo 3D'}
            </Text>
            <View style={s.linhaSubLinha}>
              {ATIVAS.includes(t.etapa) ? <ActivityIndicator size="small" color={C.ciano} style={{ transform: [{ scale: 0.7 }] }} /> : null}
              <Text style={[s.linhaSub, t.etapa === 'erro' && { color: C.erro }]}>
                {rotuloEtapa(t)} · {new Date(t.criado).toLocaleDateString('pt-BR')}
              </Text>
            </View>
          </View>
          {t.etapa === 'arquivo_pronto' ? (
            <Pressable hitSlop={8} onPress={() => enviar(t)} style={s.icone}>
              <Ionicons name="share-social" size={18} color={C.ciano} />
            </Pressable>
          ) : null}
          <Pressable hitSlop={8} onPress={() => confirmarApagar(t)} style={[s.icone, apagar === t.id && s.apagarSim]}>
            {apagar === t.id ? <Text style={s.apagarTexto}>Apagar?</Text> : <Ionicons name="trash" size={18} color={C.fraco} />}
          </Pressable>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  cartao: { backgroundColor: C.cartao, borderRadius: 14, borderWidth: 1, borderColor: C.linha, padding: 16, gap: 10 },
  cabeca: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titulo: { fontFamily: F.titulo, color: C.texto, fontSize: 18 },
  dica: { fontFamily: F.texto, color: C.fraco, fontSize: 12, textAlign: 'center' },
  sub: { fontFamily: F.texto, color: C.suave, fontSize: 13, lineHeight: 18 },
  rotulo: { fontFamily: F.tituloMedio, color: C.fraco, fontSize: 11, letterSpacing: 1.2, marginTop: 4 },
  rotuloLista: { fontFamily: F.tituloMedio, color: C.fraco, fontSize: 11, letterSpacing: 1.2, marginTop: 6, marginLeft: 2 },
  escolha: { flexDirection: 'row', gap: 10 },
  escolhaBotao: { flex: 1, height: 110, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: C.linha, backgroundColor: C.cartao2, alignItems: 'center', justifyContent: 'center', gap: 8 },
  escolhaTexto: { fontFamily: F.textoForte, color: C.texto, fontSize: 14 },
  fotoCaixa: { borderRadius: 12, overflow: 'hidden', backgroundColor: C.cartao2 },
  foto: { width: '100%', height: 240 },
  trocar: { position: 'absolute', right: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(7,11,18,0.75)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  trocarTexto: { fontFamily: F.textoMedio, color: C.texto, fontSize: 12 },
  texto: { minHeight: 70, maxHeight: 140, textAlignVertical: 'top', backgroundColor: C.cartao2, borderRadius: 10, borderWidth: 1, borderColor: C.linha, color: C.texto, fontFamily: F.texto, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10 },
  seg: { flexDirection: 'row', backgroundColor: C.cartao2, borderRadius: 10, padding: 3 },
  segItem: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segAtivo: { backgroundColor: C.ciano },
  segTexto: { fontFamily: F.textoForte, color: C.suave, fontSize: 14 },
  criar: { marginTop: 6, height: 50, borderRadius: 12, backgroundColor: C.laranja, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  criarTexto: { fontFamily: F.titulo, color: C.fundo, fontSize: 16, letterSpacing: 0.4 },
  duplo: { flexDirection: 'row', gap: 10 },
  secundario: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: C.linha, backgroundColor: C.cartao2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  secundarioTexto: { fontFamily: F.textoForte, color: C.texto, fontSize: 14 },
  nota: { fontFamily: F.texto, color: C.fraco, fontSize: 12, textAlign: 'center' },
  erro: { fontFamily: F.textoMedio, color: C.erro, fontSize: 13, textAlign: 'center' },
  andamento: { marginTop: 2, gap: 10 },
  etapa: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  etapaTexto: { flex: 1, fontFamily: F.textoMedio, color: C.fraco, fontSize: 14 },
  pct: { fontFamily: F.tituloMedio, color: C.ciano, fontSize: 13 },
  aviso: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: C.cianoEscuro, borderRadius: 10, padding: 10 },
  avisoTexto: { flex: 1, fontFamily: F.textoMedio, color: C.texto, fontSize: 13, lineHeight: 18 },
  visor: { height: 340, borderRadius: 12, overflow: 'hidden', backgroundColor: C.cartao2 },
  fotosLinha: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fotoMini: { width: 46, height: 46, borderRadius: 8, backgroundColor: C.cartao2 },
  fotoEspera: { alignItems: 'center', justifyContent: 'center' },
  fotosTexto: { flex: 1, fontFamily: F.texto, color: C.suave, fontSize: 12 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.cartao, borderRadius: 12, borderWidth: 1, borderColor: C.linha, padding: 10 },
  mini: { width: 48, height: 48, borderRadius: 8, backgroundColor: C.cartao2 },
  linhaNome: { fontFamily: F.textoForte, color: C.texto, fontSize: 14 },
  linhaSubLinha: { flexDirection: 'row', alignItems: 'center' },
  linhaSub: { fontFamily: F.texto, color: C.suave, fontSize: 12 },
  icone: { padding: 6 },
  apagarSim: { backgroundColor: C.erro, borderRadius: 8, paddingHorizontal: 8 },
  apagarTexto: { fontFamily: F.textoForte, color: C.fundo, fontSize: 12 },
});

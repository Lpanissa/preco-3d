// Servidor do "Criar 3D" do app Preço 3D (Supabase Edge Function "tripo").
// - A chave do Tripo fica só aqui, nos segredos do Supabase (TRIPO_API_KEY).
// - O app manda a mesma senha da EDITH no cabeçalho x-senha (segredo APP_SENHA).
// - Os trabalhos ficam no banco do Supabase (tabela modelos3d_trabalhos) e os arquivos no Storage (modelos3d).
// - O trabalho anda sozinho no servidor (agendador a cada minuto), então o app pode ser fechado.
//   Etapas: limpando (foto com fundo branco, Nano Banana Pro do Google) -> criando (3D) -> pronto
//           -> convertendo (STL/3MF, quando pedido) -> arquivo_pronto.   Falha: erro.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const TRIPO = "https://openapi.tripo3d.ai/v3";
const BALDE = "modelos3d";
const TABELA = "modelos3d_trabalhos";
const ATIVAS = ["limpando", "criando", "convertendo"];

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function igual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function tripo(caminho: string, init: RequestInit = {}) {
  const r = await fetch(TRIPO + caminho, {
    ...init,
    headers: { Authorization: "Bearer " + (Deno.env.get("TRIPO_API_KEY") || ""), ...(init.headers || {}) },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.code !== 0) {
    const cod = d.code ?? r.status;
    const erro = cod === 2010 || r.status === 403 ? "creditos" : cod === 2000 || r.status === 429 ? "limite" : r.status === 401 ? "chave" : "tripo";
    throw new Error(erro);
  }
  return d.data;
}
const postar = (caminho: string, corpo: unknown) =>
  tripo(caminho, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });

// guarda um arquivo do Tripo (os links de lá vencem em 5 minutos)
async function guardarDeLink(url: string, caminho: string, tipo: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("baixar");
  const { error } = await sb.storage.from(BALDE).upload(caminho, new Uint8Array(await r.arrayBuffer()), { contentType: tipo, upsert: true });
  if (error) throw new Error("guardar");
  return caminho;
}

const comecarModelo = (origem: string, detalhado: boolean) =>
  postar("/generation/image-to-model", {
    input: origem,
    model: "v3.1-20260211",
    texture: true,
    pbr: false,
    enable_image_autofix: true,
    geometry_quality: detalhado ? "detailed" : "standard",
  }).then((t) => t.task_id as string);

const urlImagem = (o: Record<string, unknown>) =>
  (o.generated_image_url || o.image_url || o.rendered_image_url || (Array.isArray(o.images) ? o.images[0] : null)) as string | null;

// confere um trabalho no Tripo e passa para a próxima etapa quando a atual termina
async function avancar(t: Record<string, any>) {
  if (!ATIVAS.includes(t.etapa) || !t.tarefa) return;
  const mudar = async (m: Record<string, unknown>) => {
    await sb.from(TABELA).update({ ...m, atualizado: new Date().toISOString() }).eq("id", t.id);
  };
  try {
    const s = await tripo("/tasks/" + encodeURIComponent(t.tarefa));
    if (["failed", "cancelled", "banned", "expired"].includes(s.status)) {
      return mudar({ etapa: "erro", erro: "falhou" });
    }
    if (s.status !== "success") return mudar({ progresso: Number(s.progress || 0) });
    const o = s.output || {};
    const pasta = t.id;
    if (t.etapa === "limpando") {
      const img = urlImagem(o);
      const foto_limpa = img ? await guardarDeLink(img, `${pasta}/foto-limpa.png`, "image/png").catch(() => null) : null;
      const tarefa = await comecarModelo(t.tarefa, t.detalhado);
      return mudar({ etapa: "criando", progresso: 0, origem: t.tarefa, tarefa, foto_limpa });
    }
    if (t.etapa === "criando") {
      const glbUrl = o.pbr_model_url || o.model_url;
      if (!glbUrl) return mudar({ etapa: "erro", erro: "falhou" });
      const glb = await guardarDeLink(glbUrl, `${pasta}/${t.tarefa}.glb`, "model/gltf-binary");
      const previa = o.rendered_image_url
        ? await guardarDeLink(o.rendered_image_url, `${pasta}/${t.tarefa}.png`, "image/png").catch(() => null)
        : null;
      return mudar({ etapa: "pronto", progresso: 100, tarefa_modelo: t.tarefa, tarefa: null, glb, previa });
    }
    if (t.etapa === "convertendo") {
      if (!o.model_url) return mudar({ etapa: "erro", erro: "falhou" });
      const ext = t.formato === "3MF" ? "3mf" : "stl";
      const arquivo = await guardarDeLink(o.model_url, `${pasta}/modelo.${ext}`, ext === "3mf" ? "model/3mf" : "model/stl");
      return mudar({ etapa: "arquivo_pronto", progresso: 100, tarefa: null, arquivo });
    }
  } catch (e) {
    const m = (e as Error).message;
    // falta de créditos ou chave errada param o trabalho; o resto tenta de novo no próximo minuto
    if (["creditos", "chave"].includes(m)) await mudar({ etapa: "erro", erro: m });
  }
}

async function avancarTodos() {
  const { data } = await sb.from(TABELA).select("*").in("etapa", ATIVAS).order("criado").limit(20);
  await Promise.all((data || []).map(avancar));
}

// links de 7 dias para o app ver as fotos, o 3D e o arquivo
async function comLinks(t: Record<string, any>) {
  const chaves = ["foto", "foto_limpa", "previa", "glb", "arquivo"].filter((k) => t[k]);
  const out: Record<string, unknown> = { ...t };
  if (chaves.length) {
    const { data } = await sb.storage.from(BALDE).createSignedUrls(chaves.map((k) => t[k]), 60 * 60 * 24 * 7);
    chaves.forEach((k, i) => (out[k] = data?.[i]?.signedUrl || null));
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ erro: "metodo" }, 405);

  // chamada do agendador do próprio Supabase (a cada minuto, só quando há trabalho andando)
  const cron = req.headers.get("x-cron") || "";
  if (cron) {
    const { data } = await sb.from("tripo_config").select("valor").eq("chave", "cron").single();
    if (!igual(data?.valor || "", cron)) return json({ erro: "cron" }, 401);
    await avancarTodos();
    return json({ ok: true });
  }

  if (!Deno.env.get("TRIPO_API_KEY")) return json({ erro: "sem_chave" }, 500);
  if (!igual(Deno.env.get("APP_SENHA") || "", req.headers.get("x-senha") || "")) {
    await new Promise((r) => setTimeout(r, 600));
    return json({ erro: "senha" }, 401);
  }

  try {
    const b = await req.json();

    // foto nova -> guarda, manda limpar (fundo branco + texto) e o resto anda sozinho
    if (b.acao === "criar") {
      const bin = Uint8Array.from(atob(String(b.imagem || "")), (c) => c.charCodeAt(0));
      if (bin.length < 1000 || bin.length > 15_000_000) return json({ erro: "foto" }, 400);
      const id = crypto.randomUUID();
      const foto = `${id}/foto.jpg`;
      await sb.storage.from(BALDE).upload(foto, bin, { contentType: "image/jpeg", upsert: true });
      const fd = new FormData();
      fd.append("file", new Blob([bin], { type: "image/jpeg" }), "foto.jpg");
      const up = await tripo("/files", { method: "POST", body: fd });
      const detalhe = String(b.detalhe || "").trim().slice(0, 600);
      const t = await postar("/generation/image-to-image", {
        input: up.file_token,
        model: "banana_pro", // Nano Banana Pro, o editor de imagem do Google (Gemini), pelo próprio Tripo
        prompt:
          "Clean up this photo so it can become a 3D printed figurine. Keep only the main subject, whole and centered, " +
          "on a plain pure white background; remove the background, clutter and shadows. Keep the subject's look, face, " +
          "proportions and colors faithful to the photo." +
          (detalhe ? " Also follow these instructions from the user (written in Portuguese): " + detalhe : ""),
      });
      const { error } = await sb.from(TABELA).insert({ id, etapa: "limpando", detalhe, detalhado: !!b.detalhado, tarefa: t.task_id, foto });
      if (error) return json({ erro: "guardar" }, 500);
      return json({ id });
    }

    // lista dos trabalhos (e já confere os que estão andando)
    if (b.acao === "lista") {
      await avancarTodos();
      const { data } = await sb.from(TABELA).select("*").order("criado", { ascending: false }).limit(30);
      return json({ trabalhos: await Promise.all((data || []).map(comLinks)) });
    }

    const { data: t } = await sb.from(TABELA).select("*").eq("id", String(b.id || "")).maybeSingle();
    if (!t) return json({ erro: "sumiu" }, 404);

    // refazer: outra versão do 3D com a mesma foto limpa (vira um item novo, o antigo fica)
    if (b.acao === "refazer") {
      if (!t.origem) return json({ erro: "origem" }, 400);
      const tarefa = await comecarModelo(t.origem, !!t.detalhado);
      const id = crypto.randomUUID();
      const copia: Record<string, string | null> = { foto: null, foto_limpa: null };
      for (const k of ["foto", "foto_limpa"]) {
        if (!t[k]) continue;
        const destino = `${id}/${String(t[k]).split("/").pop()}`;
        const { error } = await sb.storage.from(BALDE).copy(t[k], destino);
        copia[k] = error ? null : destino;
      }
      await sb.from(TABELA).insert({
        id, etapa: "criando", detalhe: t.detalhe, detalhado: t.detalhado, origem: t.origem, tarefa, ...copia,
      });
      return json({ id });
    }

    // ficou bom -> converte para STL ou 3MF, em pé e com a base reta
    if (b.acao === "converter") {
      if (!t.tarefa_modelo) return json({ erro: "nao_pronto" }, 409);
      const formato = b.formato === "3MF" ? "3MF" : "STL";
      const c = await postar("/models/convert", {
        input: t.tarefa_modelo,
        format: formato,
        pivot_to_center_bottom: true,
        flatten_bottom: true,
      });
      await sb.from(TABELA)
        .update({ etapa: "convertendo", progresso: 0, formato, tarefa: c.task_id, arquivo: null, atualizado: new Date().toISOString() })
        .eq("id", t.id);
      return json({ ok: true });
    }

    if (b.acao === "apagar") {
      const { data: arqs } = await sb.storage.from(BALDE).list(t.id);
      if (arqs?.length) await sb.storage.from(BALDE).remove(arqs.map((a) => `${t.id}/${a.name}`));
      await sb.from(TABELA).delete().eq("id", t.id);
      return json({ ok: true });
    }

    return json({ erro: "acao" }, 400);
  } catch (e) {
    return json({ erro: (e as Error).message || "falha" }, 502);
  }
});

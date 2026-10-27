#!/usr/bin/env node
// Verificações automáticas do site gerado em dist/.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/site.json'), 'utf8'));
const veiculos = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/veiculos.json'), 'utf8')).filter((v) => v.ativo !== false);

const errors = [];
const notes = [];
const fail = (m) => errors.push(m);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const htmlFiles = walk(DIST).filter((f) => f.endsWith('.html'));
const rel = (f) => '/' + path.relative(DIST, f);

function resolveInternal(href) {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean) return true;
  const p = path.join(DIST, clean);
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return true;
  if (fs.existsSync(path.join(p, 'index.html'))) return true;
  return false;
}

const WA_BASE = `https://wa.me/${cfg.whatsapp}`;
const waMessages = new Map();

for (const f of htmlFiles) {
  const html = fs.readFileSync(f, 'utf8');
  const name = rel(f);

  // título, descrição, h1
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];
  if (!title) fail(`${name}: sem <title>`);
  if (!desc) fail(`${name}: sem meta description`);
  const h1s = (html.match(/<h1[\s>]/g) || []).length;
  if (h1s !== 1) fail(`${name}: esperado 1 <h1>, encontrado ${h1s}`);
  notes.push({ name, title, desc });

  // links e recursos
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const url = m[1];
    if (url === '#' || url === '') fail(`${name}: link vazio`);
    else if (url.startsWith('https://wa.me/')) {
      if (!url.startsWith(WA_BASE + '?text=')) fail(`${name}: link do WhatsApp com número errado: ${url}`);
      waMessages.set(decodeURIComponent(url.split('?text=')[1] || ''), name);
    } else if (url.startsWith('/')) {
      if (!resolveInternal(url)) fail(`${name}: link interno quebrado → ${url}`);
    } else if (url.startsWith('#')) {
      if (!html.includes(`id="${url.slice(1)}"`)) fail(`${name}: âncora inexistente ${url}`);
    }
  }
  for (const m of html.matchAll(/srcset="([^"]+)"/g)) {
    for (const part of m[1].split(',')) {
      const u = part.trim().split(/\s+/)[0];
      if (u.startsWith('/') && !resolveInternal(u)) fail(`${name}: imagem do srcset ausente → ${u}`);
    }
  }
  // imagens com alt
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\salt="[^"]+"/.test(m[0])) fail(`${name}: <img> sem alt: ${m[0].slice(0, 80)}`);
  }
  // botões sem texto
  for (const m of html.matchAll(/<a\b[^>]*class="btn[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
    if (!m[1].replace(/<[^>]+>/g, '').trim()) fail(`${name}: botão sem texto`);
  }
  // conteúdo fictício
  if (/★|⭐|estrelas?\b/i.test(html)) fail(`${name}: possível avaliação/estrela fictícia`);
  const prices = [...html.matchAll(/R\$\s?[\d.,]+/g)].map((m) => m[0]);
  const permitidos = veiculos.filter((v) => typeof v.diaria === 'number').length;
  if (prices.length && !permitidos) fail(`${name}: preço exibido sem preço cadastrado: ${prices.join(', ')}`);
}

// páginas obrigatórias
for (const p of ['index.html', 'veiculos/index.html', 'sobre/index.html', 'contato/index.html', 'perguntas-frequentes/index.html', 'obrigado/index.html', '404.html', 'politica-de-privacidade/index.html', 'robots.txt']) {
  if (!fs.existsSync(path.join(DIST, p))) fail(`arquivo obrigatório ausente: ${p}`);
}
for (const v of veiculos) {
  if (!fs.existsSync(path.join(DIST, 'veiculos', v.slug, 'index.html'))) fail(`página do veículo ausente: ${v.slug}`);
  // mensagem personalizada
  const esperada = `Olá! Vi o ${v.marca} ${v.modelo} no site da FORT Locadora de Veículos e gostaria de consultar a disponibilidade, o valor da diária e as condições de locação.`;
  if (!waMessages.has(esperada)) fail(`mensagem personalizada do WhatsApp ausente para ${v.marca} ${v.modelo}`);
}
if (!waMessages.has(cfg.mensagemGeral)) fail('mensagem geral do WhatsApp ausente');

// obrigado e 404 não indexáveis; sitemap
for (const p of ['obrigado/index.html', '404.html']) {
  const f = path.join(DIST, p);
  if (fs.existsSync(f) && !fs.readFileSync(f, 'utf8').includes('noindex')) fail(`${p} deveria ter noindex`);
}
const sm = path.join(DIST, 'sitemap.xml');
if (fs.existsSync(sm)) {
  const x = fs.readFileSync(sm, 'utf8');
  if (/obrigado|404/.test(x)) fail('sitemap inclui obrigado ou 404');
  for (const m of x.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const u = new URL(m[1]);
    if (!resolveInternal(u.pathname)) fail(`sitemap aponta para página inexistente: ${m[1]}`);
  }
  const robots = fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8');
  if (!robots.includes('Sitemap:')) fail('robots.txt sem linha Sitemap');
} else {
  notes.push({ name: 'sitemap.xml', title: 'não gerado (siteUrl vazio)', desc: '' });
}

// JSON-LD válido
for (const f of htmlFiles) {
  const html = fs.readFileSync(f, 'utf8');
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch { fail(`${rel(f)}: JSON-LD inválido`); }
  }
}
const home = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
if (!home.includes('"@type":"AutoRental"')) fail('home sem JSON-LD AutoRental');
if (/"address"/.test(home) && !(cfg.endereco && cfg.endereco.logradouro)) fail('JSON-LD com endereço sem endereço cadastrado');

// títulos e descrições únicos
const titles = notes.filter((n) => n.desc).map((n) => n.title);
const descs = notes.filter((n) => n.desc).map((n) => n.desc);
if (new Set(titles).size !== titles.length) fail('há títulos SEO repetidos');
if (new Set(descs).size !== descs.length) fail('há meta descriptions repetidas');

console.log(`${htmlFiles.length} páginas HTML verificadas; ${waMessages.size} mensagens distintas de WhatsApp.`);
if (errors.length) {
  console.log(`\n${errors.length} problema(s):`);
  for (const e of errors) console.log(' ✗', e);
  process.exit(1);
}
console.log('Tudo certo: links, WhatsApp, metadados, alt das imagens e conteúdo sem dados fictícios.');

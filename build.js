#!/usr/bin/env node
/**
 * Gerador do site da FORT Locadora de Veículos.
 * Lê config/ e data/, gera o site estático em dist/.
 *   node build.js            → usa siteUrl de config/site.json
 *   SITE_URL=https://... node build.js  → sobrescreve o domínio (testes)
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let sharp = null;
try { sharp = require('sharp'); } catch { /* otimização de imagens é opcional */ }

const cfg = readJson('config/site.json');
const SITE_URL = (process.env.SITE_URL || cfg.siteUrl || '').replace(/\/+$/, '');
const GA_ID = (process.env.GA_ID || cfg.googleAnalyticsId || '').trim();
const YEAR = new Date().getFullYear();
const warnings = [];
let HAS_FONT = false;

const veiculos = readJson('data/veiculos.json').filter((v) => v.ativo !== false);
const avaliacoes = readJson('data/avaliacoes.json');
const experiencias = readJson('data/experiencias.json');
const faq = readJson('data/faq.json');

const VIEWS = [
  { key: 'principal', label: 'Vista frontal e lateral', file: 'principal' },
  { key: 'frente', label: 'Vista frontal', file: 'frente' },
  { key: 'traseira', label: 'Traseira', file: 'traseira' },
  { key: 'lado-esquerdo', label: 'Lateral esquerda', file: 'lado-esquerdo' },
  { key: 'lado-direito', label: 'Lateral direita', file: 'lado-direito' },
];
const CARD_VIEW = 'lado-esquerdo';
const cardPhoto = (photos) => photos.principal || photos[CARD_VIEW] || Object.values(photos)[0];

// ---------- utilidades ----------
const wa = (msg) => `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(msg)}`;
const waVeiculo = (v) =>
  wa(`Olá! Vi o ${v.marca} ${v.modelo} no site da FORT Locadora de Veículos e gostaria de consultar a disponibilidade, o valor da diária e as condições de locação.`);
const nomeVeiculo = (v) => `${v.marca} ${v.modelo}`;
const preco = (v) =>
  typeof v.diaria === 'number' ? `R$ ${v.diaria.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;
const abs = (p) => (SITE_URL ? SITE_URL + p : null);
const hasEndereco = () => Boolean(cfg.endereco && cfg.endereco.logradouro && cfg.endereco.logradouro.trim());
const enderecoTexto = () =>
  [cfg.endereco.logradouro, cfg.endereco.bairro, `${cfg.cidade} - ${cfg.uf}`, cfg.endereco.cep].filter(Boolean).join(', ');

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function writeOut(rel, content) {
  const full = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}
function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

// ---------- fotos ----------
function findOriginal(dir, name) {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const f = path.join(dir, `${name}.${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

async function processPhotos(v) {
  const out = {};
  const dir = path.join(ROOT, 'fotos-originais', v.slug);
  if (!fs.existsSync(dir)) return out;
  for (const view of VIEWS) {
    const file = findOriginal(dir, view.file);
    if (!file) continue;
    const base = `img/veiculos/${v.slug}/${view.file}`;
    if (sharp) {
      const meta = await sharp(file).metadata();
      if (meta.width / meta.height > 2.2) {
        warnings.push(`${path.relative(ROOT, file)} parece uma colagem com várias vistas; use um arquivo por foto.`);
      }
      const w1 = Math.min(meta.width, 1600);
      const h1 = Math.round((meta.height * w1) / meta.width);
      await sharp(file).rotate().resize({ width: w1 }).webp({ quality: 80 }).toFile(ensureDir(path.join(DIST, `${base}-${w1}.webp`)));
      let srcset = `/${base}-${w1}.webp ${w1}w`;
      let src = `/${base}-${w1}.webp`;
      if (meta.width > 800) {
        await sharp(file).rotate().resize({ width: 800 }).webp({ quality: 78 }).toFile(ensureDir(path.join(DIST, `${base}-800.webp`)));
        srcset = `/${base}-800.webp 800w, ${srcset}`;
        src = `/${base}-800.webp`;
      }
      out[view.key] = { src, srcset, width: w1, height: h1, view };
    } else {
      const ext = path.extname(file);
      fs.mkdirSync(path.join(DIST, `img/veiculos/${v.slug}`), { recursive: true });
      fs.copyFileSync(file, path.join(DIST, `${base}${ext}`));
      out[view.key] = { src: `/${base}${ext}`, srcset: null, width: null, height: null, view };
    }
  }
  return out;
}
function ensureDir(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); return file; }

const altFoto = (v, view) => `${view.label} do ${nomeVeiculo(v)}`;

function imgTag(v, photo, { lazy = true, sizes = '(min-width: 960px) 33vw, (min-width: 640px) 50vw, 100vw', cls = '' } = {}) {
  const dims = photo.width ? ` width="${photo.width}" height="${photo.height}"` : '';
  const srcset = photo.srcset ? ` srcset="${photo.srcset}" sizes="${sizes}"` : '';
  return `<img${cls ? ` class="${cls}"` : ''} src="${photo.src}"${srcset}${dims} alt="${esc(altFoto(v, photo.view))}" ${lazy ? 'loading="lazy" decoding="async"' : 'fetchpriority="high"'}>`;
}

// ---------- layout ----------
const NAV = [
  { href: '/', label: 'Início' },
  { href: '/veiculos/', label: 'Veículos' },
  { href: '/sobre/', label: 'Sobre a FORT' },
  { href: '/perguntas-frequentes/', label: 'Perguntas frequentes' },
  { href: '/contato/', label: 'Contato' },
];

function jsonLd(obj) { return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`; }

function autoRentalLd() {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'AutoRental',
    name: cfg.nome,
    telephone: cfg.telefoneE164,
    areaServed: { '@type': 'City', name: cfg.cidade, containedInPlace: { '@type': 'AdministrativeArea', name: cfg.estado } },
  };
  if (SITE_URL) ld.url = SITE_URL + '/';
  if (cfg.instagram) ld.sameAs = [cfg.instagram];
  if (hasEndereco()) {
    ld.address = {
      '@type': 'PostalAddress',
      streetAddress: cfg.endereco.logradouro,
      addressLocality: cfg.cidade,
      addressRegion: cfg.uf,
      addressCountry: 'BR',
      ...(cfg.endereco.cep ? { postalCode: cfg.endereco.cep } : {}),
    };
  }
  return ld;
}

function breadcrumbHtml(items) {
  if (!items || items.length < 2) return '';
  const lis = items
    .map((it, i) => (i === items.length - 1 ? `<li aria-current="page">${esc(it.label)}</li>` : `<li><a href="${it.href}">${esc(it.label)}</a></li>`))
    .join('');
  return `<nav class="breadcrumb" aria-label="Você está em"><ol>${lis}</ol></nav>`;
}
function breadcrumbLd(items) {
  if (!SITE_URL || !items || items.length < 2) return '';
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.label, ...(it.href ? { item: SITE_URL + it.href } : i === items.length - 1 ? { item: SITE_URL + it.self } : {}) })),
  });
}

function layout({ path: pth, title, description, body, breadcrumbs, noindex = false, ld = [], ogImage = null, current = '' }) {
  const canonical = !noindex && SITE_URL ? `<link rel="canonical" href="${SITE_URL}${pth}">` : '';
  const ogUrl = SITE_URL ? `<meta property="og:url" content="${SITE_URL}${pth}">` : '';
  const ogImg = ogImage && SITE_URL ? `<meta property="og:image" content="${SITE_URL}${ogImage}">` : '';
  const nav = NAV.map((n) => `<li><a href="${n.href}"${n.href === '/perguntas-frequentes/' ? ' class="nav__faq"' : ''}${current === n.href ? ' aria-current="page"' : ''}>${esc(n.label)}</a></li>`).join('');
  const footNav = NAV.map((n) => `<li><a href="${n.href}">${esc(n.label)}</a></li>`).join('');
  const insta = cfg.instagram ? `<li><a href="${esc(cfg.instagram)}" rel="noopener" target="_blank">Instagram</a></li>` : '';
  const consent = GA_ID
    ? `<div class="consent" id="consent" role="dialog" aria-live="polite" aria-label="Cookies e privacidade" hidden>
  <p>Usamos o Google Analytics para entender como o site é usado (páginas visitadas e cliques nos botões). Só ativamos com a sua permissão. <a href="/politica-de-privacidade/">Saiba mais</a></p>
  <div class="consent__actions"><button type="button" class="btn btn--ghost" data-consent="denied">Recusar</button><button type="button" class="btn" data-consent="granted">Aceitar</button></div>
</div>`
    : '';
  return `<!doctype html>
<html lang="pt-BR" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}
${canonical}
<meta property="og:type" content="website">
<meta property="og:locale" content="pt_BR">
<meta property="og:site_name" content="${esc(cfg.nome)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${ogUrl}
${ogImg}
<meta name="theme-color" content="#000000">
<link rel="icon" href="/assets/img/favicon.png" type="image/png">
${HAS_FONT ? '<link rel="preload" href="/assets/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>' : ''}
<link rel="stylesheet" href="/assets/style.css">
${ld.join('\n')}
<script>document.documentElement.className='js';window.FORT={gaId:${JSON.stringify(GA_ID)}};</script>
</head>
<body>
<a class="skip" href="#conteudo">Ir para o conteúdo</a>
<header class="site-header">
  <div class="container site-header__inner">
    <a class="brand" href="/" aria-label="${esc(cfg.nome)} — página inicial"><img src="/assets/img/logo-preta.png" width="1051" height="371" alt="${esc(cfg.nome)}"></a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="menu"><span class="nav-toggle__label">Menu</span></button>
    <nav class="nav" id="menu" aria-label="Principal">
      <ul>${nav}</ul>
      <a class="btn btn--sm nav__cta" href="${wa(cfg.mensagemGeral)}" target="_blank" rel="noopener" data-wa="cabecalho">Consultar disponibilidade</a>
    </nav>
  </div>
</header>
<main id="conteudo">
${breadcrumbs ? `<div class="container">${breadcrumbHtml(breadcrumbs)}</div>` : ''}
${body}
</main>
<footer class="site-footer">
  <div class="container footer__grid">
    <div>
      <img class="footer__logo" src="/assets/img/logo-branca.png" width="1051" height="371" alt="${esc(cfg.nome)}" loading="lazy">
      <p>${esc(cfg.cidade)} - ${esc(cfg.uf)}</p>
      <p><a href="${wa(cfg.mensagemGeral)}" target="_blank" rel="noopener" data-wa="rodape">WhatsApp ${esc(cfg.telefoneExibicao)}</a></p>
    </div>
    <nav aria-label="Rodapé"><ul>${footNav}<li><a href="/politica-de-privacidade/">Política de privacidade</a></li>${insta}</ul></nav>
  </div>
  <div class="container footer__legal"><p>© ${YEAR} ${esc(cfg.nome)}. Todos os direitos reservados.</p></div>
</footer>
<a class="wa-fab" href="${wa(cfg.mensagemGeral)}" target="_blank" rel="noopener" data-wa="flutuante" aria-label="Falar pelo WhatsApp">
  <span>WhatsApp</span>
</a>
${consent}
<script src="/assets/script.js" defer></script>
</body>
</html>
`;
}

// ---------- componentes ----------
function vehicleCard(v, photos) {
  const p = cardPhoto(photos);
  const media = p
    ? `<a class="card__media" href="/veiculos/${v.slug}/" tabindex="-1" aria-hidden="true">${imgTag(v, p)}</a>`
    : `<a class="card__media card__media--empty" href="/veiculos/${v.slug}/" tabindex="-1" aria-hidden="true"><span>Foto em breve</span></a>`;
  const specs = [
    v.ano ? ['Ano', v.ano] : null,
    v.categoria ? ['Categoria', v.categoria] : null,
    v.transmissao ? ['Transmissão', v.transmissao] : null,
    v.lugares ? ['Lugares', v.lugares] : null,
  ].filter(Boolean);
  const specsHtml = specs.length ? `<dl class="specs">${specs.map(([k, val]) => `<div><dt>${k}</dt><dd>${esc(val)}</dd></div>`).join('')}</dl>` : '';
  const pr = preco(v);
  return `<article class="card" data-vehicle="${esc(nomeVeiculo(v))}">
  ${media}
  <div class="card__body">
    <h3 class="card__title"><a href="/veiculos/${v.slug}/">${esc(nomeVeiculo(v))}</a></h3>
    ${specsHtml}
    <p class="card__price">${pr ? `Diária: <strong>${pr}</strong>` : '<strong>Consulte o valor</strong>'}</p>
    <p class="card__note">Condições: ${v.condicoes ? esc(v.condicoes) : 'consulte a empresa.'}</p>
    <div class="card__actions">
      <a class="btn" href="${waVeiculo(v)}" target="_blank" rel="noopener" data-wa="cartao" data-vehicle="${esc(nomeVeiculo(v))}">Consultar disponibilidade</a>
      <a class="link" href="/veiculos/${v.slug}/">Ver detalhes<span class="sr-only"> do ${esc(nomeVeiculo(v))}</span></a>
    </div>
  </div>
</article>`;
}

function catalog(list, photosBySlug) {
  if (!list.length) {
    return `<p class="empty">No momento não há veículos cadastrados no site. Fale com a equipe da FORT pelo WhatsApp para consultar os carros disponíveis.</p>
<p><a class="btn" href="${wa(cfg.mensagemGeral)}" target="_blank" rel="noopener" data-wa="catalogo-vazio">Falar pelo WhatsApp</a></p>`;
  }
  return `<div class="grid">${list.map((v) => vehicleCard(v, photosBySlug[v.slug])).join('\n')}</div>`;
}

function reviewsSection() {
  const ok = avaliacoes.filter((a) => a && a.comentario && a.fonte);
  if (!ok.length) return '';
  const items = ok
    .map((a) => `<figure class="review">
  ${a.nota ? `<p class="review__score">Nota: ${esc(a.nota)}</p>` : ''}
  <blockquote><p>${esc(a.comentario)}</p></blockquote>
  <figcaption>${a.nome ? esc(a.nome) : 'Cliente'}${a.data ? ` · ${esc(a.data)}` : ''} · Fonte: ${a.url ? `<a href="${esc(a.url)}" rel="noopener" target="_blank">${esc(a.fonte)}</a>` : esc(a.fonte)}</figcaption>
</figure>`)
    .join('');
  return `<section class="section"><div class="container"><h2>Avaliações de clientes</h2><div class="reviews">${items}</div></div></section>`;
}

function experiencesSection() {
  const ok = experiencias.filter((e) => e && e.titulo && e.texto && e.autorizado === true);
  if (!ok.length) return '';
  const items = ok.map((e) => `<article class="exp"><h3>${esc(e.titulo)}</h3><p>${esc(e.texto)}</p></article>`).join('');
  return `<section class="section section--alt"><div class="container"><h2>Experiências com a FORT</h2><div class="grid">${items}</div></div></section>`;
}

function ctaBand(title, text, label, tag) {
  return `<section class="section cta-band"><div class="container cta-band__inner"><div><h2>${esc(title)}</h2><p>${esc(text)}</p></div><a class="btn btn--invert" href="${wa(cfg.mensagemGeral)}" target="_blank" rel="noopener" data-wa="${tag}">${esc(label)}</a></div></section>`;
}

function faqHtml() {
  return `<div class="faq">${faq.map((f) => `<details><summary>${esc(f.pergunta)}</summary><p>${esc(f.resposta)}</p></details>`).join('')}</div>`;
}

// ---------- páginas ----------
async function build() {
  rmrf(DIST);
  fs.mkdirSync(DIST, { recursive: true });

  const photosBySlug = {};
  for (const v of veiculos) photosBySlug[v.slug] = await processPhotos(v);

  const pages = []; // para sitemap

  // assets
  copyDir(path.join(ROOT, 'src/assets'), path.join(DIST, 'assets'));
  const fontSrc = path.join(ROOT, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2');
  if (fs.existsSync(fontSrc)) {
    fs.mkdirSync(path.join(DIST, 'assets/fonts'), { recursive: true });
    fs.copyFileSync(fontSrc, path.join(DIST, 'assets/fonts/inter-latin-wght-normal.woff2'));
    HAS_FONT = true;
  } else {
    warnings.push('Fonte Inter não encontrada (rode "npm install"); o site usa fontes do sistema até lá.');
  }

  // Início
  const heroV = veiculos.find((v) => cardPhoto(photosBySlug[v.slug]));
  const heroPhoto = heroV ? cardPhoto(photosBySlug[heroV.slug]) : null;
  const home = `<section class="hero">
  <div class="container hero__inner">
    <div class="hero__text">
      <p class="eyebrow">${esc(cfg.cidade)} - ${esc(cfg.uf)} · Aluguel de carros</p>
      <h1>Seu próximo destino começa aqui.</h1>
      <p class="lead">Encontre o veículo ideal para sua rotina, viagem ou trabalho. Consulte nossos carros disponíveis e fale diretamente com a FORT Locadora de Veículos.</p>
      <div class="actions">
        <a class="btn" href="/veiculos/">Ver veículos disponíveis</a>
        <a class="btn btn--ghost" href="${wa(cfg.mensagemGeral)}" target="_blank" rel="noopener" data-wa="hero">Falar pelo WhatsApp</a>
        <a class="btn btn--ghost" href="/perguntas-frequentes/">Perguntas frequentes</a>
      </div>
      <p class="hero__meta">Atendimento em ${esc(cfg.cidade)} - ${esc(cfg.uf)} · WhatsApp ${esc(cfg.telefoneExibicao)}</p>
    </div>
    ${heroPhoto ? `<div class="hero__media">${imgTag(heroV, heroPhoto, { lazy: false, sizes: '(min-width: 960px) 50vw, 100vw' })}</div>` : ''}
  </div>
</section>
<section class="section" id="veiculos">
  <div class="container">
    <div class="section__head"><h2>Nossos veículos</h2><a class="link" href="/veiculos/">Ver todos os veículos</a></div>
    ${catalog(veiculos, photosBySlug)}
  </div>
</section>
<section class="section section--alt">
  <div class="container narrow">
    <h2>Conheça a FORT</h2>
    <p>A FORT Locadora de Veículos atende em Belo Horizonte - MG. Nosso objetivo é facilitar o acesso às informações sobre os veículos disponíveis, oferecendo um canal direto para consultar valores, disponibilidade e condições de locação.</p>
    <p><a class="link" href="/sobre/">Sobre a FORT</a> · <a class="link" href="/perguntas-frequentes/">Tirar dúvidas sobre a locação</a></p>
  </div>
</section>
${experiencesSection()}
${reviewsSection()}
<section class="section faq-home" id="duvidas">
  <div class="container faq-home__inner">
    <div class="faq-home__intro">
      <p class="eyebrow">Dúvidas</p>
      <h2>Perguntas frequentes</h2>
      <p>Respostas rápidas sobre veículos, diária, pagamento e como solicitar uma locação.</p>
      <p><a class="btn btn--ghost" href="/perguntas-frequentes/">Ver todas as perguntas</a></p>
    </div>
    ${faqHtml()}
  </div>
</section>
${ctaBand('Fale com a equipe da FORT', 'Consulte disponibilidade, valor da diária e condições de locação diretamente pelo WhatsApp.', 'Solicitar informações', 'home-cta')}`;
  writeOut('index.html', layout({
    path: '/',
    title: 'FORT Locadora de Veículos | Aluguel de Carros em Belo Horizonte',
    description: 'Conheça a FORT Locadora de Veículos em Belo Horizonte - MG. Consulte os carros disponíveis, os valores das diárias e as condições de locação pelo WhatsApp.',
    body: home,
    current: '/',
    ld: [jsonLd(autoRentalLd())],
    ogImage: heroPhoto ? heroPhoto.src : null,
  }));
  pages.push('/');

  // Veículos
  const vlist = `<section class="section"><div class="container">
  <h1>Nossos veículos</h1>
  <p class="lead">Escolha um carro e consulte a disponibilidade, o valor da diária e as condições de locação pelo WhatsApp.</p>
  ${catalog(veiculos, photosBySlug)}
  <p class="faq-hint">Dúvidas sobre valores, pagamento ou como alugar? <a class="link" href="/perguntas-frequentes/">Veja as perguntas frequentes</a>.</p>
</div></section>
${ctaBand('Não encontrou o que procura?', 'Fale com a equipe da FORT e pergunte sobre outros veículos.', 'Falar pelo WhatsApp', 'veiculos-cta')}`;
  const bcV = [{ label: 'Início', href: '/' }, { label: 'Veículos', self: '/veiculos/' }];
  writeOut('veiculos/index.html', layout({
    path: '/veiculos/',
    title: 'Veículos para Alugar em Belo Horizonte | FORT Locadora de Veículos',
    description: 'Veja os veículos da FORT Locadora de Veículos em Belo Horizonte - MG e consulte disponibilidade, valor da diária e condições de locação pelo WhatsApp.',
    body: vlist,
    breadcrumbs: bcV,
    current: '/veiculos/',
    ld: [breadcrumbLd(bcV)].filter(Boolean),
  }));
  pages.push('/veiculos/');

  // Página de cada veículo
  for (const v of veiculos) {
    const photos = photosBySlug[v.slug];
    const nome = nomeVeiculo(v);
    const pr = preco(v);
    const specs = [
      v.ano ? ['Ano', v.ano] : null,
      v.categoria ? ['Categoria', v.categoria] : null,
      v.transmissao ? ['Transmissão', v.transmissao] : null,
      v.lugares ? ['Lugares', v.lugares] : null,
    ].filter(Boolean);
    const gallery = VIEWS.filter((vw) => photos[vw.key])
      .map((vw) => `<figure>${imgTag(v, photos[vw.key], { lazy: vw.key !== Object.keys(photos)[0], sizes: '(min-width: 960px) 40vw, 100vw' })}</figure>`)
      .join('');
    const body = `<section class="section"><div class="container vehicle">
  <div class="vehicle__gallery">${gallery || '<div class="card__media card__media--empty vehicle__empty"><span>Fotos em breve</span></div>'}</div>
  <div class="vehicle__info">
    <h1>${esc(nome)}</h1>
    ${specs.length ? `<dl class="specs specs--stack">${specs.map(([k, val]) => `<div><dt>${k}</dt><dd>${esc(val)}</dd></div>`).join('')}</dl>` : ''}
    <p class="card__price">${pr ? `Diária: <strong>${pr}</strong>` : '<strong>Consulte o valor</strong>'}</p>
    <p class="card__note">Condições: ${v.condicoes ? esc(v.condicoes) : 'consulte a empresa.'}</p>
    <p class="card__note">Condições de pagamento: consulte diretamente a FORT pelo WhatsApp.</p>
    <div class="actions">
      <a class="btn" href="${waVeiculo(v)}" target="_blank" rel="noopener" data-wa="veiculo" data-vehicle="${esc(nome)}">Consultar disponibilidade</a>
      <a class="btn btn--ghost" href="/veiculos/">Ver outros veículos</a>
    </div>
    <p class="faq-hint">Dúvidas sobre a locação? <a class="link" href="/perguntas-frequentes/">Veja as perguntas frequentes</a>.</p>
  </div>
</div></section>`;
    const bc = [{ label: 'Início', href: '/' }, { label: 'Veículos', href: '/veiculos/' }, { label: nome, self: `/veiculos/${v.slug}/` }];
    const first = cardPhoto(photos);
    const carLd = { '@context': 'https://schema.org', '@type': 'Car', name: nome, brand: { '@type': 'Brand', name: v.marca }, model: v.modelo };
    if (v.ano) carLd.vehicleModelDate = String(v.ano);
    if (v.transmissao) carLd.vehicleTransmission = v.transmissao;
    if (first && SITE_URL) carLd.image = SITE_URL + first.src;
    if (SITE_URL) carLd.url = `${SITE_URL}/veiculos/${v.slug}/`;
    if (pr) carLd.offers = { '@type': 'Offer', priceCurrency: 'BRL', price: v.diaria.toFixed(2), availability: 'https://schema.org/InStock', seller: { '@type': 'AutoRental', name: cfg.nome } };
    writeOut(`veiculos/${v.slug}/index.html`, layout({
      path: `/veiculos/${v.slug}/`,
      title: `Alugar ${nome} em Belo Horizonte | FORT Locadora de Veículos`,
      description: `Consulte a disponibilidade, o valor da diária e as condições de locação do ${nome} na FORT Locadora de Veículos, em Belo Horizonte - MG.`,
      body,
      breadcrumbs: bc,
      current: '/veiculos/',
      ld: [jsonLd(carLd), breadcrumbLd(bc)].filter(Boolean),
      ogImage: first ? first.src : null,
    }).replace('<body>', `<body data-view-vehicle="${esc(nome)}">`));
    pages.push(`/veiculos/${v.slug}/`);
  }

  // Sobre
  const dif = (cfg.diferenciais || []).filter(Boolean);
  const sobre = `<section class="section"><div class="container narrow">
  <h1>Conheça a FORT</h1>
  <p class="lead">A FORT Locadora de Veículos atende em Belo Horizonte - MG. Nosso objetivo é facilitar o acesso às informações sobre os veículos disponíveis, oferecendo um canal direto para consultar valores, disponibilidade e condições de locação.</p>
  ${dif.length ? `<h2>Diferenciais</h2><ul class="list">${dif.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
  <div class="actions"><a class="btn" href="/veiculos/">Ver veículos disponíveis</a><a class="btn btn--ghost" href="${wa(cfg.mensagemGeral)}" target="_blank" rel="noopener" data-wa="sobre">Falar pelo WhatsApp</a></div>
</div></section>`;
  const bcS = [{ label: 'Início', href: '/' }, { label: 'Sobre a FORT', self: '/sobre/' }];
  writeOut('sobre/index.html', layout({
    path: '/sobre/',
    title: 'Sobre a FORT | Locadora de Veículos em Belo Horizonte',
    description: 'Conheça a FORT Locadora de Veículos, que atende em Belo Horizonte - MG com atendimento direto pelo WhatsApp para consultar valores e disponibilidade.',
    body: sobre, breadcrumbs: bcS, current: '/sobre/', ld: [breadcrumbLd(bcS)].filter(Boolean),
  }));
  pages.push('/sobre/');

  // FAQ
  const bcF = [{ label: 'Início', href: '/' }, { label: 'Perguntas frequentes', self: '/perguntas-frequentes/' }];
  const faqLd = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.pergunta, acceptedAnswer: { '@type': 'Answer', text: f.resposta } })),
  });
  writeOut('perguntas-frequentes/index.html', layout({
    path: '/perguntas-frequentes/',
    title: 'Perguntas Frequentes | FORT Locadora de Veículos',
    description: 'Tire dúvidas sobre como consultar veículos, valores de diária, pagamento e como solicitar uma locação na FORT Locadora de Veículos, em Belo Horizonte.',
    body: `<section class="faq-hero"><div class="container narrow"><p class="eyebrow">Dúvidas</p><h1>Perguntas frequentes</h1><p class="lead">Tudo o que você precisa saber para consultar um veículo e solicitar sua locação na FORT.</p></div></section>
<section class="section faq-page"><div class="container narrow">${faqHtml()}</div></section>
${ctaBand('Ainda tem dúvidas?', 'Fale direto com a equipe da FORT pelo WhatsApp e tire dúvidas sobre a locação.', 'Tirar dúvidas pelo WhatsApp', 'faq')}`,
    breadcrumbs: bcF, current: '/perguntas-frequentes/', ld: [faqLd, breadcrumbLd(bcF)].filter(Boolean),
  }));
  pages.push('/perguntas-frequentes/');

  // Contato
  const mapa = hasEndereco()
    ? `<h2>Localização</h2><p>${esc(enderecoTexto())}</p>
<div class="map"><iframe title="Mapa da localização da FORT" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${encodeURIComponent(enderecoTexto())}&output=embed"></iframe></div>
<p><a class="link" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(enderecoTexto())}" target="_blank" rel="noopener">Abrir rota no Google Maps</a></p>`
    : `<p class="area"><strong>Área de atendimento: ${esc(cfg.cidade)} - ${esc(cfg.uf)}.</strong></p>`;
  const bcC = [{ label: 'Início', href: '/' }, { label: 'Contato', self: '/contato/' }];
  writeOut('contato/index.html', layout({
    path: '/contato/',
    title: 'Contato | FORT Locadora de Veículos em Belo Horizonte',
    description: 'Fale com a FORT Locadora de Veículos pelo WhatsApp (31) 98674-2998 para consultar disponibilidade, valores e condições de locação em Belo Horizonte - MG.',
    body: `<section class="section"><div class="container narrow">
  <h1>Contato</h1>
  <p class="lead">O atendimento da FORT é feito pelo WhatsApp. Conte qual veículo você procura e a equipe responde sobre disponibilidade, valor da diária e condições de locação.</p>
  <p><a class="btn" href="${wa(cfg.mensagemGeral)}" target="_blank" rel="noopener" data-wa="contato">Falar pelo WhatsApp</a></p>
  <p>WhatsApp: <a class="link" href="${wa(cfg.mensagemGeral)}" target="_blank" rel="noopener" data-wa="contato-numero">${esc(cfg.telefoneExibicao)}</a></p>
  ${mapa}
  ${cfg.instagram ? `<p>Instagram: <a class="link" href="${esc(cfg.instagram)}" target="_blank" rel="noopener">${esc(cfg.instagram)}</a></p>` : ''}
</div></section>`,
    breadcrumbs: bcC, current: '/contato/', ld: [jsonLd(autoRentalLd()), breadcrumbLd(bcC)].filter(Boolean),
  }));
  pages.push('/contato/');

  // Política de privacidade
  const gaTxt = GA_ID
    ? `<h2>Google Analytics</h2><p>Com a sua permissão, usamos o Google Analytics 4 para medir acessos às páginas, visualizações de veículos, cliques nos botões de WhatsApp, origem do tráfego e tipo de dispositivo. Essa medição só é ativada depois que você aceita no aviso exibido no site, e você pode recusar. Os dados são processados pelo Google.</p>`
    : `<h2>Estatísticas de acesso</h2><p>Este site não usa ferramentas de medição de acesso no momento. Se isso mudar, esta política será atualizada e pediremos a sua permissão antes de coletar dados.</p>`;
  const bcP = [{ label: 'Início', href: '/' }, { label: 'Política de privacidade', self: '/politica-de-privacidade/' }];
  writeOut('politica-de-privacidade/index.html', layout({
    path: '/politica-de-privacidade/',
    title: 'Política de Privacidade | FORT Locadora de Veículos',
    description: 'Saiba como o site da FORT Locadora de Veículos trata dados pessoais: sem formulários, com contato pelo WhatsApp e medição de acessos apenas com consentimento.',
    body: `<section class="section"><div class="container narrow prose">
  <h1>Política de privacidade</h1>
  <p>Esta página explica quais dados o site da ${esc(cfg.nome)} trata. Ela descreve apenas o que o site realmente faz.</p>
  <h2>Dados que o site não coleta</h2>
  <p>O site não possui formulários, cadastro ou área de login e não armazena dados pessoais dos visitantes.</p>
  <h2>Contato pelo WhatsApp</h2>
  <p>Ao clicar em um botão de WhatsApp, você é levado ao aplicativo ou ao site do WhatsApp, com uma mensagem inicial já escrita. A partir daí, a conversa é regida pelos termos e pela política de privacidade do WhatsApp. O número e as informações que você enviar à FORT são usados apenas para o atendimento da sua solicitação.</p>
  ${gaTxt}
  <h2>Seus direitos</h2>
  <p>Conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), você pode pedir acesso, correção ou exclusão dos dados que tenha enviado à FORT. Para isso, fale com a equipe pelo WhatsApp ${esc(cfg.telefoneExibicao)}.</p>
  <p class="muted">Última atualização: ${String(new Date().getMonth() + 1).padStart(2, '0')}/${YEAR}.</p>
</div></section>`,
    breadcrumbs: bcP, ld: [breadcrumbLd(bcP)].filter(Boolean),
  }));
  pages.push('/politica-de-privacidade/');

  // Obrigado (existe pronta, mas não é linkada nem indexada: só use após um envio real de formulário)
  writeOut('obrigado/index.html', layout({
    path: '/obrigado/',
    title: 'Obrigado por entrar em contato! | FORT Locadora de Veículos',
    description: 'Confirmação de contato com a FORT Locadora de Veículos.',
    noindex: true,
    body: `<section class="section"><div class="container narrow center">
  <h1>Obrigado por entrar em contato!</h1>
  <p class="lead">Recebemos sua solicitação. Para consultar os veículos disponíveis e agilizar seu atendimento, você também pode falar diretamente com nossa equipe pelo WhatsApp.</p>
  <p><a class="btn" href="${wa(cfg.mensagemGeral)}" target="_blank" rel="noopener" data-wa="obrigado">Iniciar conversa no WhatsApp</a></p>
</div></section>`,
  }));

  // 404
  writeOut('404.html', layout({
    path: '/404.html',
    title: 'Página não encontrada | FORT Locadora de Veículos',
    description: 'A página que você procura pode ter sido movida ou não estar disponível.',
    noindex: true,
    body: `<section class="section"><div class="container narrow center">
  <p class="eyebrow">Erro 404</p>
  <h1>Ops! Não encontramos esta página.</h1>
  <p class="lead">A página que você procura pode ter sido movida ou não estar disponível.</p>
  <div class="actions actions--center">
    <a class="btn" href="/">Voltar para o início</a>
    <a class="btn btn--ghost" href="/veiculos/">Ver veículos</a>
    <a class="btn btn--ghost" href="${wa(cfg.mensagemGeral)}" target="_blank" rel="noopener" data-wa="404">Falar pelo WhatsApp</a>
  </div>
</div></section>`,
  }));

  // robots.txt e sitemap
  if (SITE_URL) {
    const today = new Date().toISOString().slice(0, 10);
    writeOut('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${SITE_URL}${p}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
    writeOut('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  } else {
    writeOut('robots.txt', `User-agent: *\nAllow: /\n`);
    warnings.push('siteUrl vazio em config/site.json: sitemap.xml, canonical, og:url e og:image não foram gerados. Preencha o domínio e rode o build novamente.');
  }
  if (!GA_ID) warnings.push('googleAnalyticsId vazio: o Google Analytics fica desativado e nenhum aviso de cookies é exibido.');
  const semFoto = veiculos.filter((v) => !Object.keys(photosBySlug[v.slug]).length).map(nomeVeiculo);
  if (semFoto.length) warnings.push(`Sem fotos (pasta fotos-originais/<slug>/): ${semFoto.join(', ')}.`);
  if (!sharp) warnings.push('Pacote "sharp" ausente: as fotos são copiadas sem otimização (rode "npm install").');

  console.log(`Site gerado em dist/ com ${pages.length} páginas indexáveis, 404 e obrigado.`);
  for (const w of warnings) console.log('AVISO:', w);
}

build().catch((e) => { console.error(e); process.exit(1); });

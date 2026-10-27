# Site da FORT Locadora de Veículos

Site estático (HTML, CSS e um JS pequeno), gerado por `build.js` a partir dos arquivos em `config/` e `data/`. O resultado fica em `dist/`, pronto para publicar em qualquer hospedagem estática (Netlify, Cloudflare Pages, Vercel, GitHub Pages, etc.).

## Comandos

```
npm install      # opcional: instala a fonte Inter e o otimizador de imagens (sharp)
npm run build    # gera o site em dist/
npm test         # build + verificação de links, WhatsApp, metadados, alt e conteúdo fictício
npm run dev      # build + servidor local em http://localhost:4173
```

Sem `npm install` o site também funciona: usa fontes do sistema e copia as fotos sem otimizar.

## Como adicionar, editar ou remover veículos

Edite `data/veiculos.json`. Cada veículo:

```json
{
  "slug": "fiat-uno",
  "marca": "Fiat",
  "modelo": "Uno",
  "ano": 2020,
  "categoria": "Econômico",
  "transmissao": "Manual",
  "lugares": 5,
  "diaria": 120,
  "condicoes": "texto confirmado pela empresa",
  "ativo": true
}
```

- Campos `null` não aparecem. Sem `diaria`, o cartão mostra "Consulte o valor". Sem `condicoes`, mostra "consulte a empresa".
- Para remover um carro do site, use `"ativo": false` ou apague o bloco.
- Depois de editar, rode `npm run build` e publique a pasta `dist/` novamente. A página do veículo, o catálogo, o sitemap e a mensagem do WhatsApp são atualizados juntos.

## Fotos

Coloque **uma foto por arquivo** em `fotos-originais/<slug>/`, com estes nomes: `frente`, `traseira`, `lado-esquerdo`, `lado-direito` (`.jpg`, `.png` ou `.webp`). Exemplo: `fotos-originais/fiat-uno/lado-esquerdo.jpg`.

- O build redimensiona e converte para WebP (com o `sharp` instalado) e preenche o texto alternativo automaticamente (ex.: "Lateral esquerda do Fiat Uno").
- O cartão usa a lateral esquerda; a página inicial usa a primeira lateral disponível.
- Enquanto não houver foto, aparece "Foto em breve". Nenhuma imagem fictícia é usada.
- Use fotos sem textos ou rótulos gravados e que mostrem o carro real da frota.

## Dados que faltam (config/site.json e data/)

| Item | Onde | Efeito ao preencher |
|---|---|---|
| Domínio do site | `siteUrl` | Gera sitemap.xml, canonical, og:url, og:image e Sitemap no robots.txt |
| Google Analytics 4 | `googleAnalyticsId` (ex.: G-XXXXXXX) | Ativa o GA4 só após o visitante aceitar o aviso de cookies; eventos `whatsapp_click` e `view_vehicle` |
| Instagram | `instagram` (URL completa) | Aparece no rodapé, no contato e nos dados estruturados |
| Endereço físico | `endereco` | Mostra mapa e rota no Google Maps e inclui o endereço nos dados estruturados |
| Diferenciais | `diferenciais` (lista de textos) | Seção "Diferenciais" em /sobre |
| Avaliações reais | `data/avaliacoes.json` | Seção só aparece com `comentario` e `fonte` (+ `nota`, `nome`, `data`, `url` se houver) |
| Experiências | `data/experiencias.json` | Seção só aparece com `titulo`, `texto` e `"autorizado": true` |

Formato de uma avaliação: `{ "nota": "5", "comentario": "...", "nome": "...", "data": "10/2026", "fonte": "Google", "url": "https://..." }`

## Páginas e rotas

`/`, `/veiculos/`, `/veiculos/<slug>/`, `/sobre/`, `/perguntas-frequentes/`, `/contato/`, `/politica-de-privacidade/`, `/404.html` e `/obrigado/`.

- `/obrigado/` existe pronta, mas **não é linkada, não entra no sitemap e tem noindex**. O site não tem formulário (o contato é pelo WhatsApp). Use essa página só se um formulário real for conectado.
- `404.html` na raiz é usado automaticamente por Netlify, Cloudflare Pages, Vercel e GitHub Pages, com status HTTP 404.

## Antes de publicar

1. Preencha `siteUrl` e rode `npm test`.
2. Troque os `null` do `data/veiculos.json` pelos dados reais confirmados.
3. Adicione as fotos reais.
4. Revise a política de privacidade (`/politica-de-privacidade/`) com a empresa e, se possível, com um profissional jurídico; ela descreve só o que o site faz hoje.
5. Teste os botões de WhatsApp no celular e valide os dados estruturados no Teste de Resultados Rich do Google.
6. Meça o desempenho no PageSpeed Insights depois de publicar.

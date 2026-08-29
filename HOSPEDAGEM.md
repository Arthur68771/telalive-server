# Colocando o TelaLive na internet (pra funcionar com amigos em qualquer lugar)

Isso é feito em duas partes:

1. **Hospedar o servidor** num serviço gratuito chamado Render
2. **Atualizar o app desktop** pra se conectar nesse servidor online

Nada disso precisa de comandos complicados — é tudo clicando em páginas
da internet.

## Parte 1 — Colocar o código no GitHub

O Render (o serviço de hospedagem) precisa buscar seu código de algum
lugar. O jeito mais simples é o GitHub.

1. Vá em [github.com](https://github.com) e crie uma conta gratuita (se
   ainda não tiver).
2. Depois de logado, clique no **"+"** no canto superior direito → **"New
   repository"**.
3. Dê um nome, tipo `telalive-server`. Deixe como **"Public"**. Não
   marque nenhuma caixinha extra. Clique em **"Create repository"**.
4. Na página que abrir, procure o link **"uploading an existing file"**
   (ou vá em "Add file" → "Upload files").
5. Arraste pra lá **todos os arquivos e pastas** que vieram dentro da
   pasta `telalive-server` que eu te mandei (server.js, db.js,
   package.json, .gitignore, e a pasta `public` inteira). **Não** suba a
   pasta `data` nem `node_modules` (se existir).
6. Role pra baixo e clique em **"Commit changes"**.

## Parte 2 — Hospedar no Render

1. Vá em [render.com](https://render.com) e crie uma conta gratuita
   (dá pra entrar direto com sua conta do GitHub, é mais rápido).
2. No painel, clique em **"New +"** → **"Web Service"**.
3. Conecte sua conta do GitHub se ele pedir, e escolha o repositório
   `telalive-server` que você acabou de criar.
4. Preencha assim:
   - **Name:** telalive (ou o nome que quiser — isso vira parte do
     endereço do site)
   - **Region:** a mais próxima de você
   - **Branch:** main
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Clique em **"Create Web Service"**.
6. Espera uns minutos — ele vai instalar tudo e ligar o servidor
   sozinho. Quando aparecer **"Live"** em verde lá em cima, funcionou.
7. Copie o endereço que aparece no topo da página, algo tipo:
   `https://telalive.onrender.com`

⚠️ **Sobre o plano gratuito:** ele "dorme" depois de alguns minutos sem
uso, e demora uns 30-50 segundos pra acordar na próxima vez que alguém
acessa. É normal, não é erro.

## Parte 3 — Atualizar o app desktop pra usar esse endereço

1. Abra o arquivo `main.js` (dentro da pasta `telalive-completo`) com o
   Bloco de Notas (clique com botão direito → Abrir com → Bloco de
   Notas).
2. Ache essa linha perto do topo:
   ```
   const SERVER_URL = "https://COLOQUE-O-ENDERECO-AQUI.onrender.com";
   ```
3. Troque pelo endereço que o Render te deu (o do passo 7 acima),
   mantendo as aspas.
4. Salve o arquivo (Ctrl+S) e feche o Bloco de Notas.
5. No PowerShell, dentro da pasta `telalive-completo`, rode `npm start`
   de novo.

Agora o app abre carregando o servidor online, não mais um servidor
local. Manda esse mesmo `main.js` atualizado (ou o instalador `.exe`
gerado com `npm run dist`) pros seus amigos, e todo mundo vai se
conectar no mesmo servidor — funcionando de qualquer lugar.

## Testando

Peça pro seu amigo abrir `https://SEU-ENDERECO.onrender.com` direto no
navegador dele (não precisa nem instalar nada). Ele cria a conta dele,
você manda o código de convite do seu servidor, e prontinho — vocês já
podem conversar e compartilhar tela mesmo estando em casas diferentes.

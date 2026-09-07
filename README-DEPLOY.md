# Failover PC + VPS Render (sem cartão) — passo a passo

Você escolheu: Render Free + arquivos separados.

## Como funciona (pra não dar conflito no Telegram)
- Mesmo TOKEN nos dois lados, mas **só um faz polling por vez** (Telegram dá 409 se dois pollarem).
- PC = primário (arquivos `C:\Users\jps3d`). Manda heartbeat POST pra VPS a cada 30s (só saída HTTPS, sem abrir porta).
- VPS = standby. Se ficar 90s sem heartbeat, assume e te avisa no Telegram. Quando o PC voltar e ficar 90s estável, devolve e te avisa.
- Avisos usam `sendMessage` direto (não precisa estar com polling), então o standby consegue avisar.

## 1) Subir a VPS no Render (10 min)
1. Crie repo privado no GitHub com o conteúdo da pasta `vps-render/` (Dockerfile, render.yaml, start.sh, server.js, monitor-vps.js, package.json). **NÃO suba `.env` com token.**
2. Em render.com > New > Web Service > conecte o repo:
   - Runtime: Docker, Plan: Free
   - Health Check Path: `/health`
3. Em Environment, adicione (manuais, secret onde der):
   - `TELEGRAM_BOT_TOKEN` = seu token
   - `TELEGRAM_ALLOWED_USER_ID` = 6024354686
   - `OPENCODE_MODEL_PROVIDER` = opencode
   - `OPENCODE_MODEL_ID` = big-pickle
   - `BOT_LOCALE` = pt
   - `ROLE` = vps
4. Deploy. Anote a URL: `https://SEU-NOME.onrender.com`
5. Teste: abra `https://SEU-NOME.onrender.com/health` — tem que dar JSON com `role: vps`.

## 2) Anti-sleep (senão o free dorme em 15 min)
1. Em uptimerobot.com (grátis, sem cartão) crie monitor HTTP(s) pra `https://SEU-NOME.onrender.com/health` a cada 5 min.
2. Isso mantém a VPS acordada dentro das 750h/mês do free (dá pra 24/7 com 1 serviço).

## 3) Ligar o PC nela
1. No PC, edite `C:\Users\jps3d\opencode-telegram\ha\failover-config.env`:
   - `VPS_URL=https://SEU-NOME.onrender.com`
2. Rode `C:\Users\jps3d\opencode-telegram\INICIAR-COM-FAILOVER.bat` (já é o que inicia com o Windows).
3. Ele sobe: OpenCode 4096 + bot daemon + health 4097 + heartbeat pra VPS.

## 4) Testar o revezamento
1. Com tudo ok, pare o bot no PC: `opencode-telegram stop`. Aguarde ~90s.
2. VPS assume e te manda: "⚠️ PC sem sinal há ~90s. Assumi...".
3. Volte o bot no PC: `opencode-telegram start --daemon`. Aguarde ~90s estável.
4. VPS devolve e te manda: "✅ PC voltou...". PC retoma sozinho.

## Limites honestos do free sem cartão
- Render Free dorme sem o UptimeRobot e tem 750h/mês — com 1 serviço + ping dá 24/7, mas pode reiniciar do nada (o monitor reconecta sozinho).
- Arquivos são separados: o que a VPS fizer não aparece no PC. Se um dia quiser igualar, a gente sincroniza via git.
- Janela de conflito de ~30s se a rede oscilar (os dois podem tentar pollarem juntos e um leva 409). O PC se auto-pausa ao ver a VPS ativa pra resolver.

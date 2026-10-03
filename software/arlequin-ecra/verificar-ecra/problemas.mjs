// O que conta como problema no ecrã da roda (1024×600), a partir do que o recolher.mjs mede no Chromium.
// Função pura (testada no npm test, test/verificar-ecra.test.mjs).
//   - um alvo de toque que não está numa lista que rola tem de estar todo à vista (dentro do ecrã, fora do
//     que os botões de baixo tapam e sem um pai que o corte);
//   - um alvo numa lista que rola chega-se lá a rolar, mas a própria lista tem de estar toda à vista (senão
//     a parte de baixo dela nunca aparece) e o alvo não pode sair para os lados;
//   - cada lista que rola na página tem uma chave data-rolar (sem ela, o desenho de 1 Hz põe-na no cimo);
//   - nenhum filho da barra de cima sai do ecrã, e o chip do alarme fica com largura para se ler;
//   - nenhum mosaico (nem as linhas dele) fica cortado sem estar numa lista que rola.

const FOLGA = 1 // px (arredondamentos)
export const CHIP_ALARME_MIN = 96 // px: a largura mínima para se ler o começo do alarme ("⚠ Água no por…")

const todo = (vis, caixa) => vis.w >= caixa.w - FOLGA && vis.h >= caixa.h - FOLGA
const nome = (a) => `${a.tag}${a.acao ? `[${a.acao}]` : ''} "${a.texto}"`

export function problemas (d) {
  const out = []
  for (const a of d.alvos || []) {
    if (!a.lista) {
      if (!todo(a.vis, a.caixa)) out.push({ tipo: 'alvo cortado', alvo: nome(a), detalhe: `caixa ${a.caixa.l},${a.caixa.t} ${a.caixa.w}×${a.caixa.h}, à vista ${a.vis.w}×${a.vis.h}` })
    } else {
      if (!todo(a.lista.vis, a.lista.caixa)) out.push({ tipo: 'lista cortada', alvo: `${a.lista.nome} (com ${nome(a)})`, detalhe: `lista ${a.lista.caixa.w}×${a.lista.caixa.h}, à vista ${a.lista.vis.w}×${a.lista.vis.h}` })
      if (a.vis.w < a.caixa.w - FOLGA && a.vis.h > 0) out.push({ tipo: 'alvo cortado de lado', alvo: nome(a), detalhe: `largura ${a.caixa.w}, à vista ${a.vis.w}` })
    }
  }
  for (const r of d.rolar || []) {
    if (!r.chave && r.scrollH > r.clientH + FOLGA) out.push({ tipo: 'lista sem data-rolar', alvo: r.nome, detalhe: `${r.scrollH} px para ${r.clientH} à vista: volta ao cimo a cada segundo` })
  }
  for (const f of d.filhosBarra || []) {
    if (f.caixa.l < -FOLGA || f.caixa.r > d.vw + FOLGA) out.push({ tipo: 'barra fora do ecrã', alvo: `${f.nome} "${f.texto}"`, detalhe: `x ${f.caixa.l}–${f.caixa.r} (ecrã ${d.vw})` })
    if (/ir-alarme|chip\.alarme|chip\.aviso/.test(f.nome) && /⚠/.test(f.texto) && f.caixa.w < CHIP_ALARME_MIN) out.push({ tipo: 'chip do alarme estreito', alvo: `${f.nome} "${f.texto}"`, detalhe: `${f.caixa.w} px (mínimo ${CHIP_ALARME_MIN})` })
  }
  // a prova da rolagem (verificar.mjs): depois de refazer a página como o app.js, cada lista fica onde estava
  for (const r of d.rolagem || []) {
    if (Math.abs((r.depois ?? -1) - r.antes) > FOLGA) out.push({ tipo: 'rolagem perdida', alvo: r.chave, detalhe: `scrollTop ${r.antes} antes de refazer, ${r.depois} depois` })
  }
  // um mosaico cortado já diz das linhas dele: só se conta a mais de fora
  const cortados = d.conteudo || []
  for (const c of cortados) {
    const dentroDeOutro = cortados.some(o => o !== c && o.caixa.l <= c.caixa.l && o.caixa.t <= c.caixa.t && o.caixa.r >= c.caixa.r && o.caixa.b >= c.caixa.b)
    if (!dentroDeOutro) out.push({ tipo: 'conteúdo cortado', alvo: `${c.nome} "${c.texto}"`, detalhe: `caixa ${c.caixa.w}×${c.caixa.h} em y ${c.caixa.t}–${c.caixa.b}, à vista ${c.vis.w}×${c.vis.h}` })
  }
  return out
}

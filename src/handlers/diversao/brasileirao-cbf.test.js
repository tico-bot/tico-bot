'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buscarTabelaCBF, parseTabelaCBFMarkdown } = require('./brasileirao-cbf');

const MARKDOWN_C = `Title: Série C
## GRUPO B
| Classificação | PTS Pontos | J Jogos | V Vitórias | E Empates | D Derrotas | GP Gols Prós | GC Gols Contras | SG Saldos |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **1**+1[![Image](https://example.com/a.png)**Maringá FC SAF**](https://example.com/maringa) | 11 | 6 | 3 | 2 | 1 | 6 | 2 | 4 |
| **2**0[![Image](https://example.com/b.png)**Santa Cruz**](https://example.com/santa) | 11 | 6 | 3 | 2 | 1 | 5 | 3 | 2 |

## GRUPO C
| Classificação | PTS Pontos | J Jogos | V Vitórias | E Empates | D Derrotas | GP Gols Prós | GC Gols Contras | SG Saldos |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **1**0[![Image](https://example.com/c.png)**Ferroviária**](https://example.com/ferroviaria) | 11 | 6 | 3 | 2 | 1 | 10 | 7 | 3 |
`;

const MARKDOWN_D = `Title: Série D
## GRUPO A1
| Classificação | PTS Pontos | J Jogos | V Vitórias | E Empates | D Derrotas | GP Gols Prós | GC Gols Contras | SG Saldos |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **1**0[![Image](https://example.com/d.png)**Manauara**](https://example.com/manauara) | 22 | 10 | 6 | 4 | 0 | 13 | 5 | 8 |
`;

test('parseTabelaCBFMarkdown lê grupos e estatísticas da Série C', () => {
  const tabelas = parseTabelaCBFMarkdown(MARKDOWN_C);
  assert.equal(tabelas.length, 2);
  assert.equal(tabelas[0].name, 'GRUPO B');
  assert.equal(tabelas[0].entries[0].team.name, 'Maringá FC SAF');
  assert.deepEqual(
    [
      tabelas[0].entries[0].points,
      tabelas[0].entries[0].matches,
      tabelas[0].entries[0].wins,
      tabelas[0].entries[0].draws,
      tabelas[0].entries[0].losses,
      tabelas[0].entries[0].goalDifference,
    ],
    [11, 6, 3, 2, 1, 4],
  );
  assert.equal(tabelas[1].entries[0].team.name, 'Ferroviária');
});

test('buscarTabelaCBF usa fallback seguro quando a conexão direta falha', async () => {
  const fetchFake = async (url) => {
    if (!url.includes('r.jina.ai')) throw new Error('certificado TLS indisponível');
    const markdown = url.includes('serie-c') ? MARKDOWN_C : MARKDOWN_D;
    return { ok: true, status: 200, text: async () => markdown };
  };

  const serieC = await buscarTabelaCBF('C', 2026, fetchFake);
  const serieD = await buscarTabelaCBF('D', 2026, fetchFake);
  assert.equal(serieC.tabelas.length, 2);
  assert.equal(serieC.tabelas[0].entries[0].team.name, 'Maringá FC SAF');
  assert.equal(serieD.tabelas[0].entries[0].team.name, 'Manauara');
  assert.equal(serieD.tabelas[0].entries[0].points, 22);
});

test('parseTabelaCBFMarkdown ignora páginas sem tabelas de grupo', () => {
  assert.deepEqual(parseTabelaCBFMarkdown('## Estatísticas\nSem classificação disponível.'), []);
});

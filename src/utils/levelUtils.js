function getNivelInfo(xp) {
  const niveis = [
    { xp: 0, nome: '🌱 Recém-saído do forno', titulo: 'Iniciante', emoji: '🌱' },
    { xp: 50, nome: '💕 Apaixonado de verdade', titulo: 'Romântico', emoji: '💕' },
    { xp: 150, nome: '💪 Sólido feito rocha', titulo: 'Sólido', emoji: '💪' },
    { xp: 300, nome: '⭐ Veterano com calo', titulo: 'Veterano', emoji: '⭐' },
    { xp: 500, nome: '🏆 Lenda viva', titulo: 'Lendário', emoji: '🏆' },
    { xp: 800, nome: '👑 IMORTAL DO AMOR', titulo: 'Imortal', emoji: '👑' },
    { xp: 1200, nome: '💎 DEUS DO RELACIONAMENTO', titulo: 'Divino', emoji: '💎' },
  ];
  let nivel = niveis[0];
  for (const n of niveis) if (xp >= n.xp) nivel = n;
  return nivel;
}

module.exports = { getNivelInfo };
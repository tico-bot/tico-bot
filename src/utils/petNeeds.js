'use strict';

const INTERVALO_NECESSIDADES_MS = 6 * 60 * 60 * 1000;
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));

function dataValida(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Aplica a deterioração em blocos de seis horas sem reiniciar o relógio a cada consulta. */
function atualizarNecessidades(pet, agora = new Date()) {
  if (!pet || typeof pet !== 'object') return pet;
  const now = dataValida(agora);
  if (!now) throw new TypeError('Data de atualização inválida.');

  const base = dataValida(pet.lastNeedsUpdate) || dataValida(pet.lastInteraction) || dataValida(pet.capturedAt) || now;
  const blocos = Math.max(0, Math.floor((now.getTime() - base.getTime()) / INTERVALO_NECESSIDADES_MS));
  if (blocos === 0) {
    return {
      ...pet,
      health: clamp(pet.health ?? 100, 1),
      hygiene: clamp(pet.hygiene ?? 100),
      lastNeedsUpdate: base,
    };
  }

  let fullness = clamp(pet.fullness ?? 100);
  let energy = clamp(pet.energy ?? 100);
  let happiness = clamp(pet.happiness ?? 60);
  let hygiene = clamp(pet.hygiene ?? 100);
  let health = clamp(pet.health ?? 100, 1);

  for (let i = 1; i <= blocos; i++) {
    fullness = clamp(fullness - 6);
    energy = clamp(energy - 2);
    if (i % 2 === 0) {
      happiness = clamp(happiness - 2);
      hygiene = clamp(hygiene - 5);
    }
    if ((fullness <= 20 || hygiene <= 20) && i % 2 === 0) {
      health = clamp(health - 3, 1);
    }
  }

  return {
    ...pet,
    fullness,
    energy,
    happiness,
    hygiene,
    health,
    lastNeedsUpdate: new Date(base.getTime() + blocos * INTERVALO_NECESSIDADES_MS),
  };
}

function obterEstagioPet(pet) {
  const nivel = Math.max(1, Number(pet?.level) || 1);
  if (nivel >= 50) return 'Lendário';
  if (nivel >= 25) return 'Adulto';
  if (nivel >= 10) return 'Jovem';
  return 'Filhote';
}

function calcularHumorPet(pet) {
  const media = (
    clamp(pet?.happiness ?? 0) +
    clamp(pet?.energy ?? 0) +
    clamp(pet?.fullness ?? 0) +
    clamp(pet?.health ?? 100) +
    clamp(pet?.hygiene ?? 100)
  ) / 5;
  if (media >= 80) return '😄 Muito feliz';
  if (media >= 60) return '😊 Feliz';
  if (media >= 40) return '😐 Normal';
  if (media >= 20) return '😟 Triste';
  return '😢 Precisa de cuidados';
}

function gerarPetId() {
  return require('crypto').randomUUID();
}

module.exports = {
  INTERVALO_NECESSIDADES_MS,
  atualizarNecessidades,
  obterEstagioPet,
  calcularHumorPet,
  gerarPetId,
};

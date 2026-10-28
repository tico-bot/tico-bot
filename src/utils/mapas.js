'use strict';

// Normaliza Maps do Mongoose/JavaScript e objetos comuns para objetos JSON.
function mapParaObjeto(valor) {
  if (valor == null) return {};
  if (valor instanceof Map) return Object.fromEntries(valor.entries());

  if (typeof valor.toObject === 'function') {
    const convertido = valor.toObject();
    if (convertido && typeof convertido === 'object' && convertido !== valor) {
      return convertido instanceof Map ? Object.fromEntries(convertido.entries()) : convertido;
    }
  }

  if (typeof valor.entries === 'function') {
    try {
      return Object.fromEntries(valor.entries());
    } catch {
      // Usa o fallback para objetos simples abaixo.
    }
  }

  if (typeof valor === 'object' && !Array.isArray(valor)) return { ...valor };
  return {};
}

// Soma contagens numéricas armazenadas em um Map/objeto, ignorando valores inválidos.
function somarMap(valor) {
  return Object.values(mapParaObjeto(valor)).reduce((total, item) => {
    const numero = typeof item === 'number'
      ? item
      : typeof item === 'string' && item.trim() !== ''
        ? Number(item)
        : NaN;
    return Number.isFinite(numero) ? total + numero : total;
  }, 0);
}

module.exports = { mapParaObjeto, somarMap };

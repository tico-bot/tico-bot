'use strict';
const mongoose = require('mongoose');

const aniversarioSchema = new mongoose.Schema({
  idWhatsApp: {
    type:      String,
    required:  true,
    unique:    true,
    trim:      true,
    lowercase: true,
  },
  nome: {
    type:    String,
    default: null,
    trim:    true,
  },
  date: {
    type:     String,
    required: true,
    trim:     true,
    validate: {
      validator: function (v) {
        if (!/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return false;
        const [day, month, year] = v.split('/').map(Number);
        if (year < 1900 || year > new Date().getFullYear()) return false;
        const testDate = new Date(year, month - 1, day);
        return testDate.getFullYear() === year && testDate.getMonth() === month - 1 && testDate.getDate() === day;
      },
      message: 'Data inválida. Use o formato DD/MM/AAAA com uma data real.',
    },
  },
}, {
  timestamps:  true,
  collection: 'aniversarios', // nome explícito no Mongo
});

module.exports = mongoose.models.Aniversario
  || mongoose.model('Aniversario', aniversarioSchema);
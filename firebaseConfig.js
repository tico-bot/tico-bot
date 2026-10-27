'use strict';

const { initializeApp } = require('firebase/app');
const { getFirestore } = require('firebase/firestore');

// Suas credenciais extraídas diretamente do console do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCsf5aIFPZNrwekWbkwuyjKEUgSiWHlJSs",
  authDomain: "botwhatsapp-74647.firebaseapp.com",
  projectId: "botwhatsapp-74647",
  storageBucket: "botwhatsapp-74647.firebasestorage.app",
  messagingSenderId: "676001100050",
  appId: "1:676001100050:web:f88c6eb293cff30f5d43cb",
  measurementId: "G-GWY5N6XW3G"
};

// Inicializa o Firebase
const app = initializeApp(firebaseConfig);

// Inicializa o banco de dados Firestore
const db = getFirestore(app);

module.exports = { db };